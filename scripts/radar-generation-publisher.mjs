#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PUBLICATION_PROVIDER = "nearcast-radar-generation-publication";
const INDEX_PROVIDER = "nearcast-generated-radar-index";
const INDEX_VERSION = 1;
const DEFAULT_INDEX_KEY = "radar/mrms/index.json";
const DEFAULT_ARTIFACT_CACHE_CONTROL = "public, max-age=86400, immutable";
const DEFAULT_INDEX_CACHE_CONTROL = "no-store";
const DEFAULT_MAX_PACKS = 80;
const DEFAULT_R2_CONCURRENCY = 16;

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Radar generation publication failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  const result = await publishRadarGenerationArtifacts({
    renderResult: loadRenderResult(args),
    currentIndex: readOptionalJson(args["current-index"]),
    indexOut: args["index-out"],
    indexKey: args["index-key"],
    artifactRoot: args["artifact-root"],
    uploadMode: args["upload-mode"],
    r2LocalDir: args["r2-local-dir"],
    bucket: args.bucket || process.env.RADAR_GENERATION_R2_BUCKET || process.env.MRMS_R2_BUCKET,
    endpoint: args.endpoint || process.env.RADAR_GENERATION_R2_ENDPOINT || process.env.MRMS_R2_ENDPOINT || endpointForAccount(args["account-id"] || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID),
    accessKeyId: args["access-key-id"] || process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: args["secret-access-key"] || process.env.R2_SECRET_ACCESS_KEY,
    concurrency: args.concurrency || process.env.RADAR_GENERATION_R2_UPLOAD_CONCURRENCY || process.env.MRMS_R2_UPLOAD_CONCURRENCY,
    maxPacks: args["max-packs"],
    publicBaseUrl: args["public-base-url"]
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function publishRadarGenerationArtifacts(options = {}) {
  const renderResult = normalizeRenderResult(options.renderResult, options);
  const artifactRoot = path.resolve(options.artifactRoot || renderResult.materialized.artifactRoot);
  const indexKey = safeRelativeKey(options.indexKey || DEFAULT_INDEX_KEY);
  const indexOut = path.resolve(options.indexOut || path.join(artifactRoot, indexKey));
  const maxPacks = positiveInteger(options.maxPacks, DEFAULT_MAX_PACKS);
  const uploadMode = options.uploadMode || "dry-run";
  const pack = normalizePack(renderResult.pack, {
    publicBaseUrl: options.publicBaseUrl || "",
    manifestKey: renderResult.materialized.manifestKey
  });
  const objects = artifactObjects({ artifactRoot, materialized: renderResult.materialized });
  const index = mergeGeneratedRadarIndex({
    currentIndex: options.currentIndex,
    pack,
    maxPacks
  });
  atomicWriteJson(indexOut, index);
  const indexObject = objectForFile({
    artifactRoot: path.dirname(indexOut),
    file: indexOut,
    key: indexKey,
    cacheControl: DEFAULT_INDEX_CACHE_CONTROL
  });
  const plannedObjects = [...objects, indexObject].sort((a, b) => a.key.localeCompare(b.key));
  const upload = await publishObjects(plannedObjects, {
    uploadMode,
    r2LocalDir: options.r2LocalDir,
    r2: {
      bucket: options.bucket,
      endpoint: cleanEndpoint(options.endpoint),
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      concurrency: positiveInteger(options.concurrency, DEFAULT_R2_CONCURRENCY),
      client: options.r2Client || null
    }
  });
  return {
    provider: PUBLICATION_PROVIDER,
    version: 1,
    uploadMode,
    artifactRoot,
    indexOut,
    indexKey,
    packId: pack.id,
    sourceSignature: pack.sourceSignature || renderResult.sourceSignature || "",
    objectCount: plannedObjects.length,
    bytes: plannedObjects.reduce((sum, object) => sum + object.size, 0),
    objects: plannedObjects,
    index,
    upload
  };
}

export function mergeGeneratedRadarIndex({ currentIndex = null, pack, maxPacks = DEFAULT_MAX_PACKS } = {}) {
  if (!pack?.id) throw new Error("missing generated radar pack id");
  const now = new Date().toISOString();
  const existingPacks = Array.isArray(currentIndex?.packs) ? currentIndex.packs : [];
  const freshExisting = existingPacks
    .filter((item) => item?.id && item.id !== pack.id)
    .filter((item) => !packExpired(item));
  const packs = [pack, ...freshExisting]
    .sort(comparePacks)
    .slice(0, Math.max(1, Math.floor(Number(maxPacks) || DEFAULT_MAX_PACKS)));
  const defaultPack = packs.some((item) => item.id === currentIndex?.defaultPack)
    ? currentIndex.defaultPack
    : pack.id;
  return {
    provider: INDEX_PROVIDER,
    version: INDEX_VERSION,
    generatedAt: currentIndex?.generatedAt || now,
    updatedAt: now,
    expiresAt: maxIso(packs.map((item) => item.expiresAt)) || pack.expiresAt || "",
    defaultPack,
    packs
  };
}

export function artifactObjects({ artifactRoot, materialized }) {
  if (!materialized || typeof materialized !== "object") throw new Error("missing materialized artifact paths");
  const root = path.resolve(artifactRoot || materialized.artifactRoot);
  const files = [
    fileEntry(root, materialized.manifestPath, materialized.manifestKey),
    fileEntry(root, materialized.indexPackPath, materialized.indexPackKey),
    ...walkFiles(materialized.tilePath).map((file) => fileEntry(root, file))
  ];
  const unique = new Map();
  files.forEach((entry) => {
    if (!entry) return;
    unique.set(entry.key, objectForFile({
      artifactRoot: root,
      file: entry.file,
      key: entry.key,
      cacheControl: DEFAULT_ARTIFACT_CACHE_CONTROL
    }));
  });
  return [...unique.values()];
}

async function publishObjects(objects, { uploadMode, r2LocalDir, r2 = {} }) {
  if (uploadMode === "dry-run") {
    return {
      mode: uploadMode,
      uploaded: 0,
      sampleKeys: objects.slice(0, 8).map((object) => object.key)
    };
  }
  if (uploadMode === "local-r2") {
    if (!r2LocalDir) throw new Error("missing --r2-local-dir for local-r2 upload mode");
    const root = path.resolve(r2LocalDir);
    objects.forEach((object) => {
      const target = path.join(root, object.key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(object.file, target);
    });
    return {
      mode: uploadMode,
      uploaded: objects.length,
      dir: root,
      sampleKeys: objects.slice(0, 8).map((object) => object.key)
    };
  }
  if (uploadMode === "r2") {
    const client = r2.client || await createR2Client(r2);
    let uploaded = 0;
    await mapLimit(objects, r2.concurrency || DEFAULT_R2_CONCURRENCY, async (object) => {
      await client.putObject({
        key: object.key,
        body: fs.readFileSync(object.file),
        cacheControl: object.cacheControl,
        contentType: object.contentType
      });
      uploaded += 1;
    });
    return {
      mode: uploadMode,
      bucket: r2.bucket || client.bucket || "",
      endpoint: r2.endpoint || client.endpoint || "",
      uploaded,
      concurrency: r2.concurrency || DEFAULT_R2_CONCURRENCY,
      sampleKeys: objects.slice(0, 8).map((object) => object.key)
    };
  }
  throw new Error(`unsupported upload mode: ${uploadMode}`);
}

async function createR2Client(r2 = {}) {
  if (!r2.bucket) throw new Error("missing --bucket or RADAR_GENERATION_R2_BUCKET");
  if (!r2.endpoint) throw new Error("missing --endpoint or CLOUDFLARE_ACCOUNT_ID");
  if (!r2.accessKeyId) throw new Error("missing --access-key-id or R2_ACCESS_KEY_ID");
  if (!r2.secretAccessKey) throw new Error("missing --secret-access-key or R2_SECRET_ACCESS_KEY");
  const sdk = await loadAwsSdk();
  return new R2Client({
    endpoint: r2.endpoint,
    bucket: r2.bucket,
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    sdk
  });
}

class R2Client {
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, sdk }) {
    this.endpoint = endpoint;
    this.bucket = bucket;
    this.sdk = sdk;
    this.client = new sdk.S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  async putObject({ key, body, cacheControl, contentType }) {
    await this.sendWithRetry(new this.sdk.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      CacheControl: cacheControl,
      ContentType: contentType
    }));
  }

  async sendWithRetry(command) {
    const attempts = 4;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.client.send(command);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !shouldRetry(error)) break;
        await sleep(250 * (2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }
}

function normalizeRenderResult(value, options = {}) {
  const result = value && typeof value === "object" ? value : {};
  const materialized = result.materialized && typeof result.materialized === "object"
    ? { ...result.materialized }
    : {};
  if (options.artifactRoot) materialized.artifactRoot = path.resolve(options.artifactRoot);
  if (!materialized.artifactRoot) throw new Error("missing materialized artifact root");
  if (!result.pack && materialized.indexPackPath) {
    result.pack = readJsonFile(materialized.indexPackPath);
  }
  if (!result.pack) throw new Error("missing rendered index pack");
  return {
    ...result,
    materialized
  };
}

function normalizePack(pack, { publicBaseUrl, manifestKey }) {
  const normalized = pack && typeof pack === "object" ? { ...pack } : {};
  if (!normalized.id) throw new Error("missing pack id");
  if (publicBaseUrl) normalized.manifestUrl = joinPublicUrl(publicBaseUrl, manifestKey);
  if (!normalized.manifestUrl && manifestKey) normalized.manifestUrl = manifestKey;
  return normalized;
}

function fileEntry(root, file, key = "") {
  if (!file) return null;
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`missing artifact file: ${file}`);
  }
  return {
    file: resolved,
    key: key ? safeRelativeKey(key) : relativeKey(root, resolved)
  };
}

