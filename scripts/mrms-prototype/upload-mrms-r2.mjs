#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIR = "radar/mrms/live";
const DEFAULT_PREFIX = "mrms";
const DEFAULT_CACHE_CONTROL = "public, max-age=86400, immutable";
const DEFAULT_MUTABLE_CACHE_CONTROL = "no-store";
const DEFAULT_CONCURRENCY = 24;
const DEFAULT_PRUNE_OLDER_THAN_MINUTES = 360;

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const dir = args.dir || DEFAULT_DIR;
  const bucket = args.bucket || process.env.MRMS_R2_BUCKET;
  const prefix = cleanKeyPrefix(args.prefix ?? process.env.MRMS_R2_PREFIX ?? DEFAULT_PREFIX);
  const dryRun = booleanArg(args["dry-run"], false);
  const accountId = args["account-id"] || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  const endpoint = cleanEndpoint(args.endpoint || process.env.MRMS_R2_ENDPOINT || endpointForAccount(accountId));
  const accessKeyId = args["access-key-id"] || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = args["secret-access-key"] || process.env.R2_SECRET_ACCESS_KEY;
  const cacheControl = args["cache-control"] || process.env.MRMS_R2_CACHE_CONTROL || DEFAULT_CACHE_CONTROL;
  const mutableCacheControl = args["mutable-cache-control"] || DEFAULT_MUTABLE_CACHE_CONTROL;
  const mutableFiles = new Set(splitList(args["mutable-files"] || args["mutable-file"])
    .map((item) => cleanKeyPrefix(item)));
  const concurrency = Math.max(1, Math.round(numberArg(args.concurrency || process.env.MRMS_R2_UPLOAD_CONCURRENCY, DEFAULT_CONCURRENCY)));
  const deleteLocal = booleanArg(args["delete-local"], false);
  const pruneOlderThanMinutes = Math.max(0, numberArg(args["prune-older-than-minutes"] ?? process.env.MRMS_R2_PRUNE_OLDER_THAN_MINUTES, DEFAULT_PRUNE_OLDER_THAN_MINUTES));

  if (!bucket) throw new Error("missing --bucket or MRMS_R2_BUCKET");
  if (!dryRun && !endpoint) throw new Error("missing --endpoint or CLOUDFLARE_ACCOUNT_ID");
  if (!dryRun && !accessKeyId) throw new Error("missing --access-key-id or R2_ACCESS_KEY_ID");
  if (!dryRun && !secretAccessKey) throw new Error("missing --secret-access-key or R2_SECRET_ACCESS_KEY");

  const startedAt = Date.now();
  const files = walkFiles(dir);
  const planned = files.map((file) => {
    const relativePath = path.relative(dir, file).split(path.sep).join("/");
    return {
      file,
      relativePath,
      key: joinKey(prefix, relativePath),
      size: fs.statSync(file).size,
      cacheControl: mutableFiles.has(cleanKeyPrefix(relativePath)) ? mutableCacheControl : cacheControl
    };
  });

  const summary = {
    provider: "nearcast-mrms-r2-upload",
    dryRun,
    bucket,
    endpoint,
    prefix,
    dir,
    fileCount: planned.length,
    bytes: planned.reduce((sum, item) => sum + item.size, 0),
    uploaded: 0,
    pruned: 0,
    deleteLocal,
    cacheControl,
    mutableCacheControl,
    mutableFileCount: planned.filter((item) => item.cacheControl === mutableCacheControl).length,
    concurrency
  };

  if (!planned.length) {
    console.log(JSON.stringify({ ...summary, elapsedMs: Date.now() - startedAt }, null, 2));
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ...summary,
      sampleKeys: planned.slice(0, 8).map((item) => item.key),
      elapsedMs: Date.now() - startedAt
    }, null, 2));
    return;
  }

  const sdk = await loadAwsSdk();
  const client = new R2Client({ endpoint, bucket, accessKeyId, secretAccessKey, sdk });
  const uploadedKeys = new Set();
  await mapLimit(planned, concurrency, async (item, index) => {
    const body = fs.readFileSync(item.file);
    await client.putObject({
      key: item.key,
      body,
      cacheControl: item.cacheControl,
      contentType: contentTypeForFile(item.file)
    });
    uploadedKeys.add(item.key);
    summary.uploaded += 1;
    if (summary.uploaded % 500 === 0 || summary.uploaded === planned.length) {
      console.error(`Uploaded ${summary.uploaded}/${planned.length} generated radar tiles to R2.`);
    }
  });

  if (pruneOlderThanMinutes > 0) {
    const cutoffMs = Date.now() - pruneOlderThanMinutes * 60 * 1000;
    summary.pruned = await pruneOldObjects({
      client,
      prefix,
      cutoffMs,
      keepKeys: uploadedKeys
    });
  }

  if (deleteLocal) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log(JSON.stringify({
    ...summary,
    elapsedMs: Date.now() - startedAt
  }, null, 2));
}

