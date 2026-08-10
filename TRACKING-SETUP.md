# תוספת: ביקורים באתר + ניסיונות תשלום בעמוד הניהול

## מה עשיתי
הוספתי שני טאבים חדשים לעמוד הניהול:

**"ביקורים באתר"** - כל טעינת דף אצל מבקר שאישר את הודעת העוגיות (יש כבר
פס עוגיות באתר - עכשיו הוא גם מפעיל מעקב, לא רק תצוגה). מוצג: עמוד,
מאיפה הגיע, כתובת IP, דפדפן, וזמן.

**"ניסיונות תשלום"** - כל לקוח שהגיע לשלב התשלום, כולל מי שביטל, נכשל לו
התשלום, או פשוט סגר את הדפדפן באמצע. עד עכשיו רק הזמנות שהושלמו נשמרו -
זה בדיוק הפער שביקשת לסגור. הרשומה נוצרת ברגע שהלקוח פותח את חלון
התשלום, ומתעדכנת לבד לפי תוצאת טרנזילה - גם אם הלקוח לא נשאר בעמוד.

שני הדברים נשמרים בשרת (Supabase), בדיוק כמו מוצרים, הזמנות, קופונים
ופניות.

## מה תצטרך לעשות

**שלב 1 - להריץ SQL חדש ב-Supabase:**
1. supabase.com/dashboard → הפרויקט שלך → **SQL Editor** → **New query**.
2. תדביק ותריץ (Run):

```sql
create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  path text,
  referrer text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table site_visits enable row level security;

create table if not exists order_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null unique,
  customer jsonb,
  items jsonb,
  subtotal numeric,
  discount numeric,
  shipping numeric,
  total numeric,
  status text not null default 'started',
  tranzila_response jsonb,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table order_attempts enable row level security;
```

**שלב 2 - להעלות את הזיפ הזה לוורסל (Redeploy).**

זהו. אחרי זה תראה שני טאבים חדשים בסיידבר: "ניסיונות תשלום" (ליד
"ניהול הזמנות") ו-"ביקורים באתר" (ליד "פניות").

## הערה חשובה לגבי פרטיות
מעקב הביקורים פועל **רק** אחרי שהמבקר אישר את פס העוגיות באתר (או
שכבר אישר בביקור קודם) - לא לפני. זה אומר שביקור ראשון של מישהו שעדיין
לא הספיק ללחוץ "אישור" לא יירשם. זו הבחירה הנכונה מבחינה חוקית (חוק
הגנת הפרטיות בישראל, וגם כדי לא לסתור את פס העוגיות הקיים באתר), אבל
חשוב שתדע שזו לא באמת "כל כניסה בלי יוצא מן הכלל" - היא כן תיתן לך
תמונה מלאה ואמינה של רוב התנועה בפועל, כי רוב המבקרים כן מאשרים.

ניסיונות התשלום, לעומת זאת, נרשמים תמיד - אין שם צורך בהסכמת עוגיות כי
זה חלק מתהליך הרכישה עצמו שהלקוח כבר יזם.