function objectForFile({ artifactRoot, file, key, cacheControl }) {
  const stat = fs.statSync(file);
  return {
    file,
    key: safeRelativeKey(key || relativeKey(artifactRoot, file)),
    size: stat.size,
    contentType: contentTypeForFile(file),
    cacheControl
  };
}

function walkFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const root = path.resolve(dir);
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      fs.readdirSync(current).forEach((child) => stack.push(path.join(current, child)));
    } else if (stat.isFile()) {
      files.push(current);
    }
  }
  return files.sort();
}

function relativeKey(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file)).split(path.sep).join("/");
  return safeRelativeKey(relative);
}

function safeRelativeKey(value) {
  const key = String(value || "").replace(/^\/+|\/+$/g, "");
  const parts = key.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`unsafe object key: ${value}`);
  }
  return parts.join("/");
}

function comparePacks(a, b) {
  const generatedDelta = Date.parse(b.generatedAt || "") - Date.parse(a.generatedAt || "");
  if (Number.isFinite(generatedDelta) && generatedDelta !== 0) return generatedDelta;
  const expiryDelta = Date.parse(b.expiresAt || "") - Date.parse(a.expiresAt || "");
  if (Number.isFinite(expiryDelta) && expiryDelta !== 0) return expiryDelta;
  return String(a.id).localeCompare(String(b.id));
}

