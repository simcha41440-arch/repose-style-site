const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { sendEmail, escapeHtml, sanitizeEnvValue } = require('./_lib/mailer');
const {
  getClientIp,
  checkRateLimit,
  recordRateLimitEvent,
  looksLikeBot,
  logAdminAction,
} = require('./_lib/security');

const TYPE_LABELS = {
  contact: 'פנייה חדשה מעמוד צור קשר',
  checkout_contact: 'פנייה חדשה מהאתר (טופס בתוך הקופה)',
};

// Public contact/mini-contact submissions: at most 6 per IP every 10
// minutes - a real visitor rarely submits the contact form more than
// once or twice.
const INQUIRY_RATE_LIMIT = { max: 6, windowMinutes: 10 };

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Anyone submitting the contact form (or the mini contact form inside
  // checkout) can create an inquiry - no login required, same as orders.
  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'inquiry', ip, INQUIRY_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי פניות נשלחו לאחרונה. אנא נסו שוב בעוד כמה דקות.' });
    }

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Same honeypot/timing bot check used on /api/orders - see the
    // comment there for why this always returns a visible error instead
    // of a silent fake success.
    if (looksLikeBot(body)) {
      await recordRateLimitEvent(supabase, 'inquiry', ip);
      return res.status(400).json({ error: 'לא ניתן להשלים את הבקשה. אנא רעננו את הדף ונסו שוב.' });
    }

    const { type, name, phone, email, message } = body || {};
    const inquiryType = TYPE_LABELS[type] ? type : 'contact';

    if (!name) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    await recordRateLimitEvent(supabase, 'inquiry', ip);

    const inquiryId = 'INQ' + Date.now().toString().slice(-8);

    const { data, error } = await withFriendlyError(
      supabase
        .from('inquiries')
        .insert({
          inquiry_id: inquiryId,
          type: inquiryType,
          name,
          phone: phone || null,
          email: email || null,
          message: message || null,
          status: 'new',
        })
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // The inquiry is already saved and will show up in the admin panel no
    // matter what happens below. Email is best-effort only - a failure
    // here is logged but never turns an already-saved inquiry into an
    // error response for the visitor.
    try {
      const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'rstyle.israel@gmail.com';
      const title = TYPE_LABELS[inquiryType];
      const rows = [];
      rows.push(`<b>שם:</b> ${escapeHtml(name)}`);
      if (phone) rows.push(`<b>טלפון:</b> ${escapeHtml(phone)}`);
      if (email) rows.push(`<b>אימייל:</b> ${escapeHtml(email)}`);
      const html = `
        <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
          <h2 style="margin:0 0 10px;">${title}</h2>
          <p style="margin:0 0 6px;">${rows.join('<br>')}</p>
          ${message ? `<p style="margin:10px 0 0;"><b>הודעה:</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
        </div>`;
      await sendEmail({
        to: notifyTo,
        subject: `${title} - רפאוז סטייל`,
        html,
        replyTo: email || undefined,
      });
    } catch (err) {
      console.error(`Inquiry ${inquiryId}: notification email failed (non-fatal):`, err);
    }

    return res.status(201).json({ inquiry: data && data[0] });
  }

  // Listing all inquiries and updating their status is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data, error } = await withFriendlyError(
      supabase
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false })
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ inquiries: data });
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
      return res.status(400).json({ error: 'Inquiry id and status are required.' });
    }

    const { data, error } = await withFriendlyError(
      supabase
        .from('inquiries')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'inquiry_status_update', id, { status }, getClientIp(req));
    return res.status(200).json({ inquiry: data && data[0] });
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Inquiry id is required.' });
    }

    const { error } = await withFriendlyError(
      supabase.from('inquiries').delete().eq('id', id)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'inquiry_delete', id, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
