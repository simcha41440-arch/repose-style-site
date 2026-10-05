const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, checkRateLimit, recordRateLimitEvent, logAdminAction } = require('./_lib/security');
const { sendPaymentPendingEmail } = require('./_lib/orderEmails');

// Tracks every time a customer reaches the payment step - not just the
// orders that end up completed and saved via /api/orders. A row is
// created with status "started" the moment the Tranzila iframe opens
// (see openPaymentModal() in index.html), then updated to "success" or
// "failed" either by the customer's own browser (the postMessage result
// handler) or - more reliably, since it doesn't depend on the shopper
// staying on the page - by Tranzila's own server-to-server notify
// callback (see api/payment/tranzila-notify.js). This is what makes
// abandoned/declined checkouts visible in the admin panel's "ניסיונות
// תשלום" tab, where before they simply vanished.
const ATTEMPT_RATE_LIMIT = { max: 20, windowMinutes: 10 };
// The PUT below is intentionally public (the shopper's own browser calls it,
// before they're ever "logged in" anywhere) - but it should only ever be
// able to *finalize* an attempt it already knows the id of, never spawn one
// or flip an already-finalized attempt back and forth.
const PUT_ALLOWED_STATUSES = ['success', 'failed'];


// The POST below is public, so everything stored/emailed is whitelisted and
// length-capped here rather than trusted as-is.
const str = (v, max) => (v == null || v === '' ? null : String(v).slice(0, max || 300));
function sanitizeCustomer(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    name: str(c.name),
    first_name: str(c.first_name),
    last_name: str(c.last_name),
    email: str(c.email),
    phone: str(c.phone, 40),
    phone2: str(c.phone2, 40),
    address: str(c.address),
    city: str(c.city),
    zip: str(c.zip, 20),
    shipping_method: str(c.shipping_method, 60),
    notes: str(c.notes, 2000),
    gift_message: str(c.gift_message, 1000),
    coupon: str(c.coupon, 60),
  };
}
function sanitizeItems(items) {
  if (!Array.isArray(items)) return null;
  return items.slice(0, 60).map((it) => ({
    id: str(it && it.id, 80),
    name: str(it && it.name, 200),
    qty: Math.max(0, Math.min(1000, Number(it && it.qty) || 0)),
    price: it && it.price != null && !isNaN(Number(it.price)) ? Number(it.price) : null,
    size: str(it && it.size, 40),
    embroidery: str(it && it.embroidery, 60),
    color: str(it && it.color, 60),
  }));
}
const num = (v) => (v != null && !isNaN(Number(v)) ? Number(v) : null);

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'order_attempt', ip, ATTEMPT_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי ניסיונות. אנא נסו שוב בעוד כמה דקות.' });
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { attemptId, mode, customer, items, subtotal, discount, shipping, total } = body || {};
    // mode "awaiting_payment": the shopper pressed pay while the Tranzila
    // terminal isn't connected yet - the order is kept in full and the
    // business inbox gets an email so the payment can be completed by phone.
    const awaiting = mode === 'awaiting_payment';
    const cleanCustomer = sanitizeCustomer(customer);
    const cleanItems = sanitizeItems(items);
    if (!attemptId) {
      return res.status(400).json({ error: 'attemptId is required.' });
    }

    await recordRateLimitEvent(supabase, 'order_attempt', ip);

    const { data, error } = await withFriendlyError(
      supabase
        .from('order_attempts')
        .insert({
          attempt_id: String(attemptId).slice(0, 100),
          customer: cleanCustomer,
          items: cleanItems,
          subtotal: num(subtotal),
          discount: num(discount),
          shipping: num(shipping),
          total: num(total),
          status: awaiting ? 'awaiting_payment' : 'started',
          ip,
        })
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (awaiting) {
      await sendPaymentPendingEmail({
        attemptId: String(attemptId).slice(0, 100),
        customer: cleanCustomer,
        items: cleanItems,
        subtotal: num(subtotal),
        discount: num(discount),
        shipping: num(shipping),
        total: num(total),
      });
    }
    return res.status(201).json({ attempt: data && data[0] });
  }

  if (req.method === 'PUT') {
    // Best-effort client-side status update (the browser knows the
    // result immediately after the redirect, before Tranzila's own
    // server-to-server notify callback necessarily arrives). Intentionally
    // not admin-gated - the shopper's own browser needs to call this -
    // but it can only ever move a status forward, never touch amounts or
    // customer data, so there's nothing meaningful to abuse here.
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'order_attempt_update', ip, ATTEMPT_RATE_LIMIT);
    if (!rate.allowed) {
      return res.status(429).json({ error: 'יותר מדי ניסיונות. אנא נסו שוב בעוד כמה דקות.' });
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { attemptId, status } = body || {};
    if (!attemptId || !PUT_ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Valid attemptId and status are required.' });
    }

    await recordRateLimitEvent(supabase, 'order_attempt_update', ip);

    // Only ever finalize an attempt that's still "started" - never let this
    // public endpoint flip an already-finalized row (e.g. one Tranzila's own
    // server-to-server callback already marked "success") back to "failed"
    // or vice versa. A stale/duplicate call from the shopper's browser after
    // the real result already landed is simply a no-op.
    const { error } = await withFriendlyError(
      supabase
        .from('order_attempts')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('attempt_id', String(attemptId).slice(0, 100))
        .eq('status', 'started')
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  // Listing attempts is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data, error } = await withFriendlyError(
      supabase
        .from('order_attempts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ attempts: data });
  }

  if (req.method === 'DELETE') {
    // Occasionally useful for clearing out test transactions.
    const attemptId = req.query && req.query.attemptId;
    if (!attemptId) {
      return res.status(400).json({ error: 'attemptId is required.' });
    }
    const { error } = await withFriendlyError(
      supabase.from('order_attempts').delete().eq('attempt_id', attemptId)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'order_attempt_delete', attemptId, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
