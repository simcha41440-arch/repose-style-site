// עמוד ההגדרות של נייעס סטטוס. כל ההעדפות נשמרות רק בדפדפן של הקורא.

(function () {
  const $ = (id) => document.getElementById(id);
  $("back").innerHTML = icon("back", 24);

  const THEMES = { system: "ברירת המחדל של המערכת", light: "בהיר", dark: "כהה" };
  const FONTS = { s: "קטן", m: "בינוני", l: "גדול" };
  const SPEEDS = { slow: "איטית", normal: "רגילה", fast: "מהירה" };
  const MUTABLE = { hot: "דחוף", ...Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.name])) };

  render();

  function row({ id, ic, title, sub, toggle, checked, danger, href }) {
    const inner = `${icon(ic, 24, 1.7)}<span class="txt"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      ${toggle ? `<span class="switch"><input type="checkbox" id="${id}" ${checked ? "checked" : ""} aria-label="${esc(title)}"><i></i></span>` : ""}`;
    if (href) return `<a class="set-row" href="${href}">${inner}</a>`;
    if (toggle) return `<label class="set-row" for="${id}">${inner}</label>`;
    return `<button class="set-row ${danger ? "danger" : ""}" id="${id}">${inner}</button>`;
  }

  function render() {
    const p = getPrefs();
    const muted = p.muted.map((k) => MUTABLE[k]).filter(Boolean);
    $("rows").innerHTML = `
      <div class="set-sec">התראות</div>
      ${row({ id: "badge", ic: "badge", title: "סימון מבזקים חדשים", sub: "מספר על הלשונית בדפדפן ועל אייקון האפליקציה", toggle: true, checked: p.badge })}
      ${row({ id: "hotAlerts", ic: "bell", title: "התראה על מבזק דחוף", sub: "התראה קופצת כשמגיע מבזק דחוף, בזמן שהאתר פתוח", toggle: true, checked: p.hotAlerts })}

      <div class="set-sec">תצוגה</div>
      ${row({ id: "theme", ic: "theme", title: "ערכת נושא", sub: THEMES[p.theme] })}
      ${row({ id: "font", ic: "text", title: "גודל טקסט", sub: FONTS[p.font] })}
      ${row({ id: "speed", ic: "speed", title: "מהירות מעבר בין סטטוסים", sub: SPEEDS[p.speed] })}

      <div class="set-sec">ערוצים</div>
      ${row({ id: "muted", ic: "bellOff", title: "ערוצים מושתקים", sub: muted.length ? muted.join(", ") : "אין ערוצים מושתקים" })}

      <div class="set-sec">היסטוריית צפייה</div>
      ${row({ id: "seenAll", ic: "checkAll", title: "סימון הכל כנצפה" })}
      ${row({ id: "clear", ic: "trash", title: "ניקוי היסטוריית הצפייה", sub: "כל המבזקים יחזרו להופיע כחדשים", danger: true })}

      <div class="set-sec">עוד</div>
      ${row({ id: "installRow", ic: "phone", title: "התקנה למסך הבית", sub: "נייעס סטטוס כמו אפליקציה, בלי חנות אפליקציות" })}
      ${row({ ic: "megaphone", title: "פרסום בנייעס סטטוס", sub: "סטטוס ממומן, כרטיס ממומן ומודעת צד", href: "/about?topic=ads#contact" })}
      ${row({ ic: "chat", title: "יצירת קשר", sub: "שאלות, תיקונים ודיווח על טעות", href: "/about#contact" })}
      ${row({ ic: "info", title: "אודות ומדיניות תוכן", href: "/about" })}`;

    $("badge").onchange = (e) => { setPref("badge", e.target.checked); snack(e.target.checked ? "הסימון הופעל" : "הסימון כובה"); };
    $("hotAlerts").onchange = async (e) => {
      if (e.target.checked) {
        if (!("Notification" in window)) { e.target.checked = false; return snack("הדפדפן הזה לא תומך בהתראות"); }
        const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (perm !== "granted") { e.target.checked = false; return snack("צריך לאשר התראות בדפדפן"); }
      }
      setPref("hotAlerts", e.target.checked);
      snack(e.target.checked ? "התראות על מבזקים דחופים הופעלו" : "ההתראות כובו");
    };
    $("theme").onclick = () => choose("ערכת נושא", THEMES, getPrefs().theme, (v) => { setPref("theme", v); render(); });
    $("font").onclick = () => choose("גודל טקסט", FONTS, getPrefs().font, (v) => { setPref("font", v); render(); });
    $("speed").onclick = () => choose("מהירות מעבר בין סטטוסים", SPEEDS, getPrefs().speed, (v) => { setPref("speed", v); render(); });
    $("muted").onclick = () => chooseMany("ערוצים מושתקים", MUTABLE, getPrefs().muted, (v) => { setPref("muted", v); render(); });
    $("seenAll").onclick = markAllSeen;
    $("clear").onclick = () => confirmDlg("לנקות את היסטוריית הצפייה?", "כל המבזקים יופיעו שוב כחדשים.", "ניקוי", () => {
      try { localStorage.removeItem("nayes_seen"); } catch {}
      snack("היסטוריית הצפייה נוקתה");
    });
    $("installRow").onclick = () => {
      const btn = document.getElementById("install");
      if (btn && !btn.hidden) return btn.click();
      snack("בטלפון: פתחו את תפריט הדפדפן ובחרו \"הוספה למסך הבית\"");
    };
  }

  async function markAllSeen() {
    const res = await api({ limit: 60 });
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem("nayes_seen") || "[]"); } catch {}
    const all = new Set([...seen, ...(res.articles || []).map((a) => a.slug)]);
    try { localStorage.setItem("nayes_seen", JSON.stringify([...all].slice(-400))); } catch {}
    setUnreadBadge(0);
    snack("כל המבזקים סומנו כנצפו");
  }

  // ---------- חלונות בחירה ----------
  function dialog(html, onOk) {
    const back = document.createElement("div");
    back.className = "dlg-back";
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    back.querySelector("[data-cancel]").onclick = close;
    back.querySelector("[data-ok]").onclick = () => { onOk(back); close(); };
    document.body.appendChild(back);
    const first = back.querySelector("input:checked, input, button");
    if (first) first.focus();
  }

  function choose(title, options, current, onPick) {
    dialog(`<h3>${esc(title)}</h3>
      ${Object.entries(options).map(([k, v]) => `<label><input type="radio" name="opt" value="${k}" ${k === current ? "checked" : ""}>${esc(v)}</label>`).join("")}
      <div class="btns"><button data-cancel>ביטול</button><button data-ok>אישור</button></div>`,
      (d) => { const v = d.querySelector("input:checked"); if (v) onPick(v.value); });
  }

  function chooseMany(title, options, current, onPick) {
    dialog(`<h3>${esc(title)}</h3><p>מבזקים מערוצים מושתקים לא יסומנו כחדשים, ויופיעו בתחתית הרשימה.</p>
      ${Object.entries(options).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${current.includes(k) ? "checked" : ""}>${esc(v)}</label>`).join("")}
      <div class="btns"><button data-cancel>ביטול</button><button data-ok>אישור</button></div>`,
      (d) => onPick([...d.querySelectorAll("input:checked")].map((i) => i.value)));
  }

  function confirmDlg(title, text, okLabel, onOk) {
    dialog(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="btns"><button data-cancel>ביטול</button><button data-ok class="red">${esc(okLabel)}</button></div>`, onOk);
  }

  function snack(text) {
    document.querySelectorAll(".snack").forEach((s) => s.remove());
    const s = document.createElement("div");
    s.className = "snack";
    s.textContent = text;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 2600);
  }
})();
