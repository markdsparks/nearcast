# Cloudflare deployment

Nearcast still serves static app assets, but the Cloudflare deploy now includes
a thin Worker script for the opt-in radar capability endpoint. The default app
experience remains static unless a user or engineering test explicitly points
the app at `/api/radar/capability`.

## Workers static assets project

- Source: GitHub repo `markdsparks/nearcast`
- Production branch: current default branch
- Project name: `nearcast`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Environment variables: configured in `wrangler.toml`

The deploy is configured by `wrangler.toml`:

- Worker name: `nearcast`
- Worker entry point: `workers/radar-capability.mjs`
- Compatibility date: `2026-06-22`
- Static assets directory: `.`
- `RADAR_GENERATION_INDEX_URL` points the capability endpoint at the R2 preview
  generated-radar index.
- `RADAR_GENERATION_REQUESTS_R2` stores preview dedupe and budget records in
  the private `nearcast-radar-state` R2 bucket under
  `RADAR_GENERATION_REQUESTS_R2_PREFIX`.
- `RADAR_GENERATION_QUEUE` is a producer binding for the
  `nearcast-radar-generation-preview` queue.
- The same queue is also consumed by the Worker to validate accepted messages
  and persist bounded render plans.
- `RADAR_GENERATION_PLANS_R2` stores preview render plans in the private
  `nearcast-radar-state` R2 bucket under `RADAR_GENERATION_PLANS_R2_PREFIX`.
- `RADAR_GENERATION_PENDING_PLANS_R2_PREFIX` stores the latest pending-plan
  pointer the preview runner can consume without listing the private bucket.
- `RADAR_GENERATION_OUTPUT_PREFIX` is set to
  `radar/mrms/on-demand-preview` so queued preview plans render into the same
  R2 namespace the app can opt into with `radarIndex=preview`.

Use `npx wrangler deploy` so Wrangler applies both the Worker script and the
static asset binding from repository config.

Manual app/control-plane deploys can run without rendering radar:

```bash
gh workflow run "Deploy Cloudflare app"
```

That workflow exists so app shell and capability Worker changes do not need to
ride on `.github/workflows/publish-generated-mrms.yml`.

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

## Radar capability Worker

`workers/radar-capability.mjs` contains the first control-plane Worker for
`/api/radar/capability`. It is configured in `wrangler.toml`, but the app only
calls it when `?radarCapabilityEndpoint=/api/radar/capability` or
`localStorage["nearcast-radar-capability-endpoint"]` is set.

The Worker can:

- Serve static assets through `env.ASSETS` when activated as the main Worker.
- Read the deployed `radar/mrms/index.json` through the assets binding.
- Prefer `RADAR_GENERATION_INDEX_URL` when set, allowing the control plane to
  resolve fresh generated packs from an external R2 index without deploying app
  assets.
- Return the same `nearcast-radar-capabilities` shape the app already consumes.
- Report `unsupported` for generation requests when no queue binding exists.
- Report `unsupported` when the queue exists without request-state storage.
- Dedupe recent viewport warming requests through `RADAR_GENERATION_REQUESTS`
  or the preview R2 request store.
- Apply soft hourly generation budgets before accepting queue work.
- Send a viewport warming message to `RADAR_GENERATION_QUEUE` after dedupe.
- Consume preview queue messages and persist render plans to private R2.

Default preview-worker budget caps are intentionally conservative:

- `RADAR_GENERATION_GLOBAL_HOURLY_LIMIT`: defaults to `60` accepted generation
  requests per hour.
- `RADAR_GENERATION_VIEWPORT_HOURLY_LIMIT`: defaults to `3` accepted generation
  requests per deduped viewport per hour.
- Current preview config sets those to `20` global and `2` per viewport per
  hour.

These counters use the same request-state storage and are a soft safety rail,
not a final abuse-control system. Production activation should still add
authenticated request identity and a stronger atomic throttle before broad use.

Smoke test:

```bash
node scripts/radar-capability-smoke.mjs
```

## Radar generation consumer

`workers/radar-generation-consumer.mjs` contains the queue-side contract for
accepted generation requests. It does not render, upload, or publish radar yet.
Its job is to validate a `RADAR_GENERATION_QUEUE` message and turn it into a
bounded render plan the manual processor, and later an automatic job runner, can
execute.

The consumer can:

