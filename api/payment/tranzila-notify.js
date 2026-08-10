// Receives Tranzila's server-to-server "notify_url_address" callback -
// see TRANZILA-SETUP.md for the full picture.
//
// Tranzila POSTs the transaction result here directly from its own
// servers (not through the customer's browser), as a form-urlencoded
// body, right after a card charge is attempted from the iframe embedded
// in the checkout modal. This is a best-effort confirmation channel: the
// order itself is already saved by /api/orders once the customer's
// browser receives the success redirect (see payment-success.html), so a
// failure or delay here never blocks a real order from going through.
//
// IMPORTANT - NOT YET SIGNATURE-VERIFIED: Tranzila's basic notify
// callback isn't cryptographically signed, so right now this endpoint
// only logs what it receives (visible in Vercel's function logs) and
// forwards a copy to the business inbox as a courtesy - it does NOT
// write to the orders table or mark anything as paid on its own. Once
// you're set up on Tranzila and have real terminal credentials, this is
// the right place to add a server-side call back to Tranzila's
// transaction-lookup API to confirm the reported result before trusting
// it for anything more than a notification email.

const { sendEmail, escapeHtml, sanitizeEnvValue } = require('../_lib/mailer');
const { getSupabase } = require('../_lib/supabase');

function parseFormBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try {
        resolve(Object.fromEntries(new URLSearchParams(data)));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const fields = await parseFormBody(req);
  const success = fields.Response === '000';

  console.log('Tranzila notify callback received:', { success, fields });

  // Best-effort: mark the matching order_attempts row (correlated via the
  // custom "param" field we send Tranzila alongside the charge - see
  // buildTranzilaIframeSrc() in index.html) as success/failed, with the
  // raw response attached. This is what makes a declined or abandoned
  // payment show up in the admin panel's "ניסיונות תשלום" tab even if the
  // shopper's browser never sends its own status update (closed tab,
  // network hiccup, etc.) - Tranzila's own server-to-server callback
  // doesn't depend on the shopper still being there.
  const attemptId = fields.param;
  if (attemptId) {
    try {
      const supabase = getSupabase();
      await supabase
        .from('order_attempts')
        .update({
          status: success ? 'success' : 'failed',
          tranzila_response: fields,
          updated_at: new Date().toISOString(),
        })
        .eq('attempt_id', String(attemptId).slice(0, 100));
    } catch (err) {
      console.error('tranzila-notify: order_attempts update failed (non-fatal):', err.message);
    }
  }

  const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'rstyle.israel@gmail.com';
  const rowsHtml = Object.entries(fields)
    .map(([k, v]) => `<tr><td style="padding:2px 8px;color:#888;">${escapeHtml(k)}</td><td style="padding:2px 8px;">${escapeHtml(v)}</td></tr>`)
    .join('');

  // Best-effort only - a failed email here must never turn into a 5xx
  // back to Tranzila (Tranzila may retry the callback repeatedly otherwise).
  try {
    await sendEmail({
      to: notifyTo,
      subject: success ? 'טרנזילה: תשלום אושר' : 'טרנזילה: תשלום נכשל/בוטל',
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
          <h2 style="margin:0 0 10px;">${success ? 'עדכון תשלום מטרנזילה - אושר' : 'עדכון תשלום מטרנזילה - לא אושר'}</h2>
          <table style="border-collapse:collapse;">${rowsHtml}</table>
        </div>`,
    });
  } catch (err) {
    console.error('tranzila-notify: courtesy email failed:', err);
  }

  // Always acknowledge with 200 so Tranzila doesn't keep retrying.
  return res.status(200).send('OK');
};
