// All admin-only, non-resource endpoints live in this ONE file, routed by
// ?action=. This isn't a stylistic choice - Vercel's Hobby plan caps a
// project at 12 serverless functions total, and every file under /api
// (other than _lib helpers) counts as one. Splitting login/logout/
// session/audit-log/image-upload into five separate files (as they used
// to be) pushed the project over that limit and broke deployment
// ("No more than 12 Serverless Functions..."). Merging them here, plus
// the resource-style endpoints (orders.js, products.js, coupons.js, etc.)
// staying as-is, keeps the project comfortably under the cap with room
// to add a couple more features later without hitting this again.
//
// Routes (all under /api/admin):
//   GET  /api/admin?action=session       - am I logged in?
//   POST /api/admin?action=login         - { username, password }
//   POST /api/admin?action=logout
//   GET  /api/admin?action=audit-log     - admin action log + failed logins
//   POST /api/admin?action=upload-image  - { filename, dataUrl } -> { url }
//   POST /api/admin?action=test-email    - { to? } -> sends a real test email

const crypto = require('crypto');
const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const {
  createSessionCookie,
  clearSessionCookie,
  readSession,
  requireAdmin,
  MAX_AGE_SECONDS,
} = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const {
  getClientIp,
  checkLoginLockout,
  recordLoginAttempt,
  logAdminAction,
} = require('./_lib/security');
const { sendEmail, sanitizeEnvValue } = require('./_lib/mailer');
// Reusing the same scrypt-based hashPassword/verifyPassword the customer
// account system already uses (see api/_lib/customerSession.js) - it's a
// generic password-hashing helper, not actually tied to customer sessions.
const { hashPassword, verifyPassword } = require('./_lib/customerSession');

function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(String(a ?? ''));
  const bBuf = Buffer.from(String(b ?? ''));
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf); // still run a comparison so failure timing doesn't leak length info
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function handleSession(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const session = readSession(req);
  if (session && session.admin) {
    return res.status(200).json({ authenticated: true, user: session.user });
  }
  return res.status(200).json({ authenticated: false });
}

// Looks up a saved admin_credentials row (see NEW-ADMIN-FEATURES-SETUP.sql).
// Returns null if the table doesn't exist yet, is empty, or on any DB
// error - every caller treats null as "fall back to the environment
// variables", so this never turns a DB hiccup into a lockout.
async function getSavedCredentials(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('admin_credentials').select('username, password_hash').eq('id', 1).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Checks a username/password against whichever credential source is
// currently active: the admin_credentials DB row if one has been saved
// (i.e. the admin used "שינוי פרטי התחברות" at least once), otherwise the
// ADMIN_USERNAME/ADMIN_PASSWORD environment variables - same as before
// this feature existed.
async function checkCredentials(supabase, username, password) {
  const saved = await getSavedCredentials(supabase);
  if (saved) {
    const userOk = timingSafeEqualStr(username, saved.username);
    const passOk = userOk && verifyPassword(password, saved.password_hash);
    return { success: userOk && passOk, usingSaved: true };
  }
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return { success: false, notConfigured: true, usingSaved: false };
  }
  const userOk = timingSafeEqualStr(username, expectedUser);
  const passOk = timingSafeEqualStr(password, expectedPass);
  return { success: userOk && passOk, usingSaved: false };
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { username, password } = body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const ip = getClientIp(req);

  let supabase = null;
  try {
    supabase = getSupabase();
  } catch (err) {
    supabase = null;
  }

  if (supabase) {
    const lockout = await checkLoginLockout(supabase, ip);
    if (lockout.locked) {
      const minutes = Math.ceil(lockout.retryAfterSeconds / 60);
      res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
      return res.status(429).json({
        error: `יותר מדי ניסיונות התחברות כושלים. נסו שוב בעוד כ-${minutes} דקות.`,
      });
    }
  }

  const result = await checkCredentials(supabase, username, password);
  if (result.notConfigured) {
    return res.status(500).json({ error: 'Admin credentials are not configured on the server.' });
  }
  const success = result.success;

  if (supabase) {
    await recordLoginAttempt(supabase, ip, username, success);
  }

  if (!success) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  if (supabase) {
    await logAdminAction(supabase, username, 'login', null, null, ip);
  }

  const cookie = createSessionCookie({
    admin: true,
    user: username,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  });

  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const session = readSession(req);
    if (session && session.admin) {
      const supabase = getSupabase();
      await logAdminAction(supabase, session.user, 'logout', null, null, getClientIp(req));
    }
  } catch (err) {
    // ignore - logging out must always succeed regardless of DB state
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
}

