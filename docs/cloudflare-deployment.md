# Cloudflare deployment

Nearcast should remain static until a backend feature earns the added surface area.
The first Cloudflare step is a Pages deploy with no Worker functions.

## Pages project

- Source: GitHub repo `markdsparks/nearcast`
- Production branch: current default branch
- Framework preset: None
- Build command: leave empty
- Build output directory: `.`
- Environment variables: none

Use the generated `*.pages.dev` URL only for verification. The durable app origin
should be the custom domain before users install the PWA.

## Custom domain

Preferred domain: `getnearcast.app`.

Recommended routing:

- `https://getnearcast.app/` is canonical.
- `https://www.getnearcast.app/` redirects to apex.

## Current app assumptions

- `manifest.json` uses relative `start_url` and `scope`, so the same build works
  at GitHub Pages `/nearcast/` and Cloudflare Pages `/`.
- `sw.js` derives its shell cache base from the service worker URL.
- `_headers` keeps `sw.js`, `manifest.json`, and HTML from sticking in
  Cloudflare/browser caches during rollout.

## Not included yet

- Workers paid plan.
- Weather API proxy.
- Push subscription endpoints.
- Scheduled rain checks.
- Auth or server-side user storage.
