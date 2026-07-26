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

// Built from data the SukiDesk app already has locally (never re-derived from
// the public repo's PII-free reservation file) — see api/update-reservation-status.js.
function reservationStatusEmail({ approve, fullName, serviceName, date, time }) {
  const when = `${formatDate(date)} at ${formatTime12h(time)}`;
  const name = fullName || 'there';

  if (approve) {
    return {
      subject: `You're booked! ${serviceName} — Hype District Plaridel`,
      html: `<p>Hi ${name},</p>
<p>We've verified your GCash payment — your reservation is <strong>confirmed</strong>:</p>
<ul><li><strong>${serviceName}</strong></li><li>${when}</li></ul>
<p>We'll see you then at Hype District Barbers, Plaridel.</p>`,
    };
  }

  return {
    subject: `We couldn't verify your GCash payment — Hype District Plaridel`,
    html: `<p>Hi ${name},</p>
<p>We weren't able to verify your GCash payment for this reservation request:</p>
<ul><li><strong>${serviceName}</strong></li><li>${when}</li></ul>
<p>This time slot has been released back for others to book. If you did send payment, please get in touch with us with your reference number and we'll sort it out, or feel free to submit a new booking request with a clearer screenshot.</p>`,
  };
}

module.exports = { sendEmail, reservationStatusEmail };
