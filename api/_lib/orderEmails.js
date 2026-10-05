const { sendEmail, escapeHtml, sanitizeEnvValue } = require('./mailer');

function itemsTable(items) {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(it.qty)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${(Number(it.price) * Number(it.qty)).toLocaleString('he-IL')} ₪</td>
    </tr>`).join('');
  return `
    <table dir="rtl" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#f4efe6;">
          <th align="right" style="padding:6px 10px;">מוצר</th>
          <th align="center" style="padding:6px 10px;">כמות</th>
          <th align="right" style="padding:6px 10px;">מחיר</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Sends the "new order" alert to the business inbox, and (if the customer
// gave an email address) a confirmation to the customer. Both are fired at
// once and this never throws - the caller (api/orders.js) should call it
// AFTER the order is already saved in Supabase, and treat any failure here
// as a logged warning, not a reason to fail the order-creation request.
async function sendOrderNotificationEmails({ orderId, customer, items, total, notes }) {
  const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'simcha41440@gmail.com';

  const businessHtml = `
    <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
      <h2 style="margin:0 0 10px;">הזמנה חדשה מספר ${escapeHtml(orderId)}</h2>
      <p style="margin:0 0 6px;">
        <b>שם:</b> ${escapeHtml(customer.name)}<br>
        <b>טלפון:</b> ${escapeHtml(customer.phone)}${customer.phone2 ? ` / ${escapeHtml(customer.phone2)}` : ''}<br>
        <b>אימייל:</b> ${escapeHtml(customer.email || 'לא צוין')}<br>
        <b>כתובת:</b> ${escapeHtml(customer.address || '')}, ${escapeHtml(customer.city || '')} ${customer.zip ? escapeHtml(customer.zip) : ''}<br>
        <b>אופן משלוח:</b> ${escapeHtml(customer.shipping_method || 'לא צוין')}
      </p>
      ${itemsTable(items)}
      <p style="margin:14px 0 0;font-size:16px;"><b>סה"כ לתשלום:</b> ${Number(total).toLocaleString('he-IL')} ₪</p>
      ${notes ? `<p style="margin:10px 0 0;"><b>הערות:</b><br>${escapeHtml(notes).replace(/\n/g, '<br>')}</p>` : ''}
    </div>`;

  const tasks = [
    sendEmail({
      to: notifyTo,
      subject: `הזמנה חדשה #${orderId} - רפאוז סטייל`,
      html: businessHtml,
      replyTo: customer.email || undefined,
    }),
  ];

  if (customer.email) {
    const customerHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
        <p>שלום ${escapeHtml(customer.name)},</p>
        <p>תודה על ההזמנה שלך ברפאוז סטייל! הזמנה מספר <b>${escapeHtml(orderId)}</b> התקבלה בהצלחה ומעובדת אצלנו.</p>
        ${itemsTable(items)}
        <p style="margin:14px 0 0;font-size:16px;"><b>סה"כ לתשלום:</b> ${Number(total).toLocaleString('he-IL')} ₪</p>
        <p>נעדכן אותך כשההזמנה תישלח.</p>
        <p>תודה שקנית אצלנו,<br>צוות רפאוז סטייל</p>
      </div>`;
    tasks.push(
      sendEmail({
        to: customer.email,
        subject: `אישור הזמנה #${orderId} - רפאוז סטייל`,
        html: customerHtml,
      })
    );
  }

  const results = await Promise.all(tasks);
  if (!results[0].ok) {
    console.error(`Order ${orderId}: business notification email FAILED:`, results[0].error);
  }
  if (results[1] && !results[1].ok) {
    console.error(`Order ${orderId}: customer confirmation email FAILED:`, results[1].error);
  }
  return results;
}


