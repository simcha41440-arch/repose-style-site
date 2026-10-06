/* ============================================================
   AI CHAT ASSISTANT (Gemini) - floating chat widget
   ------------------------------------------------------------
   Loaded on every storefront page via <script src="/chatbot.js" defer>.
   Talks only to our own server (POST /api/inquiries, type:"chat") -
   the Gemini API key never reaches the browser. See api/_lib/chatbot.js.
   ============================================================ */
(function () {
  if (window.__rsChatLoaded) return;
  window.__rsChatLoaded = true;
  if (/^\/admin/.test(location.pathname)) return;

  var STORE_KEY = 'rs-chat-history-v1';
  var WELCOME = 'שלום! 👋 אני העוזר הדיגיטלי של רפאוז סטייל.\nאשמח לעזור לבחור מצעים, מגבות או ניחוח לבית, ולענות על שאלות לגבי משלוחים, החזרות ותשלום.';
  var SUGGESTIONS = [
    'מה ההבדל בין הקולקציות?',
    'מה כולל סט מצעים?',
    'כמה עולה משלוח?',
    'ממליץ לי על מתנה'
  ];

  var history = [];
  try {
    var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
    if (Array.isArray(saved)) history = saved.slice(-30);
  } catch (e) {}
  // Identifies this chat so the server can keep the whole conversation
  // together for the admin panel ("שיחות עם הבוט"). New id on "שיחה חדשה".
  function newSessionId() {
    var r = '';
    try { r = (crypto.randomUUID && crypto.randomUUID()) || ''; } catch (e) {}
    return (r || (Date.now().toString(36) + Math.random().toString(36).slice(2, 12))).replace(/[^A-Za-z0-9_-]/g, '');
  }
  var sessionId = null;
  try { sessionId = sessionStorage.getItem('rs-chat-session'); } catch (e) {}
  if (!sessionId) {
    sessionId = newSessionId();
    try { sessionStorage.setItem('rs-chat-session', sessionId); } catch (e) {}
  }
  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-30))); } catch (e) {}
  }

  /* ---------- styles ---------- */
  var css = '' +
  /* Sits bottom-left, right above the accessibility button. */
  /* Chat button: dark "ink" disc with a slowly turning gold ring and a
     gold sparkle mark - matches the site's black & gold palette. */
  '#rs-chat-btn{position:fixed;bottom:96px;left:18px;z-index:1140;width:60px;height:60px;border-radius:50%;border:none;padding:0;cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;isolation:isolate;' +
    'background:radial-gradient(circle at 35% 28%,#4A3D33 0%,#2B2420 45%,#14100C 100%);' +
    'box-shadow:0 14px 30px -8px rgba(20,16,12,.65),0 0 0 1px rgba(227,195,120,.25);' +
    'transition:transform .35s cubic-bezier(.19,1,.22,1),box-shadow .35s ease,opacity .25s ease;}' +
  /* rotating gold ring */
  '#rs-chat-btn::before{content:"";position:absolute;inset:-3px;border-radius:50%;z-index:-1;' +
    'background:conic-gradient(from 0deg,#8A6C2E,#F3DE9C,#B08A3E,#FFF3C9,#8A6C2E,#D6B15E,#8A6C2E);animation:rsRing 6s linear infinite;}' +
  /* inner dark disc + fine inner gold line */
  '#rs-chat-btn::after{content:"";position:absolute;inset:1px;border-radius:50%;z-index:-1;' +
    'background:radial-gradient(circle at 35% 28%,#4A3D33 0%,#2B2420 45%,#14100C 100%);box-shadow:inset 0 0 0 4px rgba(20,16,12,.9),inset 0 0 0 5px rgba(227,195,120,.45);}' +
  '@keyframes rsRing{to{transform:rotate(360deg)}}' +
  '#rs-chat-btn:hover{transform:translateY(-2px) scale(1.06);box-shadow:0 20px 38px -10px rgba(20,16,12,.7),0 0 22px -4px rgba(227,195,120,.55);}' +
  '#rs-chat-btn:focus-visible{outline:2px solid #B08A3E;outline-offset:4px;}' +
  '#rs-chat-btn svg{width:28px;height:28px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4));transition:transform .5s cubic-bezier(.19,1,.22,1);}' +
  '#rs-chat-btn:hover svg{transform:rotate(-12deg) scale(1.08);}' +
  '#rs-chat-btn .rs-chat-badge{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);padding:2px 7px;border-radius:999px;' +
    'font:700 9px/1.2 Rubik,Arial,sans-serif;letter-spacing:.12em;color:#2B2420;background:linear-gradient(135deg,#F3DE9C,#D6B15E 55%,#B08A3E);' +
    'box-shadow:0 3px 8px -3px rgba(0,0,0,.5);}' +
  '#rs-chat-btn.rs-open{transform:scale(.92);}' +
  '#rs-chat-btn.rs-hidden{opacity:0;pointer-events:none;transform:scale(.6);}' +
  '@media (max-width:680px){#rs-chat-btn{bottom:94px;left:21px;width:54px;height:54px;}#rs-chat-btn svg{width:25px;height:25px;}}' +
  '#rs-chat-panel{position:fixed;bottom:170px;left:22px;z-index:1160;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 190px);' +
    'background:#FFFDF8;border:1px solid #D8B96C;border-radius:20px;box-shadow:0 24px 60px -18px rgba(28,23,18,.45);' +
    'display:flex;flex-direction:column;overflow:hidden;direction:rtl;font-family:Rubik,"Almoni Neue",Arial,sans-serif;color:#2B2420;' +
    'opacity:0;transform:translateY(14px) scale(.98);pointer-events:none;transition:opacity .22s ease,transform .22s ease;}' +
  '#rs-chat-panel.rs-show{opacity:1;transform:none;pointer-events:auto;}' +
  '#rs-chat-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#1C1712;color:#F1DFA0;}' +
  '#rs-chat-head .rs-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(145deg,#D6B15E,#8A6C2E);display:flex;align-items:center;justify-content:center;flex:none;}' +
  '#rs-chat-head .rs-av svg{width:20px;height:20px;}' +
  '#rs-chat-head .rs-t{flex:1;min-width:0;}' +
  '#rs-chat-head .rs-t b{display:block;font-size:15px;font-weight:600;color:#fff;}' +
  '#rs-chat-head .rs-t span{font-size:12px;color:#E3C378;}' +
  '#rs-chat-head button{background:none;border:none;color:#E3C378;cursor:pointer;padding:6px;border-radius:8px;display:flex;}' +
  '#rs-chat-head button:hover{background:rgba(255,255,255,.08);}' +
  '#rs-chat-head button svg{width:18px;height:18px;}' +
  '#rs-chat-msgs{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}' +
  '.rs-m{max-width:86%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;}' +
  '.rs-m a{color:#8A6C2E;text-decoration:underline;word-break:break-all;}' +
  '.rs-m.rs-bot{align-self:flex-start;background:#F6EEDB;border-bottom-right-radius:4px;}' +
  '.rs-m.rs-user{align-self:flex-end;background:#2B2420;color:#fff;border-bottom-left-radius:4px;}' +
  '.rs-m.rs-err{background:#FBE9E5;color:#8A3A2C;}' +
  '.rs-typing{display:flex;gap:4px;align-items:center;padding:14px 16px;}' +
  '.rs-typing i{width:7px;height:7px;border-radius:50%;background:#B08A3E;animation:rsDot 1.2s infinite ease-in-out;}' +
  '.rs-typing i:nth-child(2){animation-delay:.15s}.rs-typing i:nth-child(3){animation-delay:.3s}' +
  '@keyframes rsDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
  '#rs-chat-sugg{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;}' +
  '#rs-chat-sugg button{border:1px solid #D8B96C;background:#fff;color:#6B4E14;border-radius:999px;padding:6px 12px;font:13px Rubik,Arial,sans-serif;cursor:pointer;}' +
  '#rs-chat-sugg button:hover{background:#F6EEDB;}' +
  '#rs-chat-form{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #EEDCA6;background:#fff;}' +
  '#rs-chat-input{flex:1;resize:none;border:1px solid #D8B96C;border-radius:14px;padding:10px 12px;font:14px/1.4 Rubik,Arial,sans-serif;max-height:96px;min-height:42px;color:#2B2420;background:#fff;direction:rtl;}' +
  '#rs-chat-input:focus{outline:none;border-color:#8A6C2E;box-shadow:0 0 0 3px rgba(176,138,62,.18);}' +
  '#rs-chat-send{flex:none;width:42px;height:42px;border-radius:50%;border:none;background:#2B2420;color:#F1DFA0;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
  '#rs-chat-send:disabled{opacity:.45;cursor:default;}' +
  '#rs-chat-send svg{width:18px;height:18px;transform:scaleX(-1);}' +
  '#rs-chat-foot{font-size:11px;color:#8A6C2E;text-align:center;padding:0 12px 8px;background:#fff;}' +
  '#rs-chat-foot a{color:#8A6C2E;}' +
  '@media (max-width:520px){' +
    '#rs-chat-panel{right:8px;left:8px;width:auto;max-width:none;bottom:8px;height:calc(100vh - 16px);height:calc(100dvh - 16px);max-height:none;}' +
    '#rs-chat-btn.rs-open{opacity:0;pointer-events:none;}' +
  '}' +
  '@media (prefers-reduced-motion:reduce){#rs-chat-panel,#rs-chat-btn{transition:none}#rs-chat-btn::before{animation:none}.rs-typing i{animation:none}}' +
  'body.rs-print-hide #rs-chat-btn{display:none}';

  var style = document.createElement('style');
  style.id = 'rs-chat-style';
  style.textContent = css;
  document.head.appendChild(style);

  var ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="rsGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF3C9"/><stop offset=".45" stop-color="#E3C378"/><stop offset="1" stop-color="#B08A3E"/></linearGradient></defs>' +
    '<path fill="url(#rsGold)" d="M11 2.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"/>' +
    '<path fill="url(#rsGold)" d="M18 13.5c.28 2 1.2 2.92 3.2 3.2-2 .28-2.92 1.2-3.2 3.2-.28-2-1.2-2.92-3.2-3.2 2-.28 2.92-1.2 3.2-3.2z" opacity=".9"/>' +
    '<circle cx="5.5" cy="18" r="1.1" fill="url(#rsGold)" opacity=".75"/></svg>';
  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.5-7.5a1 1 0 0 0 0-1.8L3.4 3.6a1 1 0 0 0-1.4 1.2L4.3 12l-2.3 7.2a1 1 0 0 0 1.4 1.2z"/></svg>';

  /* ---------- markup ---------- */
  var btn = document.createElement('button');
  btn.id = 'rs-chat-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'פתיחת צ\'אט עם העוזר הדיגיטלי');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'rs-chat-panel');
  btn.innerHTML = ICON_CHAT + '<span class="rs-chat-badge">AI</span>';

  var panel = document.createElement('div');
  panel.id = 'rs-chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'צ\'אט עם העוזר הדיגיטלי של רפאוז סטייל');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML =
    '<div id="rs-chat-head">' +
      '<div class="rs-av">' + ICON_SPARK + '</div>' +
      '<div class="rs-t"><b>העוזר של רפאוז סטייל</b><span>עונה מיד · מבוסס בינה מלאכותית</span></div>' +
      '<button type="button" id="rs-chat-reset" aria-label="שיחה חדשה" title="שיחה חדשה">' + ICON_RESET + '</button>' +
      '<button type="button" id="rs-chat-close" aria-label="סגירת הצ\'אט" title="סגירה">' + ICON_CLOSE + '</button>' +
    '</div>' +
    '<div id="rs-chat-msgs" aria-live="polite"></div>' +
    '<div id="rs-chat-sugg"></div>' +
    '<form id="rs-chat-form" autocomplete="off">' +
      '<textarea id="rs-chat-input" rows="1" maxlength="800" placeholder="כתבו כאן את השאלה…" aria-label="הודעה"></textarea>' +
      '<button type="submit" id="rs-chat-send" aria-label="שליחה">' + ICON_SEND + '</button>' +
    '</form>' +
    '<div id="rs-chat-foot">התשובות נוצרות ע"י בינה מלאכותית ועשויות לטעות · השיחות נשמרות לשיפור השירות · לנציג אנושי: <a href="https://wa.me/972556713828" target="_blank" rel="noopener">וואטסאפ</a></div>';

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // Same behaviour as the WhatsApp button: step out of the way while the
  // cart, wishlist, search, payment or any other panel/popup is open.
  var HIDE_BEHIND_IDS = ['cart-drawer', 'wishlist-drawer', 'search-panel', 'newsletter-modal',
    'payment-modal', 'success-modal', 'mobile-menu', 'a11y-panel'];
  setInterval(function () {
    var covered = HIDE_BEHIND_IDS.some(function (id) {
      var el = document.getElementById(id);
      return el && el.classList.contains('open');
    }) || !!document.getElementById('rs-gift-ov');
    btn.classList.toggle('rs-hidden', covered);
  }, 200);

  var msgsEl = panel.querySelector('#rs-chat-msgs');
  var suggEl = panel.querySelector('#rs-chat-sugg');
  var form = panel.querySelector('#rs-chat-form');
  var input = panel.querySelector('#rs-chat-input');
  var sendBtn = panel.querySelector('#rs-chat-send');
  var busy = false;
  var rendered = false;

  /* ---------- rendering ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Safe mini-markdown: escape first, then **bold** and links.
  function format(text) {
    var h = esc(text);
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/(^|\n)\s*[\*\-]\s+/g, '$1• ');
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
      return linkTag(url, label);
    });
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,!?:;'"])/g, function (m, pre, url) {
      return pre + linkTag(url, prettyUrl(url));
    });
    return h;
  }
  function prettyUrl(url) {
    try {
      var u = new URL(url.replace(/&amp;/g, '&'));
      if (/(^|\.)reposestyle\.com$/.test(u.hostname)) {
        var path = u.pathname.replace(/\/+$/, '') || '/';
        if (/^\/product\//.test(path)) return 'לעמוד המוצר ←';
        var PAGES = {
          '/': 'לעמוד הבית', '/shop': 'לחנות', '/shop/renaissance': 'לקולקציית Renaissance',
          '/shop/bloom': 'לקולקציית Bloom', '/shop/heritage': 'לקולקציית Heritage', '/towels': 'למגבות',
          '/perfume': 'למכשירי הבישום', '/sale': 'למבצעים', '/shipping': 'למשלוחים והחזרות',
          '/faq': 'לשאלות נפוצות', '/contact': 'לצור קשר', '/about': 'לאודות', '/account': 'לאזור האישי',
          '/checkout': 'לקופה'
        };
        return (PAGES[path] || 'לעמוד באתר') + (/^\/product\//.test(path) ? '' : ' ←');
      }
      return u.hostname;
    } catch (e) { return url; }
  }
  function linkTag(url, label) {
    var internal = /^https?:\/\/(www\.)?reposestyle\.com/.test(url);
    var href = internal ? url.replace(/^https?:\/\/(www\.)?reposestyle\.com/, '') || '/' : url;
    return '<a href="' + href + '"' + (internal ? '' : ' target="_blank" rel="noopener nofollow"') + '>' + label + '</a>';
  }

  function addBubble(role, text, extraClass) {
    var d = document.createElement('div');
    d.className = 'rs-m ' + (role === 'user' ? 'rs-user' : 'rs-bot') + (extraClass ? ' ' + extraClass : '');
    if (role === 'user') d.textContent = text; else d.innerHTML = format(text);
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return d;
  }

  function renderAll() {
    msgsEl.innerHTML = '';
    addBubble('model', WELCOME);
    history.forEach(function (m) { addBubble(m.role, m.text); });
    renderSuggestions();
    rendered = true;
  }

  function renderSuggestions() {
    suggEl.innerHTML = '';
    if (history.length) { suggEl.style.display = 'none'; return; }
    suggEl.style.display = '';
    SUGGESTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.addEventListener('click', function () { send(s); });
      suggEl.appendChild(b);
    });
  }

  /* ---------- open / close ---------- */
  function open() {
    if (!rendered) renderAll();
    panel.classList.add('rs-show');
    panel.setAttribute('aria-hidden', 'false');
    btn.classList.add('rs-open');
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { input.focus(); msgsEl.scrollTop = msgsEl.scrollHeight; }, 60);
  }
  function close() {
    panel.classList.remove('rs-show');
    panel.setAttribute('aria-hidden', 'true');
    btn.classList.remove('rs-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
  btn.addEventListener('click', function () {
    panel.classList.contains('rs-show') ? close() : open();
  });
  panel.querySelector('#rs-chat-close').addEventListener('click', close);
  panel.querySelector('#rs-chat-reset').addEventListener('click', function () {
    if (busy) return;
    history = [];
    persist();
    sessionId = newSessionId();
    try { sessionStorage.setItem('rs-chat-session', sessionId); } catch (e) {}
    renderAll();
    input.focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('rs-show')) close();
  });
  // Internal links inside the chat: on phones, close the panel so the
  // visitor actually sees the page they navigated to.
  msgsEl.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (a && !a.target && window.innerWidth <= 520) close();
  });

  /* ---------- sending ---------- */
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = '';
    history.push({ role: 'user', text: text.slice(0, 800) });
    persist();
    addBubble('user', text);
    renderSuggestions();

    var typing = document.createElement('div');
    typing.className = 'rs-m rs-bot rs-typing';
    typing.setAttribute('aria-label', 'העוזר מקליד');
    typing.innerHTML = '<i></i><i></i><i></i>';
    msgsEl.appendChild(typing);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var payload = JSON.stringify({
      type: 'chat',
      session_id: sessionId,
      messages: history.slice(-16),
      page: location.origin + location.pathname
    });
    function ask() {
      return fetch('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
    }
    // One automatic, silent retry for a temporary server/network hiccup,
    // so the visitor only sees an error if it happens twice in a row.
    ask()
      .then(function (res) {
        // Retry only when the server gave no answer at all (timeout/crash);
        // a friendly server-side reply is shown as-is.
        if (res.ok || (res.d && res.d.reply) || res.status === 429 || res.status === 400) return res;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(ask);
      }, function () {
        return new Promise(function (r) { setTimeout(r, 1200); }).then(ask);
      })
      .then(function (res) {
        typing.remove();
        var reply = res.d && res.d.reply;
        if (res.ok && reply) {
          history.push({ role: 'model', text: reply });
          persist();
          addBubble('model', reply);
        } else {
          // Drop the unanswered question so a retry starts clean.
          history.pop();
          persist();
          addBubble('model', reply || 'אירעה תקלה זמנית. נסו שוב בעוד רגע, או פנו אלינו בוואטסאפ 055-6713828.', 'rs-err');
        }
      })
      .catch(function () {
        typing.remove();
        history.pop();
        persist();
        addBubble('model', 'נראה שיש בעיית חיבור. בדקו את האינטרנט ונסו שוב.', 'rs-err');
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }
})();
