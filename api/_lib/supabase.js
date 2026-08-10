const { createClient } = require('@supabase/supabase-js');

let client;

function sanitizeEnvValue(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function getSupabase() {
  if (!client) {
    const url = sanitizeEnvValue(process.env.SUPABASE_URL);
    const key = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (!url || !key) {
      throw new Error(
        'Supabase environment variables are not set (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Add them in Vercel > Project Settings > Environment Variables for the Production environment, then redeploy.'
      );
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new Error(
        `SUPABASE_URL is not a valid URL ("${url}"). It should look like https://YOUR-PROJECT.supabase.co with no quotes or extra spaces.`
      );
    }
    if (!/\.supabase\.co$/i.test(parsed.hostname)) {
      throw new Error(
        `SUPABASE_URL ("${url}") does not look like a Supabase project URL (expected something ending in .supabase.co). Check Project Settings > API in the Supabase dashboard and copy the URL again.`
      );
    }

    client = createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  return client;
}

function friendlyNetworkError(rawMessage, cause) {
  const causeText = cause && cause.message ? ` (${cause.message})` : '';
  return {
    message:
      `Could not reach Supabase${causeText}. This almost always means either the ` +
      `Supabase project is paused (free-tier projects pause after a week of ` +
      `inactivity - open the Supabase dashboard and click "Restore/Resume"), or ` +
      `SUPABASE_URL is wrong, or Vercel cannot reach Supabase from this region. ` +
      `Original error: ${rawMessage}`,
  };
}

// supabase-js does NOT always throw on a network failure - the
// postgrest client frequently catches the fetch error internally and
// just resolves with { data: null, error: { message: 'TypeError: fetch
// failed' } }, same shape as a normal query error. So we have to check
// BOTH: a thrown/rejected promise, and a normally-resolved result whose
// error field says the same thing.
async function withFriendlyError(promise) {
  let result;
  try {
    result = await promise;
  } catch (err) {
    if (err && /fetch failed/i.test(err.message)) {
      return { data: null, error: friendlyNetworkError(err.message, err.cause) };
    }
    throw err;
  }

  if (result && result.error && /fetch failed/i.test(result.error.message || '')) {
    return {
      ...result,
      data: null,
      error: friendlyNetworkError(result.error.message, result.error.cause),
    };
  }

  return result;
}

module.exports = { getSupabase, withFriendlyError };