// "Waiting for payment" alert: fired when a shopper filled in the checkout
// form and pressed pay while the Tranzila terminal is not connected yet.
// Carries every detail so the order can be completed by phone. Never throws.
async function sendPaymentPendingEmail({ attemptId, customer, items, subtotal, discount, shipping, total }) {
  try {
    const notifyTo = sanitizeEnvValue(process.env.ORDER_NOTIFY_EMAIL) || 'simcha41440@gmail.com';
    const c = customer || {};
    const list = Array.isArray(items) ? items : [];
    const rows = list.map((it) => {
      const extra = [
        it.size === 'single' ? 'סט יחיד' : '',
        it.color ? `צבע: ${it.color}` : '',
        it.embroidery ? `רקמה: ${it.embroidery}` : '',
      ].filter(Boolean).join(' | ');
      const line = it.price != null ? (Number(it.price) * Number(it.qty || 1)).toLocaleString('he-IL') + ' ₪' : '-';
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.name || it.id)}${extra ? `<br><span style="color:#888;font-size:12px;">${escapeHtml(extra)}</span>` : ''}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(it.qty)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${line}</td>
        </tr>`;
    }).join('');
    const money = (v) => (v != null ? Number(v).toLocaleString('he-IL') + ' ₪' : '-');
    const ref = String(attemptId || '').slice(-6).toUpperCase();

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#333;">
        <h2 style="margin:0 0 6px;">🛒 הזמנה ממתינה לתשלום (מס' פנייה ${escapeHtml(ref)})</h2>
        <p style="margin:0 0 12px;color:#8A6C2E;">הלקוח מילא את כל הפרטים ולחץ על תשלום, אבל התשלום המקוון עדיין לא פעיל - יש ליצור איתו קשר להשלמת התשלום.</p>
        <p style="margin:0 0 10px;">
          <b>שם:</b> ${escapeHtml(c.name || '')}<br>
          <b>טלפון:</b> ${escapeHtml(c.phone || '')}${c.phone2 ? ` / ${escapeHtml(c.phone2)}` : ''}<br>
          <b>אימייל:</b> ${escapeHtml(c.email || 'לא צוין')}<br>
          <b>כתובת:</b> ${escapeHtml(c.address || '')}, ${escapeHtml(c.city || '')} ${c.zip ? escapeHtml(c.zip) : ''}<br>
          <b>אופן משלוח:</b> ${escapeHtml(c.shipping_method || 'לא צוין')}
        </p>
        <table dir="rtl" style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead><tr style="background:#f4efe6;">
            <th align="right" style="padding:6px 10px;">מוצר</th>
            <th align="center" style="padding:6px 10px;">כמות</th>
            <th align="right" style="padding:6px 10px;">מחיר</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:12px 0 0;">
          סכום ביניים: ${money(subtotal)}${Number(discount) > 0 ? ` | הנחה: -${money(discount)}` : ''} | משלוח: ${money(shipping)}<br>
          <b style="font-size:16px;">סה"כ לתשלום: ${money(total)}</b>
        </p>
        ${c.coupon ? `<p style="margin:8px 0 0;"><b>קופון:</b> ${escapeHtml(c.coupon)}</p>` : ''}
        ${c.gift_message ? `<p style="margin:8px 0 0;"><b>ברכת גיפט קארד:</b> ${escapeHtml(c.gift_message)}</p>` : ''}
        ${c.notes ? `<p style="margin:8px 0 0;"><b>הערות:</b><br>${escapeHtml(c.notes).replace(/\n/g, '<br>')}</p>` : ''}
        <p style="margin:16px 0 0;color:#888;font-size:12px;">אפשר לראות את כל הפרטים גם בלוח הניהול ← "ניסיונות תשלום".</p>
      </div>`;

    const r = await sendEmail({
      to: notifyTo,
      subject: `הזמנה ממתינה לתשלום - ${c.name || 'לקוח'} - ${money(total)}`,
      html,
      replyTo: c.email || undefined,
    });
    if (!r.ok) console.error('Payment-pending notification email FAILED:', r.error);
  } catch (err) {
    console.error('Payment-pending notification email crashed (non-fatal):', err);
  }
}

module.exports = { sendOrderNotificationEmails, sendPaymentPendingEmail };
