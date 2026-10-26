/*
 * Server-side SEO tag rewriting for the storefront's static routes.
 *
 * WHY THIS EXISTS (fixes the "pages aren't being indexed" warning from
 * Google Search Console):
 * This site is a single-page app - one index.html file, with JavaScript
 * that changes the page's <title> and <link rel="canonical"> AFTER the
 * page loads (see updateSEOForView() in index.html). That's fine for a
 * human visitor, but the very first HTML Google's crawler receives -
 * before any JavaScript runs - always has the exact same <title> and the
 * exact same canonical URL (the homepage), no matter which URL was
 * requested (/shop, /about, /contact, etc.). When many different URLs
 * all point to one canonical URL in their raw HTML, Google's indexer
 * typically folds them together and treats everything except the
 * homepage as a duplicate - which means it skips indexing them. That
 * matches the "Duplicate, Google chose different canonical than user"
 * and "Crawled - currently not indexed" reasons shown in Search Console.
 *
 * This middleware runs on Vercel's Edge Network, on the specific static
 * routes listed in sitemap.xml, and rewrites the raw HTML response with
 * the CORRECT title/description/canonical/OG tags for that exact URL -
 * before it ever leaves the server. Google (and anyone else) now always
 * sees the right canonical URL for every route on the very first byte,
 * with no JavaScript required. Dynamic, non-sitemap routes (individual
 * product pages, checkout, account) are left untouched and keep working
 * exactly as before, via the client-side updateSEOForView() logic.
 */

const SITE_ORIGIN = "https://reposestyle.com";

/* ------------------------------------------------------------------
 * (formerly) DELIBERATE PAGE-LOAD DELAY - REMOVED
 * ------------------------------------------------------------------
 * This used to add an artificial ~1.25s wait here before every real
 * navigation responded, so the browser's tab spinner had time to show.
 * Removed: it was stacking on top of the golden collection-loading
 * spinner (see navigateWithGoldLoader in index.html) and making every
 * page - including ones with no spinner at all, like /towels - feel
 * slow for no reason. Real navigation now responds as fast as Vercel
 * can serve it; the only intentional "wait" left anywhere on the site
 * is the golden spinner's own 1.5s timer on the collection buttons.
 * ------------------------------------------------------------------ */
