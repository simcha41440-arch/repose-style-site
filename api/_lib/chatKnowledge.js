// Knowledge base for the site's AI chat assistant (api/_lib/chatbot.js).
//
// IMPORTANT: CATALOG mirrors the PRODUCTS / TOWELS_DATA / PERFUME_DATA /
// SCENTS_DATA arrays in index.html (and BASE_CATALOG in pricing.js). When a
// product is added/removed there, update it here too. Price changes, sale
// prices, out-of-stock flags and deleted products made in the admin panel
// are picked up automatically at request time from Supabase's
// product_overrides table - no need to touch this file for those.

const SITE_URL = 'https://reposestyle.com';

const CATALOG = [
  { id: "prachim", name: "אביב", nameEn: "AVIV", price: 1080, type: "bedding", collection: "Bloom", cotton: 100, thread: 400, tag: "רב מכר" },
  { id: "simfonia", name: "סימפוניה", nameEn: "SIMFONIA", price: 700, type: "bedding", collection: "Heritage", cotton: 50, thread: 250 },
  { id: "rakefet", name: "רקפת", nameEn: "RAKEFET", price: 890, type: "bedding", collection: "Bloom", cotton: 100, thread: 400 },
  { id: "yahalom", name: "יהלום", nameEn: "YAHALOM", price: 1490, type: "bedding", collection: "Renaissance", cotton: 100, thread: 400, embroidery: "free", tag: "פרימיום" },
  { id: "london", name: "לונדון", nameEn: "LONDON", price: 690, type: "bedding", collection: "Renaissance", cotton: 100, thread: 400, embroidery: "paid" },
  { id: "royal", name: "רויאל", nameEn: "ROYAL", price: 1190, type: "bedding", collection: "Renaissance", cotton: 100, thread: 400 },
  { id: "star", name: "סטאר", nameEn: "STAR", price: 680, type: "bedding", collection: "Heritage", cotton: 50, thread: 250 },
  { id: "okeanos", name: "אוקיינוס", nameEn: "OKEANOS", price: 590, type: "bedding", collection: "Heritage", cotton: 50, thread: 250 },
  { id: "classic", name: "קלאסיק", nameEn: "CLASSIC", price: 665, type: "bedding", collection: "Heritage", cotton: 50, thread: 250 },
  { id: "aviv", name: "סימפוניה פרימיום", nameEn: "SIMFONIA PREMIUM", price: 1080, type: "bedding", collection: "Renaissance", cotton: 100, thread: 400 },
  { id: "simfonia-premium", name: "פוקסיה", nameEn: "FUCHSIA", price: 1000, type: "bedding", collection: "Bloom", cotton: 100, thread: 400 },
  { id: "elegantia", name: "מלודיה", nameEn: "MELODY", price: 700, type: "bedding", collection: "Heritage", cotton: 50, thread: 250 },
  { id: "towel-hand-premium", name: "מגבת פילדלפיה", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["שמנת", "טאופ", "ורוד עתיק", "מוקה"], type: "towel" },
  { id: "towel-bath-classic", name: "מגבת שוהם", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["שמנת", "בז'", "אפור", "כחול"], type: "towel" },
  { id: "towel-body-boutique", name: "מגבת מילאנו", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "טאופ", "אפור", "מנטה", "אפרסק", "מוקה"], type: "towel" },
  { id: "towel-natali", name: "מגבת נטלי", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן"], type: "towel" },
  { id: "towel-avishag", name: "מגבת אבישג", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "ורוד עתיק"], type: "towel" },
  { id: "towel-venezia", name: "מגבת ונציה", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "טאופ", "ורוד עתיק", "סגול עתיק", "ירוק מרווה"], type: "towel" },
  { id: "towel-oriya", name: "מגבת אוריה", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "בז'"], type: "towel" },
  { id: "towel-liya", name: "מגבת ליה", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "ורוד עתיק"], type: "towel" },
  { id: "towel-iziva", name: "מגבת איביזה", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "בז'", "ורוד עתיק", "סגול", "ירוק מרווה", "זית"], type: "towel" },
  { id: "towel-tenerife", name: "מגבת טנריף", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["ירוק מרווה"], type: "towel" },
  { id: "towel-liam", name: "מגבת ליאם", price: 25, priceRange: "25–85", sizes: "ידיים 30/50 – 25 ₪, פנים 50/90 – 42 ₪, גוף 70/130 – 85 ₪", colors: ["לבן", "שמנת", "ורוד עתיק"], type: "towel" },
  { id: "perfume-white", name: "מכשיר בישום דגם בייסיק", price: 339, type: "diffuser", features: ["גוף לבן חלק בפינות מעוגלות","פרופיל דק שמתאים לקיר או למדף","מראה מינימליסטי שלא מושך תשומת לב","הדגם המשתלם בסדרה"] },
  { id: "perfume-gold", name: "מכשיר בישום גולד דגם A300", price: 449, type: "diffuser", colors: ["לבן","שחור"], features: ["גוף בלבן מבריק או בשחור אלגנטי (לבחירתכם), עם מסגרת מתכתית בגוון זהב","כפתור הפעלה בחלקו העליון","קו נקי שמשתלב בסלון, בחדר שינה ובלובי","מתאים גם כמתנה מעוצבת לבית"] },
  { id: "perfume-graphite", name: "מכשיר בישום גרפיט חכם דגם A400", price: 539, type: "diffuser", colors: ["גרפיט","לבן"], features: ["גימור גרפיט מתכתי עם פאנל קדמי שחור","חיבור לאפליקציה באמצעות סריקת קוד QR שעל המכשיר","עיצוב עכשווי שמתאים לחללים מודרניים ומוקפדים","הדגם המתקדם בסדרה"] },
  { id: "scent-holyland", name: "הולילנד", price: 169, type: "scent" },
  { id: "scent-miami", name: "מיאמי", price: 169, type: "scent" },
  { id: "scent-spring", name: "ספרינג", price: 169, type: "scent" },
  { id: "scent-newyork", name: "ניו יורק", price: 169, type: "scent" },
  { id: "scent-paris", name: "פריז", price: 169, type: "scent" },
  { id: "scent-lacoste", name: "לקוסט", price: 169, type: "scent" },
  { id: "scent-tea-time", name: "תה טיים", price: 169, type: "scent" },
  { id: "scent-royal-beach", name: "רויאל ביץ", price: 169, type: "scent" },
  { id: "scent-olympia", name: "אולימפיה", price: 169, type: "scent" },
  { id: "scent-delta", name: "דלתא", price: 169, type: "scent" },
  { id: "scent-boutique-hotel", name: "מלון בוטיק", price: 169, type: "scent" },
  { id: "scent-nautica-home", name: "נאוטיקה הום", price: 169, type: "scent" },
  { id: "scent-jasmine", name: "יסמין", price: 169, type: "scent" },
  { id: "scent-black-jasmine", name: "בלאק יסמין", price: 169, type: "scent" },
  { id: "scent-luxury-spa", name: "ספא יוקרתי", price: 169, type: "scent" },
  { id: "scent-karamim", name: "כרמים", price: 169, type: "scent" },
  { id: "scent-bereshit", name: "בראשית", price: 169, type: "scent" },
  { id: "scent-patal", name: "פתאל", price: 169, type: "scent" },
  { id: "scent-blue-chanel", name: "בלו שאנל", price: 169, type: "scent" },
  { id: "scent-london", name: "לונדון", price: 169, type: "scent" },
  { id: "scent-pink-lotus", name: "פינק לוטוס", price: 169, type: "scent" },
  { id: "scent-abercrombie", name: "אמרקומבי", price: 169, type: "scent" },
  { id: "scent-my-secret", name: "My secret", price: 169, type: "scent" },
  { id: "scent-testers-6", name: "מארז 6 טסטרים", price: 39, type: "tester" },
];

