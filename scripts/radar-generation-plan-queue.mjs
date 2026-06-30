#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLAN_PROVIDER = "nearcast-radar-generation-plan";
const MARKER_PROVIDER = "nearcast-radar-generation-plan-marker";
const DEFAULT_PLAN_STORE_PREFIX = "radar/mrms/plans";
const DEFAULT_PLAN_OUTPUT_PREFIX = "radar/mrms/on-demand-preview";
const DEFAULT_PROCESSED_PREFIX = "radar/mrms/processed-plans";
const DEFAULT_PLAN_OUT = "/tmp/radar-generation-plan.json";
const DEFAULT_SELECTION_OUT = "/tmp/radar-generation-plan-selection.json";
const DEFAULT_MARKER_OUT = "/tmp/radar-generation-plan-marker.json";
const DEFAULT_SCAN_LIMIT = 1000;
const DEFAULT_MAX_AGE_MINUTES = 45;

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Radar generation plan queue failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help || !args._.length) {
    printHelp();
    return;
  }
  const command = args._[0];
  if (command === "select") {
    const result = await selectPendingPlanFromR2(optionsFromArgs(args));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "mark") {
    const result = await markPlanFromR2(optionsFromArgs(args));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "marker-file") {
    const result = writeMarkerFile(optionsFromArgs(args));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`unsupported command: ${command}`);
}

export async function selectPendingPlanFromR2(options = {}) {
  const config = normalizeConfig(options);
  const client = options.r2Client || await createR2Client(config);
  const listPrefix = joinKey(config.planStorePrefix, config.planOutputPrefix);
  const objects = await client.listObjects({
    prefix: listPrefix,
    maxKeys: config.scanLimit
  });
  const candidates = pendingPlanCandidates(objects, config);
  const skipped = [];

  for (const candidate of candidates) {
    if (await client.objectExists(candidate.markerKey)) {
      skipped.push({ ...candidateSummary(candidate), reason: "already-marked" });
      continue;
    }
    const plan = await client.getJson(candidate.objectKey);
    const validation = validatePlan(plan);
    if (!validation.valid) {
      skipped.push({ ...candidateSummary(candidate), reason: "invalid-plan", errors: validation.errors });
      continue;
    }
    const selected = {
      provider: "nearcast-radar-generation-plan-selection",
      version: 1,
      selected: true,
      selectedAt: new Date(config.now).toISOString(),
      bucket: config.bucket,
      objectKey: candidate.objectKey,
      objectPath: `${config.bucket}/${candidate.objectKey}`,
      planKey: candidate.planKey,
      markerKey: candidate.markerKey,
      lastModified: candidate.lastModified,
      size: candidate.size,
      requestId: plan.requestId || "",
      dedupeKey: plan.dedupeKey || "",
      plannedAt: plan.plannedAt || "",
      outputPrefix: plan.output?.prefixTemplate || "",
      skipped
    };
    writeJson(config.planOut, plan);
    writeJson(config.selectionOut, selected);
    return selected;
  }

  const empty = {
    provider: "nearcast-radar-generation-plan-selection",
    version: 1,
    selected: false,
    selectedAt: new Date(config.now).toISOString(),
    bucket: config.bucket,
    listPrefix,
    scanned: objects.length,
    candidates: candidates.length,
    skipped
  };
  writeJson(config.selectionOut, empty);
  return empty;
}

export async function markPlanFromR2(options = {}) {
  const config = normalizeConfig(options);
  const selection = readJson(options.selection || config.selectionOut);
  if (!selection?.selected) {
    return {
      provider: MARKER_PROVIDER,
      version: 1,
      marked: false,
      reason: "no-selected-plan"
    };
  }
  const client = options.r2Client || await createR2Client(config);
  const marker = buildPlanMarker(selection, config, {
    renderResult: optionalJson(options.renderResult),
    publication: optionalJson(options.publication)
  });
  await client.putJson(selection.markerKey, marker);
  return {
    provider: MARKER_PROVIDER,
    version: 1,
    marked: true,
    markerKey: selection.markerKey,
    status: marker.status,
    packId: marker.packId
  };
}

