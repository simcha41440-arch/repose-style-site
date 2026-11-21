// קוד משותף: קטגוריות, תאריך עברי, עזרי תצוגה, טעינת נתונים ונתוני דוגמה.

const CATEGORIES = {
  general:   { name: "חדשות",       emoji: "📰" },
  politics:  { name: "פוליטי",      emoji: "🏛️" },
  community: { name: "קהילה",       emoji: "🤝" },
  torah:     { name: "עולם התורה",  emoji: "📜" },
  economy:   { name: "כסף וצרכנות", emoji: "💰" },
  local:     { name: "בעיר",        emoji: "🏙️" },
  health:    { name: "בריאות",      emoji: "🩺" },
  world:     { name: "עולם",        emoji: "🌍" },
  tech:      { name: "טכנולוגיה",   emoji: "💡" },
  weather:   { name: "מזג אוויר",   emoji: "⛅" },
};

const REACTIONS = ["👍", "😮", "🙏", "😂"];

const CITIES = ["ירושלים", "בני ברק", "בית שמש", "מודיעין עילית", "ביתר עילית", "אלעד", "אשדוד"];

// לאן פונים מפרסמים. מלאו כאן טלפון או מייל, למשל "tel:0500000000" או "mailto:ads@example.com".
const ADVERTISE_LINK = "";

