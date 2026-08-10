const crypto = require('crypto');

const COOKIE_NAME = 'rstyle_admin_session';
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET environment variable is not set.');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

// Builds a Set-Cookie header value for a signed, HttpOnly session
// cookie. The payload is base64url-encoded and paired with an HMAC
// signature, so the cookie can be verified without any server-side
// session storage (Vercel functions are stateless).
function createSessionCookie(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(data);
  const value = `${data}.${signature}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
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

// Reads and verifies the admin session cookie from an incoming
// request. Returns the decoded payload (e.g. { admin: true, user,
// exp }) or null if there is no valid, unexpired session.
function readSession(req) {
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

// Convenience guard for API routes: verifies the caller is an
// authenticated admin, or writes a 401 response and returns null.
function requireAdmin(req, res) {
  const session = readSession(req);
  if (!session || !session.admin) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  return session;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SECONDS,
  createSessionCookie,
  clearSessionCookie,
  readSession,
  requireAdmin,
};