export function writeMarkerFile(options = {}) {
  const config = normalizeConfig(options);
  const selection = readJson(options.selection || config.selectionOut);
  const marker = buildPlanMarker(selection, config, {
    renderResult: optionalJson(options.renderResult),
    publication: optionalJson(options.publication)
  });
  const markerOut = options.markerOut || DEFAULT_MARKER_OUT;
  writeJson(markerOut, marker);
  return {
    provider: MARKER_PROVIDER,
    version: 1,
    markerOut,
    markerKey: marker.markerKey,
    status: marker.status,
    packId: marker.packId
  };
}

export function buildPlanMarker(selection, config = {}, { renderResult = null, publication = null } = {}) {
  return {
    provider: MARKER_PROVIDER,
    version: 1,
    status: config.status || "processed",
    markedAt: new Date(config.now || new Date().toISOString()).toISOString(),
    bucket: selection?.bucket || config.bucket || "",
    objectKey: selection?.objectKey || "",
    objectPath: selection?.objectPath || "",
    planKey: selection?.planKey || "",
    markerKey: selection?.markerKey || "",
    requestId: selection?.requestId || renderResult?.requestId || "",
    dedupeKey: selection?.dedupeKey || renderResult?.dedupeKey || "",
    packId: publication?.packId || renderResult?.pack?.id || "",
    sourceSignature: publication?.sourceSignature || renderResult?.sourceSignature || "",
    uploadMode: publication?.uploadMode || "",
    uploaded: publication?.upload?.uploaded ?? null,
    objectCount: publication?.objectCount ?? null,
    manifestUrl: renderResult?.pack?.manifestUrl || ""
  };
}

export function pendingPlanCandidates(objects = [], options = {}) {
  const config = normalizeStaticConfig(options);
  return objects
    .map((object) => normalizeObject(object))
    .filter((object) => object.key.endsWith("/plan.json"))
    .map((object) => candidateForObject(object, config))
    .filter(Boolean)
    .filter((candidate) => !candidateExpired(candidate, config))
    .sort((a, b) => {
      const timeDelta = Date.parse(b.lastModified || "") - Date.parse(a.lastModified || "");
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
      return b.objectKey.localeCompare(a.objectKey);
    })
    .slice(0, config.scanLimit);
}

export function markerKeyForPlanKey(planKey, options = {}) {
  const config = normalizeStaticConfig(options);
  return joinKey(config.processedPrefix, planKey);
}

export function planKeyFromObjectKey(objectKey, options = {}) {
  const config = normalizeStaticConfig(options);
  const key = cleanKey(objectKey);
  const prefix = cleanKey(config.planStorePrefix);
  if (!key.startsWith(`${prefix}/`)) return "";
  return key.slice(prefix.length + 1);
}

function candidateForObject(object, config) {
  const planKey = planKeyFromObjectKey(object.key, config);
  if (!planKey) return null;
  if (!planKey.startsWith(`${config.planOutputPrefix}/`)) return null;
  return {
    objectKey: object.key,
    planKey,
    markerKey: markerKeyForPlanKey(planKey, config),
    lastModified: object.lastModified,
    size: object.size
  };
}

function candidateExpired(candidate, config) {
  if (!config.maxAgeMinutes) return false;
  const modifiedAt = Date.parse(candidate.lastModified || "");
  if (!Number.isFinite(modifiedAt)) return false;
  return modifiedAt < Date.parse(config.now) - config.maxAgeMinutes * 60 * 1000;
}

