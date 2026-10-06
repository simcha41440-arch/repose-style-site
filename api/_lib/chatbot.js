// AI chat assistant for the storefront, powered by Google Gemini.
//
// Reached via POST /api/inquiries with { type: "chat", messages: [...] }.
// It lives inside api/inquiries.js (not its own api/chat.js) because the
// project is already at Vercel's Hobby-plan cap of 12 serverless
// functions - see the note at the top of api/admin.js.
//
// SETUP: add GEMINI_API_KEY in Vercel > Project Settings > Environment
// Variables (get a key at https://aistudio.google.com/apikey), then
// redeploy. Optional: GEMINI_MODEL to override the default model.
//
// The API key only ever lives here on the server - the browser never
// sees it. The browser sends the conversation, this file adds the store
// knowledge + live prices and asks Gemini for the next reply.

const { sanitizeEnvValue } = require('./mailer');
const { getClientIp, checkRateLimit, recordRateLimitEvent } = require('./security');
const { CATALOG, STORE_INFO, SITE_URL } = require('./chatKnowledge');

// Tried in order until one works. "gemini-flash-latest" is Google's
// auto-updating alias for the current Flash model, so the bot keeps
// working when an older model (like gemini-2.5-flash) is retired.
// GEMINI_MODEL in Vercel, if set, is tried first.
// flash-lite is fast and rarely overloaded, so it's the second choice.
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
function modelList() {
  const preferred = sanitizeEnvValue(process.env.GEMINI_MODEL);
  return [preferred].concat(FALLBACK_MODELS).filter((m, i, a) => m && a.indexOf(m) === i);
}

// Per-IP limit: 40 messages per 15 minutes is plenty for a real shopper
// and stops anyone from burning through the Gemini quota.
const CHAT_RATE_LIMIT = { max: 40, windowMinutes: 15 };

const MAX_HISTORY = 16; // messages sent to Gemini (user + bot)
const MAX_MESSAGE_CHARS = 800; // per visitor message

// Live overrides from the admin panel (price changes, sale prices,
// out-of-stock, deleted products, renamed products). Cached for a minute
// per warm serverless instance so every chat message doesn't hit the DB.
let overridesCache = { at: 0, rows: null };
async function getOverrides(supabase) {
  if (!supabase) return [];
  if (overridesCache.rows && Date.now() - overridesCache.at < 60 * 1000) {
    return overridesCache.rows;
  }
  try {
    const { data, error } = await supabase
      .from('product_overrides')
      .select('id, name, price, compare_at_price, out_of_stock, active');
    if (error || !data) return overridesCache.rows || [];
    overridesCache = { at: Date.now(), rows: data };
    return data;
  } catch (err) {
    console.error('chatbot: loading product_overrides failed (non-fatal):', err.message);
    return overridesCache.rows || [];
  }
}

const TYPE_LABELS = {
  bedding: 'סט מצעים',
  towel: 'מגבות',
  diffuser: 'מכשיר בישום',
  scent: 'בקבוק ניחוח (חצי ליטר)',
};

function buildCatalogText(overrides) {
  const byId = {};
  (overrides || []).forEach((o) => { byId[o.id] = o; });

  const lines = [];
  CATALOG.forEach((p) => {
    const o = byId[p.id];
    if (o && o.active === false) return; // deleted by admin
    const name = (o && o.name) || p.name;
    const price = o && o.price != null ? Number(o.price) : p.price;
    const wasPrice = o && o.compare_at_price != null ? Number(o.compare_at_price) : null;

    const parts = [`${name}${p.nameEn ? ` (${p.nameEn})` : ''}`, TYPE_LABELS[p.type] || p.type];
    if (p.collection) parts.push(`קולקציית ${p.collection}`);
    if (p.cotton) parts.push(`${p.cotton}% כותנה, ${p.thread} חוט`);
    parts.push(
      wasPrice && wasPrice > price
        ? `מחיר מבצע ${price} ₪ (במקום ${wasPrice} ₪)`
        : `מחיר ${price} ₪`
    );
    if (p.embroidery === 'free') parts.push('רקמת ראשי תיבות כלולה במחיר');
    if (p.embroidery === 'paid') parts.push('אפשר להוסיף רקמת ראשי תיבות ב-200 ₪');
    if (p.colors) parts.push(`צבעים: ${p.colors.join(', ')}`);
    if (p.features) parts.push(p.features.join('; '));
    if (p.tag) parts.push(`תגית: ${p.tag}`);
    if (o && o.out_of_stock) parts.push('*** אזל מהמלאי ***');
    parts.push(`${SITE_URL}/product/${p.id}`);
    lines.push('- ' + parts.join(' | '));
  });

  // Products the admin added that aren't in the built-in catalog.
  const known = new Set(CATALOG.map((p) => p.id));
  (overrides || []).forEach((o) => {
    if (known.has(o.id) || o.active === false || !o.name || o.price == null) return;
    lines.push(`- ${o.name} | מחיר ${Number(o.price)} ₪${o.out_of_stock ? ' | *** אזל מהמלאי ***' : ''} | ${SITE_URL}/product/${o.id}`);
  });
  return lines.join('\n');
}

