// התקנת האתר למסך הבית (בלי חנות אפליקציות) ועבודה גם כשהחיבור חלש.

(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  const btn = document.getElementById("install");
  if (!btn) return;

  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return;

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => { btn.hidden = true; });

  // באייפון אין חלון התקנה אוטומטי, לכן מסבירים איך מוסיפים ידנית.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) btn.hidden = false;

  btn.addEventListener("click", async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      btn.hidden = true;
      return;
    }
    toast("<b>הוספה למסך הבית</b>לחצו על כפתור השיתוף <span aria-hidden='true'>⬆️</span> בתחתית המסך, ואז על \"הוספה למסך הבית\".");
  });

  function toast(html) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<button aria-label="סגירה">✕</button>${html}`;
    t.querySelector("button").onclick = () => t.remove();
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 9000);
  }
})();
