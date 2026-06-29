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
- `radar/mrms/index.json` is no-cache for the same reason. It is the
  location-aware generated-radar catalog the app checks before loading a
  specific generated manifest.
- Radar capability endpoints are opt-in while the app remains static. For
  engineering tests, set `?radarCapabilityEndpoint=/api/radar/capability` or
  `localStorage["nearcast-radar-capability-endpoint"]`. Without that setting,
  the app uses the local static manifest/index resolver and never calls a
  backend capability endpoint.

## Dormant radar capability Worker

`workers/radar-capability.mjs` contains the first control-plane Worker for
`/api/radar/capability`. It is intentionally not active in `wrangler.toml` yet,
so production remains an assets-only deploy.

The Worker can:

- Serve static assets through `env.ASSETS` when activated as the main Worker.
- Read the deployed `radar/mrms/index.json` through the assets binding.
- Return the same `nearcast-radar-capabilities` shape the app already consumes.
- Report `unsupported` for generation requests when no queue binding exists.
- Report `unsupported` when the queue exists without request-state storage.
- Dedupe recent viewport warming requests through `RADAR_GENERATION_REQUESTS`.
- Apply soft hourly generation budgets before accepting queue work.
- Send a viewport warming message to `RADAR_GENERATION_QUEUE` after dedupe.

Default dormant-worker budget caps are intentionally conservative:

- `RADAR_GENERATION_GLOBAL_HOURLY_LIMIT`: defaults to `60` accepted generation
  requests per hour.
- `RADAR_GENERATION_VIEWPORT_HOURLY_LIMIT`: defaults to `3` accepted generation
  requests per deduped viewport per hour.

These counters use the same request-state storage and are a soft safety rail,
not a final abuse-control system. Production activation should still add
authenticated request identity and a stronger atomic throttle before broad use.

Smoke test:

```bash
node scripts/radar-capability-smoke.mjs
```

## Dormant radar generation consumer

`workers/radar-generation-consumer.mjs` contains the inactive queue-side
contract for accepted generation requests. It does not render, upload, or
publish radar yet. Its job is to validate a `RADAR_GENERATION_QUEUE` message and
turn it into a bounded render plan the future renderer can execute.

The consumer can:

- Validate required request id, dedupe key, and viewport center fields.
- Normalize viewport bounds into a renderable `--tile-bounds` value.
- Select conservative encoded-tile render defaults for current-frame MRMS.
- Estimate candidate slippy-tile counts before any decode/render work starts.
- Reject over-budget jobs with `tile-budget-exceeded`.
- Produce stable plan/output key templates that include a future
  `{sourceSignature}` segment so rendered tile objects can remain immutable.
- Optionally persist accepted plans to `RADAR_GENERATION_PLANS`.

Smoke test:

```bash
node scripts/radar-generation-consumer-smoke.mjs
```

## Dormant radar generation renderer

`scripts/radar-generation-renderer.mjs` executes a persisted render plan without
activating the Worker queue. It is still an offline scaffold: it writes local
artifacts and does not upload to R2 or update the live generated-radar index.

The renderer can:

- Read a `nearcast-radar-generation-plan` JSON document.
- Resolve the latest MRMS source through the existing timeline generator.
- Pin the exact resolved source object before the bounded render run starts.
- Substitute the resolved source signature into manifest, tile, and pack keys.
- Run `scripts/mrms-prototype/generate-mrms-timeline.mjs` with the plan's
  viewport bounds, zooms, encoded-tile settings, and TTL.
- Write a generated manifest plus an index-pack artifact that the capability
  resolver can later consume.

Smoke test:

```bash
node scripts/radar-generation-renderer-smoke.mjs
```

## Dormant radar generation publisher

`scripts/radar-generation-publisher.mjs` publishes a renderer result into the
generated-radar index contract without activating production upload. It supports
`dry-run` planning, `local-r2` mirroring for smoke tests, and explicit
credentialed `r2` upload for preview/manual execution. The script is still not
connected to the automatic queue or scheduled MRMS publisher. Manual `r2` runs
require `@aws-sdk/client-s3` in the execution environment, matching the existing
generated-MRMS R2 uploader.

The publisher can:

- Collect manifest, pack, and sparse tile files from a renderer result.
- Preserve exact object keys under `radar/mrms/on-demand/...`.
- Rewrite the pack `manifestUrl` to a configured public artifact origin.
- Merge the source-scoped pack into a `nearcast-generated-radar-index`.
- Prune expired packs and cap retained pack count.
- Write the mutable `radar/mrms/index.json` object separately from immutable
  source-scoped artifacts.