- Validate required request id, dedupe key, and viewport center fields.
- Normalize viewport bounds into a renderable `--tile-bounds` value.
- Select conservative encoded-tile render defaults for current-frame MRMS.
- Estimate candidate slippy-tile counts before any decode/render work starts.
- Reject over-budget jobs with `tile-budget-exceeded`.
- Produce stable plan/output key templates that include a future
  `{sourceSignature}` segment so rendered tile objects can remain immutable.
- Persist accepted plans to `RADAR_GENERATION_PLANS` or the preview
  `RADAR_GENERATION_PLANS_R2` plan store.
- Write the latest pending-plan pointer only for user-facing render work.
  Verification requests still persist plans, but they do not replace the
  production pending pointer the renderer consumes.

Smoke test:

```bash
node scripts/radar-generation-consumer-smoke.mjs
```

Live preview verification:

```bash
gh workflow run "Verify radar generation queue"
```

That workflow posts a unique no-pack viewport to `/api/radar/capability`, waits
for the preview queue consumer, and verifies the expected private R2 render plan
object exists. It intentionally does not advance the production pending-plan
pointer.

## Radar generation renderer

`scripts/radar-generation-renderer.mjs` executes a persisted render plan without
requiring a full app deploy. It writes local artifacts and hands the result to
the publisher.

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

## Radar generation publisher

`scripts/radar-generation-publisher.mjs` publishes a renderer result into the
generated-radar index contract without activating production upload. It supports
`dry-run` planning, `local-r2` mirroring for smoke tests, and explicit
credentialed `r2` upload for preview/manual execution. The pending-plan runner
uses the same publisher path. Manual and runner `r2` runs require
`@aws-sdk/client-s3` in the execution environment, matching the existing
generated-MRMS R2 uploader.

The publisher can:

- Collect manifest, pack, and sparse tile files from a renderer result.
- Preserve exact object keys from the render plan output templates.
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

Manual queued-plan processing:

```bash
gh workflow run "Process radar generation plan" \
  -f planObjectPath=nearcast-radar-state/radar/mrms/plans/radar/mrms/on-demand-preview/encoded-current-v1/<job>/plan.json
```

The workflow fetches the private plan object, renders the bounded MRMS artifact
set, plans the preview-index merge, and defaults to `uploadMode=dry-run`. Set
`uploadMode=r2` to upload artifacts to `nearcast-radar` and merge the pack into
`https://radar.getnearcast.app/radar/mrms/on-demand-preview/index.json`.

By default, the workflow refuses to publish a render that produced zero radar
tiles. This keeps no-precip queue tests from creating a misleading enhanced pack
in the preview index. Use `allowEmptyPublish=true` only when deliberately
testing empty-coverage behavior.

Pending queued-plan processing:

```bash
gh workflow run "Process pending radar generation plans" -f uploadMode=dry-run
```

This workflow reads the latest pending-plan pointer in `nearcast-radar-state`,
fetches the referenced private plan under `radar/mrms/on-demand-preview`,
renders it, and either dry-runs or uploads it through the same publisher.
Successful `r2` publishes write a processed marker under
`radar/mrms/processed-plans/...` so the runner does not repeatedly render the
same plan. Empty no-precip renders are marked `skipped-empty` instead of being
published unless `allowEmptyPublish=true`. Verification plans are skipped if an
old verification pointer is still present.

The workflow also has a five-minute schedule, but scheduled jobs are skipped
unless the repository variable `ENABLE_RADAR_GENERATION_RUNNER=safe` or
`ENABLE_RADAR_GENERATION_RUNNER=true` is set. `safe` is the preferred preview
automation mode: it processes one pending pointer per run, caps upload
concurrency, caps retained preview packs, forces public verification, and
refuses empty publishes. Keep it off when manually testing architecture, and
turn it on only when on-demand render/publish spend is expected.

Smoke test:

```bash
node scripts/radar-generation-plan-queue-smoke.mjs
```

Manual preview R2 upload:

```bash
gh workflow run "Preview radar generation R2 upload"
```

This workflow defaults to a bounded real MRMS render for Great Falls, uploads
the preview artifact set under `radar/mrms/on-demand-preview/...`, and writes
its mutable preview index to `radar/mrms/on-demand-preview/index.json`. It uses
the repository R2 secrets and `MRMS_R2_BUCKET` fallback variable, installs
`@aws-sdk/client-s3` only for the workflow run, and does not deploy the app or
modify the live `radar/mrms/index.json`. Set `renderMode=fixture` for the tiny
synthetic upload smoke path.

