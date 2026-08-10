const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin, readSession } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, logAdminAction } = require('./_lib/security');

// Discount coupons managed from the admin panel's "קופונים" tab. Mirrors
// the product_overrides pattern in ./products.js: the storefront's
// checkout page fetches GET /api/coupons on load, so a code entered there
// is validated against whatever is active in the database right now -
// not something baked into index.html or stored only in one browser.
module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'GET') {
    // The admin panel's "קופונים" tab also calls this same GET endpoint,
    // so an authenticated admin sees every coupon (including disabled or
    // already-used ones) with full detail. Anyone else only ever sees
    // coupons that are still valid to apply.
    const session = readSession(req);

    if (session && session.admin) {
      const { data, error } = await withFriendlyError(
        supabase
          .from('coupons')
          .select('code, percent, min_subtotal, active, used_at, used_order_id, created_at, updated_at')
          .order('created_at', { ascending: false })
      );
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ coupons: data });
    }

    // Public: only expose coupons that are active AND not yet redeemed by
    // a previous order (see used_at - stamped in api/orders.js once a
    // paid order successfully claims the code), and only the fields the
    // checkout page actually needs to validate a code and compute a
    // discount - never anything internal like used_order_id/created_at.
    const { data, error } = await withFriendlyError(
      supabase
        .from('coupons')
        .select('code, percent, min_subtotal, active')
        .eq('active', true)
        .is('used_at', null)
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ coupons: data });
  }

  // Every other method (create/update/delete) is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'POST' || req.method === 'PUT') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { code, percent, minSubtotal, active, resetUsage } = body || {};
    const normalizedCode = code && String(code).trim().toUpperCase();
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Coupon code is required.' });
    }
    const percentNum = Number(percent);
    if (!Number.isFinite(percentNum) || percentNum <= 0 || percentNum > 100) {
      return res.status(400).json({ error: 'Percent must be a number between 1 and 100.' });
    }

    const upsertRow = {
      code: normalizedCode,
      percent: percentNum,
      min_subtotal: minSubtotal ? Number(minSubtotal) : null,
      active: active !== undefined ? !!active : true,
      updated_at: new Date().toISOString(),
    };
    // Editing a coupon's percent/active state never touches used_at on its
    // own (a coupon that was already redeemed stays redeemed) - the admin
    // has to explicitly ask to make it usable again via resetUsage.
    if (resetUsage) {
      upsertRow.used_at = null;
      upsertRow.used_order_id = null;
    }

    const { data, error } = await withFriendlyError(
      supabase
        .from('coupons')
        .upsert(upsertRow, { onConflict: 'code' })
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'coupon_upsert', normalizedCode, { percent: percentNum, minSubtotal, active, resetUsage: !!resetUsage }, getClientIp(req));
    return res.status(200).json({ coupon: data && data[0] });
  }

  if (req.method === 'DELETE') {
    const code = req.query && req.query.code;
    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required.' });
    }

    const { error } = await withFriendlyError(
      supabase.from('coupons').delete().eq('code', String(code).toUpperCase())
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'coupon_delete', code, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
