// נייעס: מסך הסטטוסים וצופה המבזקים במסך מלא.

(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- צבעי רקע לכל נושא ----------
  const GRADIENTS = {
    hot:       "linear-gradient(160deg, #b3122e, #ff2d55)",
    general:   "linear-gradient(160deg, #2b5876, #4e4376)",
    politics:  "linear-gradient(160deg, #1e3c72, #2a5298)",
    community: "linear-gradient(160deg, #0b7a63, #26a86a)",
    torah:     "linear-gradient(160deg, #7a4a20, #b7843a)",
    economy:   "linear-gradient(160deg, #d9480f, #f59f00)",
    local:     "linear-gradient(160deg, #5f2c82, #9b4dca)",
    health:    "linear-gradient(160deg, #087f8c, #12a4a8)",
    world:     "linear-gradient(160deg, #355c7d, #6c5b7b)",
    tech:      "linear-gradient(160deg, #4568dc, #9b5fb5)",
    weather:   "linear-gradient(160deg, #1c6ea4, #2fa3d6)",
  };

  // ---------- מצב ----------
  let articles = [];
  let ads = [];
  let seen = new Set(load("nayes_seen", []));
  let myRx = load("nayes_rx", {});

  function load(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // ---------- טעינה ----------
  $("hdate").textContent = hebrewDate();
  $("year").textContent = new Date().getFullYear();
  if (ADVERTISE_LINK) $("adv-link").href = ADVERTISE_LINK;

  init();

  async function init() {
    const [res, adList] = await Promise.all([api({ limit: 40 }), loadAds()]);
    articles = res.articles || [];
    ads = adList;
    if (DEMO_MODE) showDemoBanner();
    renderList();

    // קישור ששותף למבזק מסוים: פותחים אותו ישר במסך מלא.
    const m = location.pathname.match(/^\/article\/([^/]+)/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      let a = articles.find((x) => x.slug === slug);
      if (!a) {
        const r = await api({ slug });
        if (r.article) { a = r.article; articles.push(a); }
      }
      if (a) openViewer("all", slug);
    }

    setInterval(refresh, 60000);
  }

  async function refresh() {
    if (viewer.open || document.hidden) return;
    const res = await api({ limit: 40 });
    if (res.articles && res.articles.length) {
      articles = res.articles;
      renderList();
    }
  }

  function showDemoBanner() {
    const b = document.createElement("div");
    b.className = "demo-banner";
    b.textContent = "מצב תצוגה: המבזקים והמודעות כאן הם לדוגמה בלבד, עד שיחובר מסד הנתונים.";
    document.body.prepend(b);
  }

  // ---------- ערוצים ----------
  function channels() {
    const recent = recentOnly(articles);
    const list = [{ key: "all", name: "כל המבזקים", emoji: "נ", items: recent, logo: true }];
    const hot = recent.filter((a) => a.is_breaking);
    if (hot.length) list.push({ key: "hot", name: "דחוף", emoji: "🔴", items: hot });
    for (const [key, c] of Object.entries(CATEGORIES)) {
      const items = recent.filter((a) => a.category === key);
      if (items.length) list.push({ key, name: c.name, emoji: c.emoji, items });
    }
    return list;
  }

  // מבזקים מ-24 השעות האחרונות; אם אין, 10 האחרונים.
  function recentOnly(list) {
    const day = Date.now() - 24 * 3600 * 1000;
    const r = list.filter((a) => Date.parse(a.published_at) > day);
    return r.length ? r : list.slice(0, 10);
  }

  const unseenCount = (items) => items.filter((a) => !seen.has(a.slug)).length;

  // ---------- מסך הרשימה ----------
  function ringHtml(ch, size) {
    const n = unseenCount(ch.items);
    return `<div class="ring ${ch.logo ? "logo-ring" : ""} ${n ? "" : "seen"}" style="--size:${size}px">
      <span>${esc(ch.emoji)}</span>${n && size > 50 ? `<i class="count">${n}</i>` : ""}</div>`;
  }

  function renderList() {
    const chs = channels();

    $("strip").innerHTML = chs.map((ch) => `
      <button data-ch="${ch.key}" aria-label="${esc(ch.name)}">${ringHtml(ch, 64)}<small>${esc(ch.name)}</small></button>`).join("");

    const fresh = chs.filter((ch) => unseenCount(ch.items));
    const old = chs.filter((ch) => !unseenCount(ch.items));
    const rowHtml = (ch) => {
      const latest = ch.items[0];
      return `<button class="row ${ch.key === "hot" ? "hot" : ""}" data-ch="${ch.key}">
        ${ringHtml(ch, 54)}
        <span class="txt"><b>${esc(ch.key === "all" ? "נייעס · כל המבזקים" : ch.name)}</b>
          <span class="preview">${esc(latest ? latest.title : "")}</span>
          <span class="when">${esc(latest ? timeAgo(latest.published_at) : "")} · ${ch.items.length} עדכונים</span></span>
      </button>`;
    };

    $("list").innerHTML = !articles.length
      ? `<div class="empty">עוד אין מבזקים. הם יופיעו כאן ברגע שיתפרסמו.</div>`
      : `${fresh.length ? `<div class="sec">עדכונים חדשים</div>${fresh.map(rowHtml).join("")}` : ""}
         ${old.length ? `<div class="sec">נצפו</div>${old.map(rowHtml).join("")}` : ""}`;

    document.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => openViewer(b.dataset.ch)));
    $("play").onclick = () => openViewer("all");
    renderPinned();
  }

  let pinIdx = 0;
  let pinTimer = null;
  function renderPinned() {
    const tops = ads.filter((a) => a.placement === "top");
    const box = $("pinned");
    if (!tops.length) { box.innerHTML = ""; return; }
    const show = () => {
      const ad = tops[pinIdx % tops.length];
      box.innerHTML = `<a href="${adHref(ad)}" ${DEMO_MODE ? "" : 'target="_blank" rel="noopener sponsored"'} style="--ad-c:${esc(ad.color || "#0a7d5a")}">
        ${ad.image_url ? `<img src="${esc(ad.image_url)}" alt="">` : `<span class="ic">📌</span>`}
        <span class="txt"><span class="lbl">ממומן · ${esc(ad.advertiser)}</span><span class="t">${esc(ad.title)}</span></span>
        <span class="go">${esc(ad.cta || "לפרטים")}</span></a>`;
      pinIdx++;
    };
    show();
    clearInterval(pinTimer);
    if (tops.length > 1) pinTimer = setInterval(show, 7000);
  }

  // ---------- הצופה ----------
  const viewer = { open: false, seq: [], idx: 0, start: 0, elapsed: 0, dur: 7000, paused: false, raf: 0, chKey: "all" };

  function buildSequence(chKey) {
    const ch = channels().find((c) => c.key === chKey) || channels()[0];
    const news = [...ch.items].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    const adPool = [...ads.filter((a) => a.placement === "top"), ...ads.filter((a) => a.placement === "feed")];
    const seq = [];
    let adI = 0;
    news.forEach((a, i) => {
      seq.push({ type: "news", a });
      // סטטוס ממומן אחרי כל 4 מבזקים
      if (adPool.length && (i + 1) % 4 === 0 && i < news.length - 1) {
        seq.push({ type: "ad", ad: adPool[adI++ % adPool.length] });
      }
    });
    return { ch, seq };
  }

  function openViewer(chKey, slug) {
    const { ch, seq } = buildSequence(chKey);
    if (!seq.length) return;
    viewer.seq = seq;
    viewer.chKey = ch.key;
    let start = slug
      ? seq.findIndex((s) => s.type === "news" && s.a.slug === slug)
      : seq.findIndex((s) => s.type === "news" && !seen.has(s.a.slug));
    if (start < 0) start = 0;
    viewer.open = true;
    $("viewer").classList.add("open");
    document.body.style.overflow = "hidden";
    $("bars").innerHTML = seq.map(() => "<i><b></b></i>").join("");
    renderSide();
    show(start);
  }

  function closeViewer() {
    viewer.open = false;
    cancelAnimationFrame(viewer.raf);
    $("viewer").classList.remove("open");
    $("sheet").classList.remove("open");
    document.body.style.overflow = "";
    if (location.pathname !== "/") history.replaceState(null, "", "/");
    renderList();
  }

  function show(i) {
    if (i < 0) i = 0;
    if (i >= viewer.seq.length) return closeViewer();
    viewer.idx = i;
    viewer.elapsed = 0;
    viewer.paused = false;
    $("stage").classList.remove("paused");
    $("sheet").classList.remove("open");

    [...$("bars").children].forEach((bar, j) => {
      bar.classList.toggle("done", j < i);
      bar.firstChild.style.width = j < i ? "100%" : "0";
    });

    const item = viewer.seq[i];
    if (item.type === "news") renderNews(item.a);
    else renderAd(item.ad);

    viewer.start = performance.now();
    cancelAnimationFrame(viewer.raf);
    viewer.raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!viewer.open) return;
    if (viewer.paused || document.hidden) {
      viewer.start = now - viewer.elapsed;
    } else {
      viewer.elapsed = now - viewer.start;
      const p = Math.min(1, viewer.elapsed / viewer.dur);
      $("bars").children[viewer.idx].firstChild.style.width = p * 100 + "%";
      if (p >= 1) return show(viewer.idx + 1);
    }
    viewer.raf = requestAnimationFrame(tick);
  }

  function setPaused(p) {
    viewer.paused = p;
    $("stage").classList.toggle("paused", p && !$("sheet").classList.contains("open"));
  }

  // ---------- מבזק ----------
  function renderNews(a) {
    const cat = CATEGORIES[a.category] || CATEGORIES.general;
    const len = (a.title || "").length + (a.summary || "").length + (a.impact || "").length;
    viewer.dur = Math.max(6000, Math.min(14000, 4000 + len * 40));

    seen.add(a.slug);
    save("nayes_seen", [...seen].slice(-400));
    history.replaceState(null, "", articleUrl(a));

    $("stage").style.setProperty("--bg-grad", a.is_breaking ? GRADIENTS.hot : GRADIENTS[a.category] || GRADIENTS.general);
    $("s-extra").innerHTML = "";
    $("s-head").innerHTML = `
      <div class="ring logo-ring"><span>נ</span></div>
      <div class="who"><b>נייעס</b><small>${esc(cat.emoji)} ${esc(cat.name)}${a.city ? " · " + esc(a.city) : ""} · ${esc(timeAgo(a.published_at))}</small></div>
      <button class="icon-btn" id="v-close" aria-label="סגירה">✕</button>`;

    $("s-body").className = "s-body pop-in";
    $("s-body").innerHTML = `
      ${a.image_url ? `<img class="pic" src="${esc(a.image_url)}" alt="">` : ""}
      <span class="s-tag ${a.is_breaking ? "hot" : ""}">${a.is_breaking ? "🔴 דחוף" : `${esc(cat.emoji)} ${esc(cat.name)}`}</span>
      <h2 class="s-title">${esc(a.title)}</h2>
      ${a.summary ? `<p class="s-text">${esc(a.summary)}</p>` : ""}
      ${a.impact ? `<div class="s-tip"><b>💡 מה זה אומר עליך?</b> ${esc(a.impact)}</div>` : ""}`;

    const rx = a.reactions || {};
    $("s-foot").innerHTML = `
      <button class="more-up" id="more-up">עוד פרטים ושיתוף</button>
      <div class="rx-bar">
        ${REACTIONS.map((e) => `<button class="rx ${myRx[a.slug] === e ? "mine" : ""}" data-e="${e}">${e}${rx[e] ? `<b>${compact(rx[e])}</b>` : ""}</button>`).join("")}
        <button class="icon-btn" id="share" aria-label="שיתוף" style="background:rgba(255,255,255,.18)">↗</button>
      </div>`;

    const paragraphs = String(a.body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    $("sheet").innerHTML = `
      <div class="grab"></div>
      <h3>${esc(a.title)}</h3>
      ${(paragraphs.length ? paragraphs : [a.summary || ""]).map((p) => `<p>${esc(p)}</p>`).join("")}
      ${a.source_name ? `<div class="src">מקור: ${a.source_url ? `<a href="${esc(a.source_url)}" target="_blank" rel="noopener nofollow">${esc(a.source_name)}</a>` : esc(a.source_name)}</div>` : ""}
      <div class="acts">
        <a class="chip-btn" href="https://wa.me/?text=${encodeURIComponent(a.title + "\n" + location.origin + articleUrl(a))}" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
        <button class="chip-btn" id="copy">העתקת קישור</button>
        <button class="chip-btn" id="sheet-close">חזרה למבזקים</button>
      </div>`;

    wireCommon();
    $("more-up").onclick = openSheet;
    $("share").onclick = () => share(a);
    $("copy").onclick = async (e) => {
      try { await navigator.clipboard.writeText(location.origin + articleUrl(a)); e.target.textContent = "הועתק ✓"; } catch {}
    };
    $("sheet-close").onclick = closeSheet;
    $("s-foot").querySelectorAll(".rx").forEach((b) => (b.onclick = (ev) => doReact(a, b.dataset.e, b, ev)));
  }

  async function doReact(a, emoji, btn, ev) {
    ev.stopPropagation();
    floaty(emoji, btn);
    if (myRx[a.slug]) return; // תגובה אחת לכל מבזק
    myRx[a.slug] = emoji;
    save("nayes_rx", myRx);
    a.reactions = { ...(a.reactions || {}), [emoji]: (a.reactions?.[emoji] || 0) + 1 };
    btn.classList.add("mine", "bump");
    btn.innerHTML = `${emoji}<b>${compact(a.reactions[emoji])}</b>`;
    const fresh = await react(a.slug, emoji).catch(() => null);
    if (fresh) a.reactions = fresh;
  }

  function floaty(emoji, from) {
    const r = from.getBoundingClientRect();
    const s = $("stage").getBoundingClientRect();
    const f = document.createElement("span");
    f.className = "floaty";
    f.textContent = emoji;
    f.style.left = r.left - s.left + r.width / 2 - 17 + "px";
    f.style.top = r.top - s.top - 20 + "px";
    $("stage").appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  async function share(a) {
    const url = location.origin + articleUrl(a);
    setPaused(true);
    try {
      if (navigator.share) await navigator.share({ title: a.title, text: a.title, url });
      else window.open(`https://wa.me/?text=${encodeURIComponent(a.title + "\n" + url)}`, "_blank", "noopener");
    } catch {}
    setPaused(false);
  }

  // ---------- סטטוס ממומן ----------
  function renderAd(ad) {
    viewer.dur = 7000;
    const color = ad.color || "#333a45";
    $("stage").style.setProperty("--bg-grad", `linear-gradient(160deg, ${color}, ${shade(color, -35)})`);
    $("stage").style.setProperty("--ad-c", color);
    $("s-head").innerHTML = `
      <div class="ring"><span style="background:#fff;color:${esc(color)};font-weight:900;font-size:18px">${esc((ad.advertiser || "?").trim()[0])}</span></div>
      <div class="who"><b>${esc(ad.advertiser)}</b><small>ממומן</small></div>
      <button class="icon-btn" id="v-close" aria-label="סגירה">✕</button>`;
    $("s-extra").innerHTML = `<span class="ad-label">✨ סטטוס ממומן</span>`;
    $("s-body").className = "s-body pop-in";
    $("s-body").innerHTML = `
      ${ad.image_url ? `<img class="pic" src="${esc(ad.image_url)}" alt="">` : ""}
      <h2 class="s-title">${esc(ad.title)}</h2>
      ${ad.text ? `<p class="s-text">${esc(ad.text)}</p>` : ""}`;
    $("s-foot").innerHTML = `<a class="cta" href="${adHref(ad)}" ${DEMO_MODE ? "" : 'target="_blank" rel="noopener sponsored"'}>${esc(ad.cta || "לפרטים")} ←</a>`;
    $("sheet").innerHTML = "";
    $("s-foot").querySelector(".cta").addEventListener("click", (e) => {
      e.stopPropagation();
      if (DEMO_MODE) { closeViewer(); }
    });
    wireCommon();
  }

  // הכהיית צבע לגרדיאנט
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (c * pct) / 100)));
    return "#" + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  // ---------- מודעות צד (מחשב) ----------
  function renderSide() {
    const side = ads.filter((a) => a.placement === "side");
    $("v-side").innerHTML = `<span class="lbl">ממומן</span>` + (side.length
      ? side.map((ad) => `<a class="side-ad" href="${adHref(ad)}" ${DEMO_MODE ? "" : 'target="_blank" rel="noopener sponsored"'} style="--ad-c:${esc(ad.color || "#333a45")}">
          ${ad.image_url ? `<img src="${esc(ad.image_url)}" alt="">` : ""}
          <b>${esc(ad.title)}</b>${ad.text ? `<p>${esc(ad.text)}</p>` : ""}<span class="go">${esc(ad.cta || "לפרטים")}</span></a>`).join("")
      : `<div class="side-house"><b>המקום הזה פנוי 📣</b>פרסמו כאן את העסק שלכם</div>`);
  }

  // ---------- שליטה: לחיצות, החלקות, מקלדת ----------
  function wireCommon() {
    $("v-close").onclick = (e) => { e.stopPropagation(); closeViewer(); };
  }

  function openSheet() {
    if (!$("sheet").innerHTML) return;
    $("sheet").classList.add("open");
    setPaused(true);
  }
  function closeSheet() {
    $("sheet").classList.remove("open");
    setPaused(false);
  }

  let downAt = 0, downY = 0, downX = 0, held = false, holdTimer = 0;
  const stage = $("stage");

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, .sheet")) return;
    downAt = Date.now(); downY = e.clientY; downX = e.clientX; held = false;
    holdTimer = setTimeout(() => { held = true; setPaused(true); }, 200);
  });

  stage.addEventListener("pointerup", (e) => {
    clearTimeout(holdTimer);
    if (!downAt) return;
    const dy = e.clientY - downY;
    const dx = e.clientX - downX;
    downAt = 0;
    if (held) { setPaused(false); return; }
    if ($("sheet").classList.contains("open")) { if (!e.target.closest(".sheet")) closeSheet(); return; }
    if (dy > 90 && Math.abs(dx) < 80) return closeViewer();          // החלקה למטה: סגירה
    if (dy < -70 && Math.abs(dx) < 80) return openSheet();           // החלקה למעלה: עוד פרטים
    if (Math.abs(dx) > 60) return show(viewer.idx + (dx > 0 ? 1 : -1)); // החלקה הצידה
    if (e.target.closest("#tap-prev")) show(viewer.idx - 1);
    else if (e.target.closest("#tap-next")) show(viewer.idx + 1);
  });

  stage.addEventListener("pointercancel", () => { clearTimeout(holdTimer); downAt = 0; if (held) setPaused(false); });

  document.addEventListener("keydown", (e) => {
    if (!viewer.open) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") show(viewer.idx + 1);
    else if (e.key === "ArrowRight") show(viewer.idx - 1);
    else if (e.key === " ") { e.preventDefault(); setPaused(!viewer.paused); }
    else if (e.key === "ArrowUp") openSheet();
    else if (e.key === "ArrowDown") closeSheet();
  });
})();
