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

// Newsletter signups: at most 5 per IP every 10 minutes. Kept as its own
// bucket/limit (separate from INQUIRY_RATE_LIMIT above) since it's a much
// lower-friction action than filling out the contact form.
const NEWSLETTER_RATE_LIMIT = { max: 5, windowMinutes: 10 };

// Handles the newsletter signup (type: 'newsletter'). Merged into this
// file - rather than its own api/notify.js - purely to stay under
// Vercel's Hobby-plan 12-serverless-function cap (see api/admin.js for
// the full explanation of that constraint). Unlike a contact-form
// inquiry, a newsletter signup is never written to the `inquiries`
// table - it's just a best-effort pair of emails via Resend.
// `body` is already parsed by the caller (parseJsonBody can only safely
// read the request stream once per request).
async function handleNewsletterSignup(req, res, supabase, body) {
  const ip = getClientIp(req);
  if (supabase) {
    const rate = await checkRateLimit(supabase, 'newsletter', ip, NEWSLETTER_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי בקשות נשלחו לאחרונה. אנא נסו שוב בעוד כמה דקות.' });
    }
  }

  if (looksLikeBot(body)) {
    if (supabase) await recordRateLimitEvent(supabase, 'newsletter', ip);
    return res.status(400).json({ error: 'לא ניתן להשלים את הבקשה. אנא רעננו את הדף ונסו שוב.' });
  }

  const { email } = body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  if (supabase) await recordRateLimitEvent(supabase, 'newsletter', ip);

  const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'simcha41440@gmail.com';

  const businessHtml = `
    <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
      <h2 style="margin:0 0 10px;">הרשמה חדשה לדיוור</h2>
      <p style="margin:0 0 6px;"><b>אימייל:</b> ${escapeHtml(email)}</p>
    </div>`;

  const autoHtml = `
    <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
      <p>שלום,</p>
      <p>תודה שנרשמת לדיוור של רפאוז סטייל! ההרשמה שלך התקבלה בהצלחה, ותקבל/י מאיתנו עדכונים והטבות ישירות לתיבת המייל.</p>
      <p>צוות רפאוז סטייל</p>
    </div>`;

  // Await so the emails actually finish sending before this serverless
  // function's response ends (Vercel can freeze the function right after
  // that). A failure is logged but still returns ok, since the point of
  // this form is "don't leave the visitor stuck" - the failure is visible
  // in Vercel's function logs for you to debug (e.g. a bad RESEND_API_KEY).
  const results = await Promise.all([
    sendEmail({ to: notifyTo, subject: 'הרשמה חדשה לדיוור - רפאוז סטייל', html: businessHtml, replyTo: email }),
    sendEmail({ to: email, subject: 'ברוכים הבאים לדיוור - רפאוז סטייל', html: autoHtml }),
  ]);
  if (!results[0].ok) {
    console.error('inquiries(newsletter): business email FAILED:', results[0].error);
  }

  return res.status(200).json({ ok: true });
}

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
    // Parse once up front - the raw request stream can only be consumed
    // once, so every POST branch below (newsletter or inquiry) shares
    // this same parsed body instead of each calling parseJsonBody itself.
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Newsletter signups are a different shape entirely (no name/message,
    // never saved to the inquiries table) - branch off to their own
    // handler before the inquiry-specific rate limit/validation below.
    if (body && body.type === 'newsletter') {
      return handleNewsletterSignup(req, res, supabase, body);
    }

    const ip = getClientIp(req);
    const rate = await checkRateLimit(supabase, 'inquiry', ip, INQUIRY_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי פניות נשלחו לאחרונה. אנא נסו שוב בעוד כמה דקות.' });
    }

    // Same honeypot/timing bot check used on /api/orders - see the
    // comment there for why this always returns a visible error instead
    // of a silent fake success.
    if (looksLikeBot(body)) {
      await recordRateLimitEvent(supabase, 'inquiry', ip);
      return res.status(400).json({ error: 'לא ניתן להשלים את הבקשה. אנא רעננו את הדף ונסו שוב.' });
    }

    const { type, name, phone, email, message, time_on_site_seconds } = body || {};
    const inquiryType = TYPE_LABELS[type] ? type : 'contact';
    // Sanity-bound: a plain integer, capped at 24h - never trust the
    // client's number blindly, but it's only ever used for the "🔥 חם /
    // ❄️ קר" admin badge, not for anything security-sensitive.
    const timeOnSite = Number.isFinite(Number(time_on_site_seconds))
      ? Math.max(0, Math.min(86400, Math.round(Number(time_on_site_seconds))))
      : null;

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
          time_on_site_seconds: timeOnSite,
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
      const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'simcha41440@gmail.com';
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

    // Confirmation to the person who submitted the form - only if they
    // gave an email address. Same best-effort treatment as the business
    // notification above: never turns an already-saved inquiry into an
    // error response for the visitor.
    if (email) {
      try {
        const confirmHtml = `
          <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
            <p>שלום ${escapeHtml(name)},</p>
            <p>הפנייה שלך התקבלה בהצלחה ומספרה <b>${escapeHtml(inquiryId)}</b>. אנו נחזור אליך בהקדם האפשרי.</p>
            ${message ? `<p style="margin:14px 0 0;"><b>ההודעה ששלחת:</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
            <p style="margin:14px 0 0;">תודה,<br>צוות רפאוז סטייל</p>
          </div>`;
        await sendEmail({
          to: email,
          subject: `הפנייה שלך התקבלה - רפאוז סטייל`,
          html: confirmHtml,
        });
      } catch (err) {
        console.error(`Inquiry ${inquiryId}: customer confirmation email failed (non-fatal):`, err);
      }
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
