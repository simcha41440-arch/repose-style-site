import nodemailer from "nodemailer";
import { db } from "./_lib/db.js";

// טופס יצירת קשר. הפנייה נשמרת בלוח הבקרה ונשלחת למייל של בעל האתר.
// כתובת המייל נמצאת רק בהגדרות השרת (CONTACT_EMAIL) ולא מופיעה באתר בשום מקום.

const TOPICS = { general: "פנייה כללית", ads: "פרסום באתר", correction: "תיקון או דיווח על טעות" };
const recent = new Map();

function clean(v, max) {
  return String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  // מלכודת לרובוטים: שדה נסתר שבני אדם לא ממלאים
  if (b.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  const now = Date.now();
  const last = recent.get(ip) || 0;
  if (now - last < 30000) {
    res.status(429).json({ error: "רגע, כבר שלחתם פנייה. נסו שוב בעוד חצי דקה." });
    return;
  }

  const msg = {
    topic: TOPICS[b.topic] ? b.topic : "general",
    name: clean(b.name, 80),
    phone: clean(b.phone, 30) || null,
    email: clean(b.email, 120) || null,
    body: clean(b.body, 3000),
  };
  if (!msg.name || msg.body.length < 5 || (!msg.phone && !msg.email)) {
    res.status(400).json({ error: "נא למלא שם, טלפון או מייל, ותוכן הפנייה" });
    return;
  }
  recent.set(ip, now);

  try {
    const { error } = await db().from("messages").insert(msg);
    if (error) throw error;
  } catch (err) {
    console.error("save failed", err);
    res.status(500).json({ error: "שליחת הפנייה נכשלה. נסו שוב מאוחר יותר." });
    return;
  }

  await notifyEmail(msg).catch((err) => console.error("email failed", err.message));
  res.status(200).json({ ok: true });
}

// שליחה למייל של בעל האתר דרך חשבון ה-Gmail שלו (סיסמת אפליקציה).
async function notifyEmail(msg) {
  const to = process.env.CONTACT_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!to || !pass) return;
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: to, pass } });
  await transport.sendMail({
    from: `"נייעס סטטוס" <${to}>`,
    to,
    replyTo: msg.email || undefined,
    subject: `נייעס סטטוס: ${TOPICS[msg.topic]} מאת ${msg.name}`,
    text:
      `נושא: ${TOPICS[msg.topic]}\nשם: ${msg.name}\n` +
      (msg.phone ? `טלפון: ${msg.phone}\n` : "") +
      (msg.email ? `מייל: ${msg.email}\n` : "") +
      `\n${msg.body}\n\n(הפנייה שמורה גם בלוח הבקרה, בלשונית "פניות")`,
  });
}
