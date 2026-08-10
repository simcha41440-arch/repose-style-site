const crypto = require('crypto');

// Separate cookie from the admin session (see session.js) so a logged-in
// shopper and a logged-in admin never collide, and a shopper's cookie can
// never be replayed against admin-only routes.
const COOKIE_NAME = 'rstyle_customer_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days - "stay signed in" like most storefronts

function getSecret() {
  const secret = process.env.CUSTOMER_SESSION_SECRET;
  if (!secret) {
    throw new Error('CUSTOMER_SESSION_SECRET environment variable is not set.');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

// Builds a Set-Cookie header value for a signed, HttpOnly session cookie -
// same scheme as the admin session (see session.js), just a different
// cookie name/secret/lifetime.
function createCustomerSessionCookie(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(data);
  const value = `${data}.${signature}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

function clearCustomerSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch (err) {
      cookies[key] = val;
    }
  });
  return cookies;
}

function readCustomerSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;

  const dotIndex = raw.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const data = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!data || !signature) return null;

  const expected = sign(data);
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

// Convenience guard for API routes that require a logged-in customer.
// Writes a 401 and returns null if there is no valid session.
function requireCustomer(req, res) {
  const session = readCustomerSession(req);
  if (!session || !session.customerId) {
    res.status(401).json({ error: 'לא מחוברים.' });
    return null;
  }
  return session;
}

// --- Password hashing (scrypt, built into Node - no extra dependency) ---
// Stored as "salt:hash", both hex.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidateBuffer = Buffer.from(candidate, 'hex');
  if (hashBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SECONDS,
  createCustomerSessionCookie,
  clearCustomerSessionCookie,
  readCustomerSession,
  requireCustomer,
  hashPassword,
  verifyPassword,
};
