// Minimal GitHub Contents API client used to persist reservations as JSON
// files in this same repo — the same "GitHub-as-database" pattern js/updates.js
// already uses for reads, extended here with authenticated writes.
const REPO = 'Blueweyl/hype-district-plaridel';
const BRANCH = 'master';
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'hype-district-plaridel-api',
  };
}

async function getFile(path) {
  const res = await fetch(`${API_BASE}/${path}?ref=${BRANCH}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const data = await res.json();
  return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
}

// Writes without a `sha` are create-only — GitHub returns 422 if the file
// already exists, which is relied on as the hard double-booking guard.
async function putFile(path, contentObj, message, sha) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(contentObj, null, 2) + '\n').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  return fetch(`${API_BASE}/${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

module.exports = { getFile, putFile, REPO, BRANCH };
