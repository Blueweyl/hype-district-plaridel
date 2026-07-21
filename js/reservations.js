/* Reads content/reservations/*.json via the GitHub Contents API and renders
   them as a table — same no-backend pattern as js/updates.js. Only ever
   shows firstName + phoneLast4 per entry, matching what the webhook writes
   (see CLAUDE.md "Privacy") — never full name/phone/email. */

(function () {
  const REPO = 'Blueweyl/hype-district-plaridel';
  const BRANCH = 'master';
  const RESERVATIONS_PATH = 'content/reservations';

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00+08:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  }

  function formatTime12h(time) {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  async function loadReservations() {
    const container = document.querySelector('[data-reservations-list]');
    if (!container) return;

    try {
      const listRes = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${RESERVATIONS_PATH}?ref=${BRANCH}`
      );
      if (listRes.status === 404) {
        container.innerHTML = '<p style="color:var(--text-muted);">No reservations yet.</p>';
        return;
      }
      if (!listRes.ok) throw new Error(`GitHub API returned ${listRes.status}`);
      const files = await listRes.json();

      const jsonFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.json'));

      const entries = await Promise.all(
        jsonFiles.map(async (f) => {
          const res = await fetch(f.download_url);
          return res.json();
        })
      );

      entries.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

      if (!entries.length) {
        container.innerHTML = '<p style="color:var(--text-muted);">No reservations yet.</p>';
        return;
      }

      container.innerHTML = `
        <table class="reservations-table">
          <thead>
            <tr><th>Date</th><th>Time</th><th>Service</th><th>Name</th></tr>
          </thead>
          <tbody>
            ${entries
              .map(
                (r) => `
              <tr>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime12h(r.time)}</td>
                <td>${r.serviceName || ''}</td>
                <td>${r.firstName || ''} <span class="phone-last4">••${r.phoneLast4 || ''}</span></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--text-muted);">Couldn't load reservations right now. (${err.message})</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', loadReservations);
})();
