# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static marketing website for Hype District Barbers' Plaridel branch (a barbershop). Plain HTML/CSS/JS — no build step, no bundler, no framework. The site itself deploys as "serve the files as-is" on GitHub Pages (`https://blueweyl.github.io/hype-district-plaridel/`). The only server-side code is a small set of Vercel serverless functions under `api/` that power real online reservations + credit card payment (see "Online reservations" below) — everything else on the site remains pure static files with no backend.

## Running / previewing

There is no build or dev-server command. Open the HTML files directly in a browser, or serve the directory with any static file server, e.g.:

```
npx serve .
```

There is no lint or test suite configured. The `api/` serverless functions have a root `package.json` (only `stripe` as a dependency) — that's purely for the separate Vercel deploy described below and has no effect on the static site or GitHub Pages.

## Architecture

### Pages are independent, hand-duplicated HTML files

`index.html`, `services.html`, `reserve.html`, `gallery.html`, `about.html`, `contact.html`, `updates.html` each contain a full copy of the `<header class="site-header">` nav and `<footer class="site-footer">` markup — there is no templating/includes system. When changing the nav, footer, phone numbers, address, or social links, **update all seven HTML files**, not just one. Every "Book Now"/"Book Appointment" CTA sitewide links to `reserve.html`; `contact.html` is kept separate for general (non-booking) inquiries only.

### Styling

Single stylesheet at `css/style.css`, driven by CSS custom properties defined in `:root` (colors, radius, max width). Follow the existing token names (`--gold`, `--text-muted`, `--bg-panel`, etc.) rather than hardcoding new colors.

Placeholder photography uses a `.ph` (placeholder) div convention instead of real `<img>` tags, e.g.:
```html
<div class="ph tall" data-label="Barber at work / haircut in progress"></div>
```
`.ph` renders a styled box with the `data-label` text shown via `::after`. Modifier classes (`.tall`, `.square`, `.wide`, `.hero`) control aspect ratio. Replace these with real `<img>` tags as photos become available — don't remove the pattern for pages still awaiting images.

### `js/script.js` — page chrome behavior

Runs on every page: mobile nav toggle, FAQ accordion (on pages with `.faq-item`), header drop-shadow on scroll, and a demo-only contact form submit handler (`.contact-form`) that just shows an alert — it is **not** wired to any backend or email service.

### `js/updates.js` — client-side "Updates" feed

