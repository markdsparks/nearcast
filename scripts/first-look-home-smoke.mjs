import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
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

const savedMetric = extractFunction(app, "savedHourlyHeroMetric");
const savedInterval = extractFunction(app, "savedHourlyHeroInterval");
const resetLens = extractFunction(app, "resetHomeHourlyLens");
const setMetric = extractFunction(app, "setHourlyHeroMetric");
const setInterval = extractFunction(app, "setHourlyHeroInterval");
assert.match(app, /hourlyHeroMetric:\s*"temperature"[\s\S]*hourlyHeroInterval:\s*"hourly"/, "Home starts on the stable Hourly + Temperature view");
assert.match(savedMetric, /state\.hourlyHeroMetric[\s\S]*"temperature"/, "Home metric is session state, not a remembered launch preference");
assert.match(savedInterval, /state\.hourlyHeroInterval[\s\S]*"hourly"/, "Home interval is session state, not a remembered launch preference");
assert.doesNotMatch(`${savedMetric}\n${savedInterval}\n${setMetric}\n${setInterval}`, /localStorage\.(?:getItem|setItem)/, "Home inspection lenses never persist into another launch");
assert.match(resetLens, /hourlyHeroMetric = "temperature"[\s\S]*hourlyHeroInterval = "hourly"[\s\S]*removeItem\(HOURLY_HERO_METRIC_KEY\)[\s\S]*removeItem\(HOURLY_HERO_INTERVAL_KEY\)/, "legacy sticky Home settings are removed during migration");
assert.match(extractFunction(app, "warmStartForecast"), /resetHomeHourlyLens\(\)/, "a cached app launch resets the Home lens");
assert.match(extractFunction(app, "loadPlace"), /!previousPlace \|\| !samePlanPlace\(previousPlace, nextPlace\)[\s\S]*resetHomeHourlyLens\(\)/, "switching locations resets the Home lens without disrupting a same-place refresh");

assert.match(html, /<h2>7-Day Outlook<\/h2>/, "the primary planning horizon is seven days");
assert.match(html, /id="extendedDailyPanel"[^>]*hidden[\s\S]*<details[^>]*id="extendedDaily"[\s\S]*Extended outlook[\s\S]*Lower confidence · Days 8–14[\s\S]*id="extendedDailyList"/, "days 8–14 live in a collapsed, plainly qualified section");
const hierarchy = extractFunction(app, "arrangeForecastHierarchy");
assert.match(hierarchy, /launch\.after\(nowcast, hourlyPanel, dailyPanel, map, extendedDailyPanel, els\.familyPlacesPeek/, "Home reads Outlook/Hourly, seven days, Map, extended days, then earned family exceptions");
const renderDaily = extractFunction(app, "renderDaily");
assert.match(renderDaily, /const primaryRows = dayRows\.slice\(0, 7\)[\s\S]*const extendedRows = dayRows\.slice\(7, 14\)[\s\S]*els\.daily\.innerHTML = primaryRows\.join[\s\S]*els\.extendedDailyList\.innerHTML = extendedRows\.join/, "daily rendering splits the first seven days from the lower-confidence horizon");
assert.match(renderDaily, /extendedDailyPanel\.hidden = extendedRows\.length === 0/, "the extended disclosure disappears when the provider has no additional days");
assert.match(extractFunction(app, "dailyEditorialConditionLabel"), /most of day[\s\S]*early[\s\S]*Mixed conditions/, "a calm base condition is qualified when a different material event occurs later");
assert.match(renderDaily, /dailyEditorialConditionLabel\(data, day, index\)/, "daily rows use the coherent editorial condition");

const homeException = extractFunction(app, "familyPlaceHomeException");
assert.match(homeException, /glance\.alert\?\.event[\s\S]*hasStorm[\s\S]*hasPrecip[\s\S]*Math\.abs\(there - here\) >= threshold/, "a family place earns Home space only for alerts, precipitation/storms, or a material temperature difference");
assert.doesNotMatch(extractFunction(app, "familyPlacesForHome"), /slice\(0, 4\)/, "every saved place is evaluated before the exception rail is capped");
assert.match(extractFunction(app, "familyPlacesForHomeExceptions"), /familyPlacesForHome\(\)[\s\S]*familyPlaceHomeException[\s\S]*filter[\s\S]*sort[\s\S]*exception\.priority[\s\S]*slice\(0, 4\)/, "ordinary saved places are filtered out, official alerts sort first, and only then is Home capped");
assert.doesNotMatch(homeException, /tone:\s*hasStorm \? "warning"/, "a modeled storm chance never borrows official-warning red");
const renderFamily = extractFunction(app, "renderFamilyPlacesPeek");
assert.match(renderFamily, /familyPlacesForHomeExceptions\(\)[\s\S]*root\.hidden = !exceptions\.length[\s\S]*Around us/, "the Around Us rail is absent until another place has earned attention");
assert.match(extractFunction(app, "updateFamilyPlacePeek"), /renderFamilyPlacesPeek\(\)/, "fresh glance data can add or remove a family exception card");
assert.match(styles, /\.extended-daily > summary[\s\S]*min-height:\s*58px[\s\S]*\.extended-daily-list/, "the extended forecast disclosure has a clear touch target and native progressive disclosure");

console.log("First Look Home smoke passed.");
