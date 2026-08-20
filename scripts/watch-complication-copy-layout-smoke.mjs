import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [complications, snapshot] = await Promise.all([
  readFile(
    path.join(root, "native/ios/NearcastWatchComplications/NearcastWatchComplications.swift"),
    "utf8"
  ),
  readFile(path.join(root, "native/ios/Shared/NearcastWidgetSnapshot.swift"), "utf8")
]);

function declarationSource(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);

  const brace = source.indexOf("{", start);
  assert.notEqual(brace, -1, `missing body for ${declaration}`);

  let depth = 0;
  let stringDelimiter = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const character = source[index];
    if (stringDelimiter) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === stringDelimiter) {
        stringDelimiter = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      stringDelimiter = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated body for ${declaration}`);
}

const requiredAccessoryFamilies = [
  ".accessoryCircular",
  ".accessoryCorner",
  ".accessoryRectangular",
  ".accessoryInline"
];

for (const widget of [
  "NearcastNextComplication",
  "NearcastPlanComplication",
  "NearcastRainComplication",
  "NearcastWindComplication"
]) {
  const source = declarationSource(complications, `struct ${widget}`);
  for (const family of requiredAccessoryFamilies) {
    assert.ok(source.includes(family), `${widget} supports ${family}`);
  }
}

for (const view of [
  "NearcastNextComplicationView",
  "NearcastPlanComplicationView",
  "NearcastRainComplicationView",
  "NearcastWindComplicationView"
]) {
  const source = declarationSource(complications, `private struct ${view}`);
  for (const family of [".accessoryInline", ".accessoryCircular", ".accessoryCorner"]) {
    assert.ok(source.includes(`case ${family}:`), `${view} has an intentional ${family} composition`);
  }
  assert.match(source, /default:/, `${view} has an intentional rectangular composition`);
  assert.match(
    source,
    /accessibility(?:Label|Value)\(/,
    `${view} exposes complete meaning without relying on its compact visual text`
  );
}

const storyView = declarationSource(complications, "private struct NearcastCompanionStoryRectangle");
assert.doesNotMatch(
  storyView,
  /Text\(story\.(?:headline|timing)\)/,
  "the compact rectangular surface never renders the full app story verbatim"
);
assert.match(
  storyView,
  /nearcastCompactStoryCopy\(/,
  "the story rectangle derives family-sized visual copy before rendering"
);
assert.match(
  storyView,
  /Text\(copy\.title\)[\s\S]*?\.lineLimit\(1\)/,
  "the compact title occupies one intentional visual line"
);
assert.match(
  storyView,
  /Text\(timing\)[\s\S]*?\.lineLimit\(1\)/,
  "the compact timing occupies at most one supporting line"
);
assert.doesNotMatch(
  storyView,
  /minimumScaleFactor|truncationMode/,
  "the complication does not make unreadable scaling or ellipsis its layout strategy"
);
assert.match(
  storyView,
  /accessibilityValue\([\s\S]*story\.headline[\s\S]*story\.timing[\s\S]*story\.placeName[\s\S]*story\.source/,
  "VoiceOver retains the complete canonical story, timing, place, and source"
);

const compactCopy = declarationSource(snapshot, "func nearcastCompactStoryCopy");
const compactTitle = declarationSource(snapshot, "private func nearcastCompactStoryTitle");
assert.match(
  compactCopy,
  /NearcastCompactStoryCopy/,
  "compact story copy has a dedicated presentation contract"
);
assert.match(
  compactTitle,
  /storm|thunder/i,
  "storm headlines collapse to a compact weather category"
);
assert.match(
  compactTitle,
  /rain|shower|precip/i,
  "rain headlines collapse to a compact weather category"
);
assert.match(
  compactTitle,
  /snow|ice/i,
  "winter headlines collapse to a compact weather category"
);
assert.match(
  compactTitle,
  /wind|gust/i,
  "wind headlines collapse to a compact weather category"
);
assert.doesNotMatch(
  compactCopy,
  /return\s+NearcastCompactStoryCopy\([^)]*story\.headline/,
  "the compact title cannot fall straight back to an unbounded app headline"
);

const compactCopyContract = declarationSource(snapshot, "struct NearcastCompactStoryCopy");
assert.match(compactCopyContract, /let title: String/, "compact copy exposes one bounded title");
assert.match(compactCopyContract, /let timing: String\?/, "compact copy exposes one optional timing line");

const visualTitleLimit = snapshot.match(/nearcastCompactStoryTitleMaximumCharacters\s*=\s*(\d+)/)?.[1];
const visualTimingLimit = snapshot.match(/nearcastCompactStoryTimingMaximumCharacters\s*=\s*(\d+)/)?.[1];
assert.ok(visualTitleLimit, "compact complication declares a title character budget");
assert.ok(visualTimingLimit, "compact complication declares a timing character budget");
assert.ok(Number(visualTitleLimit) <= 20, "compact complication titles stay within 20 characters");
assert.ok(Number(visualTimingLimit) <= 22, "compact complication timing stays within 22 characters");
assert.match(
  snapshot,
  /nearcastCompactWords\([^)]*maximumCharacters:\s*nearcastCompactStoryTitleMaximumCharacters/,
  "the title budget is enforced before SwiftUI lays out the text"
);
assert.match(
  snapshot,
  /nearcastCompactWords\([^)]*maximumCharacters:\s*nearcastCompactStoryTimingMaximumCharacters/,
  "the timing budget is enforced before SwiftUI lays out the text"
);

assert.doesNotMatch(
  storyView,
  /"Thunderstorms possible"|"6:00 PM tonight–2:00 AM tomorrow"/,
  "the reported long-form failure is not baked into the compact surface"
);

console.log("PASS  Watch complication compact copy and layout contract");