// Static store information, taken from the about / shipping / FAQ pages.
const STORE_INFO = `
שם העסק: רפאוז סטייל (Repose Style) - חנות אונליין למצעים יוקרתיים, מגבות, מכשירי בישום וניחוחות לבית.
הסלוגן: "הרגשה של בית מלון בבית שלכם".
כתובת: אלפנדרי 20, ירושלים.
טלפון / וואטסאפ: 055-6713828.
דוא"ל: rstyle.israel@gmail.com.

קולקציות מצעים:
- Renaissance ו-Bloom: 100% כותנה, אריגת סאטן, צפיפות של עד 400 חוט לאינצ'.
- Heritage: 50% כותנה, אריגת סאטן, 250 חוט לאינצ'.
- עמודי הקולקציות: ${SITE_URL}/shop/renaissance , ${SITE_URL}/shop/bloom , ${SITE_URL}/shop/heritage

מה כולל סט מצעים (המחיר המוצג באתר הוא ל"זוג יחידים"):
- 2 סדינים עם גומי מלא 90/200/30 ס"מ
- 2 ציפות לשמיכה יחיד 150/200 ס"מ
- 2 ציפיות לכרית מדוגמות + 2 ציפיות לכרית חלקות
- אפשר לבחור בעמוד המוצר גם "סט יחיד" (חצי מהכמויות) - במחיר של חצי מהמחיר המלא, מעוגל.

רקמת ראשי תיבות: בדגמים "לונדון" ו"יהלום" אפשר להוסיף רקמת ראשי תיבות בעמוד המוצר. בלונדון התוספת היא 200 ₪, ביהלום הרקמה כלולה במחיר (עד 2 אותיות).

מגבות: 100% כותנה, 600 גרם למ"ר. כל דגם מגבת מגיע בשלוש מידות לבחירה בעמוד המוצר: מגבת ידיים 30/50 ס"מ – 25 ₪, מגבת פנים 50/90 ס"מ – 42 ₪, מגבת גוף 70/130 ס"מ – 85 ₪. עמוד המגבות: ${SITE_URL}/towels
מכשירי בישום: עמוד ${SITE_URL}/perfume . ניחוחות לבית: עמוד ${SITE_URL}/scents . בקבוקי ניחוח הם בנפח חצי ליטר, 169 ₪ לבקבוק. יש גם מארז 6 טסטרים להתנסות ב-39 ₪.

כביסה וטיפול במצעים: כביסה במים פושרים עד 40 מעלות, בתוכנית עדינה, ללא הלבנה. ייבוש בטמפרטורה נמוכה או תלייה בצל.

משלוחים: שליח עד הבית, 3-7 ימי עסקים מרגע אישור ההזמנה. לאחר המשלוח נשלח מספר מעקב.
דמי משלוח: 29 ₪. משלוח חינם בהזמנה מעל 299 ₪.
החזרות והחלפות: עד 14 יום מקבלת המוצר, בתנאי שלא נעשה בו שימוש והאריזה המקורית נשמרה. מתאמים בטלפון או בדוא"ל.
זיכוי כספי: לאמצעי התשלום המקורי, תוך עד 14 ימי עסקים מקבלת המוצר המוחזר ובדיקתו.
תשלום: בעמוד סליקה מאובטח ומוצפן של טרנזילה (Tranzila). האתר לא שומר ולא נחשף לפרטי כרטיס האשראי.
מבצע מתנה: בכל רכישה מעל 500 ₪ מקבלים במתנה מארז ריחניות מעוצב. אין לציין ניחוח מסוים. לפרטים נוספים על המתנה - להפנות לטלפון/וואטסאפ.
קופונים: ניתן להזין קוד קופון בעמוד התשלום (אם יש ללקוח קוד).

עמודים שימושיים: חנות ${SITE_URL}/shop , מבצעים ${SITE_URL}/sale , משלוחים והחזרות ${SITE_URL}/shipping , שאלות נפוצות ${SITE_URL}/faq , צור קשר ${SITE_URL}/contact , אודות ${SITE_URL}/about , האזור האישי ${SITE_URL}/account
עמוד מוצר: ${SITE_URL}/product/<id> (לפי ה-id שברשימת המוצרים).
`;

module.exports = { CATALOG, STORE_INFO, SITE_URL };
