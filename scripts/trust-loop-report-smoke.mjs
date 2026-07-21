import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendGitHubSummary,
  buildQuery,
  buildReport,
  parseArgs,
  parseSqlResponse,
  queryAnalytics,
  validateAccountId,
  validateDataset,
  validateDays
} from "./trust-loop-report.mjs";

assert.equal(validateDataset("nearcast_product_events"), "nearcast_product_events");
assert.throws(() => validateDataset("events; DROP TABLE events"), /dataset must start/);
assert.equal(validateDays("7"), 7);
for (const invalid of ["0", "91", "1.5", "7 days", ""]) {
  assert.throws(() => validateDays(invalid), /days must be/);
}
assert.equal(validateAccountId("a".repeat(32)), "a".repeat(32));
assert.throws(() => validateAccountId("account"), /32-character hexadecimal/);
assert.deepEqual(parseArgs(["--days=14", "--dataset", "events_v2"]), {
  dataset: "events_v2",
  days: 14,
  help: false
});
assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);

const query = buildQuery("nearcast_product_events", 7);
assert.match(query, /SUM\(_sample_interval \* double1\) AS event_count/, "batched event counts are sampling-weighted");
assert.match(query, /INTERVAL '7' DAY/, "the validated reporting window reaches SQL");
assert.match(query, /FORMAT JSON$/, "the query requests Cloudflare's documented JSON response shape");

const cloudflareBody = {
  meta: [
    { name: "event", type: "String" },
    { name: "platform", type: "String" },
    { name: "version", type: "String" },
    { name: "event_count", type: "Float64" }
  ],
  data: [
    { event: "plan-check-started", platform: "ios", version: "3.0.284", event_count: 20 },
    { event: "plan-check-completed", platform: "ios", version: "3.0.284", event_count: "10" },
    { event: "plan-watched", platform: "web", version: "3.0.284", event_count: 5 },
    { event: "notification-registration-ready", platform: "ios", version: "3.0.284", event_count: 4 },
    { event: "notification-registration-failed", platform: "ios", version: "3.0.283", event_count: 1 }
  ],
  rows: 5
};
const rows = parseSqlResponse(cloudflareBody);
assert.equal(rows[1].count, 10, "numeric SQL values are normalized");
assert.throws(() => parseSqlResponse({ meta: [], data: [], rows: 1 }), /missing the event column|row count mismatch/);

const report = buildReport(rows, { dataset: "nearcast_product_events", days: 7 });
assert.match(report, /# Nearcast Trust Loop report/);
assert.match(report, /Plan Check started \| 20/);
assert.match(report, /Plan Check completed \| 10/);
assert.match(report, /80% ready \(4 ready · 1 failed\)/);
assert.match(report, /\| ios \| 35 \| 87\.5% \|/);
assert.match(report, /Cloudflare’s `_sample_interval` weighting/);

let capturedRequest;
const token = "secret-token-that-must-not-appear";
const fetchedRows = await queryAnalytics({
  accountId: "b".repeat(32),
  token,
  dataset: "nearcast_product_events",
  days: 7,
  fetchImpl: async (url, init) => {
    capturedRequest = { url, init };
    return new Response(JSON.stringify(cloudflareBody), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
});
assert.equal(fetchedRows.length, 5);
assert.equal(capturedRequest.init.headers.Authorization, `Bearer ${token}`);
assert.ok(!capturedRequest.url.includes(token), "the token is never placed in the URL");
assert.ok(!capturedRequest.init.body.includes(token), "the token is never placed in the SQL body");

await assert.rejects(
  queryAnalytics({
    accountId: "b".repeat(32),
    token,
    dataset: "nearcast_product_events",
    days: 7,
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: token }] }), { status: 403 })
  }),
  (error) => {
    assert.match(error.message, /Account > Account Analytics > Read/);
    assert.ok(!error.message.includes(token), "authorization errors never echo the token");
    return true;
  }
);

await assert.rejects(
  queryAnalytics({
    accountId: "b".repeat(32),
    token,
    dataset: "nearcast_product_events",
    days: 7,
    fetchImpl: async () => new Response("Not authorized to access requested resource", { status: 400 })
  }),
  /Account > Account Analytics > Read/
);

const directory = await mkdtemp(path.join(os.tmpdir(), "nearcast-trust-loop-"));
const summaryPath = path.join(directory, "summary.md");
assert.equal(await appendGitHubSummary(report, summaryPath), true);
assert.equal(await readFile(summaryPath, "utf8"), report);
assert.equal(await appendGitHubSummary(report, ""), false);

console.log("Trust Loop Analytics Engine report smoke passed.");
