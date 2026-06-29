#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_DIR = "radar/mrms/live";
const DEFAULT_PREFIX = "mrms";
const DEFAULT_CACHE_CONTROL = "public, max-age=86400, immutable";
const DEFAULT_CONCURRENCY = 24;
const DEFAULT_PRUNE_OLDER_THAN_MINUTES = 360;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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
  const concurrency = Math.max(1, Math.round(numberArg(args.concurrency || process.env.MRMS_R2_UPLOAD_CONCURRENCY, DEFAULT_CONCURRENCY)));
  const deleteLocal = booleanArg(args["delete-local"], false);
  const pruneOlderThanMinutes = Math.max(0, numberArg(args["prune-older-than-minutes"] ?? process.env.MRMS_R2_PRUNE_OLDER_THAN_MINUTES, DEFAULT_PRUNE_OLDER_THAN_MINUTES));

  if (!bucket) throw new Error("missing --bucket or MRMS_R2_BUCKET");
  if (!endpoint) throw new Error("missing --endpoint or CLOUDFLARE_ACCOUNT_ID");
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
      size: fs.statSync(file).size
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

  const client = new R2Client({ endpoint, bucket, accessKeyId, secretAccessKey });
  const uploadedKeys = new Set();
  await mapLimit(planned, concurrency, async (item, index) => {
    const body = fs.readFileSync(item.file);
    await client.putObject({
      key: item.key,
      body,
      cacheControl,
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
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey }) {
    this.endpoint = endpoint;
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
  }

  async putObject({ key, body, cacheControl, contentType }) {
    const headers = {
      "cache-control": cacheControl,
      "content-type": contentType
    };
    await this.requestWithRetry({ method: "PUT", key, headers, body });
  }

  async listObjects({ prefix, continuationToken }) {
    const query = canonicalQueryString({
      "list-type": "2",
      prefix,
      ...(continuationToken ? { "continuation-token": continuationToken } : {})
    });
    const response = await this.requestWithRetry({ method: "GET", query, expectText: true });
    return parseListObjectsXml(response.text);
  }

  async deleteObjects(keys) {
    if (!keys.length) return;
    const body = Buffer.from(deleteObjectsXml(keys), "utf8");
    await this.requestWithRetry({
      method: "POST",
      query: "delete=",
      body,
      headers: {
        "content-md5": crypto.createHash("md5").update(body).digest("base64"),
        "content-type": "application/xml"
      }
    });
  }

  async requestWithRetry(request) {
    const attempts = 4;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.request(request);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !shouldRetry(error)) break;
        await sleep(250 * (2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  async request({ method, key = "", query = "", headers = {}, body, expectText = false }) {
    const payload = body || Buffer.alloc(0);
    const payloadHash = body ? sha256Hex(payload) : EMPTY_SHA256;
    const now = new Date();
    const amzDate = amzDateFor(now);
    const dateStamp = amzDate.slice(0, 8);
    const url = this.objectUrl(key, query);
    const signedHeaders = {
      ...lowercaseHeaders(headers),
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    };
    const authorization = signAwsV4({
      method,
      pathname: url.pathname,
      query,
      headers: signedHeaders,
      payloadHash,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      dateStamp,
      amzDate
    });

    const response = await fetch(url, {
      method,
      headers: {
        ...signedHeaders,
        authorization
      },
      body: body || undefined
    });

    const text = expectText || !response.ok ? await response.text() : "";
    if (!response.ok) {
      const error = new Error(`${method} ${url.pathname}${url.search} failed: ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 500)}` : ""}`);
      error.status = response.status;
      throw error;
    }
    return { response, text };
  }

  objectUrl(key = "", query = "") {
    const bucketPath = encodeKeyPath(this.bucket);
    const objectPath = key ? `/${encodeKeyPath(key)}` : "";
    return new URL(`${this.endpoint}/${bucketPath}${objectPath}${query ? `?${query}` : ""}`);
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

function signAwsV4({ method, pathname, query, headers, payloadHash, accessKeyId, secretAccessKey, dateStamp, amzDate }) {
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${normalizeHeader(headers[name])}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    pathname,
    query || "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = awsSigningKey(secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function awsSigningKey(secretAccessKey, dateStamp) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmacBuffer(dateKey, "auto");
  const serviceKey = hmacBuffer(regionKey, "s3");
  return hmacBuffer(serviceKey, "aws4_request");
}

function parseListObjectsXml(xml) {
  return {
    objects: blocksForTag(xml, "Contents").map((block) => {
      const key = decodeXml(textForTag(block, "Key"));
      const lastModified = textForTag(block, "LastModified");
      return {
        key,
        lastModified,
        lastModifiedMs: Date.parse(lastModified)
      };
    }).filter((object) => object.key),
    nextContinuationToken: decodeXml(textForTag(xml, "NextContinuationToken"))
  };
}

function deleteObjectsXml(keys) {
  const objects = keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${objects}</Delete>`;
}

function blocksForTag(xml, tag) {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  return [...String(xml || "").matchAll(pattern)].map((match) => match[1]);
}

function textForTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : "";
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

function encodeKeyPath(value) {
  return String(value || "")
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function canonicalQueryString(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(String(value))])
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function lowercaseHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function normalizeHeader(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function contentTypeForFile(file) {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function shouldRetry(error) {
  return !error.status || error.status === 429 || error.status >= 500;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacBuffer(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function amzDateFor(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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
