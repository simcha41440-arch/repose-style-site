// Shared, no-external-service security helpers used across the admin and
// public-facing API routes:
//   - getClientIp:        best-effort real visitor IP behind Vercel's proxy
//   - checkLoginLockout / recordLoginAttempt: brute-force lockout for
//     /api/admin/login, backed by the `login_attempts` table
//   - logAdminAction:     writes to `admin_audit_log` (the admin panel's
//     "יומן פעילות" tab) so it's always visible who changed what and when
//   - checkRateLimit / recordRateLimitEvent: generic per-IP rate limiting
//     for public POST endpoints (orders, inquiries, newsletter), backed by
//     `rate_limit_events`
//   - looksLikeBot:       honeypot + submit-speed heuristic for the public
//     forms, with no third-party CAPTCHA involved
//
// All the DB-backed checks here "fail open" on a Supabase error (network
// hiccup, paused project, etc.) - a security *helper* going down should
// never be the thing that takes the storefront or the admin panel down.
// It only ever makes abuse slightly easier during an outage, never blocks
// a real customer or admin because the database had a bad moment.

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

// Looks at the most recent login attempts from this IP. If the last
// LOGIN_MAX_FAILURES in a row were all failures and the most recent one
// happened within LOGIN_LOCKOUT_MINUTES, the IP is locked out.
async function checkLoginLockout(supabase, ip) {
  try {
    const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('login_attempts')
      .select('created_at, success')
      .eq('ip', ip)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(LOGIN_MAX_FAILURES + 1);

    if (error || !data) return { locked: false };

    let consecutiveFailures = 0;
    let mostRecentFailureAt = null;
    for (const row of data) {
      if (row.success) break; // a success breaks the failure streak
      consecutiveFailures++;
      if (!mostRecentFailureAt) mostRecentFailureAt = row.created_at;
    }

    if (consecutiveFailures >= LOGIN_MAX_FAILURES && mostRecentFailureAt) {
      const unlockAt = new Date(mostRecentFailureAt).getTime() + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
      const remainingMs = unlockAt - Date.now();
      if (remainingMs > 0) {
        return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
      }
    }
    return { locked: false };
  } catch (err) {
    console.error('checkLoginLockout failed (failing open):', err.message);
    return { locked: false };
  }
}

async function recordLoginAttempt(supabase, ip, username, success) {
  try {
    await supabase.from('login_attempts').insert({ ip, username: username || null, success });
  } catch (err) {
    console.error('recordLoginAttempt failed (non-fatal):', err.message);
  }
}

async function logAdminAction(supabase, actor, action, target, details, ip) {
  try {
    await supabase.from('admin_audit_log').insert({
      actor: actor || 'unknown',
      action,
      target: target != null ? String(target) : null,
      details: details || null,
      ip: ip || null,
    });
  } catch (err) {
    console.error('logAdminAction failed (non-fatal):', err.message);
  }
}

// Generic per-IP rate limit check for a named bucket (e.g. 'order',
// 'inquiry', 'newsletter'). Counts events in the last windowMinutes and
// compares against max - does NOT itself record the current request
// (call recordRateLimitEvent separately once you decide to let it
// through) so a blocked request never resets its own cooldown clock.
async function checkRateLimit(supabase, bucket, ip, { max, windowMinutes }) {
  try {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('bucket', bucket)
      .eq('ip', ip)
      .gte('created_at', since);

    if (error) return { allowed: true };
    if ((count || 0) >= max) {
      return { allowed: false, retryAfterSeconds: windowMinutes * 60 };
    }
    return { allowed: true };
  } catch (err) {
    console.error('checkRateLimit failed (failing open):', err.message);
    return { allowed: true };
  }
}

async function recordRateLimitEvent(supabase, bucket, ip) {
  try {
    await supabase.from('rate_limit_events').insert({ bucket, ip });
  } catch (err) {
    console.error('recordRateLimitEvent failed (non-fatal):', err.message);
  }
}

// Bot heuristic for public forms, with no third-party CAPTCHA:
//   1) a hidden "hp_website" field real visitors never see or fill in -
//      most bots that auto-fill every field in a form trip it.
//   2) a "hp_ts" timestamp (the moment the page's script started
//      running) - genuine visitors need at least a couple of seconds to
//      read and fill a form; scripted submissions tend to fire almost
//      immediately.
// Either signal alone can occasionally be a false positive (a very fast
// human, a browser extension poking hidden fields), so callers should
// surface a normal, visible "please try again" error rather than a
// silent fake-success - never let this quietly swallow a real
// submission while telling the visitor it went through.
function looksLikeBot(body) {
  if (body && typeof body.hp_website === 'string' && body.hp_website.trim() !== '') {
    return true;
  }
  const ts = body && Number(body.hp_ts);
  if (ts && Date.now() - ts < 1500) {
    return true;
  }
  return false;
}

module.exports = {
  getClientIp,
  checkLoginLockout,
  recordLoginAttempt,
  logAdminAction,
  checkRateLimit,
  recordRateLimitEvent,
  looksLikeBot,
};
