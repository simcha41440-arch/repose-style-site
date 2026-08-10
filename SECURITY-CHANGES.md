# אבטחה: חסימת ניסיונות פריצה, הגנה מפני ספאם, ויומן פעילות

## מה עשיתי

**1. חסימת ניסיונות התחברות כושלים (Brute-force lockout)**
עמוד ההתחברות למנהל (`/admin`) עכשיו סופר ניסיונות כושלים לפי כתובת ה-IP.
אחרי 5 ניסיונות כושלים רצופים, אותו IP נחסם מלנסות שוב למשך 15 דקות,
עם הודעה ברורה כמה זמן נשאר. זה לא משפיע על כניסה תקינה שלך בכלל -
זה חוסם רק כתובת IP שכשלה שוב ושוב.

**2. הגנה מפני ספאם וסקריפטים בטפסים הציבוריים** (בלי שום שירות חיצוני,
כמו שביקשת - הכל בקוד עצמו):
- **הגבלת קצב (Rate limiting):** כל אחד מהטפסים הציבוריים (הזמנה, צור
  קשר, מיני-קשר בקופה, הרשמה לדיוור) מוגבל למספר שליחות סביר לכל IP כל
  10 דקות (8 הזמנות / 6 פניות / 5 הרשמות דיוור). זה מספיק והרבה יותר
  ממה שלקוח אמיתי צריך, אבל עוצר סקריפט שמנסה להציף את המסד נתונים או
  את תיבת המייל שלך.
- **מלכודת דבש (Honeypot) + בדיקת מהירות:** בכל טופס יש שדה מוסתר
  שאף משתמש אמיתי לא רואה או ממלא - בוטים שממלאים כל שדה בטופס נתפסים
  בו. בנוסף, אם הטופס נשלח פחות מ-1.5 שניות אחרי טעינת הדף (מהיר מדי
  לבן אדם אמיתי שקורא וממלא טופס), הבקשה נדחית. **חשוב:** בשום מקרה זה
  לא "בולע" הזמנה אמיתית בשקט - אם משהו נתפס (גם אם בטעות), הלקוח
  מקבל הודעת שגיאה ברורה ומתבקש לנסות שוב, ולא מסך "הצלחה" מזויף.

**3. יומן פעילות מנהל** - טאב חדש בעמוד הניהול בשם **"יומן פעילות"**,
שמראה:
- כל פעולה שביצעת בעמוד הניהול - התחברות, התנתקות, שינוי סטטוס הזמנה
  או פנייה, עדכון/מחיקת override של מוצר - כולל תאריך, שעה, וכתובת IP.
- רשימת ניסיונות התחברות כושלים אחרונים (כדי שתראה אם מישהו מנסה
  לפרוץ).

## מה שכבר היה טוב ולא נגעתי בו
בדקתי את הקוד הקיים - הבסיס כבר היה חזק: עוגיית סשן חתומה (HMAC) עם
`HttpOnly` + `Secure` + `SameSite=Strict` (לא ניתנת לגניבה/קריאה
מ-JavaScript זדוני וללא CSRF פשוט), השוואת סיסמה ב"זמן קבוע" (מונעת
ניחוש סיסמה לפי זמן תגובה), הרשאות RLS בסופאבייס שחוסמות גישה ישירה
מהדפדפן לכל הטבלאות (אפשר לגשת רק דרך השרת), ו-CSP + כותרות אבטחה
(`X-Frame-Options`, `HSTS` וכו') בכל הדפים. כל זה נשאר בדיוק כמו שהיה.

## מה תצטרך לעשות (שלב אחד, חד-פעמי)

**להריץ SQL חדש ב-Supabase:**
1. supabase.com/dashboard → הפרויקט שלך → **SQL Editor** → **New query**.
2. תדביק ותריץ (Run) את כל הבלוק הבא:

```sql
create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  username text,
  success boolean not null,
  created_at timestamptz not null default now()
);
alter table login_attempts enable row level security;
create index if not exists login_attempts_ip_created_idx on login_attempts (ip, created_at);

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text,
  details jsonb,
  ip text,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);

create table if not exists rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  ip text not null,
  created_at timestamptz not null default now()
);
alter table rate_limit_events enable row level security;
create index if not exists rate_limit_events_bucket_ip_created_idx on rate_limit_events (bucket, ip, created_at);
```

זהו - שום עוגיית סביבה (env var) חדשה לא נדרשת, ואין שום שירות חיצוני
נוסף. אחרי הרצת ה-SQL, פשוט להעלות את הזיפ הזה לוורסל (Redeploy).

## דברים שלא כלולים בשלב הזה (ואם תרצה, אפשר בהמשך)
- **2FA (קוד אימות נוסף) לכניסת המנהל** - דורש עוד עבודה ואולי אפליקציה
  כמו Google Authenticator.
- **CAPTCHA אמיתי (כמו Cloudflare Turnstile)** - ביקשת לוותר על שירות
  חיצוני, אז לא כללתי; ההגנה הנוכחית (honeypot + rate limit) עוצרת את
  רוב הבוטים הפשוטים אך לא בהכרח בוט מתוחכם שנכתב במיוחד נגד האתר הזה.
- **חסימת IP קבועה (בלאק-ליסט ידני)** - כרגע החסימה זמנית (15 דקות)
  ומתאפסת אוטומטית; אם תרצה חסימה קבועה של IP ספציפי, זה אפשרי להוסיף.
