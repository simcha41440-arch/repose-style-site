(async function () {
  const params = new URLSearchParams(location.search);
  const cat = CATEGORIES[params.get("cat")] ? params.get("cat") : null;
  const city = params.get("city") || null;

  renderChrome(cat || (city ? "local" : null));

  const filter = {};
  if (cat) filter.category = cat;
  if (city) filter.city = city;

  const [{ articles = [] }, popularRes, latestRes] = await Promise.all([
    api({ ...filter, limit: 30 }),
    api({ popular: 1, limit: 6 }),
    cat || city ? api({ limit: 12 }) : Promise.resolve(null),
  ]);
  const latestAll = latestRes ? latestRes.articles || [] : articles;

  showDemoBanner();
  renderTicker(latestAll);
  renderMain(articles, cat, city);
  renderBrief(latestAll);
  renderPopular(popularRes.articles || []);
  renderCities(city);

  if (cat) document.title = `${CATEGORIES[cat]} | קו ראשון`;
  if (city) document.title = `חדשות ${city} | קו ראשון`;

  function renderTicker(list) {
    const sixHours = Date.now() - 6 * 3600 * 1000;
    const breaking = list.filter((a) => a.is_breaking && Date.parse(a.published_at) > sixHours);
    if (!breaking.length) return;
    document.getElementById("ticker").innerHTML = `
      <div class="ticker"><div class="wrap ticker-inner">
        <span class="ticker-label">מבזק</span>
        <div class="ticker-track"><div class="ticker-run">
          ${breaking.map((a) => `<a href="${articleUrl(a)}">${esc(clock(a.published_at))} · ${esc(a.title)}</a>`).join("")}
        </div></div>
      </div></div>`;
  }

  function renderMain(list, cat, city) {
    const main = document.getElementById("main");
    const heading = cat ? CATEGORIES[cat] : city ? `חדשות ${city}` : null;

    if (!list.length) {
      main.innerHTML = `${heading ? `<h1 class="section-title">${esc(heading)}</h1>` : ""}
        <div class="empty">עדיין אין כאן ידיעות. הן יופיעו כאן ברגע שיתפרסמו.</div>`;
      return;
    }

    const [hero, a2, a3, ...rest] = list;
    main.innerHTML = `
      ${heading ? `<h1 class="section-title">${esc(heading)}</h1>` : ""}
      ${heroHtml(hero)}
      ${a2 ? `<div class="grid2">${cardHtml(a2)}${a3 ? cardHtml(a3) : ""}</div>` : ""}
      ${rest.length ? `<h2 class="section-title">עוד ידיעות</h2><div class="list">${rest.map(rowHtml).join("")}</div>` : ""}`;
  }

  function heroHtml(a) {
    const body = `
      <span class="cat">${esc(a.is_breaking ? "מבזק" : CATEGORIES[a.category] || "")}${a.city ? " · " + esc(a.city) : ""}</span>
      <h2 class="h">${esc(a.title)}</h2>
      ${a.subtitle ? `<p class="sub">${esc(a.subtitle)}</p>` : ""}
      <span class="meta">${esc(timeAgo(a.published_at))}</span>`;
    if (a.image_url) {
      return `<a class="hero has-img" href="${articleUrl(a)}"><img src="${esc(a.image_url)}" alt="" loading="eager"><div class="hero-body">${body}</div></a>`;
    }
    return `<a class="hero" href="${articleUrl(a)}">${body}</a>`;
  }

  function cardHtml(a) {
    return `<a class="card ${a.is_breaking ? "breaking" : ""}" href="${articleUrl(a)}">
      ${a.image_url ? `<img src="${esc(a.image_url)}" alt="" loading="lazy">` : ""}
      <span class="cat">${esc(CATEGORIES[a.category] || "")}${a.city ? " · " + esc(a.city) : ""}</span>
      <h3 class="h">${esc(a.title)}</h3>
      ${a.subtitle ? `<p>${esc(a.subtitle)}</p>` : ""}
      <span class="meta">${esc(timeAgo(a.published_at))}</span>
    </a>`;
  }

  function rowHtml(a) {
    return `<a class="row" href="${articleUrl(a)}">
      <span class="time">${esc(clock(a.published_at))}</span>
      <span>
        <span class="cat">${esc(CATEGORIES[a.category] || "")}${a.city ? " · " + esc(a.city) : ""}</span>
        <h3 class="h">${esc(a.title)}</h3>
        ${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
      </span>
    </a>`;
  }

  function renderBrief(list) {
    const el = document.getElementById("brief");
    const items = list.filter((a) => a.summary).slice(0, 8);
    el.innerHTML = items.length
      ? items.map((a) => `<li><span class="t">${esc(clock(a.published_at))}</span><a href="${articleUrl(a)}">${esc(a.summary)}</a></li>`).join("")
      : `<li>אין עדכונים כרגע.</li>`;
  }

  function renderPopular(list) {
    document.getElementById("popular").innerHTML = list
      .map((a) => `<li><a href="${articleUrl(a)}">${esc(a.title)}</a></li>`).join("");
  }

  function renderCities(active) {
    document.getElementById("cities").innerHTML = CITIES
      .map((c) => `<a class="chip ${c === active ? "on" : ""}" href="/?city=${encodeURIComponent(c)}">${esc(c)}</a>`).join("");
  }
})();