- Upload the planned object set to R2 when bucket, endpoint, and access
  credentials are provided explicitly.

Smoke test:

```bash
node scripts/radar-generation-publisher-smoke.mjs
```

Manual preview R2 upload:

```bash
gh workflow run "Preview radar generation R2 upload"
```

This workflow uploads a tiny preview artifact set under
`radar/mrms/on-demand-preview/...` and writes its mutable preview index to
`radar/mrms/on-demand-preview/index.json`. It uses the repository R2 secrets and
`MRMS_R2_BUCKET` fallback variable, installs `@aws-sdk/client-s3` only for the
workflow run, and does not deploy the app or modify the live
`radar/mrms/index.json`.

Activation checklist:

1. Confirm Workers static assets expose the expected `ASSETS` binding with the
   current Wrangler version.
2. Add `main = "workers/radar-capability.mjs"` to `wrangler.toml`.
3. Add `RADAR_GENERATION_REQUESTS` storage for request dedupe/budgeting.
4. Confirm budget limits for the preview environment.
5. Run the generation consumer smoke test with preview budget values.
6. Run the renderer smoke test with preview artifact settings.
7. Run the publisher smoke test against a local R2 mirror.
8. Install the temporary R2 SDK dependency and verify credentialed R2 upload
   against a preview bucket with explicit manual execution.
9. Add a `RADAR_GENERATION_QUEUE` binding only after the generation worker is
   ready to consume messages and request budgets/rate limits are in place.
10. Deploy to a preview Worker URL first.
11. Point the app at the endpoint with
   `?radarCapabilityEndpoint=/api/radar/capability`.
12. Verify fallback behavior remains unchanged before making the endpoint the
   default.

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
7. Write `radar/mrms/index.json`, a generated-radar catalog that points active
   places to the correct manifest by coverage bounds.
8. Verify the generated radar file count stays below the configured static
   asset budget.
9. Run `npx --yes wrangler deploy`.

This workflow does not commit generated radar tiles. It publishes them as part
of the static asset deployment snapshot, which keeps Git history from becoming a
radar archive.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`: only required when `MRMS_TILE_UPLOAD_MODE=r2`.
- `R2_SECRET_ACCESS_KEY`: only required when `MRMS_TILE_UPLOAD_MODE=r2`.

Required GitHub variable for scheduled publishing:

- `ENABLE_MRMS_PUBLISH=true`

Set this to `false` to keep manual MRMS publishes available while preventing
scheduled runs from spending CI minutes or uploading new generated packs.

Optional GitHub variable:

- `MRMS_CURRENT_MANIFEST_URL`: deployed generated-radar manifest to compare
  before rendering. Defaults to
  `https://getnearcast.app/radar/mrms/manifest.json`.
- `MRMS_PROFILE`: scheduled publish profile. Defaults to `metro-east`; useful
  temporary values include `great-falls` for testing active Montana weather.
- `MRMS_PROFILES`: comma-separated scheduled publish profiles. When set, this
  takes precedence over `MRMS_PROFILE` and publishes multiple generated packs
  into one `radar/mrms/index.json`.
- `MRMS_SKIP_EMPTY_TILES`: defaults to `true`. Empty radar tiles are not
  uploaded, which avoids spending Cloudflare asset slots on transparent PNGs.
- `MRMS_ENCODED_TILES`: defaults to `true`. Publishes compact
  `data/{z}/{x}/{y}.png` value tiles beside the colored generated PNGs so the
  MapLibre renderer can colorize radar on the user's device. Set to `false` to
  return to colored-PNG-only publishing.
- `MRMS_ASSET_FILE_LIMIT`: generated-radar file budget before deploy. Defaults
  to `19500`, leaving headroom under the current 20000-file Workers static
  asset limit for the app shell and manifests.
- `MRMS_TILE_URL_BASE`: optional public tile URL root. When set, generated
  frame URLs point at `${MRMS_TILE_URL_BASE}/<profile>/<frame>/<z>/<x>/<y>.png`
  instead of relative Worker static asset URLs. Leave unset until an upload
  target, such as R2 behind a public/custom domain, is ready.
- `MRMS_TILE_UPLOAD_MODE`: defaults to `static`. Set to `r2` to upload
  generated tile PNGs to R2 and remove them from the Worker static asset bundle
  before deploy.
