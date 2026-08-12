const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, checkRateLimit, recordRateLimitEvent, logAdminAction } = require('./_lib/security');

// Live capture of what a visitor is typing into the contact form / the
// checkout mini-contact form, saved (debounced, client-side) even if they
// never press "שליחה" - see the draft-saving snippet near the bottom of
// index.html and the admin panel's "טיוטות פניות" tab. One row per
// draft_id (a random id the browser keeps in sessionStorage for the
// current visit), upserted as the visitor keeps typing, and deleted the
// moment they actually submit the real form - so this table only ever
// holds genuinely unfinished attempts.
const TYPE_LABELS = {
  contact: 'contact',
  checkout_contact: 'checkout_contact',
};

// Generous compared to the real inquiry rate limit, since one visitor
// typing normally can trigger several debounced saves over a couple of
// minutes.
const DRAFT_RATE_LIMIT = { max: 40, windowMinutes: 10 };

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'form_draft', ip, DRAFT_RATE_LIMIT);
    if (!rate.allowed) {
      // Best-effort background beacon - fail silently from the visitor's
      // perspective, exactly like /api/track-visit.
      return res.status(204).end();
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      body = {};
    }

    const draftId = body && typeof body.draftId === 'string' ? body.draftId.slice(0, 100) : '';
    if (!draftId) {
      return res.status(400).json({ error: 'draftId is required.' });
    }

    const type = TYPE_LABELS[body && body.type] ? body.type : 'contact';
    const name = (body && typeof body.name === 'string') ? body.name.slice(0, 100) : null;
    const phone = (body && typeof body.phone === 'string') ? body.phone.slice(0, 20) : null;
    const email = (body && typeof body.email === 'string') ? body.email.slice(0, 150) : null;
    const message = (body && typeof body.message === 'string') ? body.message.slice(0, 2000) : null;
    const timeOnSite = Number.isFinite(Number(body && body.time_on_site_seconds))
      ? Math.max(0, Math.min(86400, Math.round(Number(body.time_on_site_seconds))))
      : null;

    // Nothing meaningful typed yet - don't bother writing an empty row.
    const hasContent = [name, phone, email, message].some((v) => v && v.trim().length >= 2);
    if (!hasContent) {
      return res.status(204).end();
    }

    await recordRateLimitEvent(supabase, 'form_draft', ip);

    // Best-effort: a logging failure should never surface to the visitor.
    try {
      await supabase.from('form_drafts').upsert(
        {
          draft_id: draftId,
          type,
          name: name || null,
          phone: phone || null,
          email: email || null,
          message: message || null,
          ip,
          time_on_site_seconds: timeOnSite,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'draft_id' }
      );
    } catch (err) {
      console.error('form-drafts upsert failed (non-fatal):', err.message);
    }

    return res.status(204).end();
  }

  if (req.method === 'DELETE' && req.query && req.query.draftId) {
    // Public self-cleanup: called right after the visitor actually
    // submits the real form, so their draft doesn't linger once it's no
    // longer "unfinished". No admin auth needed - a draftId only ever
    // deletes its own row, nothing else.
    const draftId = String(req.query.draftId).slice(0, 100);
    try {
      await supabase.from('form_drafts').delete().eq('draft_id', draftId);
    } catch (err) {
      console.error('form-drafts self-delete failed (non-fatal):', err.message);
    }
    return res.status(204).end();
  }

  // Listing / admin-deleting drafts is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data, error } = await withFriendlyError(
      supabase
        .from('form_drafts')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(200)
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ drafts: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    const all = req.query && (req.query.all === '1' || req.query.all === 'true');

    if (all) {
      const { error } = await withFriendlyError(
        supabase.from('form_drafts').delete().not('id', 'is', null)
      );
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      await logAdminAction(supabase, session.user, 'form_drafts_delete_all', null, null, getClientIp(req));
      return res.status(200).json({ ok: true });
    }

    if (!id) {
      return res.status(400).json({ error: 'id is required.' });
    }
    const { error } = await withFriendlyError(
      supabase.from('form_drafts').delete().eq('id', id)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'form_draft_delete', id, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
