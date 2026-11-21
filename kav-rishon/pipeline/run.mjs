// הצינור האוטומטי של קו ראשון.
// רץ כל כמה דקות (GitHub Actions), ובכל ריצה:
//   1. קורא את המקורות שב-sources.json (פידים של RSS)
//   2. מדלג על ידיעות שכבר טופלו
//   3. שולח כל ידיעה חדשה ל"עורך" ה-AI, שכותב אותה מחדש או פוסל אותה
//   4. שומר כ"ממתינה לאישור" ושולח לך התראה בטלגרם
//   (אם AUTO_PUBLISH=true, ידיעות בלי הערות לעורך מתפרסמות מיד)
//
// הרצה ידנית:  npm run pipeline

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import Parser from "rss-parser";
import { db, makeSlug } from "../api/_lib/db.js";
import { writeArticle } from "../api/_lib/ai.js";

const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 15);
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 12);
const AUTO_PUBLISH = process.env.AUTO_PUBLISH === "true";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

const parser = new Parser({ timeout: 15000 });

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

const stripHtml = (s = "") =>
  s.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function loadSources() {
  const url = new URL("./sources.json", import.meta.url);
  const list = JSON.parse(await readFile(url, "utf8"));
  return list.filter((s) => s.enabled);
}

async function collectItems(sources) {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  const items = [];
  for (const src of sources) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const it of feed.items || []) {
        const when = it.isoDate ? Date.parse(it.isoDate) : Date.now();
        if (when < cutoff) continue;
        const link = it.link || it.guid || it.title;
        if (!link) continue;
        items.push({
          source: src,
          hash: hash(`${src.name}|${link}`),
          link: it.link || null,
          when,
          text: [it.title, stripHtml(it["content:encoded"] || it.content || it.contentSnippet || "")]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 15000),
        });
      }
    } catch (err) {
      console.warn(`⚠ מקור "${src.name}" נכשל: ${err.message}`);
    }
  }
  return items.sort((a, b) => b.when - a.when);
}

async function filterNew(items) {
  if (!items.length) return [];
  const hashes = items.map((i) => i.hash);
  const { data, error } = await db().from("articles").select("source_hash").in("source_hash", hashes);
  if (error) throw error;
  const seen = new Set((data || []).map((r) => r.source_hash));
  return items.filter((i) => !seen.has(i.hash));
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.warn("⚠ שליחת התראה לטלגרם נכשלה:", err.message);
  }
}

async function main() {
  const sources = await loadSources();
  if (!sources.length) {
    console.log("אין מקורות פעילים ב-sources.json. הוסף מקור וסמן enabled: true.");
    return;
  }

  const fresh = await filterNew(await collectItems(sources));
  const batch = fresh.slice(0, MAX_PER_RUN);
  console.log(`נמצאו ${fresh.length} ידיעות חדשות, מעבד ${batch.length}.`);

  let accepted = 0;
  let rejected = 0;
  const newTitles = [];

  for (const item of batch) {
    let art;
    try {
      art = await writeArticle({ text: item.text, sourceName: item.source.name, sourceUrl: item.link });
    } catch (err) {
      console.warn(`⚠ עיבוד נכשל (${item.link}): ${err.message}`);
      continue; // לא נשמר, ולכן ינוסה שוב בריצה הבאה
    }

    const base = {
      slug: makeSlug(),
      source_name: item.source.name,
      source_url: item.link,
      source_hash: item.hash,
    };

    if (!art.relevant) {
      // שומרים גם ידיעות שנפסלו, כדי לא לשלם על עיבוד שלהן שוב.
      await db().from("articles").insert({
        ...base,
        title: "(נפסל)",
        body: "-",
        status: "rejected",
        ai_notes: art.reject_reason || null,
      });
      rejected++;
      continue;
    }

    const publishNow = AUTO_PUBLISH && !art.ai_notes;
    const { error } = await db().from("articles").insert({
      ...base,
      title: art.title,
      subtitle: art.subtitle || null,
      summary: art.summary || null,
      impact: art.impact || null,
      body: art.body,
      category: item.source.category || art.category,
      city: art.city || item.source.city || null,
      is_breaking: art.is_breaking,
      ai_notes: art.ai_notes || null,
      status: publishNow ? "published" : "pending",
      published_at: publishNow ? new Date().toISOString() : null,
    });
    if (error) {
      console.warn("⚠ שמירה נכשלה:", error.message);
      continue;
    }
    accepted++;
    newTitles.push(`${art.is_breaking ? "🔴 " : "• "}${art.title}`);
  }

  console.log(`✓ ${accepted} ידיעות נכתבו, ${rejected} נפסלו.`);

  if (newTitles.length) {
    const head = AUTO_PUBLISH
      ? `קו ראשון: ${newTitles.length} ידיעות חדשות`
      : `קו ראשון: ${newTitles.length} ידיעות ממתינות לאישורך`;
    const link = SITE_URL ? `\n\n${SITE_URL}/admin` : "";
    await notifyTelegram(`${head}\n\n${newTitles.join("\n")}${link}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
