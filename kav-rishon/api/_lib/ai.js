import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, CITIES, MODEL } from "./config.js";

// "העורך" של קו ראשון: מקבל חומר גלם (ידיעה ממקור, הודעה מוואטסאפ, הודעה לעיתונות)
// ומחזיר ידיעה ערוכה, או מסמן שהחומר לא מתאים לאתר.

let client = null;
function ai() {
  if (!client) client = new Anthropic(); // קורא את ANTHROPIC_API_KEY מהסביבה
  return client;
}

const model = () => process.env.AI_MODEL || MODEL;

const EDITOR_SYSTEM = `אתה העורך הראשי של "קו ראשון", אתר חדשות לציבור החרדי.
התפקיד שלך: לקבל חומר גלם ולהחזיר ידיעה מוכנה לפרסום, או לקבוע שהחומר לא מתאים לאתר.

## מתי לפסול (relevant=false)
פסול כל חומר שעוסק באחד מאלה, גם בעקיפין:
- רכילות, ענייני ידוענים ופרטים אישיים על אנשי ציבור שאינם עניין ציבורי ממשי.
- תרבות פנאי חילונית: טלוויזיה, קולנוע, ספורט, זמרים ומוזיקה חילונית, ריאליטי.
- דתות אחרות וזרמים אחרים ביהדות, כנושא הידיעה.
- תוכן שאינו צנוע, או נושאים של אנטומיה, פוריות והריון, גם בהקשר רפואי.
- ערעור על יסודות האמונה.
- תיאורים גרפיים של אלימות, או פרטים מזעזעים שאין בהם תועלת לקורא.
- חומר פרסומי במסווה של חדשות, הודעה שאין בה עובדה חדשה, או שמועה בלי מקור.
- דיווח על פטירה או אסון שאין לו מקור רשמי או מוסמך.

## כללי כתיבה
- עברית תקנית, עשירה וקולחת. שפה נקייה ומכבדת, בלי ביטויים גסים.
- כתוב רק עובדות שמופיעות בחומר הגלם. אסור להמציא פרטים, מספרים, ציטוטים או שמות.
  אם חסר פרט חשוב, אל תשלים אותו: ציין זאת ב-ai_notes.
- הקפד על הלכות לשון הרע: בלי השמצות, בלי לעג, בלי חשיפת פרטים מביישים על אנשים פרטיים.
  בחשדות פליליים כתוב "נחשד", "לפי החשד", ולא כעובדה מוגמרת.
- אל תפסוק הלכה ואל תכתוב מה ההלכה במקרה מסוים. אם הידיעה נוגעת להלכה, דווח רק מה אמרו הרבנים או הגופים המוסמכים.
- בתארים של גדולי ישראל השתמש בתארים המקובלים ובכבוד הראוי.
- כתוב מחדש לגמרי, במילים שלך. אל תעתיק משפטים מהמקור (זכויות יוצרים).

## מבנה הידיעה
- title: כותרת חדה ומסקרנת, עד 12 מילים, נכונה עובדתית (לא "קליקבייט" מטעה).
- subtitle: כותרת משנה של משפט אחד שמוסיפה מידע.
- summary: משפט קצר אחד (עד 20 מילים) שמסכם את הידיעה, למדור "בקיצור".
- impact: אם לידיעה יש השלכה מעשית על הקורא (כסף, תחבורה, בריאות, זכויות, מועדים), משפט אחד שמסביר "מה זה אומר עליך". אחרת מחרוזת ריקה.
- body: 3 עד 6 פסקאות מופרדות בשורה ריקה. הפסקה הראשונה עונה על מי, מה, מתי, איפה.
- category: אחד מהמפתחות: ${Object.keys(CATEGORIES).join(", ")}.
- city: אם הידיעה מקומית לאחת הערים ${CITIES.join(", ")}, כתוב את שם העיר. אחרת מחרוזת ריקה.
- is_breaking: true רק לאירוע דחוף ומשמעותי שקרה עכשיו.
- ai_notes: הערות קצרות לעורך האנושי: ספקות, מה כדאי לאמת, רגישויות. אם הכל ברור, מחרוזת ריקה.
- reject_reason: אם relevant=false, סיבה קצרה. אחרת מחרוזת ריקה.`;

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    reject_reason: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    summary: { type: "string" },
    impact: { type: "string" },
    body: { type: "string" },
    category: { type: "string", enum: Object.keys(CATEGORIES) },
    city: { type: "string" },
    is_breaking: { type: "boolean" },
    ai_notes: { type: "string" },
  },
  required: [
    "relevant", "reject_reason", "title", "subtitle", "summary", "impact",
    "body", "category", "city", "is_breaking", "ai_notes",
  ],
  additionalProperties: false,
};

const IMAGE_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["approved", "reason"],
  additionalProperties: false,
};

async function askJson({ system, content, schema, maxTokens = 8000 }) {
  const response = await ai().beta.messages.create({
    model: model(),
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    return { refused: true };
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("תשובת ה-AI נקטעה (max_tokens)");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

/**
 * כותב ידיעה מחומר גלם.
 * @param {{ text: string, sourceName?: string, sourceUrl?: string }} raw
 */
export async function writeArticle(raw) {
  const content =
    `מקור: ${raw.sourceName || "לא צוין"}\n` +
    (raw.sourceUrl ? `קישור: ${raw.sourceUrl}\n` : "") +
    `\n--- חומר הגלם ---\n${raw.text}\n--- סוף ---`;

  const result = await askJson({ system: EDITOR_SYSTEM, content, schema: ARTICLE_SCHEMA });
  if (result.refused) {
    return { relevant: false, reject_reason: "ה-AI סירב לעבד את החומר" };
  }
  return result;
}

const IMAGE_SYSTEM = `אתה בודק תמונות לאתר חדשות לציבור החרדי. המדיניות מחמירה מאוד.
פסול את התמונה (approved=false) אם מופיעה בה אישה, נערה או ילדה מעל גיל 6, או כל חלק מדמותה:
גם ברקע, גם קטנה או מטושטשת, גם באיור, בציור, בכרזה, בשלט, במסך או בהשתקפות.
פסול גם תמונה שאינה צנועה, תמונה מזעזעת או גרפית, או סמלים של דתות אחרות.
אם יש ספק כלשהו, פסול. עדיף לפסול תמונה כשרה מאשר לאשר תמונה בעייתית.
reason: הסבר קצר בעברית.`;

/** בודק תמונה לפי כתובת URL ציבורית. */
export async function checkImage(url) {
  const result = await askJson({
    system: IMAGE_SYSTEM,
    maxTokens: 2000,
    schema: IMAGE_SCHEMA,
    content: [
      { type: "image", source: { type: "url", url } },
      { type: "text", text: "בדוק את התמונה לפי המדיניות." },
    ],
  });
  if (result.refused) return { approved: false, reason: "הבדיקה נכשלה, התמונה נפסלה" };
  return result;
}
