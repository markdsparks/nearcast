import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

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

const labelSandbox = {};
vm.createContext(labelSandbox);
vm.runInContext(`
  ${extractFunction(app, "hourlyConditionCardLabel")}
  globalThis.hourlyConditionCardLabelTest = hourlyConditionCardLabel;
`, labelSandbox);

const compact = labelSandbox.hourlyConditionCardLabelTest;
assert.equal(compact("Thunderstorms likely"), "Storms likely", "likely thunderstorms fit the narrow visual card");
assert.equal(compact("Thunderstorms possible"), "Storms possible", "possible thunderstorms fit the narrow visual card");
assert.equal(compact("Thunderstorm likely"), "Storm likely", "singular thunderstorm wording is compact too");
assert.equal(compact("Thunderstorm possible"), "Storm possible", "singular possible wording is compact too");
assert.equal(compact("Light rain"), "Light rain", "already concise conditions remain unchanged");

for (const label of [
  compact("Thunderstorms likely"),
  compact("Thunderstorms possible"),
  compact("Thunderstorm likely"),
  compact("Thunderstorm possible")
]) {
  assert.ok(label.length <= 15, `${label} stays short enough for two narrow-card lines`);
}

const hourlyRenderer = extractFunction(app, "renderHourly");
assert.match(
  hourlyRenderer,
  /const\s+cardCondition\s*=\s*hourlyConditionCardLabel\(code\)/,
  "hourly cards derive a dedicated compact visual condition"
);
assert.match(
  hourlyRenderer,
  /class="hour-condition"[^>]*>\$\{escapeHtml\(cardCondition\)\}<\/span>/,
  "the compact condition is used only in the narrow visible label"
);
assert.match(
  hourlyRenderer,
  /const\s+cardLabel\s*=\s*`\$\{label\}: \$\{code\}/,
  "the accessible card name retains the full canonical condition"
);
assert.match(
  hourlyRenderer,
  /title="\$\{escapeHtml\(receiptSentence \|\| title\)\}"/,
  "the card title retains canonical condition and evidence wording"
);

const conditionRule = styles.match(/\.hour-card \.hour-condition\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(conditionRule, "hourly condition visual styling is present");
assert.match(conditionRule, /width:\s*100%/, "the condition can use the full card width");
assert.match(conditionRule, /min-height:\s*2\.2em/, "two visual lines retain reserved height");
assert.match(conditionRule, /line-height:\s*1\.1/, "the compact condition keeps readable line spacing");
assert.match(conditionRule, /-webkit-line-clamp:\s*2/, "visual condition labels remain capped at two lines");
assert.match(conditionRule, /overflow-wrap:\s*anywhere/, "unknown or localized long words wrap instead of clipping");
assert.match(conditionRule, /hyphens:\s*auto/, "localized long conditions may hyphenate as a final fallback");
assert.doesNotMatch(conditionRule, /white-space:\s*nowrap/, "visual conditions are allowed to wrap");
assert.doesNotMatch(conditionRule, /text-overflow:\s*ellipsis/, "visual conditions do not silently ellipsize");

console.log("Hourly hero label smoke passed.");