After upload, the workflow verifies the app-facing preview index, resolves the
new pack manifest, and probes public encoded/generated tile URLs. A preview run
that uploads objects but cannot serve them through the public origin fails
instead of handing the app a broken generated-radar pack.

The preview defaults render source zooms `8,9,10,11,12` for the Great Falls
test bounds. That costs more than the original z8-z10 smoke pack, but it keeps
deep zoom from relying on aggressive overzooming. The workflow also fetches the
current preview index before publish and merges fresh packs into it, so a broad
pack and a tighter high-zoom pack can coexist during engineering tests.

For a tighter city-center fidelity check, run:

```bash
gh workflow run "Preview radar generation R2 upload" \
  -f bounds=47.35,-111.55,47.65,-111.05 \
  -f zoom=12 \
  -f tileZooms=10,11,12,13 \
  -f maxCandidateTiles=1000
```

To test that preview pack in the app without changing the default user path,
open the app with:

```text
?map=gl&radar=mrms-generated&radarIndex=preview
```

For engineering quality checks, add `mapPerf=current`. The MapLibre diagnostic
readout then shows the selected pack, source zoom band, overzoom, candidate
counts, coverage overlap, and tile/data counts while keeping the default user
experience unchanged.

The shorthand stores
`https://radar.getnearcast.app/radar/mrms/on-demand-preview/index.json` in
`nearcast-radar-index-url` and clears any older
`nearcast-radar-manifest-url` override. Use `radarIndex=off` to remove the
index override and return to the default generated-radar routing. In the browser
console, `window.nearcastUseRadarPreviewIndex(true)` and
`window.nearcastUseRadarPreviewIndex(false)` toggle the same setting, clear the
manifest override, and refresh the radar timeline.

The preview index is loaded from the `radar.getnearcast.app` R2 custom domain,
so the bucket must allow browser reads from the app origin. The workflow applies
`config/radar-r2-cors.json` before uploading preview objects when
`CLOUDFLARE_API_TOKEN` is available.

Preview activation checklist:

Completed in repo:

- `main = "workers/radar-capability.mjs"` is set in `wrangler.toml`.
- `RADAR_GENERATION_INDEX_URL` points at
  `https://radar.getnearcast.app/radar/mrms/on-demand-preview/index.json`.
- `RADAR_GENERATION_REQUESTS_R2` stores request state in R2.
- `RADAR_GENERATION_QUEUE` can enqueue accepted preview warming requests.
- `RADAR_GENERATION_PLANS_R2` stores accepted render plans in private R2.
- `Process radar generation plan` can fetch a private plan, render artifacts,
  and dry-run or upload the preview pack to R2.
- `Process pending radar generation plans` can discover the newest unprocessed
  private plan, render/publish it, and mark it processed.
- `Deploy Cloudflare app` provisions `nearcast-radar-generation-preview` before
  deploying the Worker.
- `Deploy Cloudflare app` provisions the private `nearcast-radar-state` bucket
  before deploying the Worker.
- `Deploy Cloudflare app` can deploy the app/control-plane without rendering
  MRMS.
- `scripts/radar-capability-smoke.mjs` verifies endpoint routing and normal
  asset passthrough locally, plus KV and R2-backed request-state behavior.

Next:

1. Confirm Workers static assets expose the expected `ASSETS` binding with the
   current Wrangler version.
2. Deploy to Cloudflare with `Deploy Cloudflare app`.
3. Point the app at the endpoint with
   `?radarCapabilityEndpoint=/api/radar/capability`.
4. Verify fallback behavior remains unchanged.
5. Run or refresh a preview R2 radar upload so the endpoint has a fresh pack.
6. Run `Verify radar generation queue` and confirm the private render plan is
   persisted.
7. Run the renderer smoke test with preview artifact settings.
8. Run the publisher smoke test against a local R2 mirror.
9. Run `Process radar generation plan` in `dry-run` mode against the private
   plan object from queue verification.
10. Run `Process pending radar generation plans` in `dry-run` mode and confirm
    it selects the same pending class without requiring a copied object path.
11. Verify credentialed R2 upload against the preview bucket with explicit
   manual execution.
12. Verify endpoint-driven enhanced radar before making the endpoint the
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
- Production queue-backed radar render/publish runner.
- Push subscription endpoints.
- Scheduled rain checks.
- Auth or server-side user storage.