class R2Client {
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, sdk }) {
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

  async listObjects({ prefix, continuationToken }) {
    const response = await this.sendWithRetry(new this.sdk.ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken || undefined
    }));
    return {
      objects: (response.Contents || []).map((object) => ({
        key: object.Key || "",
        lastModified: object.LastModified ? object.LastModified.toISOString() : "",
        lastModifiedMs: object.LastModified ? object.LastModified.getTime() : NaN
      })).filter((object) => object.key),
      nextContinuationToken: response.NextContinuationToken || ""
    };
  }

  async deleteObjects(keys) {
    if (!keys.length) return;
    await this.sendWithRetry(new this.sdk.DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: {
        Quiet: true,
        Objects: keys.map((key) => ({ Key: key }))
      }
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

async function pruneOldObjects({ client, prefix, cutoffMs, keepKeys }) {
  let continuationToken = "";
  let pruned = 0;
  do {
    const page = await client.listObjects({ prefix, continuationToken });
    const staleKeys = page.objects
      .filter((object) => !keepKeys.has(object.key))
      .filter((object) => Number.isFinite(object.lastModifiedMs) && object.lastModifiedMs < cutoffMs)
      .map((object) => object.key);
    for (const batch of chunks(staleKeys, 1000)) {
      await client.deleteObjects(batch);
      pruned += batch.length;
    }
    continuationToken = page.nextContinuationToken || "";
  } while (continuationToken);
  return pruned;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current)) {
      const child = path.join(current, name);
      const stat = fs.statSync(child);
      if (stat.isDirectory()) stack.push(child);
      else if (stat.isFile()) files.push(child);
    }
  }
  return files.sort();
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
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

function endpointForAccount(accountId) {
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

function cleanEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function cleanKeyPrefix(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function joinKey(prefix, relativePath) {
  return [cleanKeyPrefix(prefix), cleanKeyPrefix(relativePath)].filter(Boolean).join("/");
}

function contentTypeForFile(file) {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function shouldRetry(error) {
  const status = error?.$metadata?.httpStatusCode || error?.status;
  return !status || status === 429 || status >= 500;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/upload-mrms-r2.mjs --bucket=nearcast-radar --prefix=mrms

Options:
  --dir=radar/mrms/live         Local generated tile directory to upload.
  --bucket=NAME                 R2 bucket name. Also reads MRMS_R2_BUCKET.
  --prefix=mrms                 Object key prefix. Should match MRMS_TILE_URL_BASE path.
  --endpoint=URL                R2 S3 endpoint. Defaults from CLOUDFLARE_ACCOUNT_ID.
  --account-id=ID               Cloudflare account id for the default endpoint.
  --access-key-id=KEY           R2 access key id. Also reads R2_ACCESS_KEY_ID.
  --secret-access-key=SECRET    R2 secret access key. Also reads R2_SECRET_ACCESS_KEY.
  --cache-control=VALUE         Cache-Control for uploaded immutable tile PNGs.
  --mutable-file=PATH           Relative file uploaded with no-store cache-control.
  --mutable-cache-control=VALUE Cache-Control for mutable files. Defaults to no-store.
  --concurrency=24              Concurrent upload requests.
  --prune-older-than-minutes=360
                                Delete older objects under the prefix after upload.
  --delete-local                Remove local tile files after successful upload.
  --dry-run                     Print planned keys without uploading.
`);
}

main().catch((error) => {
  console.error(`MRMS R2 upload failed: ${error.message}`);
  process.exit(1);
});
