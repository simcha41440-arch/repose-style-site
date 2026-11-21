// העדפות הקורא (נשמרות רק בדפדפן שלו) והחלה מיידית של ערכת נושא וגודל טקסט.

const PREFS_DEFAULT = { theme: "system", font: "m", speed: "normal", badge: true, hotAlerts: false, muted: [] };

function getPrefs() {
  try { return { ...PREFS_DEFAULT, ...JSON.parse(localStorage.getItem("nayes_prefs") || "{}") }; }
  catch { return { ...PREFS_DEFAULT }; }
}

function setPref(key, value) {
  const p = { ...getPrefs(), [key]: value };
  try { localStorage.setItem("nayes_prefs", JSON.stringify(p)); } catch {}
  applyPrefs(p);
  return p;
}

function applyPrefs(p = getPrefs()) {
  const root = document.documentElement;
  if (p.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p.theme);
  root.classList.remove("fs-s", "fs-m", "fs-l");
  root.classList.add(`fs-${p.font}`);
}

applyPrefs();

// ---------- סימון מבזקים חדשים: בלשונית הדפדפן ובאייקון האפליקציה ----------

let badgeBaseImg = null;
const BASE_TITLE = document.title;

function setUnreadBadge(n) {
  const on = getPrefs().badge && n > 0;
  document.title = on ? `(${n > 99 ? "99+" : n}) ${BASE_TITLE}` : BASE_TITLE;

  // מספר על אייקון האפליקציה המותקנת (שורת המשימות / מסך הבית)
  try {
    if (on && navigator.setAppBadge) navigator.setAppBadge(n);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch {}

  // נקודה אדומה עם מספר על האייקון של הלשונית
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (!on) { link.type = "image/svg+xml"; link.href = "/favicon.svg"; return; }
  const draw = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.drawImage(badgeBaseImg, 0, 0, 64, 64);
    const label = n > 9 ? "9+" : String(n);
    g.fillStyle = "#e0243c";
    g.beginPath(); g.arc(46, 18, 18, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
    g.fillStyle = "#fff";
    g.font = `bold ${label.length > 1 ? 20 : 24}px Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, 46, 19);
    link.type = "image/png";
    link.href = c.toDataURL("image/png");
  };
  if (badgeBaseImg && badgeBaseImg.complete) return draw();
  badgeBaseImg = new Image();
  badgeBaseImg.onload = draw;
  badgeBaseImg.src = "/icons/icon-192.png";
}
