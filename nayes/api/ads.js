import { db, AD_PUBLIC_FIELDS } from "./_lib/db.js";

// API ציבורי לפרסומות.
// GET /api/ads              → כל המודעות הפעילות (וסופר חשיפה לכל אחת)
// GET /api/ads?click=<id>   → סופר לחיצה ומעביר את הגולש לקישור של המפרסם

const UUID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const { click } = req.query;

    if (click) {
      if (!UUID.test(String(click))) {
        res.status(400).end();
        return;
      }
      const { data: link } = await db().rpc("ad_click", { ad_id: String(click) });
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(302, { Location: safeLink(link) || "/" });
      res.end();
      return;
    }

    const now = Date.now();
    const { data: rows, error } = await db()
      .from("ads")
      .select(AD_PUBLIC_FIELDS + ",starts_at,ends_at")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // רק מודעות שתקופת הקמפיין שלהן פעילה עכשיו.
    const data = rows
      .filter((a) => (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now))
      .map(({ starts_at, ends_at, ...ad }) => ad);

    if (data.length) {
      await db().rpc("ad_impressions", { ad_ids: data.map((a) => a.id) });
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ads: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
}

// רק קישורים בטוחים: https, טלפון, וואטסאפ, מייל.
function safeLink(link) {
  if (!link) return null;
  return /^(https:\/\/|tel:|mailto:)/i.test(link) ? link : null;
}