function buildSystemPrompt(catalogText, pageUrl) {
  return `את/ה "העוזר של רפאוז סטייל" - נציג/ת שירות ומכירות וירטואלי/ת באתר של רפאוז סטייל (reposestyle.com).

תפקידך: לעזור למבקרים באתר למצוא את המוצר המתאים, לענות על שאלות לגבי מוצרים, מחירים, משלוחים, החזרות ותשלום, ולעודד בעדינות רכישה.

כללים:
1. ענה/י תמיד בעברית (אלא אם הלקוח כותב בשפה אחרת - אז באותה שפה), בטון חם, מכובד ומקצועי, בשפה נקייה.
2. תשובות קצרות וברורות - בדרך כלל 1-4 משפטים. רשימה קצרה רק כשמשווים בין כמה מוצרים.
3. השתמש/י אך ורק במידע שלמטה. אל תמציא/י מחירים, מוצרים, מבצעים, מידות, צבעים או מדיניות. אם המידע לא מופיע - אמור/י בכנות שאין לך את הפרט הזה והפנה/י לטלפון/וואטסאפ 055-6713828 או לעמוד צור קשר.
4. כשממליצים על מוצר - צרף/י את הקישור לעמוד המוצר (כתובת מלאה כפי שמופיעה ברשימה).
5. מוצר שמסומן "אזל מהמלאי" - ציין/י זאת ואל תציע/י לרכוש אותו כרגע.
6. אין לך גישה להזמנות, לסטטוס משלוח או לפרטי לקוחות. לשאלות על הזמנה קיימת - הפנה/י לאזור האישי ${SITE_URL}/account או לטלפון/וואטסאפ.
7. אל תבקש/י ולא תקבל/י פרטי כרטיס אשראי. התשלום נעשה רק בעמוד הקופה המאובטח.
8. הישאר/י בנושאי החנות והמוצרים. אם שואלים על נושא שאינו קשור לחנות - השב/י בנימוס שאת/ה כאן כדי לעזור בנושאי רפאוז סטייל, והצע/י עזרה במוצרים.
9. אל תתחייב/י להנחות, החזרים או חריגות ממדיניות - רק נציג אנושי יכול לאשר.
10. אל תשתמש/י בעיצוב Markdown כבד (בלי כותרות #). מותר הדגשה עם **טקסט** ורשימות עם "-".

=== מידע על החנות ===
${STORE_INFO}

=== רשימת המוצרים והמחירים העדכניים ===
${catalogText}
${pageUrl ? `\nהלקוח נמצא כרגע בעמוד: ${pageUrl}` : ''}`;
}

// Turns the visitor's history into Gemini's `contents` format, trimming
// and validating it - never trust what the browser sends.
function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const cleaned = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, m.role === 'user' ? MAX_MESSAGE_CHARS : 2000) }))
    .filter((m) => m.text)
    .slice(-MAX_HISTORY);
  // Gemini requires the conversation to start with a user turn.
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
}

