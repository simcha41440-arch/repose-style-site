const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { sendOrderNotificationEmails } = require('./_lib/orderEmails');
const {
  getClientIp,
  checkRateLimit,
  recordRateLimitEvent,
  looksLikeBot,
  logAdminAction,
} = require('./_lib/security');
const { buildPriceMap, computeSubtotal, verifyItems, shippingPrice, couponDiscount } = require('./_lib/pricing');

// Public order submissions: at most 8 per IP every 10 minutes. Generous
// enough for a real customer placing a couple of gift orders in one
// session, tight enough to stop a script from flooding the database and
// the order-notification inbox.
const ORDER_RATE_LIMIT = { max: 8, windowMinutes: 10 };

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Anyone can place an order from the storefront checkout.
  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'order', ip, ORDER_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי הזמנות נשלחו לאחרונה. אנא נסו שוב בעוד כמה דקות.' });
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Honeypot/timing bot check. Never silently swallow a submission as a
    // fake "success" - a real order must always either save for real or
    // surface a visible error, so a rare false positive just means the
    // visitor tries again instead of believing an order went through
    // that never actually happened.
    if (looksLikeBot(body)) {
      await recordRateLimitEvent(supabase, 'order', ip);
      return res.status(400).json({ error: 'לא ניתן להשלים את הבקשה. אנא רעננו את הדף ונסו שוב.' });
    }

    const { customer, items, total, notes, couponCode } = body || {};

    if (!customer || !customer.name || !customer.phone) {
      return res.status(400).json({ error: 'Customer name and phone are required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    // --- Server-side price verification ---------------------------------
    // Never trust the client-submitted `total` (or per-item `price`
    // fields) as-is: the browser computes those from prices sitting in
    // its own memory, and nothing stops a tampered request from claiming
    // a lower total than the real one. Recompute the subtotal/discount/
    // shipping/total from the actual catalog + live product_overrides and
    // reject the order if it doesn't match. See api/_lib/pricing.js.
    const { data: overrideRows, error: overrideErr } = await withFriendlyError(
      supabase.from('product_overrides').select('*').eq('active', true)
    );
    if (overrideErr) {
      return res.status(500).json({ error: overrideErr.message });
    }
    const priceMap = buildPriceMap(overrideRows);
    const { subtotal: verifiedSubtotal, unknownIds, outOfStockIds } = computeSubtotal(priceMap, items);
    if (unknownIds.length > 0) {
      return res.status(400).json({ error: 'עגלת הקניות מכילה מוצר לא מוכר. אנא רעננו את העמוד ונסו שוב.' });
    }
    if (outOfStockIds.length > 0) {
      return res.status(400).json({ error: 'אחד המוצרים בעגלה אזל מהמלאי בינתיים. אנא הסירו אותו ונסו שוב.' });
    }

    const normalizedCoupon = couponCode ? String(couponCode).trim().toUpperCase() : null;
    let couponRowForCheck = null;
    if (normalizedCoupon) {
      const { data: couponRows } = await withFriendlyError(
        supabase
          .from('coupons')
          .select('code, percent, min_subtotal, active, used_at')
          .eq('code', normalizedCoupon)
          .limit(1)
      );
      const row = couponRows && couponRows[0];
      if (row && row.active && !row.used_at) couponRowForCheck = row;
    }
    const verifiedDiscount = couponDiscount(verifiedSubtotal, couponRowForCheck);
    const verifiedShipping = shippingPrice(verifiedSubtotal, customer.shipping_method);
    const verifiedTotal = Math.max(0, verifiedSubtotal - verifiedDiscount + verifiedShipping);

    const submittedTotal = Number(total);
    // Allow a 1-שקל cushion for rounding, nothing more - anything wider is
    // exactly the kind of small-but-real discrepancy price tampering relies on.
    if (!Number.isFinite(submittedTotal) || Math.abs(submittedTotal - verifiedTotal) > 1) {
      console.error('Order rejected - total mismatch:', {
        ip, submittedTotal, verifiedTotal, verifiedSubtotal, verifiedDiscount, verifiedShipping,
      });
      return res.status(400).json({
        error: 'הסכום לתשלום אינו תואם למחירי המוצרים בפועל. אנא רעננו את העמוד ונסו שוב.',
      });
    }

    // Store the server-verified per-line prices, never the client-supplied
    // ones - even though the total already checked out above, this keeps
    // the saved order record itself trustworthy for the admin panel.
    const verifiedItems = verifyItems(priceMap, items);

    await recordRateLimitEvent(supabase, 'order', ip);

    const orderId = 'RS' + Date.now().toString().slice(-8);

    // Single-use coupon redemption: this happens AFTER payment has already
    // been captured by Tranzila (saveOrder() in index.html only ever runs
    // once the payment iframe reports success), so we must never fail or
    // orphan an already-paid order over a coupon problem. Instead we make
    // a best-effort atomic claim - a single conditional UPDATE that only
    // succeeds if the code is still active and unused, which Postgres
    // guarantees is race-safe even if two checkouts finish at the same
    // instant. Once claimed, GET /api/coupons stops returning the code to
    // anyone else. If the claim fails (already used elsewhere, or the
    // extremely rare simultaneous race), we just log it and still save
    // the order the customer already paid for.
    if (normalizedCoupon) {
      try {
        const { data: claimed, error: claimErr } = await supabase
          .from('coupons')
          .update({ used_at: new Date().toISOString(), used_order_id: orderId })
          .eq('code', normalizedCoupon)
          .eq('active', true)
          .is('used_at', null)
          .select();
        if (claimErr) {
          console.error(`Order ${orderId}: coupon claim for "${normalizedCoupon}" failed:`, claimErr.message);
        } else if (!claimed || claimed.length === 0) {
          console.warn(`Order ${orderId}: coupon "${normalizedCoupon}" was already used or is no longer active - order still proceeds.`);
        }
      } catch (err) {
        console.error(`Order ${orderId}: unexpected error while claiming coupon "${normalizedCoupon}":`, err);
      }
    }

    const { data, error } = await withFriendlyError(
      supabase
        .from('orders')
        .insert({
          order_id: orderId,
          customer,
          items: verifiedItems,
          total: verifiedTotal,
          notes: notes ?? null,
          status: 'new',
        })
        .select()
    );

    if (error) {
      // The order itself failed to save, so if we'd already claimed a
      // coupon for it above, release that claim back so the code isn't
      // wasted on an order that never actually happened.
      if (normalizedCoupon) {
        try {
          await supabase
            .from('coupons')
            .update({ used_at: null, used_order_id: null })
            .eq('code', normalizedCoupon)
            .eq('used_order_id', orderId);
        } catch (err) {
          console.error(`Order ${orderId}: failed to release coupon "${normalizedCoupon}" after order save failure:`, err);
        }
      }
      return res.status(500).json({ error: error.message });
    }

    // The order is already safely saved in Supabase at this point - it will
    // show up in the admin panel no matter what happens below. We AWAIT
    // the emails (rather than firing and responding immediately) because
    // Vercel can freeze/terminate a serverless function right after it
    // sends its response, which would silently kill an un-awaited send.
    // A Resend problem is only logged - it never turns an already-saved
    // order into an error response for the customer.
    try {
      await sendOrderNotificationEmails({ orderId, customer, items: verifiedItems, total: verifiedTotal, notes: notes ?? null });
    } catch (err) {
      console.error(`Order ${orderId}: unexpected error while sending notification emails:`, err);
    }

    return res.status(201).json({ order: data && data[0] });
  }

  // Listing all orders and updating their status is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data, error } = await withFriendlyError(
      supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ orders: data });
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { id, status } = body || {};
    if (!id || !status) {
      return res.status(400).json({ error: 'Order id and status are required.' });
    }

    const { data, error } = await withFriendlyError(
      supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'order_status_update', id, { status }, getClientIp(req));
    return res.status(200).json({ order: data && data[0] });
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Order id is required.' });
    }

    const { error } = await withFriendlyError(
      supabase.from('orders').delete().eq('id', id)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'order_delete', id, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
