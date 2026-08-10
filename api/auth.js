// Customer account auth: register / login / logout / me, in one file
// (same "one route file per feature, ?action= sub-routing" pattern as
// api/admin.js) so it counts as a single Vercel serverless function.
//
//   POST /api/auth?action=register  - { name, email, password, phone? }
//   POST /api/auth?action=login     - { email, password }
//   POST /api/auth?action=logout
//   GET  /api/auth?action=me        - current logged-in customer, or 401
//
// Requires:
//   - the `customers` table (see CUSTOMER-AUTH-SETUP.sql)
//   - CUSTOMER_SESSION_SECRET env var (any long random string - see
//     api/_lib/customerSession.js)

const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { parseJsonBody } = require('./_lib/parseJson');
const {
  createCustomerSessionCookie,
  clearCustomerSessionCookie,
  readCustomerSession,
  hashPassword,
  verifyPassword,
} = require('./_lib/customerSession');
const { getClientIp, checkRateLimit, recordRateLimitEvent } = require('./_lib/security');
const { sendEmail, escapeHtml } = require('./_lib/mailer');
const crypto = require('crypto');

const SITE_ORIGIN = 'https://reposestyle.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generous but real limits - stops a script hammering the endpoint
// without getting in the way of an actual shopper who mistypes a
// password a few times.
const REGISTER_RATE_LIMIT = { max: 6, windowMinutes: 30 };
const LOGIN_RATE_LIMIT = { max: 10, windowMinutes: 15 };
const FORGOT_RATE_LIMIT = { max: 5, windowMinutes: 30 };
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function publicCustomer(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone || null };
}

async function handleRegister(req, res, supabase) {
  const ip = getClientIp(req);
  const rate = await checkRateLimit(supabase, 'register', ip, REGISTER_RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'יותר מדי ניסיונות הרשמה. אנא נסו שוב בעוד כמה דקות.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const password = body.password || '';

  if (!name) return res.status(400).json({ error: 'נא להזין שם מלא.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'נא להזין כתובת דוא"ל תקינה.' });
  if (password.length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים.' });

  await recordRateLimitEvent(supabase, 'register', ip);

  const { data: existing, error: existingErr } = await withFriendlyError(
    supabase.from('customers').select('id').eq('email', email).maybeSingle()
  );
  if (existingErr) return res.status(500).json({ error: existingErr.message });
  if (existing) return res.status(409).json({ error: 'כבר קיים חשבון עם כתובת דוא"ל זו. נסו להתחבר.' });

  const password_hash = hashPassword(password);
  const { data: inserted, error: insertErr } = await withFriendlyError(
    supabase
      .from('customers')
      .insert({ name, email, phone: phone || null, password_hash })
      .select('id, name, email, phone')
      .single()
  );
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  const cookie = createCustomerSessionCookie({
    customerId: inserted.id,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ customer: publicCustomer(inserted) });
}

async function handleLogin(req, res, supabase) {
  const ip = getClientIp(req);
  const rate = await checkRateLimit(supabase, 'login', ip, LOGIN_RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'יותר מדי ניסיונות התחברות. אנא נסו שוב בעוד כמה דקות.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'נא להזין דוא"ל וסיסמה.' });

  await recordRateLimitEvent(supabase, 'login', ip);

  const { data: row, error: rowErr } = await withFriendlyError(
    supabase.from('customers').select('id, name, email, phone, password_hash').eq('email', email).maybeSingle()
  );
  if (rowErr) return res.status(500).json({ error: rowErr.message });

  // Same generic error whether the email doesn't exist or the password is
  // wrong, so a login attempt can't be used to discover which emails have
  // an account.
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'דוא"ל או סיסמה שגויים.' });
  }

  const cookie = createCustomerSessionCookie({
    customerId: row.id,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ customer: publicCustomer(row) });
}

async function handleForgot(req, res, supabase) {
  const ip = getClientIp(req);
  const rate = await checkRateLimit(supabase, 'forgot-password', ip, FORGOT_RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({ error: 'יותר מדי בקשות. אנא נסו שוב בעוד כמה דקות.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'נא להזין כתובת דוא"ל תקינה.' });

  await recordRateLimitEvent(supabase, 'forgot-password', ip);

  const { data: row, error: rowErr } = await withFriendlyError(
    supabase.from('customers').select('id, name, email').eq('email', email).maybeSingle()
  );
  if (rowErr) return res.status(500).json({ error: rowErr.message });

  // Always return the same success response whether or not the email is
  // registered - otherwise this endpoint becomes a way to discover which
  // emails have an account.
  if (row) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    await withFriendlyError(
      supabase.from('customers').update({ reset_token: token, reset_token_expires: expires }).eq('id', row.id)
    );

    const resetUrl = `${SITE_ORIGIN}/account?reset_token=${token}`;
    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
        <h2 style="margin:0 0 10px;">איפוס סיסמה - רפאוז סטייל</h2>
        <p>שלום ${escapeHtml(row.name || '')},</p>
        <p>קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך. הקישור בתוקף לשעה אחת:</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#b08a3e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;">קביעת סיסמה חדשה</a></p>
        <p style="color:#888;font-size:13px;">אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מהמייל הזה - הסיסמה הנוכחית שלכם תישאר בתוקף.</p>
      </div>`;
    // Never await-fail the request on an email hiccup - the token is
    // already saved, so a retry (asking again) still works.
    sendEmail({ to: row.email, subject: 'איפוס סיסמה - רפאוז סטייל', html }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
}

async function handleReset(req, res, supabase) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const token = (body.token || '').trim();
  const password = body.password || '';
  if (!token) return res.status(400).json({ error: 'קישור לא תקין.' });
  if (password.length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים.' });

  const { data: row, error: rowErr } = await withFriendlyError(
    supabase.from('customers').select('id, name, email, reset_token, reset_token_expires').eq('reset_token', token).maybeSingle()
  );
  if (rowErr) return res.status(500).json({ error: rowErr.message });
  if (!row || !row.reset_token_expires || new Date(row.reset_token_expires).getTime() < Date.now()) {
    return res.status(400).json({ error: 'הקישור פג תוקף. בקשו קישור חדש לאיפוס סיסמה.' });
  }

  const password_hash = hashPassword(password);
  const { error: updateErr } = await withFriendlyError(
    supabase.from('customers').update({ password_hash, reset_token: null, reset_token_expires: null }).eq('id', row.id)
  );
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const cookie = createCustomerSessionCookie({
    customerId: row.id,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ customer: { id: row.id, name: row.name, email: row.email } });
}

async function handleLogout(req, res) {
  res.setHeader('Set-Cookie', clearCustomerSessionCookie());
  return res.status(200).json({ ok: true });
}

async function handleMe(req, res, supabase) {
  const session = readCustomerSession(req);
  if (!session || !session.customerId) {
    return res.status(401).json({ customer: null });
  }
  const { data: row, error } = await withFriendlyError(
    supabase.from('customers').select('id, name, email, phone').eq('id', session.customerId).maybeSingle()
  );
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(401).json({ customer: null });
  return res.status(200).json({ customer: publicCustomer(row) });
}

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const action = (req.query && req.query.action) || '';

  if (action === 'me') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleMe(req, res, supabase);
  }

  if (action === 'logout') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleLogout(req, res);
  }

  if (action === 'register') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleRegister(req, res, supabase);
  }

  if (action === 'login') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleLogin(req, res, supabase);
  }

  if (action === 'forgot') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleForgot(req, res, supabase);
  }

  if (action === 'reset') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return handleReset(req, res, supabase);
  }

  return res.status(400).json({ error: 'Unknown action.' });
};
