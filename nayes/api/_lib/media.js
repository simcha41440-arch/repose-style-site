import crypto from "node:crypto";
import { db } from "./db.js";
import { checkImage } from "./ai.js";

// כל התמונות באתר מאוחסנות אצלנו ומוגשות מהדומיין של האתר (/media/...),
// כך שהגולש לא מתחבר לאף שרת חיצוני. לפני שמירה, כל תמונה עוברת בדיקת AI.

const BUCKET = "media";
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** מוריד תמונה מכתובת חיצונית (רק בצד השרת). */
export async function fetchImage(url) {
  if (!/^https:\/\//.test(url)) throw new Error("כתובת התמונה חייבת להתחיל ב-https://");
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`לא הצלחתי להוריד את התמונה (${r.status})`);
  const type = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES[type]) throw new Error("סוג קובץ לא נתמך. אפשר JPG, PNG, WEBP או GIF");
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, type };
}

/** ממיר תמונה שהועלתה מהמחשב (data URL) לקובץ. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m || !TYPES[m[1].toLowerCase()]) throw new Error("קובץ תמונה לא תקין");
  return { buffer: Buffer.from(m[2], "base64"), type: m[1].toLowerCase() };
}

/**
 * בודק את התמונה ושומר אותה אם אושרה.
 * @returns {{ approved: boolean, reason: string, url?: string }}
 */
export async function checkAndStore({ buffer, type }) {
  if (buffer.length > MAX_BYTES) throw new Error("התמונה גדולה מדי (עד 4MB)");
  const check = await checkImage({ base64: buffer.toString("base64"), mediaType: type });
  if (!check.approved) return check;

  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${TYPES[type]}`;
  const { error } = await db().storage.from(BUCKET).upload(name, buffer, { contentType: type, upsert: false });
  if (error) throw error;
  return { ...check, url: `/media/${name}` };
}

/** מחזיר קובץ שמור להגשה לגולש. */
export async function readStored(name) {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|gif)$/i.test(name)) return null;
  const { data, error } = await db().storage.from(BUCKET).download(name);
  if (error || !data) return null;
  return { buffer: Buffer.from(await data.arrayBuffer()), type: data.type || "image/jpeg" };
}
