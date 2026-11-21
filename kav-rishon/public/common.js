// קוד משותף לעמודי האתר: קטגוריות, תאריך עברי, עזרי תצוגה, טעינת נתונים.

const CATEGORIES = {
  breaking: "מבזקים",
  general: "חדשות",
  politics: "מדיני ופוליטי",
  community: "קהילה וציבור",
  torah: "עולם התורה",
  economy: "כלכלה וצרכנות",
  health: "בריאות",
  world: "עולם",
  tech: "טכנולוגיה",
  local: "חדשות מקומיות",
};

const NAV_ORDER = ["general", "politics", "community", "torah", "economy", "local", "health", "world", "tech"];

const CITIES = ["ירושלים", "בני ברק", "בית שמש", "מודיעין עילית", "ביתר עילית", "אלעד", "אשדוד"];

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

function articleUrl(a) {
  return `/article/${encodeURIComponent(a.slug)}`;
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

async function api(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    const r = await fetch(`/api/articles${qs ? "?" + qs : ""}`);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    // אין שרת מחובר עדיין: מציגים ידיעות לדוגמה כדי לראות את העיצוב.
    DEMO_MODE = true;
    return demoQuery(params);
  }
}

function demoQuery(params) {
  let list = DEMO_ARTICLES.map((a, i) => ({
    ...a,
    published_at: new Date(Date.now() - a.minutesAgo * 60000).toISOString(),
    views: 500 - i * 37,
  }));
  if (params.slug) {
    const article = list.find((a) => a.slug === params.slug);
    return article ? { article } : { article: null };
  }
  if (params.category) list = list.filter((a) => a.category === params.category);
  if (params.city) list = list.filter((a) => a.city === params.city);
  if (params.popular) list = [...list].sort((a, b) => b.views - a.views);
  return { articles: list.slice(0, Number(params.limit) || 30) };
}

function showDemoBanner() {
  if (!DEMO_MODE || document.getElementById("demo-banner")) return;
  const b = document.createElement("div");
  b.id = "demo-banner";
  b.className = "demo-banner";
  b.textContent = "מצב תצוגה: הידיעות באתר הן לדוגמה בלבד, עד שיחובר מסד הנתונים.";
  document.body.prepend(b);
}

// ---------- מסגרת משותפת (כותרת עליונה וכותרת תחתונה) ----------

function renderChrome(active) {
  const header = document.getElementById("site-header");
  if (header) {
    header.innerHTML = `
      <div class="topbar">
        <div class="wrap topbar-inner">
          <span id="hdate">${esc(hebrewDate())}</span>
          <span class="topbar-links">
            <a href="#join" class="pill">הצטרפו לעדכונים בוואטסאפ</a>
          </span>
        </div>
      </div>
      <div class="wrap masthead">
        <a href="/" class="logo" aria-label="קו ראשון, לעמוד הבית">
          <span class="logo-mark" aria-hidden="true"><i></i></span>
          <span class="logo-text">קו <b>ראשון</b></span>
        </a>
        <p class="tagline">ראשונים לדעת. נקיים לקרוא.</p>
      </div>
      <nav class="nav" aria-label="קטגוריות">
        <div class="wrap nav-inner">
          <a href="/" class="${!active ? "on" : ""}">ראשי</a>
          ${NAV_ORDER.map((k) =>
            `<a href="/?cat=${k}" class="${active === k ? "on" : ""}">${esc(CATEGORIES[k])}</a>`).join("")}
        </div>
      </nav>`;
  }
  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.innerHTML = `
      <div class="wrap footer-inner">
        <div>
          <div class="logo logo-sm"><span class="logo-mark" aria-hidden="true"><i></i></span><span class="logo-text">קו <b>ראשון</b></span></div>
          <p>חדשות מהירות, מדויקות ונקיות לציבור שומר תורה ומצוות.</p>
        </div>
        <div id="join" class="footer-join">
          <strong>רוצים לקבל את הכותרות?</strong>
          <p>ערוץ וואטסאפ, טלגרם ומבזק יומי במייל. בקרוב גם קו טלפוני לחדשות.</p>
        </div>
        <p class="copy">© ${new Date().getFullYear()} קו ראשון</p>
      </div>`;
  }
}

// ---------- ידיעות לדוגמה (מוצגות רק כשאין שרת) ----------

