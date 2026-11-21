import { db, makeSlug } from "./_lib/db.js";
import { checkPassword, issueToken, verifyToken, tokenFromRequest } from "./_lib/auth.js";
import { writeArticle, checkImage } from "./_lib/ai.js";
import { CATEGORIES } from "./_lib/config.js";

// API של לוח הבקרה. כל הבקשות: POST עם { action, ... }.
//
// login     { password }                     → { token }
// list      { status }                       → { articles }
// update    { id, fields }                   → עדכון שדות של ידיעה
// publish   { id }                           → פרסום
// reject    { id }                           → דחייה
// compose   { text, sourceName, sourceUrl }  → AI כותב ידיעה מהודעה שהדבקת (נשמרת כממתינה)
// setImage  { id, url }                      → בדיקת AI לתמונה, ושמירה רק אם עברה
// adsList   {}                               → כל המודעות + סטטיסטיקות
// adSave    { ad }                           → יצירה/עדכון מודעה (התמונה נבדקת ב-AI)
// adToggle  { id, active }                   → הפעלה/השהיה
// adDelete  { id }                           → מחיקה

const EDITABLE = new Set([
  "title", "summary", "impact", "body", "category", "city", "is_breaking",
]);

// הגבלה פשוטה על ניסיונות כניסה (לכל מופע של הפונקציה).
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  attempts.set(ip, rec);
  return rec.n > 10;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const { action } = body;

  try {
    if (action === "login") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
      if (tooManyAttempts(ip)) {
        res.status(429).json({ error: "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה." });
        return;
      }
      if (!checkPassword(body.password)) {
        res.status(401).json({ error: "סיסמה שגויה" });
        return;
      }
      res.status(200).json({ token: issueToken() });
      return;
    }

    if (!verifyToken(tokenFromRequest(req))) {
      res.status(401).json({ error: "נדרשת כניסה מחדש" });
      return;
    }

    switch (action) {
      case "list": {
        const status = ["pending", "published", "rejected"].includes(body.status)
          ? body.status
          : "pending";
        const { data, error } = await db()
          .from("articles")
          .select("*")
          .eq("status", status)
          .order(status === "published" ? "published_at" : "created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.status(200).json({ articles: data });
      }

      case "update": {
        const fields = {};
        for (const [k, v] of Object.entries(body.fields || {})) {
          if (!EDITABLE.has(k)) continue;
          if (k === "category" && !CATEGORIES[v]) continue;
          fields[k] = k === "is_breaking" ? Boolean(v) : String(v ?? "").trim() || null;
        }
        if (fields.title === null || fields.summary === null) {
          return res.status(400).json({ error: "כותרת וטקסט המבזק הם שדות חובה" });
        }
        const { error } = await db().from("articles").update(fields).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "publish": {
        const { error } = await db()
          .from("articles")
          .update({ status: "published", published_at: new Date().toISOString() })
          .eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "reject": {
        const { error } = await db().from("articles").update({ status: "rejected" }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "compose": {
        const text = String(body.text || "").trim();
        if (text.length < 20) {
          return res.status(400).json({ error: "הטקסט קצר מדי" });
        }
        const art = await writeArticle({
          text: text.slice(0, 20000),
          sourceName: body.sourceName,
          sourceUrl: body.sourceUrl,
        });
        if (!art.relevant) {
          return res.status(200).json({ rejected: true, reason: art.reject_reason });
        }
        const { data, error } = await db()
          .from("articles")
          .insert({
            slug: makeSlug(),
            title: art.title,
            summary: art.summary || null,
            impact: art.impact || null,
            body: art.body || null,
            score: art.score,
            category: art.category,
            city: art.city || null,
            is_breaking: art.is_breaking,
            ai_notes: art.ai_notes || null,
            source_name: body.sourceName || null,
            source_url: body.sourceUrl || null,
            status: "pending",
          })
          .select("*")
          .single();
        if (error) throw error;
        return res.status(200).json({ article: data });
      }

      case "setImage": {
        const url = String(body.url || "").trim();
        if (!url) {
          const { error } = await db().from("articles").update({ image_url: null }).eq("id", body.id);
          if (error) throw error;
          return res.status(200).json({ ok: true, removed: true });
        }
        if (!/^https:\/\//.test(url)) {
          return res.status(400).json({ error: "נדרשת כתובת https" });
        }
        const check = await checkImage(url);
        if (!check.approved) {
          return res.status(200).json({ approved: false, reason: check.reason });
        }
        const { error } = await db().from("articles").update({ image_url: url }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ approved: true, reason: check.reason });
      }

      case "adsList": {
        const { data, error } = await db().from("ads").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json({ ads: data });
      }

      case "adSave": {
        const ad = body.ad || {};
        const row = {
          advertiser: clean(ad.advertiser),
          title: clean(ad.title),
          text: clean(ad.text),
          cta: clean(ad.cta),
          link: clean(ad.link),
          placement: ["top", "feed", "side"].includes(ad.placement) ? ad.placement : "feed",
          color: /^#[0-9a-f]{6}$/i.test(ad.color || "") ? ad.color : null,
          starts_at: ad.starts_at || null,
          ends_at: ad.ends_at || null,
        };
        if (!row.advertiser || !row.title) {
          return res.status(400).json({ error: "שם המפרסם וכותרת הם שדות חובה" });
        }
        if (row.link && !/^(https:\/\/|tel:|mailto:)/i.test(row.link)) {
          return res.status(400).json({ error: "הקישור חייב להתחיל ב-https://, tel: או mailto:" });
        }

        const image = clean(ad.image_url);
        let existingImage = null;
        if (ad.id) {
          const { data: prev } = await db().from("ads").select("image_url").eq("id", ad.id).maybeSingle();
          existingImage = prev?.image_url || null;
        }
        if (image && image !== existingImage) {
          if (!/^https:\/\//.test(image)) return res.status(400).json({ error: "כתובת התמונה חייבת להתחיל ב-https://" });
          const check = await checkImage(image);
          if (!check.approved) {
            return res.status(200).json({ imageRejected: true, reason: check.reason });
          }
        }
        row.image_url = image;

        const q = ad.id
          ? db().from("ads").update(row).eq("id", ad.id).select("*").single()
          : db().from("ads").insert(row).select("*").single();
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ ad: data });
      }

      case "adToggle": {
        const { error } = await db().from("ads").update({ active: Boolean(body.active) }).eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case "adDelete": {
        const { error } = await db().from("ads").delete().eq("id", body.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: "פעולה לא מוכרת" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת: " + (err.message || "") });
  }
}

function clean(v) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 500) : null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
