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

/* ------------------------------------------------------------------
 * BASE-HTML CACHE
 * ------------------------------------------------------------------
 * Rewriting the SEO tags means this middleware needs the raw index.html
 * text, which it gets via a self-fetch to /index.html - a real network
 * round-trip on Vercel's Edge Network, on top of the visitor's own
 * request, adding to the time before the browser sees its first byte
 * of HTML (and, in turn, before it can even start fetching the hero
 * image). Edge Function instances stay warm across multiple requests,
 * so caching that fetched text at module scope means only the first
 * request handled by a given warm instance pays for the extra
 * round-trip - every request after that reuses the cached text
 * instantly. A fresh deploy spins up fresh instances (fresh module
 * state), so this can never serve stale content from a previous
 * deploy. Falls back to a normal per-request fetch if the cached
 * fetch ever fails, same as before this cache existed. */
let cachedBaseHtmlPromise = null;
function getBaseHtml(request) {
  if (!cachedBaseHtmlPromise) {
    cachedBaseHtmlPromise = fetch(new URL("/index.html", request.url)).then((res) => {
      if (!res.ok) throw new Error("origin fetch failed: " + res.status);
      return res.text();
    });
    cachedBaseHtmlPromise.catch(() => { cachedBaseHtmlPromise = null; }); // don't cache a failure
  }
  return cachedBaseHtmlPromise;
}

export default async function middleware(request) {
  await delay(PAGE_LOAD_DELAY_MS);

  const url = new URL(request.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "") path = "/";

  const meta = ROUTE_SEO[path];
  if (!meta) return; // Not a static SEO route - pass through untouched (still delayed above).

  let html;
  try {
    html = await getBaseHtml(request);
  } catch (e) {
    return; // Fall back to normal handling if index.html can't be fetched.
  }
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
