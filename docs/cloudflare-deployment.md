# Cloudflare deployment

Nearcast should remain static until a backend feature earns the added surface
area. The current Cloudflare dashboard path is Workers Builds with static
assets, not a Worker script and not a Pages-only project.

## Workers static assets project

- Source: GitHub repo `markdsparks/nearcast`
- Production branch: current default branch
- Project name: `nearcast`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Environment variables: none

The deploy is configured by `wrangler.toml`:

- Worker name: `nearcast`
- Compatibility date: `2026-06-22`
- Static assets directory: `.`

If the dashboard deploy command still includes `--assets .`, that is also fine
because it points at the same static asset root. The repository config exists so
Wrangler does not fail on the required compatibility date or warn about an
undefined Worker name.

Use the generated `*.workers.dev` URL only for verification. The durable app
origin should be the custom domain before users install the PWA.

## Custom domain

Preferred domain: `getnearcast.app`.

Recommended routing:

- `https://getnearcast.app/` is canonical.
- `https://www.getnearcast.app/` redirects to apex.

## Current app assumptions

- `manifest.json` uses relative `start_url` and `scope`, so the same build works
  at GitHub Pages `/nearcast/` and Cloudflare Workers static assets `/`.
- `sw.js` derives its shell cache base from the service worker URL.
- `_headers` keeps `sw.js`, `manifest.json`, and HTML from sticking in
  Cloudflare/browser caches during rollout.

## Not included yet

- Workers paid plan.
- Weather API proxy.
- Push subscription endpoints.
- Scheduled rain checks.
- Auth or server-side user storage.
