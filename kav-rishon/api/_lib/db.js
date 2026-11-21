import { createClient } from "@supabase/supabase-js";

let client = null;

export function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("חסרים SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// כתובת קצרה וייחודית לידיעה: תאריך + מזהה אקראי קצר.
// (כתובות בעברית נשברות בשיתוף בוואטסאפ ובסינונים, לכן לא משתמשים בכותרת.)
export function makeSlug() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${rand}`;
}

// השדות שמותר לחשוף לגולשים.
export const PUBLIC_FIELDS =
  "slug,title,subtitle,summary,impact,body,category,city,is_breaking,source_name,source_url,image_url,views,published_at";