- `MRMS_R2_BUCKET`: R2 bucket name used when `MRMS_TILE_UPLOAD_MODE=r2`.
- `MRMS_R2_PREFIX`: object key prefix for generated radar tiles. Defaults to
  `mrms`; this should match the path in `MRMS_TILE_URL_BASE`.
- `MRMS_R2_ENDPOINT`: optional S3-compatible R2 endpoint override. Defaults to
  `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`.
- `MRMS_R2_CACHE_CONTROL`: defaults to
  `public, max-age=86400, immutable` because frame ids and tile-version query
  strings make generated tile URLs immutable.
- `MRMS_R2_UPLOAD_CONCURRENCY`: defaults to `24`.
- `MRMS_R2_PRUNE_OLDER_THAN_MINUTES`: defaults to `360`. Older R2 tile objects
  under the configured prefix are pruned after a successful upload.

Manual dispatch works without that variable. Scheduled runs are gated so the
workflow does not spend CI minutes every 30 minutes unless generated publishing
is deliberately enabled.

Default live profile:

- `metro-east`
- Bounds: `38.35,-90.65,39.25,-89.25`
- Zooms: `6-13`
- Frames: `6`
- Freshness window: `120` minutes

Additional test profiles:

- `great-falls`: `46.9,-112.4,48.2,-110.2`
- `swaledale`: `42.7,-93.8,43.4,-92.7`

The publisher uses a source-delta guard before it renders. It compares the
candidate MRMS source objects plus the render profile with the deployed
manifest's `publishFingerprint`. If that fingerprint matches and the deployed
manifest is not near expiry, the workflow exits successfully and skips the
Cloudflare deploy. The default freshness buffer is 8 minutes and can be
overridden with `--skip-min-fresh-minutes`. The first run after the
location-aware index contract was introduced forces a publish when the deployed
manifest does not yet advertise the current index version.

Generated radar index shape:

- `provider`: `nearcast-generated-radar-index`
- `packs[]`: generated radar packs with `id`, `label`, `manifestUrl`,
  `coverageBounds`, `coverageAreas`, `expiresAt`, `frameCount`, and operational
  metrics.

The app checks this index first. If a pack covers the active place, the app
loads that pack's manifest. If the index is missing, stale, or has no matching
coverage, the app falls back through the legacy generated manifest path and then
to NOAA/RainViewer.

Multi-pack static deploys:

- The first profile remains the compatibility manifest at
  `radar/mrms/manifest.json`.
- Additional profiles write pack manifests under
  `radar/mrms/packs/<profile>/manifest.json`.
- All pack tiles are written under `radar/mrms/live/<profile>/`.
- When encoded tiles are enabled, each frame stores color fallback PNGs at the
  frame root and data tiles under `data/`. The manifest points MapLibre at
  `dataUrl` first and keeps `url` as the fallback.
- The app scores index packs against the current viewport and zoom, not only
  the active place. This lets search, pan, and hyperzoom choose the most
  relevant pack without exposing pack/provider details in the UI.
- Empty radar tiles are skipped by default. Missing generated tiles should read
  as transparent radar, not as unavailable weather, because the manifest and
  coverage metadata remain the source of truth.
- The manifest can point tiles at an external origin via `MRMS_TILE_URL_BASE`.
  When `MRMS_TILE_UPLOAD_MODE=r2`, the workflow uploads local tiles to R2, then
  removes `radar/mrms/live/` before the Worker deploy so the Worker carries only
  the app shell, index, and manifests.
- If every pack in the deployed index has the same source/render fingerprint and
  is still fresh enough, the workflow skips the whole deploy. If any pack
  changed, the publisher regenerates all requested packs so the static deploy
  snapshot stays complete.
- Before deploy, `scripts/mrms-prototype/check-mrms-asset-budget.mjs` counts
  generated radar files. If the requested profiles/frames exceed the static
  asset budget, the workflow fails before Wrangler instead of producing a late
  Cloudflare API error.

The workflow also supports manual dispatch, so a test run can be triggered
without waiting for the schedule.

Long-term radar architecture is tracked in `docs/radar-architecture.md`. Future
generated forecast maps should reuse the same source-agnostic manifest shape,
but broad coverage should move toward capability routing, object storage, and
on-demand generation instead of full static app redeploys.

## Not included yet

- Workers paid plan.
- Weather API proxy.
- Radar capability Worker endpoint.
- Queue-backed radar generation worker.
- Push subscription endpoints.
- Scheduled rain checks.
- Auth or server-side user storage.