function packExpired(pack) {
  if (pack?.sample) return false;
  const expiresAt = Date.parse(pack?.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function maxIso(values) {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function joinPublicUrl(base, key) {
  const cleanBase = String(base || "").replace(/\/+$/g, "");
  const cleanKey = String(key || "").replace(/^\/+/g, "");
  return `${cleanBase}/${cleanKey}`;
}

function contentTypeForFile(file) {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function loadAwsSdk() {
  try {
    return await import("@aws-sdk/client-s3");
  } catch (error) {
    throw new Error(`missing @aws-sdk/client-s3 dependency for R2 upload: ${error.message}`);
  }
}

function endpointForAccount(accountId) {
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

function cleanEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function shouldRetry(error) {
  const status = error?.$metadata?.httpStatusCode || error?.status;
  return !status || status === 429 || status >= 500;
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function readOptionalJson(file) {
  if (!file) return null;
  return fs.existsSync(file) ? readJsonFile(file) : null;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function loadRenderResult(parsedArgs) {
  if (parsedArgs["render-result"]) return readJsonFile(parsedArgs["render-result"]);
  throw new Error("missing --render-result=PATH");
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  node scripts/radar-generation-publisher.mjs --render-result=/tmp/render-result.json --index-out=/tmp/radar/mrms/index.json
  node scripts/radar-generation-publisher.mjs --render-result=/tmp/render-result.json --upload-mode=local-r2 --r2-local-dir=/tmp/r2
  node scripts/radar-generation-publisher.mjs --render-result=/tmp/render-result.json --upload-mode=r2 --bucket=nearcast-radar

Options:
  --render-result=PATH        JSON result from scripts/radar-generation-renderer.mjs.
  --current-index=PATH        Existing generated-radar index to merge into.
  --index-out=PATH            Output merged generated-radar index path.
  --index-key=KEY             Object key for the merged index. Defaults to radar/mrms/index.json.
  --artifact-root=PATH        Override materialized artifact root.
  --upload-mode=MODE          dry-run, local-r2, or r2. Defaults to dry-run.
  --r2-local-dir=PATH         Local mirror root for upload-mode=local-r2 smoke tests.
  --bucket=NAME               R2 bucket. Also reads RADAR_GENERATION_R2_BUCKET or MRMS_R2_BUCKET.
  --endpoint=URL              R2 S3 endpoint. Defaults from CLOUDFLARE_ACCOUNT_ID.
  --account-id=ID             Cloudflare account id for default endpoint.
  --access-key-id=KEY         R2 access key id. Also reads R2_ACCESS_KEY_ID.
  --secret-access-key=KEY     R2 secret access key. Also reads R2_SECRET_ACCESS_KEY.
  --concurrency=16            Concurrent R2 putObject requests.
  --public-base-url=URL       Public origin used to rewrite pack manifestUrl.
  --max-packs=80              Maximum packs to keep in the merged index.

R2 mode requires @aws-sdk/client-s3 in the execution environment.
`);
}