async function callGemini({ apiKey, model, systemPrompt, contents, timeoutMs }) {
  const generationConfig = { temperature: 0.4, maxOutputTokens: 1024 };
  // 2.5 Flash "thinks" by default, which is slower and eats the output
  // token budget - a store FAQ bot doesn't need it.
  if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  // Newer models think before answering and that counts toward the output
  // budget - give them room so the visible reply isn't cut off/empty.
  else generationConfig.maxOutputTokens = 4096;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig,
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        }),
        signal: controller.signal,
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
      const err = new Error(`Gemini API error (${model}, HTTP ${resp.status}): ${msg}`);
      err.status = resp.status;
      err.geminiMessage = msg;
      throw err;
    }
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map((p) => p.text || '').join('').trim()
      : '';
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Tries each model in modelList(); moves on only when the failure is
// about the model itself (retired/unknown/no quota on it) - a bad key or
// a blocked request fails the same way on every model, so stop there.
async function callGeminiWithFallback(opts) {
  const models = modelList();
  let lastErr;
  // Hard time budget - must finish well inside Vercel's 30s function limit,
  // or the visitor gets a raw timeout instead of a friendly answer.
  const deadline = Date.now() + 20000;
  for (const model of models) {
    // Google's "high demand" / temporary errors (500/503/504) usually
    // clear within a second or two - retry the same model once, then
    // move on to the next model instead of giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 2500) throw lastErr || new Error('Gemini: out of time');
      try {
        // A single slow model can't eat the whole budget.
        const text = await callGemini(Object.assign({}, opts, { model, timeoutMs: Math.min(11000, left) }));
        if (!text) { // empty answer (e.g. blocked/cut off) - try the next model
          lastErr = new Error(`Gemini returned an empty reply (${model})`);
          break;
        }
        return { text, model };
      } catch (err) {
        lastErr = err;
        console.error('chatbot:', err.message);
        const busy = err.status === 500 || err.status === 503 || err.status === 504 || err.name === 'AbortError';
        const modelProblem = busy || err.status === 404 || err.status === 429 ||
          (err.status === 400 && /model/i.test(err.geminiMessage || ''));
        if (!modelProblem) throw err; // bad key / blocked request - same on every model
        // Quick retry only for a fast "busy" answer - a timeout moves straight on.
        if (busy && err.name !== 'AbortError' && attempt === 0) { await new Promise((r) => setTimeout(r, 700)); continue; }
        break;
      }
    }
  }
  throw lastErr;
}

// Plain-language hint for the most common setup problems, shown by the
// health check (GET /api/inquiries?chat_health=1).
function hintFor(err) {
  const m = (err && (err.geminiMessage || err.message)) || '';
  const st = err && err.status;
  if (err && err.name === 'AbortError') return 'Gemini לא ענה בזמן (timeout). נסו שוב בעוד דקה.';
  if (/API key not valid|API_KEY_INVALID/i.test(m)) return 'המפתח GEMINI_API_KEY שגוי. צרו מפתח חדש ב-aistudio.google.com/apikey, עדכנו אותו ב-Vercel ועשו Redeploy.';
  if (/referer|referrer|restrict/i.test(m)) return 'המפתח מוגבל (API restrictions / referrer). ב-Google Cloud Console > Credentials בטלו את הגבלת ה-HTTP referrers של המפתח, או צרו מפתח חדש ב-AI Studio.';
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(m)) return 'ה-Generative Language API לא מופעל בפרויקט של המפתח. צרו מפתח דרך aistudio.google.com/apikey (שם זה מופעל אוטומטית).';
  if (st === 429 || /quota|RESOURCE_EXHAUSTED/i.test(m)) return 'נגמרה המכסה (quota) של המפתח. המתינו, או הפעילו חיוב ב-Google AI Studio.';
  if (st === 503 || st === 500 || /high demand|overloaded|UNAVAILABLE/i.test(m)) return 'השרתים של Google עמוסים כרגע בכל המודלים שנוסו. זה זמני - נסו שוב בעוד כמה דקות.';
  if (st === 404) return 'המודל לא נמצא. אפשר להגדיר ב-Vercel משתנה GEMINI_MODEL עם שם מודל עדכני.';
  if (/location|region|not supported/i.test(m)) return 'Gemini לא זמין באזור של שרת Vercel. ב-Vercel > Settings > Functions שנו את Function Region (למשל ל-fra1 או iad1).';
  return 'שגיאה לא צפויה - שלחו את הטקסט הזה לתמיכה.';
}

async function handleChatHealth(req, res, supabase) {
  res.setHeader('Cache-Control', 'no-store');
  const apiKey = sanitizeEnvValue(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    return res.status(200).json({ ok: false, key_present: false,
      hint: 'GEMINI_API_KEY לא מוגדר ב-Vercel (או שלא נעשה Redeploy אחרי שהוגדר).' });
  }
  const ip = getClientIp(req);
  if (supabase) {
    const rate = await checkRateLimit(supabase, 'chat', ip, CHAT_RATE_LIMIT);
    if (!rate.allowed) return res.status(429).json({ ok: false, error: 'rate_limited' });
    await recordRateLimitEvent(supabase, 'chat', ip);
  }
  const started = Date.now();
  try {
    const r = await callGeminiWithFallback({ apiKey, systemPrompt: 'Answer in one short Hebrew word.',
      contents: [{ role: 'user', parts: [{ text: 'שלום' }] }] });
    return res.status(200).json({ ok: true, key_present: true, model: r.model, sample: r.text.slice(0, 60), ms: Date.now() - started });
  } catch (err) {
    return res.status(200).json({ ok: false, key_present: true, tried_models: modelList(),
      http_status: err.status || null, error: (err.geminiMessage || err.message || '').slice(0, 400),
      hint: hintFor(err), ms: Date.now() - started });
  }
}

