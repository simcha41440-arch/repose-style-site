import crypto from "node:crypto";

// כניסה ללוח הבקרה: סיסמה אחת (ADMIN_PASSWORD) שמחזירה אסימון חתום ל-30 יום.

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("חסר ADMIN_PASSWORD");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  return safeEqual(password, expected);
}

export function issueToken() {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (!safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

export function tokenFromRequest(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
