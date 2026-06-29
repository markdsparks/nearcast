#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PLAN_PROVIDER = "nearcast-radar-generation-plan";
const RESULT_PROVIDER = "nearcast-radar-render-result";
const DEFAULT_GENERATOR_SCRIPT = "scripts/mrms-prototype/generate-mrms-timeline.mjs";
const DEFAULT_ARTIFACT_ROOT = "/tmp/nearcast-radar-generation";
const SOURCE_SIGNATURE_TOKEN = "{sourceSignature}";

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Radar generation render failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  const plan = loadPlan(args);
  const result = await executeRadarGenerationPlan(plan, {
    artifactRoot: args["artifact-root"],
    generatorScript: args["generator-script"],
    publicBaseUrl: args["public-base-url"],
    sourceFiles: splitList(args.files || args.file),
    sourceUrls: splitList(args.urls || args.url),
    frameTimes: splitList(args["frame-times"] || args["frame-time"]),
    sample: booleanArg(args.sample, false),
    dryRun: booleanArg(args["dry-run"], false)
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function executeRadarGenerationPlan(plan, options = {}) {
  validatePlan(plan);
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const generatorScript = path.resolve(options.generatorScript || DEFAULT_GENERATOR_SCRIPT);
  const baseArgs = generatorArgsForPlan(plan, options);
  const providedSourceArgs = sourceArgsFromOptions(options);
  const resolveArgs = [...baseArgs, ...providedSourceArgs, "--resolve-only"];
  const resolved = runGeneratorJson(generatorScript, resolveArgs, "source resolution");
  const pinnedSourceArgs = providedSourceArgs.length ? providedSourceArgs : sourceArgsFromResolvedPlan(resolved);
  const sourceSignature = cleanKeySegment(resolved?.source?.signature || stableHash(resolved?.source || {}));
  const materialized = materializePlanOutput(plan, {
    artifactRoot,
    sourceSignature,
    publicBaseUrl: options.publicBaseUrl || ""
  });

  if (options.dryRun) {
    return {
      provider: RESULT_PROVIDER,
      version: 1,
      state: "resolved",
      requestId: plan.requestId || "",
      dedupeKey: plan.dedupeKey || "",
      sourceSignature,
      resolve: resolved,
      materialized
    };
  }

  fs.mkdirSync(path.dirname(materialized.manifestPath), { recursive: true });
  fs.mkdirSync(materialized.tilePath, { recursive: true });
  const renderArgs = [
    ...baseArgs,
    ...pinnedSourceArgs,
    `--manifest-out=${materialized.manifestPath}`,
    `--out-dir=${materialized.tilePath}`,
    `--tile-version=${sourceSignature}`
  ];
  const render = runGeneratorJson(generatorScript, renderArgs, "bounded render");
  const manifest = readJsonFile(materialized.manifestPath);
  const pack = indexPackForManifest({ plan, manifest, materialized, sourceSignature });
  fs.mkdirSync(path.dirname(materialized.indexPackPath), { recursive: true });
  atomicWriteJson(materialized.indexPackPath, pack);

  return {
    provider: RESULT_PROVIDER,
    version: 1,
    state: "rendered",
    requestId: plan.requestId || "",
    dedupeKey: plan.dedupeKey || "",
    sourceSignature,
    resolve: summarizeResolve(resolved),
    render,
    materialized,
    pack
  };
}

export function materializePlanOutput(plan, { artifactRoot, sourceSignature, publicBaseUrl = "" }) {
  const output = plan?.output || {};
  const manifestKey = materializeKey(output.manifestKeyTemplate, sourceSignature);
  const tilePrefix = materializeKey(output.tilePrefixTemplate, sourceSignature);
  const indexPackKey = materializeKey(output.indexPackKeyTemplate, sourceSignature);
  return {
    artifactRoot,
    sourceSignature,
    manifestKey,
    tilePrefix,
    indexPackKey,
    manifestPath: path.join(artifactRoot, manifestKey),
    tilePath: path.join(artifactRoot, tilePrefix),
    indexPackPath: path.join(artifactRoot, indexPackKey),
    manifestUrl: publicBaseUrl
      ? joinPublicUrl(publicBaseUrl, manifestKey)
      : manifestKey
  };
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") errors.push("plan");
  if (plan?.provider !== PLAN_PROVIDER) errors.push("provider");
  if (!plan?.requestId) errors.push("requestId");
  if (!plan?.dedupeKey) errors.push("dedupeKey");
  if (!plan?.source?.region) errors.push("source.region");
  if (!plan?.source?.product) errors.push("source.product");
  if (!Array.isArray(plan?.render?.tileZooms) || !plan.render.tileZooms.length) errors.push("render.tileZooms");
  if (!plan?.coverage?.tileBounds) errors.push("coverage.tileBounds");
  if (!plan?.output?.manifestKeyTemplate) errors.push("output.manifestKeyTemplate");
  if (!plan?.output?.tilePrefixTemplate) errors.push("output.tilePrefixTemplate");
  if (!plan?.output?.indexPackKeyTemplate) errors.push("output.indexPackKeyTemplate");
  if (errors.length) throw new Error(`invalid radar generation plan: ${errors.join(", ")}`);
}

function generatorArgsForPlan(plan, options = {}) {
  const render = plan.render || {};
  const source = plan.source || {};
  const args = [
    `--region=${source.region}`,
    `--product=${source.product}`,
    `--frames=${Math.max(1, Math.floor(Number(render.frameLimit || source.frameLimit || 1)))}`,
    `--style=${render.style || "banded"}`,
    "--focus=point",
    `--lat=${render.focus?.latitude}`,
    `--lon=${render.focus?.longitude}`,
    `--tile-bounds=${plan.coverage.tileBounds}`,
    `--tile-zooms=${render.tileZooms.join(",")}`,
    `--ttl-minutes=${Math.max(1, Math.floor(Number(render.ttlMinutes || 15)))}`
  ];
  if (render.skipEmptyTiles !== false) args.push("--skip-empty-tiles");
  if (render.encodedTiles !== false) args.push("--encoded-tiles");
  if (options.sample) args.push("--sample");
  return args;
}

function sourceArgsFromOptions(options = {}) {
  const result = [];
  const sourceFiles = Array.isArray(options.sourceFiles) ? options.sourceFiles.filter(Boolean) : [];
  const sourceUrls = Array.isArray(options.sourceUrls) ? options.sourceUrls.filter(Boolean) : [];
  const frameTimes = Array.isArray(options.frameTimes) ? options.frameTimes.filter(Boolean) : [];
  if (sourceFiles.length && sourceUrls.length) {
    throw new Error("provide source files or source urls, not both");
  }
  if (sourceFiles.length) result.push(`--files=${sourceFiles.join(",")}`);
  if (sourceUrls.length) result.push(`--urls=${sourceUrls.join(",")}`);
  if (frameTimes.length) result.push(`--frame-times=${frameTimes.join(",")}`);
  return result;
}

function sourceArgsFromResolvedPlan(resolved = {}) {
  const objects = Array.isArray(resolved?.source?.objects) ? resolved.source.objects : [];
  if (!objects.length) return [];
  const files = objects.filter((object) => object.kind === "file" && object.value).map((object) => object.value);
  const urls = objects.filter((object) => object.kind === "url" && object.value).map((object) => object.value);
  const frameTimes = objects.map((object) => object.observedAt).filter(Boolean);
  if (files.length && urls.length) return [];
  const result = [];
  if (files.length) result.push(`--files=${files.join(",")}`);
  if (urls.length) result.push(`--urls=${urls.join(",")}`);
  if (frameTimes.length) result.push(`--frame-times=${frameTimes.join(",")}`);
  return result;
}

function runGeneratorJson(generatorScript, generatorArgs, label) {
  const commandArgs = [generatorScript, ...generatorArgs];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32
  });
  if (result.status !== 0) {
    throw new Error([
      `${label} failed with exit ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return parseJsonOutput(result.stdout, label);
}

function parseJsonOutput(value, label) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }
}

function indexPackForManifest({ plan, manifest, materialized, sourceSignature }) {
  return {
    provider: manifest.provider || "mrms-generated",
    version: 1,
    id: `on-demand-${plan.output.jobKey}-${sourceSignature}`,
    label: "Radar",
    product: manifest.product || plan.source.product,
    region: manifest.region || plan.source.region,
    style: manifest.style || plan.render.style || "banded",
    manifestUrl: materialized.manifestUrl,
    manifestKey: materialized.manifestKey,
    generatedAt: manifest.generatedAt || new Date().toISOString(),
    expiresAt: manifest.expiresAt || "",
    sample: Boolean(manifest.sample),
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    coverageBounds: manifest.coverageBounds || plan.coverage.bounds,
    coverageAreas: Array.isArray(manifest.coverageAreas) ? manifest.coverageAreas : [],
    publishFingerprint: manifest.publishFingerprint || null,
    sourceSignature,
    metrics: manifest.metrics || manifest.coverage || null,
    requestId: plan.requestId,
    dedupeKey: plan.dedupeKey,
    output: {
      jobKey: plan.output.jobKey,
      tilePrefix: materialized.tilePrefix,
      indexPackKey: materialized.indexPackKey
    }
  };
}

function summarizeResolve(resolved = {}) {
  return {
    provider: resolved.provider || "",
    product: resolved.product || "",
    region: resolved.region || "",
    frameCount: resolved.frameCount || 0,
    sourceSignature: resolved.source?.signature || "",
    publishFingerprint: resolved.publishFingerprint || ""
  };
}

function materializeKey(template, sourceSignature) {
  const key = String(template || "").replaceAll(SOURCE_SIGNATURE_TOKEN, sourceSignature);
  if (!key || key.includes(SOURCE_SIGNATURE_TOKEN)) {
    throw new Error(`output key template did not include ${SOURCE_SIGNATURE_TOKEN}`);
  }
  return safeRelativeKey(key);
}

function safeRelativeKey(value) {
  const key = String(value || "").replace(/^\/+|\/+$/g, "");
  const parts = key.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`unsafe output key: ${value}`);
  }
  return parts.join("/");
}

function loadPlan(parsedArgs) {
  if (parsedArgs.plan) return readJsonFile(parsedArgs.plan);
  if (parsedArgs["plan-json"]) return JSON.parse(parsedArgs["plan-json"]);
  throw new Error("missing --plan=PATH");
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

function joinPublicUrl(base, key) {
  const cleanBase = String(base || "").replace(/\/+$/g, "");
  const cleanKey = String(key || "").replace(/^\/+/g, "");
  return `${cleanBase}/${cleanKey}`;
}

function cleanKeySegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function stableHash(value) {
  const json = stableJson(value);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanArg(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
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

function printHelp() {
  console.log(`Usage:
  node scripts/radar-generation-renderer.mjs --plan=/tmp/plan.json --source-file=/tmp/frame.grib2.gz --artifact-root=/tmp/radar-artifacts
  node scripts/radar-generation-renderer.mjs --plan=/tmp/plan.json --dry-run

Options:
  --plan=PATH                 Radar generation plan JSON from the queue consumer.
  --artifact-root=PATH        Local root for manifest, tiles, and pack artifacts.
  --generator-script=PATH     Override the MRMS generator script for tests.
  --file=PATH                 Pin render to a local MRMS GRIB2 file.
  --url=URL                   Pin render to a remote MRMS source URL.
  --frame-time=ISO            Observed time for pinned file/url sources.
  --public-base-url=URL       Public base used for the pack manifestUrl field.
  --sample                    Mark generated output as sample data.
  --dry-run                   Resolve source and materialize output paths only.
`);
}