No backend. On pages with `[data-updates-full]` (updates.html) or `[data-updates-teaser]` (index.html), this script calls the **GitHub Contents API directly from the browser** to list and fetch JSON files under `content/updates/`, sorts them by `date` descending, and renders each as an embedded social post (Facebook/Instagram/TikTok, via each platform's embed JS) or a fallback card if no `link` was provided.

The repo owner/name/branch are hardcoded at the top of `js/updates.js` (`REPO`, `BRANCH`, `UPDATES_PATH`) and must match the actual GitHub repo the site is deployed from — currently `Blueweyl/hype-district-plaridel` on `master`. If the repo is renamed or forked, update these constants.

### `content/updates/*.json` — the update entries themselves

Each file is one update post, named `{{year}}-{{month}}-{{day}}-{{slug}}.json`, with fields `title`, `platform` (`facebook`/`instagram`/`tiktok`), `link`, `image`, `video`, `date`. These are the data files `js/updates.js` reads at runtime — adding a new JSON file here is how a new update goes live, no code change required.

### `admin/` — Decap CMS

A Decap CMS (formerly Netlify CMS) instance for non-technical editing of `content/updates/`. `admin/index.html` just loads the Decap CMS script; all configuration is in `admin/config.yml`, which points at:
- backend: `github`, repo `Blueweyl/hype-district-plaridel`, branch `master`
- `base_url`/`auth_endpoint`: an external OAuth proxy (`oauth-proxy-blush.vercel.app`) required because GitHub OAuth needs a server-side component that this static site doesn't otherwise have

The `updates` collection schema in `config.yml` must stay in sync with the fields `js/updates.js` expects to read from each JSON entry.

### Online reservations + payment (`reserve.html`, `js/reserve.js`, `api/`)

A real (non-demo) booking flow: pick a service, date, and time on `reserve.html`, then pay the full price via **either** Stripe Checkout (card) or PayMongo Checkout (GCash) — two separate "Pay with Card" / "Pay with GCash" buttons, both hosted payment pages, so this site never touches raw card data or GCash credentials itself. The flow is:

1. `js/reserve.js` renders services/hours from `content/booking-config.json` (fetched same-origin, static file — display/UX only, not trusted for pricing).
2. On date change, it fetches `content/availability.json` from `raw.githubusercontent.com` (not the GitHub API — avoids the 60 req/hr unauthenticated rate limit) to grey out already-booked slots.
3. On submit, `e.submitter` (which of the two `<button type="submit">`s was actually clicked) decides the provider. It `POST`s the booking to `api/create-checkout-session` (Stripe) or `api/create-paymongo-checkout` (PayMongo) on a **separate Vercel deployment** of this same repo (`VERCEL_API_BASE` constant at the top of `js/reserve.js` — update it if that Vercel project's URL ever changes). Both endpoints share `api/_lib/booking-validate.js` for identical server-side re-validation (price from `content/booking-config.json`, slot re-checked free — never trusting the client), then create a Checkout Session with their respective provider and return `{ url }` for the browser to redirect to.
4. The provider calls its webhook once payment succeeds — `api/stripe-webhook` (Stripe-SDK signature verification, `checkout.session.completed` only) or `api/paymongo-webhook` (manual HMAC-SHA256 verification of the `Paymongo-Signature` header — format `t=<ts>,te=<test_sig>,li=<live_sig>`, algorithm confirmed against PayMongo's own Node SDK since their prose docs don't spell it out; only `checkout_session.payment.paid`, reading metadata off `event.data.attributes.data.attributes.metadata` since PayMongo copies the session's metadata onto the resulting Payment resource). **Webhooks are the only place a reservation is actually written**, never the client-side success redirect. Both call the shared `api/_lib/reservation.js#confirmReservation()`, which commits a JSON file to `content/reservations/{date}-{HHmm}.json` via the GitHub Contents API (write, no `sha` — so GitHub itself rejects a double-booked slot with a 422) and updates `content/availability.json`.

**Why a second Vercel project**: GitHub Pages can't run server code. Rather than migrating the site's hosting, `api/` is deployed as an independent Vercel project tracking this same GitHub repo — the same pattern already used for Decap CMS's OAuth proxy (`oauth-proxy-blush.vercel.app`, external, unrelated project). GitHub Pages remains the canonical live site, untouched.

**Privacy**: `content/reservations/*.json` is in a public repo (required for GitHub Pages + Decap CMS's unauthenticated reads to keep working), so by design it stores only `firstName` + `phoneLast4` (plus `paymentProvider`/`providerSessionId` for support lookups) — never full name, phone, or email. Full customer contact details live in the paying provider's own dashboard (Stripe or PayMongo) captured at checkout, and are also pushed to the SukiDesk Sheet (see below) — those are where the shop owner looks to actually call/confirm a customer. Keep any future change to the reservation schema consistent with this — don't start writing full PII into the repo.

**Env vars** (set in the Vercel project's dashboard, never committed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` (from a webhook registered for the `checkout_session.payment.paid` event pointed at `api/paymongo-webhook`), `GITHUB_TOKEN` (fine-grained PAT, Contents read/write, scoped to only this repo), `ALLOWED_ORIGIN` (CORS allow-list for both create-checkout endpoints, e.g. `https://blueweyl.github.io` — must stay the bare origin, no path, to match the browser's `Origin` header), `SITE_BASE_URL` (optional override for the success/cancel redirect base shared by both providers; defaults to `https://blueweyl.github.io/hype-district-plaridel`, i.e. `ALLOWED_ORIGIN` **plus** the GitHub project-page path — these two intentionally differ in shape, don't try to derive one from the other).

**Bookable services/prices/hours** live in `content/booking-config.json` (single source of truth, read by both client and server) — edit prices/services there, not in HTML. The 45-minute slot-generation loop itself is intentionally duplicated in `js/reserve.js` and `api/_lib/slots.js` (no bundler exists to share an ES module across the browser/Node boundary) — keep both in sync if the algorithm (not just the hours/prices data) ever changes. Business hours are fixed to `Asia/Manila` (UTC+8) on both sides regardless of visitor or server timezone.

The `reservations` collection in `admin/config.yml` (`create: false`, `delete: true`) lets the shop owner view/cancel bookings in Decap CMS the same way they manage `updates` — but bookings are only ever created by a webhook, never hand-authored there.

### SukiDesk staff app (`app.html`, `js/app.js`, `css/app.css`, `apps-script/`)

A separate internal tool, not part of the public marketing site and not linked from its nav/footer. It's a queue/checkout/CRM app for front-desk staff: PIN login per staff member (`screen-login`), then tabbed views (Queue, Clients, Checkout, Dashboard, and owner-only Staff/Settings) in `screen-app`.

- **Storage model**: `js/app.js` keeps the whole DB (`staff`, `clients`, `bookings`, `transactions`, `services`) in `localStorage` (`sukidesk_db_v1`) as the always-on, offline-tolerant source of truth. If a Google Sheets Web App URL + secret token are configured in the Settings tab, it additionally syncs the entire DB: pulls on login, pushes ~1.5s after any change (`pushToCloud`/`pullFromCloud`).
- **Sync backend**: `apps-script/Code.gs` is a Google Apps Script Web App (deployed by the shop owner, not part of any build/deploy pipeline here) that reads/writes named tabs in a Google Sheet the owner controls, gated by a `SUKIDESK_SECRET` script property. It's whole-sheet overwrite, last-write-wins — no per-record merge — see `apps-script/SETUP.md` for the owner-facing setup walkthrough and that limitation.
- Because sync is last-write-wins across the entire DB, avoid changing `js/app.js`'s record shape without also updating `SCHEMAS` in `Code.gs` — the two must agree on field names for each of the five tabs.
- **Online reservations bridge**: `api/_lib/reservation.js#confirmReservation()` (shared by both `api/stripe-webhook.js` and `api/paymongo-webhook.js`) optionally pushes each paid online booking (full `client_name`/`client_contact`/`client_email` — never written to the public repo) directly into the Sheet's `Bookings` tab via a dedicated `addBooking` action in `Code.gs` (appends one row, unlike `saveAll` which overwrites a whole tab). Gated by two Vercel env vars, `SUKIDESK_WEBAPP_URL` + `SUKIDESK_SECRET` (must match the Apps Script's `SUKIDESK_SECRET` script property) — if unset, this silently skips and the reservation write to the public repo (see above) proceeds unaffected. Staff see these under the app's **Reservations** tab (`source: 'online'` bookings), which is the only place full customer contact info for online bookings lives outside the payment provider's own dashboard.

## Content notes

- Two locations exist: the Plaridel branch (this site's focus) and the original La Loma, Quezon City flagship. Contact info for both appears in every page footer and on `contact.html` — keep them distinguished when editing.
- Follower counts, taglines, and business copy on `index.html`/`about.html` reflect real social-media stats; don't invent numbers when editing copy.
