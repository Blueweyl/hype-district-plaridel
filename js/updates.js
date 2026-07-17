/* Fetches update entries from content/updates/*.json via the GitHub API
   and renders them as embedded social posts (or simple cards as a fallback
   when no post link was pasted in). No backend needed — GitHub is the store. */

const REPO = 'Blueweyl/hype-district-plaridel';
const BRANCH = 'master';
const UPDATES_PATH = 'content/updates';

function loadScriptOnce(id, src) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.async = true;
  s.defer = true;
  s.src = src;
  document.body.appendChild(s);
}

function ensureFacebookSdk() {
  if (!document.getElementById('fb-root')) {
    const root = document.createElement('div');
    root.id = 'fb-root';
    document.body.prepend(root);
  }
  loadScriptOnce('facebook-jssdk', 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v19.0');
}

function reprocessEmbeds() {
  if (window.FB && window.FB.XFBML) window.FB.XFBML.parse();
  if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();

  // TikTok's widget script re-scans the DOM for unprocessed blockquotes
  // every time it loads, so re-inject a fresh copy to pick up new embeds.
  const old = document.getElementById('tiktok-embed-script');
  if (old) old.remove();
  const s = document.createElement('script');
  s.id = 'tiktok-embed-script';
  s.async = true;
  s.src = 'https://www.tiktok.com/embed.js';
  document.body.appendChild(s);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function platformLabel(p) {
  return { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }[p] || p;
}

function buildEmbedHtml(entry) {
  const link = (entry.link || '').trim();
  if (link && entry.platform === 'facebook') {
    ensureFacebookSdk();
    return `<div class="fb-post" data-href="${link}" data-width="500" data-show-text="true"></div>`;
  }
  if (link && entry.platform === 'instagram') {
    loadScriptOnce('instagram-embed-script', 'https://www.instagram.com/embed.js');
    return `<blockquote class="instagram-media" data-instgrm-permalink="${link}" data-instgrm-version="14" style="margin:0; width:100%;"></blockquote>`;
  }
  if (link && entry.platform === 'tiktok') {
    return `<blockquote class="tiktok-embed" cite="${link}" style="max-width: 100%; min-width: 280px;"><section></section></blockquote>`;
  }
  return null;
}

function buildFallbackCard(entry) {
  const img = entry.image
    ? `<img src="${entry.image}" alt="${entry.title || ''}" style="width:100%; border-radius:var(--radius); margin-bottom:16px;">`
    : `<div class="ph wide" data-label="${platformLabel(entry.platform)} update"></div>`;
  return `${img}
    <h3 style="margin-top:16px;">${entry.title || ''}</h3>
    ${entry.link ? `<a href="${entry.link}" target="_blank" rel="noopener" class="btn btn-outline" style="margin-top:12px;">View on ${platformLabel(entry.platform)}</a>` : ''}`;
}

async function loadUpdates(containerSelector, limit) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  try {
    const listRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${UPDATES_PATH}?ref=${BRANCH}`
    );
    if (!listRes.ok) throw new Error(`GitHub API returned ${listRes.status}`);
    const files = await listRes.json();

    const jsonFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.json'));

    const entries = await Promise.all(
      jsonFiles.map(async (f) => {
        const res = await fetch(f.download_url);
        const data = await res.json();
        return data;
      })
    );

    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    const shown = limit ? entries.slice(0, limit) : entries;

    if (!shown.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">No updates posted yet — check back soon.</p>';
      return;
    }

    container.innerHTML = shown
      .map((entry) => {
        const embed = buildEmbedHtml(entry);
        return `
        <div class="testimonial-card update-card">
          <div class="update-meta">
            <span class="service-price">${platformLabel(entry.platform)}</span>
            <span style="color:var(--text-muted); font-size:0.85rem;">${formatDate(entry.date)}</span>
          </div>
          ${embed ? `<div class="update-embed">${embed}</div>` : buildFallbackCard(entry)}
          ${embed && entry.title ? `<p style="color:var(--text-muted); margin-top:14px;">${entry.title}</p>` : ''}
        </div>`;
      })
      .join('');

    reprocessEmbeds();
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted);">Couldn't load updates right now. (${err.message})</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const full = document.querySelector('[data-updates-full]');
  const teaser = document.querySelector('[data-updates-teaser]');
  if (full) loadUpdates('[data-updates-full]');
  if (teaser) loadUpdates('[data-updates-teaser]', 3);
});
