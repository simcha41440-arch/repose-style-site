(function () {
  const TOKEN_KEY = "kr_admin_token";
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  let tab = "pending";

  const $ = (id) => document.getElementById(id);

  async function call(action, payload = {}) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && action !== "login") { logout(); throw new Error("נדרשת כניסה מחדש"); }
    if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
    return data;
  }

  function show(loggedIn) {
    $("login").classList.toggle("hidden", loggedIn);
    $("app").classList.toggle("hidden", !loggedIn);
    $("logout").classList.toggle("hidden", !loggedIn);
    if (loggedIn) load();
  }

  function logout() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    show(false);
  }

  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-msg").textContent = "";
    try {
      const { token: t } = await call("login", { password: $("password").value });
      token = t;
      try { localStorage.setItem(TOKEN_KEY, t); } catch {}
      show(true);
    } catch (err) {
      $("login-msg").textContent = err.message;
    }
  });
  $("logout").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
      tab = b.dataset.tab;
      load();
    }));

  async function load() {
    const panel = $("panel");
    if (tab === "compose") return renderCompose(panel);
    panel.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    try {
      const { articles } = await call("list", { status: tab });
      if (tab === "pending") $("count").textContent = articles.length;
      panel.innerHTML = articles.length
        ? ""
        : `<div class="empty">${tab === "pending" ? "אין ידיעות ממתינות. הכל מעודכן ✓" : "עדיין לא פורסמו ידיעות."}</div>`;
      articles.forEach((a) => panel.appendChild(itemEl(a)));
    } catch (err) {
      panel.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function itemEl(a) {
    const el = document.createElement("div");
    el.className = `item ${a.is_breaking ? "breaking" : ""}`;
    const catOptions = Object.entries(CATEGORIES)
      .map(([k, v]) => `<option value="${k}" ${k === a.category ? "selected" : ""}>${esc(v)}</option>`).join("");

    el.innerHTML = `
      ${a.ai_notes ? `<div class="notes"><b>הערות העורך האוטומטי:</b> ${esc(a.ai_notes)}</div>` : ""}
      <div class="src">${esc(timeAgo(a.created_at))}${a.source_name ? " · מקור: " + (a.source_url ? `<a href="${esc(a.source_url)}" target="_blank" rel="noopener">${esc(a.source_name)}</a>` : esc(a.source_name)) : ""}</div>
      <label>כותרת</label><input type="text" class="title" data-f="title" value="${esc(a.title)}">
      <label>כותרת משנה</label><input type="text" data-f="subtitle" value="${esc(a.subtitle)}">
      <label>בקיצור (משפט אחד)</label><input type="text" data-f="summary" value="${esc(a.summary)}">
      <label>מה זה אומר עליך? (לא חובה)</label><input type="text" data-f="impact" value="${esc(a.impact)}">
      <label>גוף הידיעה (שורה ריקה בין פסקאות)</label><textarea class="body" data-f="body">${esc(a.body)}</textarea>
      <div class="row2">
        <div><label>קטגוריה</label><select data-f="category">${catOptions}</select></div>
        <div><label>עיר (לא חובה)</label><input type="text" data-f="city" value="${esc(a.city)}"></div>
        <div><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:16px">
          <input type="checkbox" data-f="is_breaking" ${a.is_breaking ? "checked" : ""}> מבזק</label></div>
      </div>
      <label>תמונה (לא חובה, תיבדק אוטומטית לפני שתישמר)</label>
      <div class="img-row"><input type="text" class="img-url" placeholder="https://..." value="${esc(a.image_url)}" dir="ltr">
        <button class="btn ghost img-btn" type="button">בדיקה ושמירה</button></div>
      ${a.image_url ? `<img class="thumb" src="${esc(a.image_url)}" alt="">` : ""}
      <p class="msg img-msg"></p>
      <div class="actions">
        ${a.status === "pending"
          ? `<button class="btn green" data-act="publish">פרסום</button>
             <button class="btn ghost" data-act="save">שמירה</button>
             <button class="btn gray" data-act="reject">דחייה</button>`
          : `<button class="btn ghost" data-act="save">שמירת שינויים</button>
             <a class="btn ghost" href="/article/${encodeURIComponent(a.slug)}" target="_blank">צפייה</a>
             <button class="btn gray" data-act="reject">הסרה מהאתר</button>`}
      </div>
      <p class="msg act-msg"></p>`;

    const fields = () => {
      const f = {};
      el.querySelectorAll("[data-f]").forEach((i) => { f[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value; });
      return f;
    };
    const msg = (sel, text, good) => { const m = el.querySelector(sel); m.textContent = text; m.className = `msg ${sel.slice(1)} ${good ? "good" : "bad"}`; };

    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === "save" || act === "publish") await call("update", { id: a.id, fields: fields() });
        if (act === "publish") await call("publish", { id: a.id });
        if (act === "reject") {
          if (!confirm(a.status === "published" ? "להסיר את הידיעה מהאתר?" : "לדחות את הידיעה?")) { b.disabled = false; return; }
          await call("reject", { id: a.id });
        }
        if (act === "save") { msg(".act-msg", "נשמר ✓", true); b.disabled = false; return; }
        el.remove();
        if (tab === "pending") $("count").textContent = Math.max(0, Number($("count").textContent) - 1);
      } catch (err) {
        msg(".act-msg", err.message);
        b.disabled = false;
      }
    }));

    el.querySelector(".img-btn").addEventListener("click", async (e) => {
      const url = el.querySelector(".img-url").value.trim();
      e.target.disabled = true;
      msg(".img-msg", url ? "בודק את התמונה..." : "מסיר...", true);
      try {
        const r = await call("setImage", { id: a.id, url });
        if (r.removed) msg(".img-msg", "התמונה הוסרה", true);
        else if (r.approved) msg(".img-msg", "התמונה אושרה ונשמרה ✓", true);
        else { msg(".img-msg", "התמונה נפסלה: " + r.reason); el.querySelector(".img-url").value = ""; }
      } catch (err) { msg(".img-msg", err.message); }
      e.target.disabled = false;
    });

    return el;
  }

  function renderCompose(panel) {
    panel.innerHTML = `
      <div class="compose">
        <p style="margin-top:0">הדביקו הודעה מוואטסאפ, הודעה לעיתונות או כל חומר גלם. העורך האוטומטי יכתוב ממנה ידיעה מוכנה, והיא תחכה לאישורכם בלשונית "ממתינות".</p>
        <textarea id="raw" placeholder="הדביקו כאן את הטקסט..."></textarea>
        <div class="row2">
          <input type="text" id="srcName" placeholder="שם המקור (לא חובה)">
          <input type="text" id="srcUrl" placeholder="קישור למקור (לא חובה)" dir="ltr">
        </div>
        <div class="actions"><button class="btn" id="go">כתיבת ידיעה</button></div>
        <p class="msg" id="compose-msg"></p>
      </div>`;
    $("go").addEventListener("click", async (e) => {
      const m = $("compose-msg");
      e.target.disabled = true;
      m.className = "msg good"; m.textContent = "העורך כותב... (כחצי דקה)";
      try {
        const r = await call("compose", { text: $("raw").value, sourceName: $("srcName").value, sourceUrl: $("srcUrl").value });
        if (r.rejected) { m.className = "msg bad"; m.textContent = "החומר לא מתאים לאתר: " + r.reason; }
        else {
          m.textContent = "הידיעה מוכנה ✓ היא מחכה לאישורך בלשונית \"ממתינות\".";
          $("raw").value = "";
          $("count").textContent = Number($("count").textContent) + 1;
        }
      } catch (err) { m.className = "msg bad"; m.textContent = err.message; }
      e.target.disabled = false;
    });
  }

  show(Boolean(token));
})();
