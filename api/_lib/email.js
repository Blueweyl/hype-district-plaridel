// Minimal Resend REST client — raw fetch rather than their npm SDK, matching
// this repo's existing pattern (see _lib/paymongo.js, _lib/github.js) of not
// pulling in a client library just to wrap one HTTP call.
const API_BASE = 'https://api.resend.com';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured — skipping email send');
    return { skipped: true };
  }
  const from = process.env.RESEND_FROM_EMAIL || 'Hype District Barbers <onboarding@resend.dev>';

  try {
    const res = await fetch(`${API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Resend send failed', res.status, body);
      return { ok: false, error: body };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    console.error('Resend send error', err);
    return { ok: false, error: err.message };
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
}

function formatTime12h(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatPeso(amount) {
  return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shared letterhead/footer so every outgoing email (booking confirmations,
// GCash approve/reject, in-person checkout receipts) reads as coming from
// the shop, not a bare transactional message.
function emailShell(bodyHtml) {
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #222;">
  <div style="text-align:center; padding: 18px 0; border-bottom: 2px solid #c9a24b;">
    <div style="font-size: 22px; font-weight: bold;">Hype <span style="color:#c9a24b;">District</span></div>
    <div style="font-size: 12px; color:#777; letter-spacing: 1px; text-transform: uppercase;">Hype District Barbers — Plaridel</div>
  </div>
  <div style="padding: 20px 6px;">
    ${bodyHtml}
  </div>
  <div style="text-align:center; padding: 16px 0; border-top: 1px solid #ddd; font-size: 11px; color:#999;">
    <p style="margin:0;">Unit 19, GF Rocka Commercial Complex, Brgy. Tabang, Plaridel, Bulacan</p>
    <p style="margin:4px 0 0;">0991-008-9759</p>
  </div>
</div>`;
}

// Built from data the SukiDesk app already has locally (never re-derived from
// the public repo's PII-free reservation file) — see api/update-reservation-status.js.
// The 'approve' branch doubles as this booking's payment receipt.
function reservationStatusEmail({ approve, fullName, serviceName, date, time, price }) {
  const when = `${formatDate(date)} at ${formatTime12h(time)}`;
  const name = fullName || 'there';

  if (approve) {
    const priceRow = price != null
      ? `<tr><td style="padding-top:8px; border-top:1px solid #ccc; font-weight:bold;">Total Paid</td><td style="padding-top:8px; border-top:1px solid #ccc; text-align:right; font-weight:bold;">${formatPeso(price)}</td></tr>`
      : '';
    return {
      subject: `You're booked! ${serviceName} — Hype District Plaridel`,
      html: emailShell(`
<p>Hi ${name},</p>
<p>We've verified your GCash payment — your reservation is <strong>confirmed</strong>. Here's your receipt:</p>
<table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:14px;">
  <tr><td style="padding:4px 0;">${serviceName}</td><td style="padding:4px 0; text-align:right;">&nbsp;</td></tr>
  <tr><td style="padding:4px 0;">Appointment</td><td style="padding:4px 0; text-align:right;">${when}</td></tr>
  <tr><td style="padding:4px 0;">Payment method</td><td style="padding:4px 0; text-align:right;">GCash</td></tr>
  ${priceRow}
</table>
<p>We'll see you then!</p>`),
    };
  }

  return {
    subject: `We couldn't verify your GCash payment — Hype District Plaridel`,
    html: emailShell(`
<p>Hi ${name},</p>
<p>We weren't able to verify your GCash payment for this reservation request:</p>
<ul><li><strong>${serviceName}</strong></li><li>${when}</li></ul>
<p>This time slot has been released back for others to book. If you did send payment, please get in touch with us with your reference number and we'll sort it out, or feel free to submit a new booking request with a clearer screenshot.</p>`),
  };
}

// Card (Stripe) receipt — sent right after the webhook confirms payment,
// since there's no separate staff approval step for card payments the way
// there is for GCash manual transfers.
function paymentReceiptEmail({ fullName, serviceName, date, time, price, paymentMethod }) {
  const when = `${formatDate(date)} at ${formatTime12h(time)}`;
  const name = fullName || 'there';
  return {
    subject: `Your receipt — Hype District Plaridel`,
    html: emailShell(`
<p>Hi ${name},</p>
<p>Thanks for booking with us! Here's your receipt:</p>
<table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:14px;">
  <tr><td style="padding:4px 0;">${serviceName}</td><td style="padding:4px 0; text-align:right;">&nbsp;</td></tr>
  <tr><td style="padding:4px 0;">Appointment</td><td style="padding:4px 0; text-align:right;">${when}</td></tr>
  <tr><td style="padding:4px 0;">Payment method</td><td style="padding:4px 0; text-align:right;">${paymentMethod}</td></tr>
  <tr><td style="padding-top:8px; border-top:1px solid #ccc; font-weight:bold;">Total Paid</td><td style="padding-top:8px; border-top:1px solid #ccc; text-align:right; font-weight:bold;">${formatPeso(price)}</td></tr>
</table>
<p>We'll see you then!</p>`),
  };
}

// In-person SukiDesk checkout receipt — unlike the online flows above, this
// one has real per-item prices (checkoutCart), so it itemizes properly.
function checkoutReceiptEmail({ fullName, items, total, paymentMethod, staffName }) {
  const name = fullName || 'there';
  const rows = (items || [])
    .map((i) => `<tr><td style="padding:4px 0;">${i.name}</td><td style="padding:4px 0; text-align:right;">${formatPeso(i.price)}</td></tr>`)
    .join('');
  return {
    subject: `Your receipt — Hype District Plaridel`,
    html: emailShell(`
<p>Hi ${name},</p>
<p>Thanks for visiting Hype District Barbers — Plaridel! Here's your receipt:</p>
<table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:14px;">
  ${rows}
  <tr><td style="padding-top:8px; border-top:1px solid #ccc; font-weight:bold;">Total</td><td style="padding-top:8px; border-top:1px solid #ccc; text-align:right; font-weight:bold;">${formatPeso(total)}</td></tr>
</table>
<p style="font-size:13px; color:#555;">
  Payment method: ${paymentMethod}${staffName ? `<br>Served by: ${staffName}` : ''}
</p>
<p>See you again soon!</p>`),
  };
}

module.exports = { sendEmail, reservationStatusEmail, paymentReceiptEmail, checkoutReceiptEmail };