function candidateSummary(candidate) {
  return {
    objectKey: candidate.objectKey,
    planKey: candidate.planKey,
    markerKey: candidate.markerKey,
    lastModified: candidate.lastModified
  };
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") errors.push("plan");
  if (plan?.provider !== PLAN_PROVIDER) errors.push("provider");
  if (!plan?.requestId) errors.push("requestId");
  if (!plan?.dedupeKey) errors.push("dedupeKey");
  if (!plan?.output?.planKey) errors.push("output.planKey");
  if (!plan?.output?.manifestKeyTemplate) errors.push("output.manifestKeyTemplate");
  return { valid: errors.length === 0, errors };
}

async function createR2Client(config) {
  if (!config.bucket) throw new Error("missing --bucket or RADAR_GENERATION_STATE_R2_BUCKET");
  if (!config.endpoint) throw new Error("missing --endpoint or CLOUDFLARE_ACCOUNT_ID");
  if (!config.accessKeyId) throw new Error("missing --access-key-id or R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) throw new Error("missing --secret-access-key or R2_SECRET_ACCESS_KEY");
  const sdk = await loadAwsSdk();
  return new R2Client({
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sdk
  });
}

class R2Client {
  constructor({ bucket, endpoint, accessKeyId, secretAccessKey, sdk }) {
    this.bucket = bucket;
    this.endpoint = endpoint;
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

  async listObjects({ prefix, maxKeys }) {
    const objects = [];
    let ContinuationToken;
    do {
      const response = await this.client.send(new this.sdk.ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(Math.max(maxKeys - objects.length, 1), 1000),
        ContinuationToken
      }));
      for (const item of response.Contents || []) {
        objects.push(normalizeObject({
          key: item.Key,
          lastModified: item.LastModified,
          size: item.Size
        }));
        if (objects.length >= maxKeys) break;
      }
      ContinuationToken = response.IsTruncated && objects.length < maxKeys
        ? response.NextContinuationToken
        : null;
    } while (ContinuationToken);
    return objects;
  }

  async objectExists(key) {
    try {
      await this.client.send(new this.sdk.HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return true;
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode || error?.status;
      if (status === 404 || error?.name === "NotFound") return false;
      throw error;
    }
  }

  async getJson(key) {
    const response = await this.client.send(new this.sdk.GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    }));
    return JSON.parse(await bodyToString(response.Body));
  }

  async putJson(key, value) {
    await this.client.send(new this.sdk.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: `${JSON.stringify(value, null, 2)}\n`,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store"
    }));
  }
}

