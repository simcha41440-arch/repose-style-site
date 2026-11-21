// הגדרות משותפות לאתר, ל-API ולצינור האוטומטי.

export const SITE_NAME = "נייעס סטטוס";

// הקטגוריות ("ערוצים"). המפתח נשמר במסד הנתונים.
export const CATEGORIES = {
  general: "חדשות",
  politics: "פוליטי",
  community: "קהילה",
  torah: "עולם התורה",
  economy: "כסף וצרכנות",
  local: "בעיר",
  health: "בריאות",
  world: "עולם",
  tech: "טכנולוגיה",
  weather: "מזג אוויר",
};

export const CITIES = [
  "ירושלים", "בני ברק", "בית שמש", "מודיעין עילית", "ביתר עילית",
  "אלעד", "אשדוד", "חריש", "רכסים", "צפת", "טבריה", "נתיבות",
  "ערד", "פתח תקווה", "חיפה",
];

export const REACTIONS = ["❤️", "😍", "😂", "😮", "😢", "🙏", "👏", "🎉", "💯"];

export const MODEL = "claude-opus-5-5";