const DEMO_ARTICLES = [
  {
    slug: "demo-1", minutesAgo: 6, category: "general", is_breaking: true, city: "",
    title: "שינויים בלוחות הזמנים של הרכבת לקראת עבודות תשתית בסוף השבוע",
    subtitle: "קווים יופסקו ביום שישי בבוקר, ויופעלו אוטובוסים חלופיים בין התחנות הסגורות",
    summary: "עבודות תשתית ישבשו את תנועת הרכבות ביום שישי, ויופעלו הסעות חלופיות.",
    impact: "אם אתם נוסעים ביום שישי בבוקר, כדאי לבדוק מראש את לוחות הזמנים ולהקדים את היציאה.",
    body: "ידיעה לדוגמה: בעקבות עבודות תשתית מתוכננות, תופסק תנועת הרכבות בחלק מהקווים ביום שישי הקרוב בשעות הבוקר.\n\nלפי ההודעה, יופעלו אוטובוסים חלופיים בין התחנות שייסגרו, והנוסעים מתבקשים להתעדכן בלוחות הזמנים.\n\nזו ידיעה לדוגמה שמדגימה את מבנה הידיעות באתר, כולל המדור \"מה זה אומר עליך\".",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-2", minutesAgo: 22, category: "economy", city: "",
    title: "מחירי מוצרי היסוד צפויים להשתנות מתחילת החודש הבא",
    subtitle: "הפיקוח על המחירים מתעדכן, וחלק מהמוצרים יתייקרו בשיעור קטן",
    summary: "עדכון המחירים המפוקחים ייכנס לתוקף בתחילת החודש.",
    impact: "כדאי לשים לב למחירים בקנייה הגדולה לפני תחילת החודש.",
    body: "ידיעה לדוגמה על עדכון מחירים מפוקחים.\n\nהעדכון יחול על מספר מוצרי יסוד, ושיעור השינוי צפוי להיות מתון.\n\nפרטים נוספים יפורסמו בהמשך.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-3", minutesAgo: 41, category: "local", city: "בני ברק",
    title: "רחוב מרכזי ייסגר לתנועה לשלושה ימים בשל עבודות ניקוז",
    subtitle: "העירייה פרסמה מסלולים חלופיים ומבקשת מהתושבים להימנע מחניה באזור",
    summary: "עבודות ניקוז יסגרו רחוב מרכזי לשלושה ימים.",
    impact: "", body: "ידיעה מקומית לדוגמה.\n\nהעבודות נועדו למנוע הצפות בחורף הקרוב.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-4", minutesAgo: 75, category: "torah", city: "ירושלים",
    title: "אלפים צפויים להשתתף בכינוס לימוד גדול בירושלים",
    subtitle: "המארגנים נערכים להסעות מיוחדות מכל רחבי הארץ",
    summary: "כינוס לימוד גדול יתקיים בירושלים, והסעות יצאו מכל הארץ.",
    impact: "", body: "ידיעה לדוגמה על כינוס לימוד.\n\nהמארגנים פרסמו את נקודות האיסוף להסעות.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-5", minutesAgo: 110, category: "health", city: "",
    title: "שרב בדרך: משרד הבריאות מפרסם הנחיות להתגוננות מהחום",
    subtitle: "מומלץ להרבות בשתייה ולהימנע משהייה ממושכת בשמש בשעות הצהריים",
    summary: "צפוי שרב כבד, ומשרד הבריאות ממליץ להרבות בשתייה.",
    impact: "הקפידו על שתייה מרובה, במיוחד אצל ילדים ומבוגרים.",
    body: "ידיעה לדוגמה על הנחיות לימי שרב.\n\nההמלצות כוללות שתייה מרובה והימנעות מפעילות מאומצת בשעות החמות.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-6", minutesAgo: 160, category: "politics", city: "",
    title: "דיון סוער בוועדה על תקציב מוסדות החינוך",
    subtitle: "חברי הכנסת דרשו הבהרות על לוח הזמנים של העברת הכספים",
    summary: "הוועדה דנה בתקציב מוסדות החינוך, וההחלטה נדחתה לשבוע הבא.",
    impact: "", body: "ידיעה לדוגמה מהזירה הפוליטית.\n\nההצבעה נדחתה לשבוע הבא.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-7", minutesAgo: 230, category: "tech", city: "",
    title: "שירות חדש מאפשר לשמוע עדכונים חשובים גם בטלפון כשר",
    subtitle: "השירות מבוסס על הקראה קולית אוטומטית של הודעות",
    summary: "שירות קולי חדש מנגיש עדכונים למשתמשי טלפון כשר.",
    impact: "", body: "ידיעה לדוגמה בתחום הטכנולוגיה.\n\nהשירות פועל בכל שעות היממה.",
    source_name: "ידיעה לדוגמה",
  },
  {
    slug: "demo-8", minutesAgo: 300, category: "community", city: "בית שמש",
    title: "מבצע התרמה שכונתי גייס סכום שיא למשפחות נזקקות",
    subtitle: "מאות מתנדבים השתתפו בפעילות שנמשכה יממה שלמה",
    summary: "מבצע התרמה שכונתי שבר שיא, והכספים יחולקו לפני החג.",
    impact: "", body: "ידיעה לדוגמה מהקהילה.\n\nהכספים יחולקו למשפחות לפני החג.",
    source_name: "ידיעה לדוגמה",
  },
];
