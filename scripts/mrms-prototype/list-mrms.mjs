#!/usr/bin/env node

const BUCKET_URL = "https://noaa-mrms-pds.s3.amazonaws.com/";
const DEFAULT_REGION = "CONUS";
const DEFAULT_LIMIT = 12;
const DEFAULT_MAX_KEYS = 1000;
const DEFAULT_DAYS_BACK = 2;
const CATALOG_MATCH = "Reflectivity|PrecipRate|RadarOnly_QPE_15M|SeamlessHSR";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`MRMS discovery failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const region = cleanSegment(args.region || DEFAULT_REGION);
  const product = args.product ? cleanSegment(args.product) : "";
  const limit = numberArg(args.limit, DEFAULT_LIMIT);
  const maxKeys = numberArg(args["max-keys"], DEFAULT_MAX_KEYS);

  if (product) {
    const daysBack = args.date ? 0 : numberArg(args["days-back"], DEFAULT_DAYS_BACK);
    const candidates = candidateDates(args.date, daysBack);
    const result = await findProductObjects({ region, product, dates: candidates, maxKeys });
    printResult({
      mode: "product",
      region,
      product,
      date: result.date,
      prefix: result.prefix,
      objects: sortObjectsNewestFirst(result.objects).slice(0, limit),
      limit
    });
    return;
  }

  const prefix = normalizePrefix(args.prefix || `${region}/`);
  const match = args.all ? "" : (args.match || CATALOG_MATCH);
  const page = await listS3({ prefix, delimiter: "/", maxKeys });
  const commonPrefixes = filterValues(page.commonPrefixes, match).slice(0, limit);
  const objects = filterObjects(page.objects, match).slice(0, limit);
  printResult({
    mode: "catalog",
    prefix,
    commonPrefixes,
    objects,
    limit,
    match
  });
}

async function findProductObjects({ region, product, dates, maxKeys }) {
  for (const date of dates) {
    const prefix = `${region}/${product}/${date}/`;
    const page = await listS3({ prefix, maxKeys });
    if (page.objects.length) return { date, prefix, objects: page.objects };
  }
  throw new Error(`no objects found for ${region}/${product} across ${dates.join(", ")}`);
}

async function listS3({ prefix = "", delimiter = "", maxKeys = DEFAULT_MAX_KEYS, continuationToken = "" }) {
  const url = new URL(BUCKET_URL);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", String(maxKeys));
  if (prefix) url.searchParams.set("prefix", prefix);
  if (delimiter) url.searchParams.set("delimiter", delimiter);
  if (continuationToken) url.searchParams.set("continuation-token", continuationToken);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);

  const xml = await response.text();
  return {
    bucket: textForTag(xml, "Name"),
    prefix: textForTag(xml, "Prefix"),
    keyCount: numberArg(textForTag(xml, "KeyCount"), 0),
    maxKeys: numberArg(textForTag(xml, "MaxKeys"), maxKeys),
    isTruncated: textForTag(xml, "IsTruncated") === "true",
    nextContinuationToken: textForTag(xml, "NextContinuationToken"),
    commonPrefixes: blocksForTag(xml, "CommonPrefixes").map((block) => textForTag(block, "Prefix")).filter(Boolean),
    objects: blocksForTag(xml, "Contents").map(parseObject).filter((item) => item.key)
  };
}

function parseObject(block) {
  const key = textForTag(block, "Key");
  const lastModified = textForTag(block, "LastModified");
  const size = numberArg(textForTag(block, "Size"), 0);
  const observedAt = observedTimeFromKey(key);
  return {
    key,
    observedAt: observedAt ? observedAt.toISOString() : "",
    lastModified,
    size,
    url: objectUrl(key)
  };
}

function printResult(result) {
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("MRMS bucket: noaa-mrms-pds");
  if (result.mode === "catalog") {
    console.log(`Catalog prefix: ${result.prefix}`);
    if (result.match) console.log(`Filter: ${result.match}`);
    if (result.commonPrefixes?.length) {
      console.log("");
      console.log("Product/date prefixes:");
      result.commonPrefixes.forEach((prefix) => console.log(`- ${prefix}`));
    }
  } else {
    console.log(`Product: ${result.region}/${result.product}`);
    console.log(`Date prefix: ${result.prefix}`);
  }

  if (result.objects?.length) {
    console.log("");
    console.log(`Objects (${result.objects.length}, newest first when timestamps are available):`);
    result.objects.forEach((object) => {
      const mb = (object.size / 1024 / 1024).toFixed(2);
      const observed = object.observedAt ? `obs ${object.observedAt}` : "obs unknown";
      console.log(`- ${observed} - ${mb} MB`);
      console.log(`  ${object.url}`);
    });
  }

  if (!result.commonPrefixes?.length && !result.objects?.length) {
    console.log("No matching prefixes or objects.");
  }
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      parsed[body] = true;
    } else {
      parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
    }
  });
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/list-mrms.mjs
  node scripts/mrms-prototype/list-mrms.mjs --all --limit=40
  node scripts/mrms-prototype/list-mrms.mjs --product=MergedReflectivityQCComposite_00.50
  node scripts/mrms-prototype/list-mrms.mjs --product=PrecipRate_00.00 --date=20260628 --limit=8
  node scripts/mrms-prototype/list-mrms.mjs --product=ReflectivityAtLowestAltitude_00.50 --json

Options:
  --region=CONUS             MRMS region prefix. Defaults to CONUS.
  --prefix=CONUS/            Raw S3 prefix for catalog browsing.
  --product=NAME             Product prefix under the region.
  --date=YYYYMMDD            Product date folder. Defaults to today UTC with fallback days.
  --days-back=2              Days to walk back when --date is omitted.
  --match=REGEX              Catalog filter. Defaults to radar-relevant products.
  --all                      Disable the default catalog filter.
  --limit=12                 Max rows to print.
  --max-keys=1000            Max S3 keys per request.
  --json                     Print machine-readable JSON.
`);
}

function candidateDates(dateArg, daysBack) {
  if (dateArg && dateArg !== "today") return [dateArg];
  const start = new Date();
  const dates = [];
  for (let offset = 0; offset <= daysBack; offset += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - offset));
    dates.push(date.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return dates;
}

function observedTimeFromKey(key) {
  const match = String(key || "").match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
  if (!match) return null;
  const [, ymd, hms] = match;
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
    Number(hms.slice(0, 2)),
    Number(hms.slice(2, 4)),
    Number(hms.slice(4, 6))
  ));
}

function sortObjectsNewestFirst(objects) {
  return [...objects].sort((a, b) => {
    const aTime = Date.parse(a.observedAt || a.lastModified || "");
    const bTime = Date.parse(b.observedAt || b.lastModified || "");
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

function filterValues(values, match) {
  if (!match) return values;
  const regex = new RegExp(match, "i");
  return values.filter((value) => regex.test(value));
}

function filterObjects(objects, match) {
  if (!match) return objects;
  const regex = new RegExp(match, "i");
  return objects.filter((object) => regex.test(object.key));
}

function blocksForTag(xml, tag) {
  return [...String(xml || "").matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);
}

function textForTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return decodeXml(match?.[1] || "");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function numberArg(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizePrefix(value) {
  const trimmed = String(value || "").replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function cleanSegment(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function objectUrl(key) {
  return `${BUCKET_URL}${String(key || "").split("/").map(encodeURIComponent).join("/")}`;
}