// Lets the logged-in admin change their own username/password from inside
// the admin panel ("הגדרות התחברות"). Requires the CURRENT password as
// confirmation (checked against whichever source - saved DB row or env
// vars - is currently active), then saves the new username + a freshly
// hashed password into admin_credentials. From that point on, login always
// uses this saved row and the ADMIN_USERNAME/ADMIN_PASSWORD environment
// variables are ignored (see checkCredentials above) - so it's worth
// picking a password you'll remember, since there's no "forgot password"
// flow for the admin account the way there is for customers.
async function handleChangeCredentials(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const currentPassword = (body && body.currentPassword) || '';
  const newUsername = ((body && body.newUsername) || '').trim();
  const newPassword = (body && body.newPassword) || '';

  if (!currentPassword) {
    return res.status(400).json({ error: 'יש להזין את הסיסמה הנוכחית לאימות.' });
  }
  if (!newUsername) {
    return res.status(400).json({ error: 'יש להזין שם משתמש חדש.' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'הסיסמה החדשה חייבת להכיל לפחות 8 תווים.' });
  }

  // Verify the current password against whichever credential source is
  // currently active, using the CURRENT username (session.user) - not
  // newUsername, since the caller is proving they know the password for
  // the account they're already logged in as.
  const check = await checkCredentials(supabase, session.user, currentPassword);
  if (!check.success) {
    return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה.' });
  }

  const password_hash = hashPassword(newPassword);
  const { error: upsertErr } = await withFriendlyError(
    supabase.from('admin_credentials')
      .upsert({ id: 1, username: newUsername, password_hash, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  );
  if (upsertErr) {
    const hint = /relation .* does not exist/i.test(upsertErr.message || '')
      ? ' (הריצו קודם את NEW-ADMIN-FEATURES-SETUP.sql ב-Supabase)'
      : '';
    return res.status(500).json({ error: 'שגיאה בשמירת פרטי ההתחברות: ' + upsertErr.message + hint });
  }

  await logAdminAction(supabase, session.user, 'admin_credentials_changed', newUsername, null, getClientIp(req));

  // Force a fresh login with the new credentials, rather than silently
  // keeping the old session alive under a username that no longer exists.
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
}

async function handleAuditLog(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const [logResult, failedLoginsResult] = await Promise.all([
    withFriendlyError(
      supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(200)
    ),
    withFriendlyError(
      supabase.from('login_attempts').select('*').eq('success', false).order('created_at', { ascending: false }).limit(100)
    ),
  ]);

  if (logResult.error) {
    return res.status(500).json({ error: logResult.error.message });
  }
  return res.status(200).json({
    log: logResult.data,
    failed_logins: failedLoginsResult.error ? [] : failedLoginsResult.data,
  });
}

const UPLOAD_BUCKET = 'site-images';
// Vercel's serverless functions hard-cap the incoming request body at
// ~4.5MB *before* this code even runs, and that platform limit can't be
// raised from here - so this needs to sit safely below it. The admin.html
// upload flow now resizes/compresses images in the browser first (see
// prepareImageForUpload there) so normal photos land well under this, but
// keep this check as a clear, friendly backstop for anything that slips
// through (e.g. animated GIFs, which are sent uncompressed).
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === 'string' && req.body.length) {
      resolve(req.body);
      return;
    }
    if (req.body && typeof req.body === 'object') {
      resolve(JSON.stringify(req.body));
      return;
    }
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > UPLOAD_MAX_BYTES) {
        req.destroy();
        reject(new Error('התמונה גדולה מדי (מקסימום כ-4 מ״ב).'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleUploadImage(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(413).json({ error: err.message });
  }

  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  const { filename, dataUrl } = body || {};
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'קובץ תמונה לא תקין.' });
  }
  const mimeType = match[1];
  const ext = UPLOAD_ALLOWED_TYPES[mimeType];
  if (!ext) {
    return res.status(400).json({ error: 'סוג קובץ לא נתמך - יש להעלות JPG, PNG, WEBP או GIF בלבד.' });
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > UPLOAD_MAX_BYTES) {
    return res.status(413).json({ error: 'התמונה גדולה מדי (מקסימום כ-4 מ״ב).' });
  }

  const safeName = String(filename || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, '-')
    .replace(/\.[a-z0-9]+$/, '');
  const path = `${Date.now()}-${safeName || 'image'}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    const hint = /bucket not found/i.test(uploadError.message || '')
      ? ' (ודאו שהרצתם את ALL-SQL-SETUP.sql ב-Supabase - הוא יוצר את ה-bucket הנדרש)'
      : '';
    return res.status(500).json({ error: 'שגיאה בהעלאת התמונה: ' + uploadError.message + hint });
  }

  const { data: publicData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  const url = publicData && publicData.publicUrl;
  if (!url) {
    return res.status(500).json({ error: 'ההעלאה הצליחה אך לא התקבלה כתובת ציבורית לתמונה.' });
  }

  await logAdminAction(supabase, session.user, 'image_upload', path, { mimeType, bytes: buffer.length }, getClientIp(req));
  return res.status(200).json({ url });
}

// Sends a real test email through the exact same api/_lib/mailer.js every
// other flow on the site uses (order confirmations, contact form,
// newsletter signup, password reset, Tranzila payment notifications) - so
// a success here is a real, verified signal that all of those work too,
// and a failure surfaces the exact Resend error (bad/missing API key,
// unverified sending domain, etc.) directly in the admin panel instead of
// only in Vercel's function logs. Always responds 200 (even on failure)
// with { ok: false, error, ... } so the admin panel can show the specific
// reason - a non-2xx here would just show a generic "שגיאה" instead.
async function handleTestEmail(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const session = requireAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const requestedTo = body && body.to ? String(body.to).trim() : '';
  const to = requestedTo || sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'simcha41440@gmail.com';

  const missingEnv = [];
  if (!sanitizeEnvValue(process.env.RESEND_API_KEY)) missingEnv.push('RESEND_API_KEY');
  if (!sanitizeEnvValue(process.env.RESEND_FROM_EMAIL)) missingEnv.push('RESEND_FROM_EMAIL');

  const result = await sendEmail({
    to,
    subject: 'מייל בדיקה - רפאוז סטייל',
    html: `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
        <h2 style="margin:0 0 10px;">מייל בדיקה מעמוד הניהול</h2>
        <p>אם קיבלתם את המייל הזה - שליחת המיילים באתר מוגדרת נכון ועובדת (אישורי הזמנה, טופס יצירת קשר, הרשמה לדיוור, איפוס סיסמה ועדכוני תשלום עוברים כולם דרך אותה מערכת).</p>
        <p style="color:#888;font-size:13px;">נשלח ${new Date().toLocaleString('he-IL')}.</p>
      </div>`,
  });

  // Best-effort audit log entry - never let a logging problem affect the
  // response the admin is waiting on to know if the email itself worked.
  try {
    const supabase = getSupabase();
    await logAdminAction(supabase, session.user, 'test_email', to, { ok: result.ok, error: result.error || null }, getClientIp(req));
  } catch (err) {
    console.error('test-email: audit log failed (non-fatal):', err.message);
  }

  if (!result.ok) {
    return res.status(200).json({ ok: false, error: result.error, missingEnv, to });
  }
  return res.status(200).json({ ok: true, to, missingEnv });
}

module.exports = async (req, res) => {
  const action = req.query && req.query.action;
  switch (action) {
    case 'session':
      return handleSession(req, res);
    case 'login':
      return handleLogin(req, res);
    case 'logout':
      return handleLogout(req, res);
    case 'change-credentials':
      return handleChangeCredentials(req, res);
    case 'audit-log':
      return handleAuditLog(req, res);
    case 'upload-image':
      return handleUploadImage(req, res);
    case 'test-email':
      return handleTestEmail(req, res);
    default:
      return res.status(400).json({ error: 'Unknown or missing action.' });
  }
};
