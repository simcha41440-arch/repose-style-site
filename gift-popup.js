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
    imageAlt: 'שקיות ריח מעוצבות - מתנה מרפאוז סטייל',
    badge: 'מתנה מאיתנו',
    amountLabel: 'בכל רכישה מעל',
    amount: '500',
    title: 'שקית ריח מעוצבת במתנה',
    text: 'השלימו הזמנה בסכום של מעל 500 ₪ וקבלו מאיתנו שקית ריח מעוצבת, שמפיצה ניחוח עדין ונעים בבית.',
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

  /* Design: a split card - cream "gift window" with the product on one
     side, dark ink panel with gold typography on the other (stacked on
     phones). */
  var css = '' +
  '#rs-gift-ov{position:fixed;inset:0;z-index:100500;background:rgba(20,16,12,.62);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
    'display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;transition:opacity .4s ease;}' +
  '#rs-gift-ov.show{opacity:1;}' +
  '#rs-gift{position:relative;display:grid;grid-template-columns:1.05fr 1fr;width:720px;max-width:100%;max-height:calc(100vh - 36px);overflow:auto;' +
    'direction:rtl;border-radius:28px;background:#1C1712;box-shadow:0 50px 110px -30px rgba(0,0,0,.75),0 0 0 1px rgba(227,195,120,.35);' +
    'font-family:Rubik,"Almoni Neue",Arial,sans-serif;transform:translateY(26px) scale(.97);transition:transform .55s cubic-bezier(.19,1,.22,1);}' +
  '#rs-gift-ov.show #rs-gift{transform:none;}' +
  '#rs-gift:focus{outline:none;}' +
  /* text side (first in RTL = right) */
  '#rs-gift .g-body{position:relative;overflow:hidden;padding:46px 40px 34px;text-align:right;color:#F1DFA0;' +
    'background:radial-gradient(420px 260px at 100% 0%,rgba(214,177,94,.22),transparent 65%),linear-gradient(165deg,#2B2420 0%,#14100C 100%);}' +
  '#rs-gift .g-body::before{content:"";position:absolute;inset:14px;border:1px solid rgba(227,195,120,.28);border-radius:18px;pointer-events:none;}' +
  '#rs-gift .g-badge{display:inline-flex;align-items:center;gap:7px;margin-bottom:22px;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:600;' +
    'letter-spacing:.06em;color:#1C1712;background:linear-gradient(135deg,#F3DE9C,#D6B15E 55%,#B08A3E);box-shadow:0 8px 20px -10px rgba(214,177,94,.9);}' +
  '#rs-gift .g-badge svg{width:15px;height:15px;}' +
  '#rs-gift .g-amount-label{display:block;font-size:15px;color:rgba(241,223,160,.8);letter-spacing:.02em;}' +
  '#rs-gift .g-amount{display:flex;align-items:baseline;gap:8px;margin:2px 0 10px;line-height:1;}' +
  '#rs-gift .g-amount b{font-size:76px;font-weight:700;letter-spacing:-.02em;' +
    'background:linear-gradient(180deg,#FFF3C9 0%,#E3C378 45%,#B08A3E 100%);-webkit-background-clip:text;background-clip:text;color:transparent;}' +
  '#rs-gift .g-amount span{font-size:30px;font-weight:600;color:#E3C378;}' +
  '#rs-gift .g-rule{width:56px;height:2px;margin:6px 0 16px;background:linear-gradient(90deg,#E3C378,rgba(227,195,120,0));}' +
  '#rs-gift h2{margin:0 0 10px;font-size:25px;line-height:1.3;font-weight:500;color:#fff;}' +
  '#rs-gift p{margin:0 0 26px;font-size:14.5px;line-height:1.75;color:rgba(241,223,160,.78);font-weight:300;}' +
  '#rs-gift .g-cta{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:16px 20px;border-radius:999px;' +
    'text-decoration:none;font-size:15px;font-weight:600;letter-spacing:.05em;color:#1C1712;overflow:hidden;' +
    'background:linear-gradient(135deg,#F3DE9C 0%,#D6B15E 50%,#B08A3E 100%);box-shadow:0 16px 34px -14px rgba(214,177,94,.85);transition:transform .2s ease,box-shadow .2s ease;}' +
  '#rs-gift .g-cta::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;transform:skewX(-20deg);' +
    'background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);animation:rsGiftShine 3.2s ease-in-out 1s infinite;}' +
  '@keyframes rsGiftShine{0%{left:-60%}35%,100%{left:130%}}' +
  '#rs-gift .g-cta:hover{transform:translateY(-2px);box-shadow:0 22px 40px -14px rgba(214,177,94,.95);}' +
  '#rs-gift .g-later{display:block;margin:14px auto 0;background:none;border:none;cursor:pointer;font:inherit;font-size:13px;color:rgba(241,223,160,.65);' +
    'text-decoration:underline;text-underline-offset:4px;}' +
  '#rs-gift .g-later:hover{color:#F1DFA0;}' +
  /* image side */
  '#rs-gift .g-media{position:relative;display:flex;align-items:center;justify-content:center;padding:44px 26px;min-height:100%;' +
    'background:radial-gradient(circle at 50% 45%,#FFFFFF 0%,#FFF8E6 48%,#EAD49C 100%);}' +
  '#rs-gift .g-media::before{content:"";position:absolute;inset:14px;border:1px solid rgba(176,138,62,.45);border-radius:18px;pointer-events:none;}' +
  '#rs-gift .g-media img{position:relative;display:block;width:100%;height:auto;mix-blend-mode:multiply;' +
    'filter:drop-shadow(0 22px 20px rgba(110,80,25,.25));animation:rsGiftFloat 5s ease-in-out infinite;}' +
  '@keyframes rsGiftFloat{0%,100%{transform:rotate(-2deg) translateY(0)}50%{transform:rotate(-2deg) translateY(-7px)}}' +
    '#rs-gift .g-body{padding:30px 26px 26px;text-align:center;}' +
    '#rs-gift .g-badge{margin-bottom:14px;}' +
    '#rs-gift .g-amount{justify-content:center;}' +
    '#rs-gift .g-amount b{font-size:60px;}' +
    '#rs-gift .g-rule{margin:6px auto 14px;background:linear-gradient(90deg,rgba(227,195,120,0),#E3C378,rgba(227,195,120,0));}' +
    '#rs-gift h2{font-size:21px;}' +
    '#rs-gift p{font-size:14px;margin-bottom:20px;}' +
  '}' +
  '@media (prefers-reduced-motion:reduce){#rs-gift-ov,#rs-gift{transition:none;}#rs-gift .g-media img,#rs-gift .g-cta::after{animation:none;}}';

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
        '<div class="g-body">' +
          '<span class="g-badge">' + ICON_GIFT + CONFIG.badge + '</span>' +
          '<span class="g-amount-label">' + CONFIG.amountLabel + '</span>' +
          '<div class="g-amount"><b>' + CONFIG.amount + '</b><span>₪</span></div>' +
          '<div class="g-rule"></div>' +
          '<h2 id="rs-gift-title">' + CONFIG.title + '</h2>' +
          '<p>' + CONFIG.text + '</p>' +
          '<a class="g-cta" href="' + CONFIG.ctaHref + '">' + CONFIG.cta + '</a>' +
          '<button type="button" class="g-later">' + CONFIG.later + '</button>' +
        '</div>' +
        '<div class="g-media">' +
          '<button type="button" class="g-close" aria-label="סגירה">' + ICON_CLOSE + '</button>' +
          '<img src="' + CONFIG.image + '" alt="' + CONFIG.imageAlt + '">' +
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
