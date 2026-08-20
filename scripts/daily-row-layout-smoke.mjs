import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const bodyStart = source.indexOf("{", start);
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
    if (char === "\"" || char === "'" || char === "`") {
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

function cssBodiesFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g");
  return [...styles.matchAll(pattern)].map((match) => match[1]);
}

function combinedCssFor(selector) {
  const bodies = cssBodiesFor(selector);
  assert.ok(bodies.length, `Found CSS for ${selector}`);
  return bodies.join("\n");
}

function cssDeclarationsMentioning(selectors) {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selectors.some((selector) => match[1].includes(selector)))
    .map((match) => match[2])
    .join("\n");
}

const renderDaily = extractFunction(app, "renderDaily");

assert.match(
  renderDaily,
  /<div class="day-story">[\s\S]*day-precip-note[\s\S]*day-memory[\s\S]*<\/div>/,
  "daily timing and plan context live in a dedicated story row"
);
assert.match(
  renderDaily,
  /day-precip-note">\$\{escapeHtml\(precipNote\)}/,
  "daily timing copy is preserved in full rather than shortened for layout"
);
assert.match(
  renderDaily,
  /aria-label="\$\{escapeHtml\(dayAria\)}/,
  "the complete condition and timing remain available to assistive technology"
);

const rowCss = combinedCssFor(".day-row");
assert.doesNotMatch(rowCss, /(?:^|;)\s*height\s*:/, "daily rows do not have a fixed height");
assert.doesNotMatch(rowCss, /max-height\s*:/, "daily rows can grow for wrapped and large text");

const conditionCss = combinedCssFor(".day-condition");
const storyCss = combinedCssFor(".day-story");
const timingCss = combinedCssFor(".day-precip-note");
const sharedTextCss = styles.match(/\.day-condition\s*,\s*\.day-precip-note\s*,\s*\.day-memory\s*\{([^}]*)\}/)?.[1] || "";
assert.ok(sharedTextCss, "daily condition and story text share a responsive wrapping rule");
const wrappingCss = `${sharedTextCss}\n${conditionCss}\n${storyCss}\n${timingCss}`;
const allStoryOverrides = cssDeclarationsMentioning([".day-condition", ".day-precip-note", ".day-story"]);

assert.match(`${sharedTextCss}\n${conditionCss}`, /white-space\s*:\s*normal/, "long condition names wrap instead of clipping");
assert.match(`${sharedTextCss}\n${timingCss}`, /white-space\s*:\s*normal/, "long timing conclusions wrap instead of clipping");
assert.doesNotMatch(wrappingCss, /text-overflow\s*:\s*ellipsis/, "condition and story text never use ellipses");
assert.doesNotMatch(wrappingCss, /-webkit-line-clamp|line-clamp\s*:/, "condition and story text have no line clamp");
assert.doesNotMatch(wrappingCss, /overflow\s*:\s*hidden/, "condition and story text are not cut off");
assert.doesNotMatch(wrappingCss, /white-space\s*:\s*nowrap/, "condition and story text remain responsive");
assert.match(wrappingCss, /overflow-wrap\s*:\s*(?:anywhere|break-word)/, "long forecast language can break safely on narrow phones");
assert.doesNotMatch(allStoryOverrides, /text-overflow\s*:\s*ellipsis|-webkit-line-clamp|line-clamp\s*:|white-space\s*:\s*nowrap|overflow\s*:\s*hidden/, "no later desktop, phone, or accessibility override can reintroduce clipping");
assert.ok(
  /grid-column\s*:\s*1\s*\/\s*-1/.test(storyCss)
    || (/grid-area\s*:\s*story/.test(storyCss) && /"story\s+story\s+story"/.test(rowCss)),
  "the story receives the full daily-row width"
);
assert.match(storyCss, /min-width\s*:\s*0/, "the story can shrink safely inside 320px and 390px layouts");

const phoneCss = styles.match(/@media \(max-width: 600px\)\s*\{[\s\S]*?\n\}/)?.[0]
  || styles.match(/@media \(max-width: 480px\)\s*\{[\s\S]*?\n\}/)?.[0]
  || "";
assert.ok(phoneCss, "a phone layout contract exists");
assert.doesNotMatch(phoneCss, /\.day-story\s*\{[^}]*display\s*:\s*none/s, "phone layouts keep the full forecast story visible");
assert.doesNotMatch(phoneCss, /\.day-(?:condition|precip-note)\s*\{[^}]*(?:ellipsis|line-clamp|nowrap|overflow\s*:\s*hidden)/s, "phone overrides cannot reintroduce clipping");

assert.match(rowCss, /min-height\s*:/, "daily rows retain a minimum touch target while still growing");

// These scenarios exercise the same intrinsic-height contract used by the app:
// text is kept verbatim, receives the full grid width, wraps normally, and has
// no fixed/clamped ancestor. That makes visibility independent of glyph metrics.
const fullWidthStory = /grid-column\s*:\s*1\s*\/\s*-1/.test(storyCss)
  || (/grid-area\s*:\s*story/.test(storyCss) && /"story\s+story\s+story"/.test(rowCss));
for (const { viewport, textScale, phrase } of [
  { viewport: 320, textScale: 1, phrase: "Thunderstorms likely late afternoon into evening" },
  { viewport: 390, textScale: 1, phrase: "Rain possible overnight into early tomorrow morning" },
  { viewport: 320, textScale: 2, phrase: "Clouds increase near sunset, then showers become possible" },
  { viewport: 390, textScale: 2, phrase: "Thunderstorms possible late afternoon, easing after sunset" }
]) {
  assert.ok(phrase.length > 40, `${viewport}px at ${textScale}x uses a representative multi-line forecast`);
  assert.ok(fullWidthStory, `${viewport}px at ${textScale}x keeps the story out of the narrow label column`);
  assert.match(wrappingCss, /white-space\s*:\s*normal/, `${viewport}px at ${textScale}x allows the complete story to wrap`);
  assert.doesNotMatch(`${rowCss}\n${storyCss}`, /max-height\s*:|(?:^|;)\s*height\s*:/, `${viewport}px at ${textScale}x allows the row to grow to every wrapped line`);
}

console.log("Daily row responsive layout smoke passed.");