// ---------- עזרים ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return "עכשיו";
  const m = Math.floor(diff / 60);
  if (m < 60) return m === 1 ? "לפני דקה" : `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : h === 2 ? "לפני שעתיים" : `לפני ${h} שעות`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "long" });
}

function clock(iso) {
  return iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "היום";
  if (d.toDateString() === y.toDateString()) return "אתמול";
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
}

function articleUrl(a) {
  return `/article/${encodeURIComponent(a.slug)}`;
}

function compact(n) {
  n = Number(n) || 0;
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "") + "K" : String(n);
}

// ---------- תאריך עברי בגימטריה ----------

function gematria(n) {
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  let s = hundreds[Math.floor(n / 100) % 10] + tens[Math.floor(n / 10) % 10] + ones[n % 10];
  s = s.replace("יה", "טו").replace("יו", "טז");
  return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
}

function hebrewDate(d = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
      day: "numeric", month: "long", year: "numeric",
    }).formatToParts(d);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const month = parts.find((p) => p.type === "month")?.value || "";
    const year = Number(parts.find((p) => p.type === "year")?.value);
    let weekday = d.toLocaleDateString("he-IL", { weekday: "long" });
    if (d.getDay() === 6) weekday = "שבת קודש";
    return `${weekday}, ${gematria(day)} ${month} ${gematria(year % 1000)}`;
  } catch {
    return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  }
}

// ---------- נתונים ----------

let DEMO_MODE = false;

async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function api(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    return await getJson(`/api/articles${qs ? "?" + qs : ""}`);
  } catch {
    // אין שרת מחובר עדיין: מציגים מבזקים לדוגמה כדי לראות את העיצוב.
    DEMO_MODE = true;
    return demoQuery(params);
  }
}

async function loadAds() {
  try {
    return (await getJson("/api/ads")).ads || [];
  } catch {
    DEMO_MODE = true;
    return DEMO_ADS;
  }
}

async function react(slug, emoji) {
  if (DEMO_MODE) return null;
  const r = await fetch("/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, emoji }),
  });
  return r.ok ? (await r.json()).reactions : null;
}

function adHref(ad) {
  return DEMO_MODE ? "#advertise" : `/api/ads?click=${encodeURIComponent(ad.id)}`;
}

function demoQuery(params) {
  let list = DEMO_ARTICLES.map((a, i) => ({
    ...a,
    published_at: new Date(Date.now() - a.minutesAgo * 60000).toISOString(),
    views: 4200 - i * 410,
  }));
  if (params.slug) return { article: list.find((a) => a.slug === params.slug) || null };
  if (params.after) return { articles: [] };
  if (params.before) return { articles: [] };
  if (params.category) list = list.filter((a) => a.category === params.category);
  if (params.city) list = list.filter((a) => a.city === params.city);
  return { articles: list.slice(0, Number(params.limit) || 30) };
}

// ---------- נתוני דוגמה (מוצגים רק כשאין שרת) ----------

const DEMO_ARTICLES = [
  {
    slug: "demo-1", minutesAgo: 3, category: "general", is_breaking: true, city: "",
    title: "שיבושים ברכבת ביום שישי",
    summary: "בגלל עבודות תשתית, חלק מהקווים לא יפעלו ביום שישי בבוקר. יופעלו אוטובוסים חלופיים בין התחנות הסגורות.",
    impact: "נוסעים ביום שישי? תבדקו את לוח הזמנים מראש ותצאו קצת יותר מוקדם.",
    body: "זה מבזק לדוגמה שמראה איך נראה \"עוד פרטים\".\n\nכאן יופיעו הפרטים המלאים למי שרוצה להעמיק, בלי להעמיס על כל השאר.",
    reactions: { "👍": 42, "😮": 7 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-2", minutesAgo: 18, category: "economy", city: "",
    title: "מחירי מוצרי היסוד מתעדכנים",
    summary: "מתחילת החודש הבא חלק ממוצרי היסוד המפוקחים יתייקרו בשיעור קטן. המחירים החדשים יפורסמו בקרוב.",
    impact: "קנייה גדולה? עדיף לעשות אותה לפני תחילת החודש.",
    body: "", reactions: { "😮": 31, "🙏": 4 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-3", minutesAgo: 47, category: "local", city: "בני ברק",
    title: "רחוב מרכזי נסגר לשלושה ימים",
    summary: "העירייה סוגרת את הרחוב לעבודות ניקוז לקראת החורף. פורסמו מסלולים חלופיים.",
    impact: "", body: "", reactions: { "👍": 12 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-4", minutesAgo: 95, category: "torah", city: "ירושלים",
    title: "אלפים בדרך לכינוס הלימוד הגדול",
    summary: "המארגנים נערכים להסעות מיוחדות מכל רחבי הארץ. נקודות האיסוף פורסמו הבוקר.",
    impact: "", body: "", reactions: { "🙏": 88, "👍": 20 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-5", minutesAgo: 140, category: "weather", city: "",
    title: "השרב מגיע: שותים, שותים, שותים 💧",
    summary: "צפוי חום כבד מחר ומחרתיים. ההמלצה: להרבות בשתייה ולהימנע מהשמש בשעות הצהריים.",
    impact: "שימו לב במיוחד לילדים ולמבוגרים.", body: "",
    reactions: { "😂": 9, "👍": 15 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-6", minutesAgo: 210, category: "politics", city: "",
    title: "הוועדה דחתה את ההצבעה על התקציב",
    summary: "דיון סוער על תקציב מוסדות החינוך הסתיים בלי החלטה. ההצבעה נדחתה לשבוע הבא.",
    impact: "", body: "", reactions: { "😮": 6 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-7", minutesAgo: 290, category: "tech", city: "",
    title: "עדכונים בקול, גם בטלפון כשר",
    summary: "שירות חדש מקריא עדכונים חשובים בטלפון, בכל שעות היממה.",
    impact: "", body: "", reactions: { "👍": 27 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-8", minutesAgo: 1500, category: "community", city: "בית שמש",
    title: "מבצע התרמה שכונתי שבר שיא",
    summary: "מאות מתנדבים, יממה אחת וסכום שיא למשפחות נזקקות. הכספים יחולקו לפני החג.",
    impact: "", body: "", reactions: { "🙏": 54 }, source_name: "מבזק לדוגמה",
  },
];

const DEMO_ADS = [
  {
    id: "demo-top", placement: "top", advertiser: "עסק לדוגמה",
    title: "כאן תופיע המודעה הראשית שלכם 📌",
    text: "המקום הכי נצפה באתר: נעוץ למעלה, מול כל קורא.", cta: "לפרטים", color: "#0a7d5a",
  },
  {
    id: "demo-feed-1", placement: "feed", advertiser: "חנות לדוגמה",
    title: "מבצע סוף עונה: 1+1 על הכל 🎉",
    text: "מודעה לדוגמה שמשולבת בין המבזקים, בעיצוב מיוחד שבולט אבל לא מפריע.",
    cta: "לפרטים", color: "#6b3fd6",
  },
  {
    id: "demo-side-1", placement: "side", advertiser: "שירות לדוגמה",
    title: "המקום הזה יכול להיות שלכם",
    text: "מודעה בצד המסך, מול כל מי שגולל.", cta: "לפרסום", color: "#d4570f",
  },
];
