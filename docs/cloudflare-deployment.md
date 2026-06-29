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
- `radar/mrms/manifest.json` is also no-cache because generated radar freshness
  comes from that manifest, not the app shell.

## Generated MRMS radar publisher

The app still deploys as static assets. Live generated radar is produced before
deployment by `.github/workflows/publish-generated-mrms.yml`:

1. Check out the repo.
2. Run `scripts/mrms-prototype/publish-mrms-live.mjs`.
3. Resolve the latest MRMS source objects and compare their publish fingerprint
   against the currently deployed generated manifest.
4. Skip tile generation and deploy when the source objects, render profile, and
   current manifest freshness are still valid.
5. Generate regional tiles into the untracked `radar/mrms/live/` directory when
   the live manifest is missing, stale, or different.
6. Replace `radar/mrms/manifest.json` in the build workspace with a live
   manifest containing `expiresAt`, frames, tile URLs, and coverage metadata.
7. Run `npx --yes wrangler deploy`.

This workflow does not commit generated radar tiles. It publishes them as part
of the static asset deployment snapshot, which keeps Git history from becoming a
radar archive.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Required GitHub variable for scheduled publishing:

- `ENABLE_MRMS_PUBLISH=true`

Optional GitHub variable:

- `MRMS_CURRENT_MANIFEST_URL`: deployed generated-radar manifest to compare
  before rendering. Defaults to
  `https://getnearcast.app/radar/mrms/manifest.json`.
- `MRMS_PROFILE`: scheduled publish profile. Defaults to `metro-east`; useful
  temporary values include `great-falls` for testing active Montana weather.

Manual dispatch works without that variable. Scheduled runs are gated so the
workflow does not spend CI minutes every 15 minutes before the Cloudflare publish
secrets are configured.

Default live profile:

- `metro-east`
- Bounds: `38.35,-90.65,39.25,-89.25`
- Zooms: `6-13`
- Frames: `6`
- Freshness window: `30` minutes

Additional test profiles:

- `great-falls`: `46.9,-112.4,48.2,-110.2`
- `swaledale`: `42.7,-93.8,43.4,-92.7`

The publisher uses a source-delta guard before it renders. It compares the
candidate MRMS source objects plus the render profile with the deployed
manifest's `publishFingerprint`. If that fingerprint matches and the deployed
manifest is not near expiry, the workflow exits successfully and skips the
Cloudflare deploy. The default freshness buffer is 8 minutes and can be
overridden with `--skip-min-fresh-minutes`.

The workflow also supports manual dispatch, so a test run can be triggered
without waiting for the schedule.

Future generated forecast maps should reuse the same static-asset pattern:
produce tile frames plus a coverage-aware manifest first, then let the app
consume that manifest as ordinary precipitation timeline frames.

## Not included yet

- Workers paid plan.
- Weather API proxy.
- Push subscription endpoints.
- Scheduled rain checks.
- Auth or server-side user storage.
