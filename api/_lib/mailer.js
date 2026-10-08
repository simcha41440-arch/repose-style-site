// Sends transactional emails through Resend's HTTP API (https://resend.com).
//
// IMPORTANT SETUP STEP (do this in Vercel > Project Settings > Environment
// Variables, for the Production environment, then redeploy):
//   RESEND_API_KEY     - the API key from resend.com/api-keys (you already
//                         created one called "Rstyle" - copy its value here).
//   RESEND_FROM_EMAIL  - who the emails appear to come from, e.g.
//                         "רפאוז סטייל <orders@reposestyle.com>".
//                         This address's DOMAIN must be verified under
//                         resend.com/domains (add the DNS records Resend
//                         gives you to your domain's DNS settings). Until
//                         the domain is verified, Resend will only actually
//                         deliver mail sent from its shared test address
//                         (onboarding@resend.dev) to the email address of
//                         the Resend account owner - it will silently fail
//                         for any other recipient.
//   ORDER_NOTIFY_EMAIL - the business inbox that should receive new-order
//                         and contact-form alerts, e.g. simcha41440@gmail.com

const RESEND_API_URL = 'https://api.resend.com/emails';

function sanitizeEnvValue(value) {
  if (typeof value !== 'string') return value;
  return value
    // Strip invisible Unicode direction/format marks (RLM, LRM, ZWSP, BOM,
    // line/paragraph separators). These get silently inserted when a value
    // is typed or pasted into a browser page that Chrome has auto-translated
    // (e.g. Vercel's dashboard translated to Hebrew) - invisible on screen,
    // but they corrupt the value enough that Resend silently rejects it.
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sends one email via Resend. Never throws - always resolves to
// { ok: true, id } or { ok: false, error }, so a mail problem never
// crashes the API route that called it (the order/contact was already
// saved/handled before this runs).
// Pulls clean email addresses out of whatever was given (a single string,
// a comma/semicolon/space separated list, "Name <a@b.com>", an array, a
// value with invisible RTL marks or Hebrew text around it from a Hebrew
// keyboard / auto-translated page). Resend rejects the whole request with
// "Invalid `to` field" if even one entry isn't a bare valid address.
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;
function extractEmails(value) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    const clean = String(item).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
    const found = clean.match(EMAIL_RE) || [];
    for (const e of found) {
      const addr = e.replace(/^[.\-]+|[.\-]+$/g, '');
      if (!out.some((x) => x.toLowerCase() === addr.toLowerCase())) out.push(addr);
    }
  }
  return out;
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const apiKey = sanitizeEnvValue(process.env.RESEND_API_KEY);
  const from = sanitizeEnvValue(process.env.RESEND_FROM_EMAIL) || 'רפאוז סטייל <onboarding@resend.dev>';

  if (!apiKey) {
    const msg = 'RESEND_API_KEY is not set in Vercel - email was NOT sent.';
    console.error(msg, { subject, to });
    return { ok: false, error: msg };
  }

  const recipients = extractEmails(to);
  if (!recipients.length) {
    const msg = `כתובת הנמען לא תקינה ("${String(Array.isArray(to) ? to.join(', ') : (to == null ? '' : to)).slice(0, 80)}") - יש לכתוב כתובת מייל מלאה, למשל name@gmail.com`;
    console.error('sendEmail: no valid recipient for "%s": %j', subject, to);
    return { ok: false, error: msg };
  }

  const payload = {
    from,
    to: recipients,
    subject,
    html,
  };
  if (text) payload.text = text;
  const replyList = replyTo ? extractEmails(replyTo) : [];
  if (replyList.length) payload.reply_to = replyList;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let body = null;
    try { body = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok) {
      const errMsg = (body && (body.message || body.error)) || `Resend responded with HTTP ${res.status}`;
      console.error('Resend API error while sending "%s" to %s: %s', subject, to, errMsg);
      return { ok: false, error: errMsg };
    }

    return { ok: true, id: body && body.id };
  } catch (err) {
    console.error('Failed to reach Resend API for "%s" to %s: %s', subject, to, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  extractEmails, sendEmail, escapeHtml, sanitizeEnvValue };
