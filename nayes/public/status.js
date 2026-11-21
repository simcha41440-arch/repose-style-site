// נייעס סטטוס: מסך העדכונים וצופה הסטטוס במסך מלא.

(function () {
  const $ = (id) => document.getElementById(id);

  // צבע רקע אחיד לכל ערוץ, כמו בסטטוס טקסט
  const COLORS = CHANNEL_COLORS;
  const QUICK = ["😍", "😂", "😮", "😢", "🙏", "👏", "🎉", "💯"];
  const HEART = "❤️";

  const ICON_BACK = `<svg viewBox="0 0 24 24"><path d="M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z"/></svg>`;
  const ICON_DOTS = `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
  const ICON_HEART = `<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 2.9 1.5-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const ICON_CHEV = `<svg viewBox="0 0 26 16"><path d="M3 13l10-9 10 9"/></svg>`;

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

  $("hdate").textContent = hebrewDate();
  $("v-x").innerHTML = icon("close", 26);
  $("arr-prev").innerHTML = icon("chevRight", 26);
  $("arr-next").innerHTML = icon("chevLeft", 26);
  $("install-ic").innerHTML = icon("install", 18, 2);
  $("mega-ic").innerHTML = icon("megaphone", 22);
  $("menu-btn").innerHTML = icon("dots", 24);
  $("menu-btn").onclick = (e) => { e.stopPropagation(); $("menu").classList.toggle("open"); };
  document.addEventListener("click", () => $("menu").classList.remove("open"));
  $("menu-seen").onclick = () => {
    recentOnly(articles).forEach((a) => seen.add(a.slug));
    save("nayes_seen", [...seen].slice(-400));
    renderHome();
  };

  const SPEED = { slow: 1.5, normal: 1, fast: 0.65 };
  const speedFactor = () => SPEED[getPrefs().speed] || 1;
  const isMuted = (a) => {
    const m = getPrefs().muted;
    return m.includes(a.category) || (a.is_breaking && m.includes("hot"));
  };
  let knownSlugs = null;
  $("year").textContent = new Date().getFullYear();
  if (ADVERTISE_LINK) $("adv-link").href = ADVERTISE_LINK;

  init();

  async function init() {
    const [res, adList] = await Promise.all([api({ limit: 40 }), loadAds()]);
    articles = res.articles || [];
    ads = adList;
    if (DEMO_MODE) {
      const b = document.createElement("div");
      b.className = "demo-banner";
      b.textContent = "מצב תצוגה: המבזקים והמודעות כאן הם לדוגמה בלבד, עד שיחובר מסד הנתונים.";
      document.body.prepend(b);
    }
    renderHome();
    knownSlugs = new Set(articles.map((a) => a.slug));

    const m = location.pathname.match(/^\/article\/([^/]+)/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      if (!articles.find((x) => x.slug === slug)) {
        const r = await api({ slug });
        if (r.article) articles.push(r.article);
      }
      if (articles.find((x) => x.slug === slug)) openChannel("all", slug);
    }
    setInterval(refresh, 60000);
  }

  // רענון כל דקה, גם כשהלשונית ברקע, כדי שהסימון על האייקון יתעדכן
  async function refresh() {
    const res = await api({ limit: 40 });
    if (!res.articles || !res.articles.length) return;
    const fresh = res.articles.filter((a) => knownSlugs && !knownSlugs.has(a.slug));
    articles = res.articles;
    knownSlugs = new Set(articles.map((a) => a.slug));
    alertHot(fresh.filter((a) => a.is_breaking && !seen.has(a.slug) && !isMuted(a)));
    if (viewer.open) updateBadge();
    else renderHome();
  }

  // התראה קופצת על מבזק דחוף (אם הקורא הפעיל זאת בהגדרות)
  async function alertHot(list) {
    if (!list.length || !getPrefs().hotAlerts || !("Notification" in window) || Notification.permission !== "granted") return;
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
    for (const a of list.slice(0, 3)) {
      const opts = { body: a.summary || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: a.slug, data: { url: articleUrl(a) }, lang: "he", dir: "rtl" };
      try {
        if (reg) await reg.showNotification(`דחוף: ${a.title}`, opts);
        else new Notification(`דחוף: ${a.title}`, opts).onclick = () => { window.focus(); location.href = articleUrl(a); };
      } catch {}
    }
  }

  function updateBadge() {
    const unread = recentOnly(articles).filter((a) => !seen.has(a.slug) && !isMuted(a)).length;
    setUnreadBadge(unread);
  }

  // ---------- ערוצים ----------
  function recentOnly(list) {
    const day = Date.now() - 24 * 3600 * 1000;
    const r = list.filter((a) => Date.parse(a.published_at) > day);
    return r.length ? r : list.slice(0, 10);
  }

  function channels() {
    const recent = recentOnly(articles);
    const muted = getPrefs().muted;
    const out = [{ key: "all", name: "נייעס סטטוס", face: "נ", logo: true, items: recent }];
    const hot = recent.filter((a) => a.is_breaking);
    if (hot.length) out.push({ key: "hot", name: "דחוף", icon: "hot", items: hot, muted: muted.includes("hot") });
    for (const [key, c] of Object.entries(CATEGORIES)) {
      const items = recent.filter((a) => a.category === key);
      if (items.length) out.push({ key, name: c.name, icon: key, items, muted: muted.includes(key) });
    }
    return out;
  }

  const unseen = (items) => items.filter((a) => !seen.has(a.slug)).length;

  // טבעת מחולקת לקטעים: קטע צבעוני לכל עדכון שלא נצפה, אפור למה שנצפה
  function ring(total, seenN, size) {
    const r = size / 2 - 2;
    const c = 2 * Math.PI * r;
    const n = Math.max(1, Math.min(total, 30));
    const gap = n > 1 ? Math.min(6, c / n / 3) : 0;
    const seg = c / n - gap;
    const seenSegs = Math.round((seenN / Math.max(1, total)) * n);
    let s = `<svg viewBox="0 0 ${size} ${size}"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a36"/><stop offset="1" stop-color="#ff2d6f"/></linearGradient></defs>`;
    for (let i = 0; i < n; i++) {
      const color = i < seenSegs ? "var(--seen)" : "url(#rg)";
      s += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"
        stroke-dasharray="${seg} ${c - seg}" stroke-dashoffset="${-(i * c) / n - gap / 2}"/>`;
    }
    return s + "</svg>";
  }

  function avatar(ch, size) {
    const total = ch.items.length;
    return `<div class="av" style="--s:${size}px">${ring(total, total - unseen(ch.items), size)}
      ${ch.logo
        ? `<span class="face logo">${esc(ch.face)}</span>`
        : `<span class="face ic" style="background:${COLORS[ch.icon] || COLORS.general}">${icon(ch.icon, Math.round(size * 0.46), 1.7)}</span>`}</div>`;
  }

  function timeLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const t = clock(iso);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return `היום, ${t}`;
    if (d.toDateString() === y.toDateString()) return `אתמול, ${t}`;
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "long" }) + `, ${t}`;
  }

  // ---------- מסך העדכונים ----------
  function renderHome() {
    const all = channels();
    const chs = all.filter((c) => !c.muted);
    const mutedChs = all.filter((c) => c.muted);
    // קודם ערוצים עם עדכונים חדשים, אחר כך מה שנצפה
    const ordered = [...chs.filter((c) => unseen(c.items)), ...chs.filter((c) => !unseen(c.items))];
    const tops = ads.filter((a) => a.placement === "top");

    const cardHtml = (ch) => {
      const latest = ch.items[0];
      const color = ch.key === "hot" ? COLORS.hot : COLORS[ch.key] || (latest ? (latest.is_breaking ? COLORS.hot : COLORS[latest.category]) : COLORS.general);
      return `<button class="card" data-ch="${ch.key}" style="--c:${color}" aria-label="${esc(ch.name)}">
        ${latest && latest.image_url ? `<img class="prev-img" src="${esc(latest.image_url)}" alt="">` : `<span class="prev-txt">${esc(latest ? latest.title : "")}</span>`}
        ${avatar(ch, 40)}<span class="nm">${esc(ch.name)}</span></button>`;
    };
    const adCard = (ad, i) => `<button class="card" data-ad="${i}" style="--c:${esc(ad.color || "#0a7d5a")}" aria-label="ממומן: ${esc(ad.advertiser)}">
        ${ad.image_url ? `<img class="prev-img" src="${esc(ad.image_url)}" alt="">` : `<span class="prev-txt">${esc(ad.title)}</span>`}
        <div class="av plain" style="--s:40px"><span class="face" style="background:#fff;color:${esc(ad.color || "#0a7d5a")};font-weight:800;font-size:17px">${esc((ad.advertiser || "?").trim()[0])}</span></div>
        <span class="spon">ממומן</span><span class="nm">${esc(ad.advertiser)}</span></button>`;

    const cards = ordered.map(cardHtml);
    // כרטיס ממומן במקום השני בשורה, הכי בולט
    tops.forEach((ad, i) => cards.splice(Math.min(1 + i * 3, cards.length), 0, adCard(ad, ads.indexOf(ad))));
    $("cards").innerHTML = articles.length || tops.length ? cards.join("") : `<div class="empty">עוד אין עדכונים.</div>`;

    const chanRow = (ch) => {
      const latest = ch.items[0];
      const n = ch.muted ? 0 : unseen(ch.items);
      return `<button class="chan" data-ch="${ch.key}">
        ${avatar(ch, 52)}
        <span class="mid"><b>${esc(ch.name)}</b><span class="last">${esc(latest ? latest.title : "")}</span></span>
        <span class="end"><span class="t ${n ? "new" : ""}">${esc(latest ? clock(latest.published_at) : "")}</span>${n ? `<span class="badge">${n}</span>` : ""}${ch.muted ? `<span style="color:var(--muted)">${icon("bellOff", 18)}</span>` : ""}</span>
      </button>`;
    };
    $("chans").innerHTML = chs.map(chanRow).join("") + (mutedChs.length
      ? `<button class="muted-toggle" id="muted-toggle">ערוצים מושתקים (${mutedChs.length}) ${icon("chevLeft", 18)}</button>
         <div class="muted-list" id="muted-list">${mutedChs.map(chanRow).join("")}</div>`
      : "");
    if (mutedChs.length) {
      $("muted-toggle").querySelector(".i").style.transform = "rotate(-90deg)";
      $("muted-toggle").onclick = () => {
        const open = $("muted-list").classList.toggle("open");
        $("muted-toggle").querySelector(".i").style.transform = open ? "rotate(90deg)" : "rotate(-90deg)";
      };
    }
    updateBadge();

    document.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => openChannel(b.dataset.ch)));
    document.querySelectorAll("[data-ad]").forEach((b) => (b.onclick = () => openSeq([{ type: "ad", ad: ads[Number(b.dataset.ad)] }], 0)));
  }

  // ---------- הצופה ----------
  const viewer = { open: false, seq: [], idx: 0, start: 0, elapsed: 0, dur: 7000, paused: false, raf: 0 };

  function openChannel(chKey, slug) {
    const ch = channels().find((c) => c.key === chKey) || channels()[0];
    const news = [...ch.items].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    const pool = ads.filter((a) => a.placement === "feed").concat(ads.filter((a) => a.placement === "top"));
    const seq = [];
    let k = 0;
    news.forEach((a, i) => {
      seq.push({ type: "news", a });
      if (pool.length && (i + 1) % 4 === 0 && i < news.length - 1) seq.push({ type: "ad", ad: pool[k++ % pool.length] });
    });
    let start = slug ? seq.findIndex((s) => s.a && s.a.slug === slug) : seq.findIndex((s) => s.a && !seen.has(s.a.slug));
    openSeq(seq, Math.max(0, start));
  }

  function openSeq(seq, start) {
    if (!seq.length) return;
    viewer.seq = seq;
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
    $("panel").classList.remove("open");
    document.body.style.overflow = "";
    if (location.pathname !== "/") history.replaceState(null, "", "/");
    renderHome();
  }

  function show(i) {
    if (i < 0) i = 0;
    if (i >= viewer.seq.length) return closeViewer();
    viewer.idx = i;
    viewer.elapsed = 0;
    setPaused(false);
    $("panel").classList.remove("open");
    [...$("bars").children].forEach((bar, j) => (bar.firstChild.style.width = j < i ? "100%" : "0"));
    const item = viewer.seq[i];
    item.type === "news" ? renderNews(item.a) : renderAd(item.ad);
    viewer.start = performance.now();
    cancelAnimationFrame(viewer.raf);
    viewer.raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!viewer.open) return;
    if (viewer.paused || document.hidden) viewer.start = now - viewer.elapsed;
    else {
      viewer.elapsed = now - viewer.start;
      const p = Math.min(1, viewer.elapsed / viewer.dur);
      $("bars").children[viewer.idx].firstChild.style.width = p * 100 + "%";
      if (p >= 1) return show(viewer.idx + 1);
    }
    viewer.raf = requestAnimationFrame(tick);
  }

  function setPaused(p) {
    viewer.paused = p;
    $("stage").classList.toggle("paused", p && !$("panel").classList.contains("open"));
  }

  function head(face, name, sub, extraClass = "") {
    return `<button class="ico" id="v-back" aria-label="חזרה">${ICON_BACK}</button>
      ${face}<div class="who"><b>${name}</b><small class="${extraClass}">${sub}</small></div>
      <button class="ico" id="v-menu" aria-label="אפשרויות">${ICON_DOTS}</button>`;
  }

  // ---------- סטטוס של מבזק ----------
  function renderNews(a) {
    const cat = CATEGORIES[a.category] || CATEGORIES.general;
    const len = (a.title || "").length + (a.summary || "").length + (a.impact || "").length;
    viewer.dur = Math.max(6000, Math.min(14000, 4000 + len * 40)) * speedFactor();
    seen.add(a.slug);
    save("nayes_seen", [...seen].slice(-400));
    updateBadge();
    history.replaceState(null, "", articleUrl(a));

    $("stage").style.setProperty("--solid", a.is_breaking ? COLORS.hot : COLORS[a.category] || COLORS.general);
    $("s-head").innerHTML = head(
      `<div class="av plain" style="--s:38px"><span class="face logo">נ</span></div>`,
      "נייעס סטטוס",
      `${esc(timeLabel(a.published_at))} · ${esc(cat.name)}`,
    );

    const title = esc(a.title);
    const hotTag = a.is_breaking ? `<span class="hot-pill">${icon("hot", 15, 2)} דחוף</span>` : "";
    $("s-media").innerHTML = a.image_url
      ? `<div class="s-img"><img src="${esc(a.image_url)}" alt=""></div>
         <div class="s-caption"><b>${title}</b>${a.summary ? `<span>${esc(a.summary)}</span>` : ""}</div>`
      : `<div class="s-text fade">${hotTag}<h2>${title}</h2>${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
         ${a.impact ? `<p class="tip">מה זה אומר עליך? ${esc(a.impact)}</p>` : ""}</div>`;

    $("s-foot").innerHTML = `
      <button class="chev" id="chev" aria-label="עוד">${ICON_CHEV}</button>
      <div class="reply-row">
        <button class="reply" id="reply"><span class="em">${icon("smile", 24, 1.6)}</span>השב</button>
        <button class="heart ${myRx[a.slug] === HEART ? "on" : ""}" id="heart" aria-label="אהבתי">${ICON_HEART}</button>
      </div>`;

    const paragraphs = String(a.body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    $("panel").innerHTML = `
      <div class="quick">${QUICK.map((e) => `<button class="${myRx[a.slug] === e ? "mine" : ""}" data-e="${e}">${e}</button>`).join("")}</div>
      ${paragraphs.length || a.source_name ? `<div class="details">
        ${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
        ${a.source_name ? `<div class="src">מקור: ${esc(a.source_name)}</div>` : ""}
      </div>` : ""}
      <div class="acts">
        <button id="send">${icon("share", 20)}<span>שליחה לחבר</span></button>
        <button id="copy">${icon("link", 20)}<span>העתקת קישור</span></button>
        <button id="p-close">${icon("close", 20)}<span>סגירה</span></button>
      </div>`;

    wire();
    $("reply").onclick = openPanel;
    $("chev").onclick = openPanel;
    $("v-menu").onclick = openPanel;
    $("heart").onclick = (e) => { e.stopPropagation(); reactWith(a, HEART); };
    $("panel").querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => reactWith(a, b.dataset.e)));
    $("copy").onclick = async (e) => {
      try { await navigator.clipboard.writeText(location.origin + articleUrl(a)); e.currentTarget.querySelector("span").textContent = "הועתק"; } catch {}
    };
    $("p-close").onclick = closePanel;
    $("send").onclick = async () => {
      const url = location.origin + articleUrl(a);
      try {
        if (navigator.share) await navigator.share({ title: a.title, text: a.title, url });
        else window.open(`https://wa.me/?text=${encodeURIComponent(a.title + "\n" + url)}`, "_blank", "noopener");
      } catch {}
    };
  }

  function reactWith(a, emoji) {
    flyer(emoji);
    closePanel();
    const prev = myRx[a.slug];
    const h = $("heart");
    if (emoji === HEART && h) { h.classList.add("on", "pop"); setTimeout(() => h.classList.remove("pop"), 450); }
    if (prev) return; // תגובה אחת לכל סטטוס
    myRx[a.slug] = emoji;
    save("nayes_rx", myRx);
    react(a.slug, emoji).catch(() => {});
  }

  function flyer(emoji) {
    const f = document.createElement("span");
    f.className = "flyer";
    f.textContent = emoji;
    $("stage").appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  // ---------- סטטוס ממומן ----------
  function renderAd(ad) {
    viewer.dur = 7000 * speedFactor();
    const color = ad.color || "#243640";
    $("stage").style.setProperty("--solid", color);
    $("s-head").innerHTML = head(
      `<div class="av plain" style="--s:38px"><span class="face" style="background:#fff;color:${esc(color)};font-weight:800;font-size:16px">${esc((ad.advertiser || "?").trim()[0])}</span></div>`,
      esc(ad.advertiser),
      "ממומן",
      "spon-tag",
    );
    $("s-media").innerHTML = ad.image_url
      ? `<div class="s-img"><img src="${esc(ad.image_url)}" alt=""></div>
         <div class="s-caption"><b>${esc(ad.title)}</b>${ad.text ? `<span>${esc(ad.text)}</span>` : ""}</div>`
      : `<div class="s-text fade"><h2>${esc(ad.title)}</h2>${ad.text ? `<p>${esc(ad.text)}</p>` : ""}</div>`;
    $("s-foot").innerHTML = `<a class="cta" id="cta" href="${adHref(ad)}" ${DEMO_MODE ? "" : 'target="_blank" rel="noopener sponsored"'}>${esc(ad.cta || "למידע נוסף")}</a>`;
    $("panel").innerHTML = "";
    $("cta").addEventListener("click", (e) => { e.stopPropagation(); if (DEMO_MODE) closeViewer(); });
    wire();
    $("v-menu").onclick = (e) => e.stopPropagation();
  }

  function renderSide() {
    const side = ads.filter((a) => a.placement === "side");
    $("v-side").innerHTML = `<span class="lbl">ממומן</span>` + (side.length
      ? side.map((ad) => `<a class="side-ad" href="${adHref(ad)}" ${DEMO_MODE ? "" : 'target="_blank" rel="noopener sponsored"'} style="--ad-c:${esc(ad.color || "#243640")}">
          ${ad.image_url ? `<img src="${esc(ad.image_url)}" alt="">` : ""}
          <b>${esc(ad.title)}</b>${ad.text ? `<p>${esc(ad.text)}</p>` : ""}<span class="go">${esc(ad.cta || "לפרטים")}</span></a>`).join("")
      : `<div class="side-house"><b>המקום הזה פנוי 📣</b>פרסמו כאן את העסק שלכם</div>`);
  }

  // ---------- שליטה ----------
  function wire() {
    $("v-back").onclick = (e) => { e.stopPropagation(); closeViewer(); };
  }
  function openPanel() {
    if (!$("panel").innerHTML) return;
    $("panel").classList.add("open");
    setPaused(true);
  }
  function closePanel() {
    $("panel").classList.remove("open");
    setPaused(false);
  }

  $("v-x").onclick = closeViewer;
  $("arr-prev").onclick = () => show(viewer.idx - 1);
  $("arr-next").onclick = () => show(viewer.idx + 1);

  let downAt = 0, downY = 0, downX = 0, held = false, holdTimer = 0;
  const stage = $("stage");

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, .panel")) return;
    downAt = Date.now(); downY = e.clientY; downX = e.clientX; held = false;
    holdTimer = setTimeout(() => { held = true; setPaused(true); }, 200);
  });
  stage.addEventListener("pointerup", (e) => {
    clearTimeout(holdTimer);
    if (!downAt) return;
    const dy = e.clientY - downY, dx = e.clientX - downX;
    downAt = 0;
    if (held) { setPaused(false); return; }
    if ($("panel").classList.contains("open")) { if (!e.target.closest(".panel")) closePanel(); return; }
    if (dy > 90 && Math.abs(dx) < 80) return closeViewer();
    if (dy < -70 && Math.abs(dx) < 80) return openPanel();
    if (Math.abs(dx) > 60) return show(viewer.idx + (dx > 0 ? 1 : -1));
    if (e.target.closest("#tap-prev")) show(viewer.idx - 1);
    else if (e.target.closest("#tap-next")) show(viewer.idx + 1);
  });
  stage.addEventListener("pointercancel", () => { clearTimeout(holdTimer); downAt = 0; if (held) setPaused(false); });

  document.addEventListener("keydown", (e) => {
    if (!viewer.open) return;
    if (e.key === "Escape") $("panel").classList.contains("open") ? closePanel() : closeViewer();
    else if (e.key === "ArrowLeft") show(viewer.idx + 1);
    else if (e.key === "ArrowRight") show(viewer.idx - 1);
    else if (e.key === " ") { e.preventDefault(); setPaused(!viewer.paused); }
    else if (e.key === "ArrowUp") openPanel();
  });
})();
