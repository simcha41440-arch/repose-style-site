const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, checkRateLimit, recordRateLimitEvent } = require('./_lib/security');

// Records one row per real page load of the storefront (index.html calls
// this once on load, only after the cookie-consent bar has been
// accepted - see the tracking snippet near the bottom of index.html), so
// the admin panel's "ביקורים באתר" tab shows genuine visits rather than
// every internal SPA view change.
//
// Public write / admin-only read, same split as every other table here.
const VISIT_RATE_LIMIT = { max: 60, windowMinutes: 10 };

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'visit', ip, VISIT_RATE_LIMIT);
    if (!rate.allowed) {
      // Fail silently from the visitor's perspective - this is a
      // best-effort background beacon, never something worth showing an
      // error for.
      return res.status(204).end();
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      body = {};
    }

    await recordRateLimitEvent(supabase, 'visit', ip);

    const path = (body && typeof body.path === 'string') ? body.path.slice(0, 300) : '/';
    const referrer = (body && typeof body.referrer === 'string') ? body.referrer.slice(0, 500) : null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 400);

    // Best-effort: a logging failure should never surface to the visitor.
    try {
      await supabase.from('site_visits').insert({
        path,
        referrer: referrer || null,
        ip,
        user_agent: userAgent || null,
      });
    } catch (err) {
      console.error('track-visit insert failed (non-fatal):', err.message);
    }

    return res.status(204).end();
  }

  // Listing visits is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { count } = await supabase
      .from('site_visits')
      .select('id', { count: 'exact', head: true });

    const { data, error } = await withFriendlyError(
      supabase
        .from('site_visits')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ visits: data, total: count || (data ? data.length : 0) });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
};
