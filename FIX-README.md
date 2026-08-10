# תוספת: פניות בעמוד הניהול (בלי תלות במייל)

## מה עשיתי
בעקבות הבקשה - הוספתי טאב חדש בעמוד הניהול בשם **"פניות"**. מעכשיו,
כל פנייה מטופס "צור קשר" או מטופס המיני-קשר בקופה **נשמרת ישירות
בשרת (Supabase)** - בדיוק כמו שהזמנות כבר נשמרות - ומופיעה מיד
בעמוד הניהול, **בלי שום תלות במייל בכלל**. גם אם המייל נכשל, ייכשל
בעתיד, או ש-Resend ישתבש - הפנייה עדיין תופיע לך בניהול, כי היא
ממש נשמרת במסד הנתונים, לא רק "מנסה להישלח".

המייל לעסק עדיין ינסה להישלח (best-effort, דרך Resend) בתור בונוס -
אבל הוא כבר לא הגורם היחיד שקובע אם אתה יודע על הפנייה.

## מה תצטרך לעשות (שני צעדים, קצת יותר מהפעם הקודמת אבל חד-פעמי)

**שלב 1 - להריץ SQL חדש ב-Supabase** (בדיוק כמו שעשית בפעם הקודמת):
1. supabase.com/dashboard → הפרויקט שלך → **SQL Editor** → **New query**.
2. תדביק ותריץ (Run):

```sql
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_id text not null unique,
  type text not null default 'contact',
  name text,
  phone text,
  email text,
  message text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table inquiries enable row level security;
```

**שלב 2 - להעלות את הזיפ הזה לוורסל (Redeploy).**

זהו. אחרי זה תראה טאב "פניות" חדש בסיידבר של עמוד הניהול, עם כל
הפניות, שם, טלפון, אימייל, הודעה, ותאריך - ותוכל לסמן אותן כ"טופלה"
כשענית ללקוח.
