import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(root, "app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  let activeAlerts = [];
  ${extractFunction(app, "alertIdentityKey")}
  ${extractFunction(app, "alertsForAlertSheet")}
  globalThis.alertTest = {
    setAlerts(alerts) { activeAlerts = alerts; },
    key(alert) { return alertIdentityKey(alert); },
    orderedIds(selected) { return alertsForAlertSheet(selected).map((alert) => alert.id || alert.event); },
    activeIds() { return activeAlerts.map((alert) => alert.id || alert.event); }
  };
`, sandbox);

const alerts = [
  { id: "warning", event: "Severe Thunderstorm Warning", onset: "2026-07-18T18:00:00Z", ends: "2026-07-18T19:00:00Z" },
  { id: "advisory", event: "Heat Advisory", onset: "2026-07-18T16:00:00Z", ends: "2026-07-19T01:00:00Z" }
];
sandbox.alertTest.setAlerts(alerts);

assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.alertTest.orderedIds(null))),
  ["warning", "advisory"],
  "opening the general alert surface preserves the primary alert order"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.alertTest.orderedIds(alerts[1]))),
  ["advisory", "warning"],
  "the tapped alert is presented first"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.alertTest.activeIds())),
  ["warning", "advisory"],
  "selecting an alert does not mutate the active-alert order"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.alertTest.orderedIds("id:missing"))),
  [],
  "a stale alert key never opens a different active alert"
);
assert.equal(sandbox.alertTest.key(alerts[1]), "id:advisory", "NWS alert ids are preferred for stable identity");
assert.equal(
  sandbox.alertTest.key({ event: "Wind Advisory", effective: "start", expires: "end" }),
  "Wind Advisory|start|end",
  "event and timing provide a stable identity fallback"
);

const openAlertSheet = extractFunction(app, "openAlertSheet");
assert.match(openAlertSheet, /const sheetAlerts = alertsForAlertSheet\(selectedAlert\)/, "alert detail resolves the selected alert");
assert.match(openAlertSheet, /const top = sheetAlerts\[0\]/, "selected alert drives the alert-sheet header");
assert.match(openAlertSheet, /renderAlertInsight\(top\)/, "selected alert drives the Nearcast read");
assert.match(openAlertSheet, /sheetAlerts\.map\(\(a, index\)/, "other active alerts remain available below the selected alert");
assert.match(openAlertSheet, /Other active alerts/, "secondary alerts have a clear section label");
assert.match(app, /openAlertSheet\(alertKey, \{ returnFocus: alertDivider \}\)[\s\S]*?refreshOpenDayDetailMemorySurfaces\(\)/, "a stale hourly alert refreshes the sheet instead of opening the wrong alert");

console.log("Hourly alert detail smoke passed.");
