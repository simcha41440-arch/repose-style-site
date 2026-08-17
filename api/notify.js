const { parseJsonBody } = require('./_lib/parseJson');
const { sendEmail, escapeHtml, sanitizeEnvValue } = require('./_lib/mailer');
const { getSupabase } = require('./_lib/supabase');
const {
  getClientIp,
  checkRateLimit,
  recordRateLimitEvent,
  looksLikeBot,
} = require('./_lib/security');

// Newsletter signups: at most 5 per IP every 10 minutes.
const NEWSLETTER_RATE_LIMIT = { max: 5, windowMinutes: 10 };

// Handles the newsletter signup only. Contact-form and checkout mini
// contact-form submissions go through /api/inquiries instead, which saves
// them to the database (so they always show up in the admin panel, even
// if the notification email happens to fail).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Rate limiting here is best-effort only - if Supabase isn't reachable
  // we still let the signup through rather than breaking a low-stakes
  // form because of an unrelated outage.
  let supabase = null;
  try {
    supabase = getSupabase();
  } catch (err) {
    supabase = null;
  }
  const ip = getClientIp(req);
  if (supabase) {
    const rate = await checkRateLimit(supabase, 'newsletter', ip, NEWSLETTER_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'יותר מדי בקשות נשלחו לאחרונה. אנא נסו שוב בעוד כמה דקות.' });
    }
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (looksLikeBot(body)) {
    if (supabase) await recordRateLimitEvent(supabase, 'newsletter', ip);
    return res.status(400).json({ error: 'לא ניתן להשלים את הבקשה. אנא רעננו את הדף ונסו שוב.' });
  }

  const { type, email } = body || {};
  if (type !== 'newsletter') {
    return res.status(400).json({ error: 'Unknown notification type.' });
  }
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  if (supabase) await recordRateLimitEvent(supabase, 'newsletter', ip);

  const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'rstyle.israel@gmail.com';

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
    console.error('notify(newsletter): business email FAILED:', results[0].error);
  }

  return res.status(200).json({ ok: true });
};
