const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, logAdminAction } = require('./_lib/security');

// Simple key/value store for editable site text and images (see the admin
// panel's "עריכת תוכן" tab). The storefront fetches GET /api/content on
// load and applies any saved value onto whatever element in index.html
// carries a matching data-content-key attribute (hero title/subtitle/
// slides, About page title/intro/photo/paragraphs) - see
// applyContentOverrides() in index.html. Anything not saved here just
// keeps showing the text/image already baked into the HTML file.
module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'GET') {
    const { data, error } = await withFriendlyError(
      supabase.from('site_content').select('key, value, updated_at')
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    // Cache at Vercel's edge so repeat visits don't wait on a fresh
    // Supabase round-trip every time. Admin edits show up within ~60s
    // (stale-while-revalidate keeps serving the cached copy instantly
    // while a fresh one is fetched in the background).
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');
    return res.status(200).json({ content: data });
  }

  // Only the admin panel can change site content.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'POST' || req.method === 'PUT') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { key, value } = body || {};
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Content key is required.' });
    }

    const { data, error } = await withFriendlyError(
      supabase
        .from('site_content')
        .upsert(
          { key, value: value != null ? String(value) : null, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'content_upsert', key, { value }, getClientIp(req));
    return res.status(200).json({ content: data && data[0] });
  }

  // Delete a saved override so the storefront falls back to whatever is
  // baked into index.html for that key - i.e. an "undo" for a single
  // saved text/image change (see the "מחיקה - חזרה למקור" button next to
  // each image field on the admin panel's "עריכת תוכן" tab).
  if (req.method === 'DELETE') {
    const key = req.query && req.query.key;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Content key is required.' });
    }

    const { error } = await withFriendlyError(
      supabase.from('site_content').delete().eq('key', key)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'content_delete', key, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
