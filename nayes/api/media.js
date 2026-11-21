import { readStored } from "./_lib/media.js";

// מגיש תמונות שמורות מהדומיין של האתר: /media/<שם> (ראו vercel.json).
// הקבצים לא משתנים אף פעם, ולכן נשמרים במטמון לשנה.

export default async function handler(req, res) {
  const name = String(req.query.name || "");
  try {
    const file = await readStored(name);
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", file.type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
}