// Saves the conversation for the admin panel's "שיחות עם הבוט" tab
// (table chat_conversations - see CHAT-LOG-SETUP.sql). One row per chat
// session; each call appends the visitor's latest question and the bot's
// answer. Best-effort: a logging problem never affects the visitor.
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
async function saveConversation(supabase, { sessionId, contents, reply, failed, page, ip }) {
  if (!supabase || !SESSION_RE.test(sessionId || '')) return;
  try {
    const now = new Date().toISOString();
    const lastUser = contents[contents.length - 1];
    const newTurns = [
      { role: 'user', text: lastUser.parts[0].text, at: now },
      { role: 'model', text: reply, at: now, failed: !!failed },
    ];
    const { data: existing } = await supabase
      .from('chat_conversations')
      .select('messages, had_error')
      .eq('session_id', sessionId)
      .maybeSingle();
    let messages;
    if (existing && Array.isArray(existing.messages)) {
      messages = existing.messages.concat(newTurns);
    } else {
      // First save for this chat: keep whatever earlier turns the browser
      // sent too (e.g. if saving was briefly unavailable).
      messages = contents.slice(0, -1).map((c) => ({ role: c.role, text: c.parts[0].text })).concat(newTurns);
    }
    messages = messages.slice(-200);
    const firstUser = messages.find((m) => m.role === 'user');
    const row = {
      session_id: sessionId,
      messages,
      message_count: messages.filter((m) => m.role === 'user').length,
      first_question: firstUser ? String(firstUser.text).slice(0, 300) : null,
      ip: ip || null,
      had_error: !!failed || !!(existing && existing.had_error),
      updated_at: now,
    };
    if (page) row.page = page; // last page the visitor chatted from
    const { error } = await supabase.from('chat_conversations').upsert(row, { onConflict: 'session_id' });
    if (error) console.error('chatbot: saving conversation failed (non-fatal):', error.message);
  } catch (err) {
    console.error('chatbot: saving conversation failed (non-fatal):', err.message);
  }
}

const FALLBACK_REPLY =
  'מצטערים, לא הצלחתי לענות כרגע. אפשר לפנות אלינו בטלפון או בוואטסאפ 055-6713828, או דרך עמוד צור קשר - ונשמח לעזור.';

async function handleChat(req, res, supabase, body) {
  try {
    return await handleChatInner(req, res, supabase, body);
  } catch (err) {
    console.error('chatbot: unexpected error:', err && err.message);
    if (!res.headersSent) return res.status(500).json({ error: 'internal', reply: FALLBACK_REPLY });
  }
}

async function handleChatInner(req, res, supabase, body) {
  const apiKey = sanitizeEnvValue(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    console.error('chatbot: GEMINI_API_KEY is not set in Vercel environment variables.');
    return res.status(503).json({ error: 'הצ\'אט אינו זמין כרגע.', reply: FALLBACK_REPLY });
  }

  const ip = getClientIp(req);
  if (supabase) {
    const rate = await checkRateLimit(supabase, 'chat', ip, CHAT_RATE_LIMIT);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({
        error: 'rate_limited',
        reply: 'נשלחו הרבה הודעות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות, או לפנות אלינו בוואטסאפ 055-6713828.',
      });
    }
  }

  // Honeypot only (the chat has no "time to fill" signal worth checking).
  if (body && typeof body.hp_website === 'string' && body.hp_website.trim() !== '') {
    return res.status(400).json({ error: 'bad_request', reply: FALLBACK_REPLY });
  }

  const contents = sanitizeHistory(body && body.messages);
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'No message.' });
  }

  if (supabase) await recordRateLimitEvent(supabase, 'chat', ip);

  const pageUrl = typeof body.page === 'string' && body.page.startsWith(SITE_URL) ? body.page.slice(0, 200) : '';
  const overrides = await getOverrides(supabase);
  const systemPrompt = buildSystemPrompt(buildCatalogText(overrides), pageUrl);
  try {
    const r = await callGeminiWithFallback({ apiKey, systemPrompt, contents });
    const reply = r.text || FALLBACK_REPLY;
    await saveConversation(supabase, { sessionId: body.session_id, contents, reply, failed: !r.text, page: pageUrl, ip });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chatbot: Gemini call failed:', err.message);
    await saveConversation(supabase, { sessionId: body.session_id, contents, reply: FALLBACK_REPLY, failed: true, page: pageUrl, ip });
    return res.status(502).json({ error: 'upstream', reply: FALLBACK_REPLY });
  }
}

module.exports = { handleChat, handleChatHealth, buildCatalogText, buildSystemPrompt, sanitizeHistory };
