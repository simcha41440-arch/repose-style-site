// Server-verified checkout total. Called from index.html's
// openPaymentModal() right before the Tranzila payment iframe is built,
// so the amount actually charged is the one *this* endpoint computed -
// never a number the browser computed on its own. See api/_lib/pricing.js
// for why this matters, and api/orders.js for the matching check that
// also runs when the order itself is saved (defense in depth: even if
// this endpoint were somehow skipped, a tampered order still gets
// rejected there).
//
// Public, unauthenticated (same trust level as GET /api/products and
// GET /api/coupons - anyone can price a cart), rate-limited per IP.

const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, checkRateLimit, recordRateLimitEvent } = require('./_lib/security');
const { buildPriceMap, computeSubtotal, shippingPrice, couponDiscount } = require('./_lib/pricing');

// Generous - this gets called every time the payment modal opens, plus
// whenever the checkout page re-prices the cart (coupon applied, shipping
// method changed, etc.), but it's a read-only calculation with no email/
// DB-write side effects, so a higher ceiling than the write endpoints is fine.
const CHECKOUT_TOTAL_RATE_LIMIT = { max: 60, windowMinutes: 10 };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const ip = getClientIp(req);
  const rate = await checkRateLimit(supabase, 'checkout_total', ip, CHECKOUT_TOTAL_RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'יותר מדי בקשות. אנא נסו שוב בעוד רגע.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await recordRateLimitEvent(supabase, 'checkout_total', ip);

  const { items, couponCode, shippingMethod } = body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'עגלת הקניות ריקה.' });
  }

  const { data: overrideRows, error: overrideErr } = await withFriendlyError(
    supabase.from('product_overrides').select('*').eq('active', true)
  );
  if (overrideErr) {
    return res.status(500).json({ error: overrideErr.message });
  }
  const priceMap = buildPriceMap(overrideRows);

  const { subtotal, unknownIds, outOfStockIds } = computeSubtotal(priceMap, items);
  if (unknownIds.length > 0) {
    return res.status(400).json({ error: 'עגלת הקניות מכילה מוצר לא מוכר. אנא רעננו את העמוד ונסו שוב.' });
  }
  if (outOfStockIds.length > 0) {
    return res.status(400).json({ error: 'אחד המוצרים בעגלה אזל מהמלאי בינתיים. אנא הסירו אותו ונסו שוב.' });
  }

  let coupon = null;
  const normalizedCoupon = couponCode ? String(couponCode).trim().toUpperCase() : null;
  if (normalizedCoupon) {
    const { data: couponRows } = await withFriendlyError(
      supabase
        .from('coupons')
        .select('code, percent, min_subtotal, active, used_at')
        .eq('code', normalizedCoupon)
        .limit(1)
    );
    const row = couponRows && couponRows[0];
    if (row && row.active && !row.used_at) coupon = row;
  }

  const discount = couponDiscount(subtotal, coupon);
  const shipping = shippingPrice(subtotal, shippingMethod);
  const total = Math.max(0, subtotal - discount + shipping);

  return res.status(200).json({
    subtotal,
    discount,
    shipping,
    total,
    couponApplied: coupon ? coupon.code : null,
  });
};