const PAGE_LOAD_DELAY_MS = 0;
function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// Keep this in sync with VIEW_SEO in index.html for these specific routes.
const ROUTE_SEO = {
  "/": {
    title: "רפאוז סטייל | Repose Style — מצעי יוקרה, מגבות ואביזרי שינה",
    desc: "רפאוז סטייל (Repose Style) — חנות מצעי יוקרה, מגבות ואביזרי שינה איכותיים. משלוחים לכל הארץ.",
  },
  "/shop": {
    title: "הקולקציה המלאה | רפאוז סטייל",
    desc: "עיינו במלוא קולקציית מצעי היוקרה של רפאוז סטייל — Renaissance, Bloom, Heritage ועוד.",
  },
  "/shop/renaissance": {
    title: "קולקציית Renaissance | רפאוז סטייל",
    desc: "קולקציית Renaissance ממבחר מצעי היוקרה של רפאוז סטייל.",
  },
  "/shop/bloom": {
    title: "קולקציית Bloom | רפאוז סטייל",
    desc: "קולקציית Bloom ממבחר מצעי היוקרה של רפאוז סטייל.",
  },
  "/shop/heritage": {
    title: "קולקציית Heritage | רפאוז סטייל",
    desc: "קולקציית Heritage ממבחר מצעי היוקרה של רפאוז סטייל.",
  },
  "/towels": {
    title: "מגבות יוקרה | רפאוז סטייל",
    desc: "מגבות יוקרה איכותיות מבית רפאוז סטייל — רכות, סופגות ועמידות לאורך זמן.",
  },
  "/perfume": {
    title: "מכשירי בישום | רפאוז סטייל",
    desc: "מכשירי בישום אלגנטיים מבית רפאוז סטייל — ניחוח יוקרתי לבית.",
  },
  "/scents": {
    title: "ניחוחות לבית | רפאוז סטייל",
    desc: "ניחוחות לבית מבית רפאוז סטייל — בקבוקי חצי ליטר למכשירי הבישום, בניחוחות של מלון בוטיק.",
  },
  "/sale": {
    title: "מבצעים | רפאוז סטייל",
    desc: "הדגמים שנמצאים כרגע במבצע אצל רפאוז סטייל — במחיר מוזל לזמן מוגבל.",
  },
  "/about": {
    title: "אודות | רפאוז סטייל",
    desc: "על רפאוז סטייל — הסיפור שמאחורי המותג, הערכים והדרך בה אנו בונים כל סט מצעים.",
  },
  "/contact": {
    title: "צור קשר | רפאוז סטייל",
    desc: "צרו קשר עם צוות רפאוז סטייל בכל שאלה או בקשה.",
  },
  "/shipping": {
    title: "משלוחים והחזרות | רפאוז סטייל",
    desc: "מדיניות המשלוחים וההחזרות של רפאוז סטייל.",
  },
  "/faq": {
    title: "שאלות נפוצות | רפאוז סטייל",
    desc: "שאלות ותשובות נפוצות אודות מוצרי והזמנות רפאוז סטייל.",
  },
  "/privacy": {
    title: "מדיניות פרטיות | רפאוז סטייל",
    desc: "מדיניות הפרטיות של אתר רפאוז סטייל.",
  },
  "/terms": {
    title: "תנאי שימוש | רפאוז סטייל",
    desc: "תנאי השימוש באתר רפאוז סטייל.",
  },
  "/accessibility": {
    title: "הצהרת נגישות | רפאוז סטייל",
    desc: "הצהרת הנגישות של אתר רפאוז סטייל.",
  },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Per-product SEO (title / description / canonical / image) for /product/:id.
   Without it the raw HTML of every product page carried the HOMEPAGE canonical,
   so Google treated product pages as "alternate pages" of the homepage and
   didn't index them. Keep in sync with the catalog in index.html. */
const PRODUCT_SEO = {
 "prachim": {
  "title": "דגם אביב | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם אביב. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/prachim.jpg"
 },
 "simfonia": {
  "title": "דגם סימפוניה | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם סימפוניה. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/simfonia.jpg"
 },
 "rakefet": {
  "title": "דגם רקפת | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם רקפת. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/rakefet.jpg"
 },
 "yahalom": {
  "title": "דגם יהלום | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם יהלום. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/yahalom.jpg"
 },
 "london": {
  "title": "דגם לונדון | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם לונדון. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/london.jpg"
 },
 "royal": {
  "title": "דגם רויאל | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם רויאל. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/royal.jpg"
 },
 "star": {
  "title": "דגם סטאר | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם סטאר. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/star.jpg"
 },
 "okeanos": {
  "title": "דגם אוקיינוס | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם אוקיינוס. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/okeanos.jpg"
 },
 "classic": {
  "title": "דגם קלאסיק | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם קלאסיק. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/classic.jpg"
 },
 "aviv": {
  "title": "דגם סימפוניה פרימיום | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם סימפוניה פרימיום. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/aviv.jpg"
 },
 "simfonia-premium": {
  "title": "דגם פוקסיה | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם פוקסיה. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/simfonia-premium.jpg"
 },
 "elegantia": {
  "title": "דגם מלודיה | רפאוז סטייל",
  "desc": "סט מצעי יוקרה מבית רפאוז סטייל — דגם מלודיה. כותנה איכותית, משלוח לכל הארץ.",
  "img": "/images/products/elegantia.jpg"
 },
 "towel-hand-premium": {
  "title": "מגבת פילדלפיה | רפאוז סטייל",
  "desc": "מגבת פילדלפיה מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-hand.jpg"
 },
 "towel-bath-classic": {
  "title": "מגבת שוהם | רפאוז סטייל",
  "desc": "מגבת שוהם מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-face.jpg"
 },
 "towel-body-boutique": {
  "title": "מגבת מילאנו | רפאוז סטייל",
  "desc": "מגבת מילאנו מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-body.jpg"
 },
 "towel-natali": {
  "title": "מגבת נטלי | רפאוז סטייל",
  "desc": "מגבת נטלי מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-natali.jpg"
 },
 "towel-avishag": {
  "title": "מגבת אבישג | רפאוז סטייל",
  "desc": "מגבת אבישג מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-avishag.jpg"
 },
 "towel-venezia": {
  "title": "מגבת ונציה | רפאוז סטייל",
  "desc": "מגבת ונציה מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-venezia.jpg"
 },
 "towel-oriya": {
  "title": "מגבת אוריה | רפאוז סטייל",
  "desc": "מגבת אוריה מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-oriya.jpg"
 },
 "towel-liya": {
  "title": "מגבת ליה | רפאוז סטייל",
  "desc": "מגבת ליה מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-liya.jpg"
 },
 "towel-iziva": {
  "title": "מגבת איביזה | רפאוז סטייל",
  "desc": "מגבת איביזה מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-iziva.jpg"
 },
 "towel-tenerife": {
  "title": "מגבת טנריף | רפאוז סטייל",
  "desc": "מגבת טנריף מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-tenerife.jpg"
 },
 "towel-liam": {
  "title": "מגבת ליאם | רפאוז סטייל",
  "desc": "מגבת ליאם מבית רפאוז סטייל — 100% כותנה, בשלוש מידות: ידיים, פנים וגוף. משלוח לכל הארץ.",
  "img": "/images/products/towel-liam.jpg"
 },
 "perfume-white": {
  "title": "מכשיר בישום דגם בייסיק | רפאוז סטייל",
  "desc": "מכשיר בישום דגם בייסיק מבית רפאוז סטייל — ניחוח של מלון בוטיק בבית. משלוח לכל הארץ.",
  "img": "/images/site/perfume-device-white.jpg"
 },
 "perfume-gold": {
  "title": "מכשיר בישום גולד דגם A300 | רפאוז סטייל",
  "desc": "מכשיר בישום גולד דגם A300 מבית רפאוז סטייל — ניחוח של מלון בוטיק בבית. משלוח לכל הארץ.",
  "img": "/images/site/perfume-device-v2.jpg"
 },
 "perfume-graphite": {
  "title": "מכשיר בישום גרפיט חכם דגם A400 | רפאוז סטייל",
  "desc": "מכשיר בישום גרפיט חכם דגם A400 מבית רפאוז סטייל — ניחוח של מלון בוטיק בבית. משלוח לכל הארץ.",
  "img": "/images/site/perfume-device-graphite.jpg"
 },
 "scent-testers-6": {
  "title": "מארז 6 טסטרים | רפאוז סטייל",
  "desc": "מארז 6 טסטרים של ניחוחות רפאוז סטייל — להתנסות בניחוחות לפני שבוחרים בקבוק מלא.",
  "img": "/images/products/scent-testers.png"
 },
 "scent-holyland": {
  "title": "ניחוח הולילנד | רפאוז סטייל",
  "desc": "ניחוח הולילנד מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-miami": {
  "title": "ניחוח מיאמי | רפאוז סטייל",
  "desc": "ניחוח מיאמי מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-spring": {
  "title": "ניחוח ספרינג | רפאוז סטייל",
  "desc": "ניחוח ספרינג מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-newyork": {
  "title": "ניחוח ניו יורק | רפאוז סטייל",
  "desc": "ניחוח ניו יורק מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-paris": {
  "title": "ניחוח פריז | רפאוז סטייל",
  "desc": "ניחוח פריז מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-lacoste": {
  "title": "ניחוח לקוסט | רפאוז סטייל",
  "desc": "ניחוח לקוסט מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-tea-time": {
  "title": "ניחוח תה טיים | רפאוז סטייל",
  "desc": "ניחוח תה טיים מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-royal-beach": {
  "title": "ניחוח רויאל ביץ | רפאוז סטייל",
  "desc": "ניחוח רויאל ביץ מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-olympia": {
  "title": "ניחוח אולימפיה | רפאוז סטייל",
  "desc": "ניחוח אולימפיה מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-delta": {
  "title": "ניחוח דלתא | רפאוז סטייל",
  "desc": "ניחוח דלתא מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-boutique-hotel": {
  "title": "ניחוח מלון בוטיק | רפאוז סטייל",
  "desc": "ניחוח מלון בוטיק מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-nautica-home": {
  "title": "ניחוח נאוטיקה הום | רפאוז סטייל",
  "desc": "ניחוח נאוטיקה הום מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-jasmine": {
  "title": "ניחוח יסמין | רפאוז סטייל",
  "desc": "ניחוח יסמין מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-black-jasmine": {
  "title": "ניחוח בלאק יסמין | רפאוז סטייל",
  "desc": "ניחוח בלאק יסמין מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-luxury-spa": {
  "title": "ניחוח ספא יוקרתי | רפאוז סטייל",
  "desc": "ניחוח ספא יוקרתי מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-karamim": {
  "title": "ניחוח כרמים | רפאוז סטייל",
  "desc": "ניחוח כרמים מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-bereshit": {
  "title": "ניחוח בראשית | רפאוז סטייל",
  "desc": "ניחוח בראשית מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-patal": {
  "title": "ניחוח פתאל | רפאוז סטייל",
  "desc": "ניחוח פתאל מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-blue-chanel": {
  "title": "ניחוח בלו שאנל | רפאוז סטייל",
  "desc": "ניחוח בלו שאנל מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-london": {
  "title": "ניחוח לונדון | רפאוז סטייל",
  "desc": "ניחוח לונדון מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-pink-lotus": {
  "title": "ניחוח פינק לוטוס | רפאוז סטייל",
  "desc": "ניחוח פינק לוטוס מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-abercrombie": {
  "title": "ניחוח אמרקומבי | רפאוז סטייל",
  "desc": "ניחוח אמרקומבי מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 },
 "scent-my-secret": {
  "title": "ניחוח My secret | רפאוז סטייל",
  "desc": "ניחוח My secret מבית רפאוז סטייל — בקבוק חצי ליטר למכשירי הבישום. משלוח לכל הארץ.",
  "img": "/images/products/scent-bottle-v2.jpg"
 }
};

export default async function middleware(request) {
  await delay(PAGE_LOAD_DELAY_MS);

  const url = new URL(request.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "") path = "/";

  let meta = ROUTE_SEO[path];
  const productMatch = path.match(/^\/product\/([a-z0-9-]+)$/);
  if (!meta && productMatch && PRODUCT_SEO[productMatch[1]]) meta = PRODUCT_SEO[productMatch[1]];
  if (!meta) return; // Not a static SEO route - pass through untouched (still delayed above).

  /* -----------------------------------------------------------------
   * BUGFIX: this middleware runs on EVERY real navigation to one of
   * the routes in `matcher` below (home, /shop, /towels, every
   * product page, /checkout, /account, ...) - and it used to `await`
   * an internal fetch back to this site's own /index.html, with NO
   * timeout, before it could respond at all. If that internal
   * request was ever slow (a cold function start, a network hiccup
   * between Vercel's edge and the origin, anything) there was no
   * limit on how long it could hang - the visitor's whole page load
   * would just sit there with nothing on screen, on every page
   * except the ones the browser had already cached from a previous
   * visit (which is why the homepage tended to feel fine while other
   * pages, reached via a real link click, would sometimes hang for a
   * very long time). The SEO title/canonical rewrite below is a
   * nice-to-have for search engines - it must never be able to block
   * a real visitor from seeing the page. Now it gives up after 2.5s
   * and simply serves the page unmodified instead of hanging.
   * ----------------------------------------------------------------- */
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 2500);

  let origin;
  try {
    origin = await fetch(new URL("/index.html", request.url), { signal: controller.signal });
  } catch (err) {
    return; // Timed out, or the internal fetch failed - pass through untouched.
  } finally {
    clearTimeout(abortTimer);
  }

  if (!origin.ok) return; // Fall back to normal handling if index.html can't be fetched.

  let html = await origin.text();
  const fullUrl = SITE_ORIGIN + path;
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.desc);

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /(<meta name="description" content=")[^"]*(")/,
      `$1${desc}$2`
    )
    .replace(
      /(<link rel="canonical" href=")[^"]*(")/,
      `$1${fullUrl}$2`
    )
    .replace(
      /(<meta property="og:title" content=")[^"]*(")/,
      `$1${title}$2`
    )
    .replace(
      /(<meta property="og:description" content=")[^"]*(")/,
      `$1${desc}$2`
    )
    .replace(
      /(<meta property="og:url" content=")[^"]*(")/,
      `$1${fullUrl}$2`
    )
    .replace(
      /(<meta name="twitter:title" content=")[^"]*(")/,
      `$1${title}$2`
    )
    .replace(
      /(<meta name="twitter:description" content=")[^"]*(")/,
      `$1${desc}$2`
    )
    .replace(
      /(<meta property="og:image" content=")[^"]*(")/,
      (m0, a1, a2) => meta.img ? `${a1}${SITE_ORIGIN}${meta.img}${a2}` : m0
    )
    .replace(
      /(<meta name="twitter:image" content=")[^"]*(")/,
      (m0, a1, a2) => meta.img ? `${a1}${SITE_ORIGIN}${meta.img}${a2}` : m0
    );

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

export const config = {
  matcher: [
    "/",
    "/shop",
    "/shop/renaissance",
    "/shop/bloom",
    "/shop/heritage",
    "/towels",
    "/perfume",
    "/scents",
    "/sale",
    "/about",
    "/contact",
    "/shipping",
    "/faq",
    "/privacy",
    "/terms",
    "/accessibility",
    "/product/:id",  // no SEO rewrite here (handled client-side), but still gets the delay above
    "/checkout",     // no SEO rewrite (not indexable), but still gets the delay above
    "/account",      // no SEO rewrite (not indexable), but still gets the delay above
  ],
};
