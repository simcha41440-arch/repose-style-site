/* ============================================================
   GIFT POPUP - "בכל רכישה מעל 500 ₪ תקבלו מתנה"
   ------------------------------------------------------------
   Opens once the visitor has spent 40 seconds on the site (counted
   across pages in the same visit, not per page). Shown at most once
   per visit, and after it's closed it stays hidden for 3 days.
   To change the picture: replace /images/site/gift-sachets.jpg.
   To change the text/timing: edit the CONFIG block below.
   ============================================================ */
(function () {
  var CONFIG = {
    delaySeconds: 40,
    hideDaysAfterClose: 3,
    image: '/images/site/gift-sachets.jpg',
    imageAlt: 'שקיות ריח מעוצבות Elegant Sachet בניחוחות לבנדר, ורד ויסמין',
    badge: 'מתנה מאיתנו',
    eyebrow: 'בכל רכישה מעל 500 ₪',
    title: 'שקית ריח מעוצבת<br>במתנה',
    text: 'השלימו הזמנה בסכום של מעל 500 ₪ וקבלו מאיתנו שקית ריח מעוצבת, שמפיצה ניחוח עדין ונעים בבית.',
    scents: [['לבנדר', '#7B6CC8'], ['ורד', '#E58BA3'], ['יסמין', '#9DB8E0']],
    cta: 'לקנייה עכשיו',
    ctaHref: '/shop',
    later: 'אולי מאוחר יותר'
  };

  if (window.__rsGiftLoaded) return;
  window.__rsGiftLoaded = true;
  // Never interrupt checkout/payment or the admin panel.
  if (/^\/(admin|checkout|payment-|account)/.test(location.pathname)) return;

  function ss(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : sessionStorage.setItem(key, val); } catch (e) { return null; }
  }
  function ls(get, key, val) {
    try { return get ? localStorage.getItem(key) : localStorage.setItem(key, val); } catch (e) { return null; }
  }

  if (ss(true, 'rs_gift_shown')) return;
  var snoozedUntil = Number(ls(true, 'rs_gift_snooze') || 0);
  if (snoozedUntil && Date.now() < snoozedUntil) return;

  // Same "visit start" key the site already uses for time-on-site.
  var start = Number(ss(true, 'rs_session_start'));
  if (!start) { start = Date.now(); ss(false, 'rs_session_start', String(start)); }
  var waitMs = Math.max(0, CONFIG.delaySeconds * 1000 - (Date.now() - start));

  var css = '' +
  '#rs-gift-ov{position:fixed;inset:0;z-index:100500;background:rgba(20,16,12,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
    'display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;transition:opacity .35s ease;}' +
  '#rs-gift-ov.show{opacity:1;}' +
  '#rs-gift{position:relative;width:440px;max-width:100%;max-height:calc(100vh - 36px);overflow:auto;direction:rtl;text-align:center;' +
    'background:#FFFDF8;border-radius:26px;border:1px solid #D8B96C;box-shadow:0 40px 90px -30px rgba(20,16,12,.6);' +
    'font-family:Rubik,"Almoni Neue",Arial,sans-serif;color:#2B2420;transform:translateY(24px) scale(.96);transition:transform .45s cubic-bezier(.19,1,.22,1);}' +
  '#rs-gift-ov.show #rs-gift{transform:none;}' +
  '#rs-gift:focus{outline:none;}' +
  '#rs-gift .g-media{position:relative;overflow:hidden;border-radius:25px 25px 0 0;padding:62px 22px 48px;' +
    'background:radial-gradient(circle at 50% 46%,#FFFFFF 0%,#FFF8E6 45%,#F3E2AE 100%);border-bottom:1px solid rgba(216,185,108,.55);}' +
  '#rs-gift .g-media::before{content:"";position:absolute;inset:12px;border:1px solid rgba(216,185,108,.55);border-radius:18px;pointer-events:none;}' +
  '#rs-gift .g-media img{position:relative;display:block;width:100%;height:auto;mix-blend-mode:multiply;' +
    'filter:drop-shadow(0 18px 18px rgba(110,80,25,.22));transform:rotate(-1.5deg);animation:rsGiftFloat 5s ease-in-out infinite;}' +
  '@keyframes rsGiftFloat{0%,100%{transform:rotate(-1.5deg) translateY(0)}50%{transform:rotate(-1.5deg) translateY(-6px)}}' +
  '#rs-gift .g-spark{position:absolute;width:10px;height:10px;background:#D6B15E;transform:rotate(45deg);opacity:.55;border-radius:2px;}' +
  '#rs-gift .g-eyebrow{display:inline-block;margin:0 0 8px;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:.03em;' +
    'color:#6B4E14;background:#FBF1D3;border:1px solid rgba(216,185,108,.7);}' +
  '#rs-gift .g-scents{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:-6px 0 22px;padding:0;list-style:none;}' +
  '#rs-gift .g-scents li{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;font-size:13px;color:#6B4E14;background:#fff;border:1px solid rgba(216,185,108,.6);}' +
  '#rs-gift .g-scents i{width:9px;height:9px;border-radius:50%;display:inline-block;}' +
  '#rs-gift .g-badge{position:absolute;top:16px;right:16px;z-index:1;display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;' +
    'font-size:13px;font-weight:600;color:#fff;background:linear-gradient(135deg,#E3C378,#B08A3E 50%,#8A6C2E);box-shadow:0 10px 22px -10px rgba(138,108,46,.8);}' +
  '#rs-gift .g-badge svg{width:15px;height:15px;}' +
  '#rs-gift .g-close{position:absolute;top:14px;left:14px;z-index:2;width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;' +
    'background:rgba(255,253,248,.92);color:#2B2420;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -6px rgba(0,0,0,.35);}' +
  '#rs-gift .g-close:hover{background:#fff;}' +
  '#rs-gift .g-close svg{width:18px;height:18px;}' +
  '#rs-gift .g-body{position:relative;padding:0 30px 28px;margin-top:-31px;}' +
  '#rs-gift .g-icon{width:62px;height:62px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
    'background:radial-gradient(circle at 32% 28%,#fff,#FBF1D3 60%,#F1DFA0);border:1px solid #D8B96C;box-shadow:0 14px 28px -14px rgba(138,108,46,.7),inset 0 0 0 5px rgba(255,255,255,.75);color:#8A6C2E;}' +
  '#rs-gift .g-icon svg{width:28px;height:28px;}' +
  '#rs-gift h2{margin:0 0 12px;font-size:30px;line-height:1.3;font-weight:600;' +
    'background:linear-gradient(135deg,#5A410F,#B08A3E 50%,#6B4E14);-webkit-background-clip:text;background-clip:text;color:transparent;}' +
  '#rs-gift p{margin:0 0 22px;font-size:15px;line-height:1.7;color:#8A6C2E;}' +
  '#rs-gift .g-cta{display:flex;align-items:center;justify-content:center;width:100%;padding:16px 20px;border-radius:999px;text-decoration:none;' +
    'font-size:15px;font-weight:600;letter-spacing:.04em;color:#fff;background:linear-gradient(135deg,#E3C378 0%,#B08A3E 45%,#8A6C2E 100%);' +
    'box-shadow:0 14px 34px -12px rgba(138,108,57,.6);transition:transform .2s ease,box-shadow .2s ease;}' +
  '#rs-gift .g-cta:hover{transform:translateY(-2px);box-shadow:0 20px 40px -14px rgba(138,108,46,.75);}' +
  '#rs-gift .g-later{margin-top:12px;background:none;border:none;cursor:pointer;font:inherit;font-size:13.5px;color:#8A6C2E;text-decoration:underline;text-underline-offset:4px;}' +
  '#rs-gift .g-close:focus-visible,#rs-gift .g-cta:focus-visible,#rs-gift .g-later:focus-visible{outline:2px solid #2B2420;outline-offset:3px;}' +
  '@media (max-width:480px){#rs-gift h2{font-size:25px;}#rs-gift .g-body{padding:0 20px 22px;}#rs-gift .g-media{padding:56px 14px 42px;}#rs-gift p{font-size:14px;margin-bottom:18px;}}' +
  '@media (prefers-reduced-motion:reduce){#rs-gift-ov,#rs-gift{transition:none;}#rs-gift .g-media img{animation:none;}}';

  var ICON_GIFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var lastFocus = null;
  var ov = null;

  function open() {
    if (ss(true, 'rs_gift_shown')) return;
    // Don't stack on top of another open dialog (cart, payment, chat on mobile...).
    if (document.querySelector('.open[role="dialog"], #payment-modal.open')) { setTimeout(open, 8000); return; }
    ss(false, 'rs_gift_shown', '1');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    ov = document.createElement('div');
    ov.id = 'rs-gift-ov';
    ov.innerHTML =
      '<div id="rs-gift" role="dialog" aria-modal="true" aria-labelledby="rs-gift-title" tabindex="-1">' +
        '<div class="g-media">' +
          '<span class="g-spark" style="top:30%;right:9%"></span><span class="g-spark" style="top:22%;left:12%;width:7px;height:7px"></span><span class="g-spark" style="bottom:20%;left:8%;width:6px;height:6px"></span>' +
          '<img src="' + CONFIG.image + '" alt="' + CONFIG.imageAlt + '">' +
          '<span class="g-badge">' + ICON_GIFT + CONFIG.badge + '</span>' +
          '<button type="button" class="g-close" aria-label="סגירה">' + ICON_CLOSE + '</button>' +
        '</div>' +
        '<div class="g-body">' +
          '<div class="g-icon">' + ICON_GIFT + '</div>' +
          '<div class="g-eyebrow">' + CONFIG.eyebrow + '</div>' +
          '<h2 id="rs-gift-title">' + CONFIG.title + '</h2>' +
          '<p>' + CONFIG.text + '</p>' +
          '<ul class="g-scents" aria-label="ניחוחות">' + CONFIG.scents.map(function (s) { return '<li><i style="background:' + s[1] + '"></i>' + s[0] + '</li>'; }).join('') + '</ul>' +
          '<a class="g-cta" href="' + CONFIG.ctaHref + '">' + CONFIG.cta + '</a>' +
          '<button type="button" class="g-later">' + CONFIG.later + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    lastFocus = document.activeElement;
    requestAnimationFrame(function () { ov.classList.add('show'); });
    setTimeout(function () { var d = ov && ov.querySelector('#rs-gift'); if (d) d.focus({ preventScroll: true }); }, 80);

    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('.g-close') || e.target.closest('.g-later')) close();
    });
    ov.querySelector('.g-cta').addEventListener('click', function () { snooze(); });
    document.addEventListener('keydown', onKey);
  }

  function snooze() {
    ls(false, 'rs_gift_snooze', String(Date.now() + CONFIG.hideDaysAfterClose * 86400000));
  }

  function onKey(e) {
    if (!ov) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { // keep keyboard focus inside the popup
      var f = ov.querySelectorAll('button, a[href]');
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function close() {
    if (!ov) return;
    snooze();
    document.removeEventListener('keydown', onKey);
    ov.classList.remove('show');
    var el = ov; ov = null;
    setTimeout(function () { el.remove(); }, 350);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  setTimeout(open, waitMs);
})();