async function bodyToString(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function loadAwsSdk() {
  try {
    return await import("@aws-sdk/client-s3");
  } catch (error) {
    throw new Error(`missing @aws-sdk/client-s3 dependency for R2 plan queue: ${error.message}`);
  }
}

function optionsFromArgs(parsed) {
  return {
    bucket: parsed.bucket,
    endpoint: parsed.endpoint,
    accountId: parsed["account-id"],
    accessKeyId: parsed["access-key-id"],
    secretAccessKey: parsed["secret-access-key"],
    planStorePrefix: parsed["plan-store-prefix"],
    planOutputPrefix: parsed["plan-output-prefix"],
    processedPrefix: parsed["processed-prefix"],
    scanLimit: parsed["scan-limit"],
    maxAgeMinutes: parsed["max-age-minutes"],
    planOut: parsed["plan-out"],
    selectionOut: parsed["selection-out"],
    selection: parsed.selection,
    renderResult: parsed["render-result"],
    publication: parsed.publication,
    markerOut: parsed["marker-out"],
    status: parsed.status
  };
}

function normalizeConfig(options = {}) {
  return {
    ...normalizeStaticConfig(options),
    bucket: options.bucket || process.env.RADAR_GENERATION_STATE_R2_BUCKET || "nearcast-radar-state",
    endpoint: cleanEndpoint(options.endpoint || process.env.RADAR_GENERATION_STATE_R2_ENDPOINT || process.env.RADAR_GENERATION_R2_ENDPOINT || endpointForAccount(options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID)),
    accessKeyId: options.accessKeyId || process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: options.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY,
    planOut: options.planOut || DEFAULT_PLAN_OUT,
    selectionOut: options.selectionOut || DEFAULT_SELECTION_OUT,
    markerOut: options.markerOut || DEFAULT_MARKER_OUT,
    status: cleanSegment(options.status || "processed")
  };
}

function normalizeStaticConfig(options = {}) {
  return {
    planStorePrefix: cleanKey(options.planStorePrefix || process.env.RADAR_GENERATION_PLANS_R2_PREFIX || DEFAULT_PLAN_STORE_PREFIX),
    planOutputPrefix: cleanKey(options.planOutputPrefix || process.env.RADAR_GENERATION_OUTPUT_PREFIX || DEFAULT_PLAN_OUTPUT_PREFIX),
    processedPrefix: cleanKey(options.processedPrefix || process.env.RADAR_GENERATION_PROCESSED_PLANS_R2_PREFIX || DEFAULT_PROCESSED_PREFIX),
    scanLimit: positiveInteger(options.scanLimit, DEFAULT_SCAN_LIMIT),
    maxAgeMinutes: nonNegativeInteger(options.maxAgeMinutes, DEFAULT_MAX_AGE_MINUTES),
    now: options.now ? new Date(options.now).toISOString() : new Date().toISOString()
  };
}

function normalizeObject(object = {}) {
  return {
    key: cleanKey(object.key || object.Key || ""),
    lastModified: isoDate(object.lastModified || object.LastModified),
    size: Number(object.size ?? object.Size ?? 0)
  };
}

function optionalJson(file) {
  return file && fs.existsSync(file) ? readJson(file) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      return;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function endpointForAccount(accountId) {
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

function cleanEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function cleanKey(value) {
  const key = String(value || "").replace(/^\/+|\/+$/g, "");
  const parts = key.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

function joinKey(...parts) {
  return parts.map(cleanKey).filter(Boolean).join("/");
}

function cleanSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "processed";
}

function isoDate(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function printHelp() {
  console.log(`Usage:
  node scripts/radar-generation-plan-queue.mjs select --plan-out=/tmp/plan.json --selection-out=/tmp/selection.json
  node scripts/radar-generation-plan-queue.mjs mark --selection=/tmp/selection.json --status=published

Options:
  --bucket=NAME                 Private state R2 bucket. Defaults to RADAR_GENERATION_STATE_R2_BUCKET or nearcast-radar-state.
  --endpoint=URL                R2 S3 endpoint. Defaults from CLOUDFLARE_ACCOUNT_ID.
  --access-key-id=KEY           R2 access key id. Also reads R2_ACCESS_KEY_ID.
  --secret-access-key=KEY       R2 secret access key. Also reads R2_SECRET_ACCESS_KEY.
  --plan-store-prefix=KEY       Private plan store prefix. Defaults to radar/mrms/plans.
  --plan-output-prefix=KEY      Render output prefix to process. Defaults to radar/mrms/on-demand-preview.
  --processed-prefix=KEY        Processed marker prefix. Defaults to radar/mrms/processed-plans.
  --scan-limit=N                Max private plan objects to inspect. Defaults to ${DEFAULT_SCAN_LIMIT}.
  --max-age-minutes=N           Skip plan objects older than this. Defaults to ${DEFAULT_MAX_AGE_MINUTES}; 0 disables.
  --plan-out=PATH               Selected plan JSON output path.
  --selection-out=PATH          Selected metadata JSON output path.
  --selection=PATH              Selection JSON path for mark.
  --render-result=PATH          Optional render result JSON for mark metadata.
  --publication=PATH            Optional publication JSON for mark metadata.
  --marker-out=PATH             Local marker JSON output path for marker-file.
  --status=VALUE                Marker status. Examples: published, dry-run, skipped-empty.

R2 mode requires @aws-sdk/client-s3 in the execution environment.
`);
}
