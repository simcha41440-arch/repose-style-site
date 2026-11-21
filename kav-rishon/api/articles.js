import { db, PUBLIC_FIELDS } from "./_lib/db.js";
import { CATEGORIES } from "./_lib/config.js";

// API ציבורי לקריאת ידיעות שפורסמו.
// GET /api/articles                    → הידיעות האחרונות
// GET /api/articles?category=economy   → לפי קטגוריה
// GET /api/articles?city=בני%20ברק      → לפי עיר
// GET /api/articles?slug=...           → ידיעה אחת (ומעלה את מונה הצפיות)
// GET /api/articles?popular=1          → הכי נקראים ב-48 השעות האחרונות

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const { slug, category, city, popular } = req.query;
    const limit = Math.min(Number(req.query.limit) || 30, 60);

    if (slug) {
      const { data, error } = await db()
        .from("articles")
        .select(PUBLIC_FIELDS)
        .eq("slug", String(slug))
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "not found" });
        return;
      }
      await db().rpc("increment_views", { article_slug: String(slug) });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ article: data });
      return;
    }

    let q = db().from("articles").select(PUBLIC_FIELDS).eq("status", "published");

    if (category && CATEGORIES[category]) q = q.eq("category", category);
    if (city) q = q.eq("city", String(city));

    if (popular) {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      q = q.gte("published_at", since).order("views", { ascending: false });
    } else {
      q = q.order("published_at", { ascending: false });
    }

    const { data, error } = await q.limit(limit);
    if (error) throw error;

    // מטמון קצר ב-CDN: עומס נמוך על המסד, ועדיין עדכני תוך פחות מדקה.
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({ articles: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
}
