import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, planner, truth, styles, html, serviceWorker, worker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "weather-truth.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "workers/radar-capability.mjs"), "utf8")
]);

assert.match(truth, /function planWeatherChangeReceipt\(/, "one shared model creates structured change receipts");
for (const field of ["direction", "metric", "why", "action", "baselineAt", "checkedAt"]) {
  assert.ok(truth.includes(`${field}:`), `the receipt carries ${field}`);
}
assert.match(truth, /const heatComparisonReady = current\.tempUnit === previous\.tempUnit/, "unit changes cannot create a false heat receipt");

assert.match(app, /capturePlanWatchChangeReceipt\(snapshot, previous, change\)/, "changes are persisted before their baseline advances");
assert.match(app, /if \(!previous \|\| !comparable \|\| change\) store\.plans\[key\] = snapshot/, "quiet updates retain the comparison point so small changes can accumulate");
assert.match(app, /const canAdvancePlans = !provenance\?\.cacheFallback/, "stale fallback data cannot advance a watched-plan baseline");
assert.match(app, /previous\.placeKey === snapshot\.placeKey/, "a plan cannot compare forecasts from two different places");
assert.match(app, /savedAt: Date\.now\(\)[\s\S]*forecastCheckedAt:/, "baseline capture time is distinct from forecast freshness");

assert.match(planner, /const PLAN_WATCH_RECEIPTS_KEY = "nearcast-plan-watch-receipts-v1"/, "receipts have a dedicated local store");
assert.match(planner, /function capturePlanWatchChangeReceipt\(/, "the client captures meaningful changes independently of notification permission");
assert.match(planner, /recordPlanWatchRecentUpdate\([\s\S]*receipt:\$\{signature\}/, "each new receipt also enters local change history");
assert.match(planner, /savePlanWatchBaselineForMemory\(memory\.id, \{ replace: true \}\)/, "watching a plan immediately saves its baseline");
assert.match(planner, /clearPlanWatchTracking\(existing\.id\)[\s\S]*savePlanWatchBaselineForMemory\(existing\.id, \{ replace: true \}\)/, "editing a plan resets the old window and saves a new baseline");
assert.match(planner, /clearPlanWatchTracking\(updated\.id\)[\s\S]*savePlanWatchBaselineForMemory\(updated\.id, \{ replace: true \}\)/, "the structured edit path also resets receipt tracking");
assert.match(planner, /function closeGlobalMemorySheet\([\s\S]*markPlanWatchFocusedChangeReviewed\(planWatchFocusMemoryId, planWatchVisibleReceiptSignature\)/, "a receipt is reviewed only after the focused view is closed");
assert.match(planner, /planWatchFocusMemoryId !== focusMemoryId[\s\S]*markPlanWatchFocusedChangeReviewed\(planWatchFocusMemoryId, planWatchVisibleReceiptSignature\)/, "switching plans reviews only the receipt that was actually visible");
assert.match(planner, /snapshot\.alertsReady === false/, "a baseline waits until official-alert context is ready");
assert.match(planner, /source\.stale \? "stale"[\s\S]*reviewedChange \? "reviewed"/, "stale truth outranks an old reviewed receipt");
assert.match(planner, /function capturePlanWatchRouteReceipt\(/, "a remote notification restores its exact structured receipt before opening Watching");
assert.match(planner, /function planWindowsFromSpan\(/, "continuous multi-day plans are segmented into forecast windows");
assert.match(planner, /\["single", "discrete", "continuous_span"\]\.includes\(memory\.scheduleType\)/, "plan storage migrates to the v2 schedule model");
assert.match(planner, /data-memory-window-add/, "the structured editor can add schedule days");
assert.match(planner, /memoryEditState\.scheduleType !== "single"/, "the structured editor saves complete schedules atomically");
assert.match(planner, /askThread\[row\]\.schedule = normalized\.schedule/, "agent-created schedules survive into the conversation turn");
assert.match(planner, /rememberedPlanIdForSchedule/, "watching a multi-day draft saves one schedule instead of its first day");
assert.match(planner, /ask-decision-schedule-row/, "multi-day drafts expose every watched window before saving");

assert.match(planner, /data-memory-show="\$\{escapeHtml\(memory\.id\)\}" aria-label="\$\{escapeHtml\(`Open/, "Watching cards open the focused receipt rather than the legacy facts sheet");
for (const phrase of [
  "Forecast changed",
  "Before",
  "Now",
  "Why it matters",
  "What to do",
  "No meaningful change",
  "Baseline saved",
  "Refresh needed"
]) {
  assert.ok(planner.includes(phrase), `${phrase} is explicit in the Watching hierarchy`);
}
assert.match(planner, /class="sr-only" role="status" aria-live="polite" aria-atomic="true"/, "new changes announce once through a short hidden status");
const focusedHeroSource = planner.match(/function renderFocusedPlanWatchHero\([\s\S]*?\n}/)?.[0] || "";
assert.match(focusedHeroSource, /renderPlanWatchSignals\(watch\)/, "the focused plan keeps one concise current-metrics surface");
assert.doesNotMatch(focusedHeroSource, /renderFocusedPlanReceipt\(watch\)/, "the focused plan does not repeat the same metrics in a second table");

assert.match(styles, /\.focused-plan-compare \{[\s\S]*grid-template-columns:/, "before and now use a stable visual comparison");
assert.match(styles, /\.focused-plan-change h4 \{[\s\S]*font-size: 1\.04rem/, "change headlines are not micro text");
assert.match(styles, /\.focused-plan-receipt dd \{[\s\S]*font-size: 0\.86rem/, "receipt values remain readable");
assert.match(styles, /\.focused-plan-actions button,[\s\S]*min-height: 44px/, "focused actions meet a reliable touch target");
assert.match(styles, /\.global-memory-actions button \{[\s\S]*min-height: 44px/, "overview actions also meet a reliable touch target");
assert.match(styles, /\.focused-plan-change\.is-baseline \{/, "a first baseline remains visually neutral rather than implying stability");
assert.match(styles, /--ai-card-muted: #bdd0d9/, "dark AI cards use a readable secondary text color");
assert.match(styles, /--ai-card-inset: rgba\(7, 16, 22, 0\.58\)/, "dark AI cards avoid washed-out translucent white panels");
assert.match(styles, /\.ask-decision \.plan-watch-signals b \{[\s\S]*color: var\(--ai-card-muted\)/, "decision signal labels inherit the accessible AI-card palette");
assert.match(styles, /\.ask-watch-confirmation small,[\s\S]*color: var\(--ai-card-muted\)/, "saved-plan supporting copy remains readable in dark mode");

assert.match(worker, /plans: mergePlanWatchPlansWithExisting\(/, "routine notification sync preserves the server comparison point");
assert.match(worker, /function sameRegisteredPlanWindow\(/, "an edited time or place intentionally resets the server baseline");
assert.match(worker, /Array\.isArray\(plan\.windows\)/, "the edge watcher evaluates all registered schedule windows");
assert.match(worker, /existingSnapshot\.tempUnit === incomingSnapshot\.tempUnit/, "server baselines also reset across unit changes");
assert.match(worker, /return hasContent \? snapshot : null/, "blank incoming snapshots cannot erase a valid server baseline");
assert.match(worker, /function planWatchPersistedEvaluationTargets\(/, "only the delivered candidate consumes its notification baseline");
assert.match(truth, /receipt: change\.receipt \|\| null/, "structured evidence crosses the notification boundary");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker assets match the app version");
assert.ok([...html.matchAll(/\?v=([\d.]+)/g)].every(([, assetVersion]) => assetVersion === version), "all HTML assets use the receipt version");

console.log(`Plan watch receipt smoke passed for Nearcast ${version}.`);
