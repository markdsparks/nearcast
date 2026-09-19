import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Found ${name} in app.js`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
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

  assert.fail(`Could not extract ${name} from app.js`);
}

const functionNames = [
  "queryRoutePlace",
  "reactiveSkyIsCurrentLocation",
  "normalizeQualifierKey",
  "normalizedPlaceAlias",
  "normalizePlace",
  "canonicalPlaceName",
  "placeLabel",
  "joinUniquePlaceParts",
  "placeCountryCode",
  "slug",
  "placeFromReverseGeocode",
  "nativePreviewPlaceRecord"
];
const sandbox = {
  routeValues: {},
  state: { savedPlaces: [] },
  lastPlace: null,
  Intl
};
vm.createContext(sandbox);
vm.runInContext(`
  function queryValue(...names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(globalThis.routeValues, name)) {
        return globalThis.routeValues[name];
      }
    }
    return null;
  }
  function readStorageJson(key) {
    return key === "weather-last-place" ? globalThis.lastPlace : null;
  }
  ${functionNames.map(extractFunction).join("\n")}
  globalThis.api = { queryRoutePlace, reactiveSkyIsCurrentLocation, normalizePlace, canonicalPlaceName, placeLabel };
`, sandbox);

const { queryRoutePlace, reactiveSkyIsCurrentLocation, normalizePlace, canonicalPlaceName, placeLabel } = sandbox.api;

const legacyCurrentLocation = normalizePlace({
  id: "gps-legacy-current",
  name: "Current Location",
  latitude: 38.72,
  longitude: -89.96
});
assert.equal(
  Object.prototype.hasOwnProperty.call(legacyCurrentLocation, "followsCurrentLocation"),
  false,
  "normalization preserves an absent legacy location-intent flag"
);
sandbox.state.savedPlaces = [];
assert.equal(
  reactiveSkyIsCurrentLocation(legacyCurrentLocation),
  true,
  "an unsaved legacy GPS last-place migrates as Current Location"
);
sandbox.state.savedPlaces = [legacyCurrentLocation];
assert.equal(
  reactiveSkyIsCurrentLocation(legacyCurrentLocation),
  false,
  "a deliberately saved legacy GPS place remains fixed"
);
assert.equal(
  reactiveSkyIsCurrentLocation({ ...legacyCurrentLocation, followsCurrentLocation: true }),
  true,
  "an explicit Current Location flag wins"
);
assert.equal(
  reactiveSkyIsCurrentLocation({ ...legacyCurrentLocation, followsCurrentLocation: false }),
  false,
  "an explicit fixed-place flag wins"
);

// A browser-resolved Current Location must carry Nominatim's declared
// country into the narrow native preview handoff. Native alert coverage is
// intentionally never inferred from a coordinate alone, so dropping this
// code would turn a successful US point response into an unavailable warning.
const reverseFallback = {
  id: "gps-38.724--89.956",
  name: "Current Location",
  admin1: "",
  country: "",
  latitude: 38.7237,
  longitude: -89.9559,
  followsCurrentLocation: true
};
const reverseUS = sandbox.placeFromReverseGeocode({
  address: {
    city: "Maryville",
    state: "Illinois",
    country: "United States",
    country_code: "us"
  }
}, reverseFallback);
assert.equal(reverseUS.countryCode, "US", "Reverse-geocoded Current Location retains its declared US coverage");
const nativeCurrentLocation = sandbox.nativePreviewPlaceRecord({ ...reverseFallback, ...reverseUS });
assert.equal(nativeCurrentLocation?.countryCode, "US", "Declared Current Location coverage reaches native official-alert checks");
const malformedReverse = sandbox.placeFromReverseGeocode({
  address: { city: "Maryville", country_code: "USA" }
}, reverseFallback);
assert.equal(
  sandbox.nativePreviewPlaceRecord({ ...reverseFallback, ...malformedReverse })?.countryCode,
  undefined,
  "Malformed reverse-geocoder coverage cannot establish native alert coverage"
);

const polluted = {
  id: "maryville",
  name: "Maryville, United States, United States, United States",
  admin1: "",
  country: "United States",
  countryCode: "US",
  latitude: 38.7237,
  longitude: -89.9559
};
const repaired = normalizePlace(polluted);
assert.equal(repaired.name, "Maryville");
assert.equal(placeLabel(repaired), "Maryville, United States");

const maryville = normalizePlace({
  id: "maryville",
  name: "Maryville, Illinois",
  admin1: "Illinois",
  country: "United States",
  countryCode: "US",
  latitude: 38.7237,
  longitude: -89.9559
});
assert.equal(maryville.name, "Maryville");
assert.equal(placeLabel(maryville), "Maryville, Illinois");

const paris = normalizePlace({
  name: "Paris, Île-de-France, France",
  admin1: "Île-de-France",
  country: "France",
  countryCode: "FR",
  latitude: 48.8566,
  longitude: 2.3522
});
assert.equal(paris.name, "Paris");
assert.equal(placeLabel(paris), "Paris, Île-de-France, France");

const singapore = normalizePlace({
  name: "Singapore, Singapore",
  admin1: "",
  country: "Singapore",
  countryCode: "SG",
  latitude: 1.3521,
  longitude: 103.8198
});
assert.equal(singapore.name, "Singapore");
assert.equal(placeLabel(singapore), "Singapore");

assert.equal(
  canonicalPlaceName({ name: "Foo, Bar", admin1: "Example State", country: "Example Country" }),
  "Foo, Bar",
  "legitimate comma-containing locality names remain intact"
);

sandbox.state.savedPlaces = [maryville];
sandbox.lastPlace = polluted;
sandbox.routeValues = {
  source: "widget",
  placeName: "Maryville, United States, United States",
  latitude: String(maryville.latitude),
  longitude: String(maryville.longitude)
};

for (let tap = 0; tap < 5; tap += 1) {
  const routed = queryRoutePlace();
  assert.equal(routed.name, "Maryville");
  assert.equal(routed.admin1, "Illinois");
  assert.equal(placeLabel(routed), "Maryville, Illinois");
  sandbox.state.savedPlaces = [routed];
  sandbox.lastPlace = routed;
  sandbox.routeValues = {
    source: "widget",
    placeName: routed.name,
    admin1: routed.admin1,
    country: routed.country,
    countryCode: routed.countryCode,
    latitude: String(routed.latitude),
    longitude: String(routed.longitude)
  };
}

console.log("place-label widget round-trip fixtures passed");
