const PLAN_PROVIDER = "nearcast-radar-generation-plan";
const RESULT_PROVIDER = "nearcast-radar-generation-result";
const DEFAULT_REGION = "CONUS";
const DEFAULT_PRODUCT = "MergedReflectivityQCComposite_00.50";
const DEFAULT_RENDER_PROFILE = "encoded-current-v1";
const DEFAULT_TILE_ZOOMS = [8, 9, 10, 11, 12];
const DEFAULT_MAX_CANDIDATE_TILES = 220;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_TTL_MINUTES = 15;
const DEFAULT_OUTPUT_PREFIX = "radar/mrms/on-demand";
const DEFAULT_PLAN_R2_PREFIX = "radar/mrms/plans";
const DEFAULT_PENDING_PLAN_R2_PREFIX = "radar/mrms/pending-plans";
const RADAR_GENERATION_PLANS_R2_PREFIX_ENV = "RADAR_GENERATION_PLANS_R2_PREFIX";
const RADAR_GENERATION_PENDING_PLANS_R2_PREFIX_ENV = "RADAR_GENERATION_PENDING_PLANS_R2_PREFIX";
const MERCATOR_MAX_LAT = 85.05113;

export default {
  async queue(batch, env = {}, ctx = {}) {
    return handleRadarGenerationQueue(batch, env, ctx);
  }
};

export async function handleRadarGenerationQueue(batch, env = {}, ctx = {}) {
  const messages = Array.isArray(batch?.messages) ? batch.messages : [];
  const results = [];
  for (const message of messages) {
    let result;
    try {
      result = await handleRadarGenerationMessage(message?.body ?? message, env, ctx);
    } catch (error) {
      result = {
        provider: RESULT_PROVIDER,
        version: 1,
        accepted: false,
        retryable: true,
        reason: "generation-consumer-error",
        error: error?.message || String(error)
      };
    }
    results.push(result);
    if (result.accepted || !result.retryable) message?.ack?.();
    else message?.retry?.();
  }
  return {
    provider: RESULT_PROVIDER,
    version: 1,
    accepted: results.filter((result) => result.accepted).length,
    rejected: results.filter((result) => !result.accepted).length,
    results
  };
}

export async function handleRadarGenerationMessage(message, env = {}) {
  let result = buildRadarGenerationPlan(message, env);
  if (!result.accepted) return result;
  const store = generationPlanStore(env);
  if (store) {
    await store.putJson(result.plan.output.planKey, result.plan, {
      expirationTtl: result.plan.render.ttlMinutes * 60
    });
    await store.putLatestPointer?.(result.plan);
    result = {
      ...result,
      stored: true,
      planStore: store.kind,
      planStorageKey: store.storageKey(result.plan.output.planKey)
    };
  }
  return result;
}

function generationPlanStore(env = {}) {
  const kv = env?.RADAR_GENERATION_PLANS;
  if (kv?.put) return kvPlanStore(kv);
  const r2 = env?.RADAR_GENERATION_PLANS_R2;
  if (r2?.put) return r2PlanStore(r2, env);
  return null;
}

function kvPlanStore(namespace) {
  return {
    kind: "kv",
    storageKey(key) {
      return key;
    },
    async putJson(key, value, options = {}) {
      return namespace.put(key, JSON.stringify(value), options);
    }
  };
}

function r2PlanStore(bucket, env = {}) {
  const prefix = cleanKeyPrefix(env?.[RADAR_GENERATION_PLANS_R2_PREFIX_ENV] || DEFAULT_PLAN_R2_PREFIX);
  const pendingPrefix = cleanKeyPrefix(
    env?.[RADAR_GENERATION_PENDING_PLANS_R2_PREFIX_ENV] || DEFAULT_PENDING_PLAN_R2_PREFIX
  );
  return {
    kind: "r2",
    storageKey(key) {
      return joinKey(prefix, key);
    },
    async putJson(key, value) {
      return bucket.put(this.storageKey(key), JSON.stringify(value), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          provider: value?.provider || PLAN_PROVIDER,
          requestId: value?.requestId || "",
          plannedAt: value?.plannedAt || ""
        }
      });
    },
    async putLatestPointer(value) {
      const pointer = {
        provider: "nearcast-radar-generation-pending-plan-pointer",
        version: 1,
        updatedAt: new Date().toISOString(),
        planKey: value?.output?.planKey || "",
        objectKey: this.storageKey(value?.output?.planKey || ""),
        requestId: value?.requestId || "",
        dedupeKey: value?.dedupeKey || "",
        plannedAt: value?.plannedAt || "",
        outputPrefix: value?.output?.prefixTemplate || "",
        candidateTiles: value?.coverage?.candidateTiles ?? null
      };
      return bucket.put(joinKey(pendingPrefix, "latest.json"), JSON.stringify(pointer), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          provider: pointer.provider,
          requestId: pointer.requestId,
          plannedAt: pointer.plannedAt
        }
      });
    }
  };
}

export function buildRadarGenerationPlan(message, env = {}) {
  const validation = validateGenerationMessage(message);
  if (!validation.valid) {
    return {
      provider: RESULT_PROVIDER,
      version: 1,
      accepted: false,
      retryable: false,
      reason: "invalid-generation-message",
      errors: validation.errors
    };
  }

  const config = renderConfig(env, message);
  const center = normalizePoint(message.viewport.center || message.viewport.activePoint);
  const coverageBounds = coverageBoundsForViewport(message.viewport);
  if (!coverageBounds) {
    return {
      provider: RESULT_PROVIDER,
      version: 1,
      accepted: false,
      retryable: false,
      reason: "invalid-viewport-bounds",
      errors: ["viewport.bounds"]
    };
  }

  const perZoom = config.tileZooms.map((z) => {
    const range = tileRangeForBounds(coverageBounds, z, config.tileSize);
    return {
      z,
      range,
      bounds: tileRangeToBounds(range, z, config.tileSize),
      candidateTiles: tileCount(range)
    };
  });
  const candidateTiles = perZoom.reduce((sum, item) => sum + item.candidateTiles, 0);
  const coverage = {
    bounds: coverageBounds,
    tileBounds: formatBounds(coverageBounds),
    candidateTiles,
    maxCandidateTiles: config.maxCandidateTiles,
    perZoom
  };
  if (candidateTiles > config.maxCandidateTiles) {
    return {
      provider: RESULT_PROVIDER,
      version: 1,
      accepted: false,
      retryable: false,
      reason: "tile-budget-exceeded",
      requestId: message.requestId,
      dedupeKey: message.dedupeKey,
      coverage
    };
  }

  const identityInput = {
    profile: config.profile,
    source: config.source,
    render: {
      tileZooms: config.tileZooms,
      tileSize: config.tileSize,
      encodedTiles: config.encodedTiles,
      skipEmptyTiles: config.skipEmptyTiles
    },
    coverageBounds,
    dedupeKey: message.dedupeKey
  };
  const jobKey = stableHash(identityInput);
  const outputPrefix = joinKey(config.outputPrefix, config.profile, jobKey);
  const sourceSignatureToken = "{sourceSignature}";
  const sourceScopedPrefix = joinKey(outputPrefix, sourceSignatureToken);
  const plan = {
    provider: PLAN_PROVIDER,
    version: 1,
    state: "planned",
    plannedAt: new Date().toISOString(),
    requestId: message.requestId,
    dedupeKey: message.dedupeKey,
    reason: message.reason || "viewport",
    source: config.source,
    render: {
      profile: config.profile,
      style: config.style,
      focus: {
        latitude: center.latitude,
        longitude: center.longitude
      },
      tileZooms: config.tileZooms,
      tileSize: config.tileSize,
      encodedTiles: config.encodedTiles,
      skipEmptyTiles: config.skipEmptyTiles,
      ttlMinutes: config.ttlMinutes,
      frameLimit: config.source.frameLimit
    },
    preferences: normalizePreferences(message.preferences),
    coverage,
    output: {
      jobKey,
      planKey: joinKey(outputPrefix, "plan.json"),
      prefixTemplate: sourceScopedPrefix,
      manifestKeyTemplate: joinKey(sourceScopedPrefix, "manifest.json"),
      tilePrefixTemplate: joinKey(sourceScopedPrefix, "tiles"),
      indexPackKeyTemplate: joinKey(sourceScopedPrefix, "pack.json")
    },
    command: {
      script: "scripts/mrms-prototype/generate-mrms-timeline.mjs",
      args: [
        `--region=${config.source.region}`,
        `--product=${config.source.product}`,
        `--frames=${config.source.frameLimit}`,
        `--tile-bounds=${coverage.tileBounds}`,
        `--tile-zooms=${config.tileZooms.join(",")}`,
        `--ttl-minutes=${config.ttlMinutes}`,
        "--skip-empty-tiles",
        "--encoded-tiles"
      ]
    }
  };

  return {
    provider: RESULT_PROVIDER,
    version: 1,
    accepted: true,
    retryable: false,
    reason: "planned",
    requestId: message.requestId,
    dedupeKey: message.dedupeKey,
    plan
  };
}

function validateGenerationMessage(message) {
  const errors = [];
  if (!message || typeof message !== "object") {
    return { valid: false, errors: ["message"] };
  }
  if (!stringValue(message.requestId)) errors.push("requestId");
  if (!stringValue(message.dedupeKey)) errors.push("dedupeKey");
  const viewport = message.viewport;
  if (!viewport || typeof viewport !== "object") {
    errors.push("viewport");
  } else {
    const center = normalizePoint(viewport.center || viewport.activePoint);
    if (!center) errors.push("viewport.center");
  }
  return { valid: errors.length === 0, errors };
}

function renderConfig(env = {}, message = {}) {
  const tileZooms = parseZooms(env.RADAR_GENERATION_TILE_ZOOMS, message.viewport?.zoom);
  return {
    profile: cleanSegment(env.RADAR_GENERATION_RENDER_PROFILE || DEFAULT_RENDER_PROFILE),
    style: cleanSegment(env.RADAR_GENERATION_STYLE || "banded"),
    tileZooms,
    tileSize: integerInRange(env.RADAR_GENERATION_TILE_SIZE, 128, 512, DEFAULT_TILE_SIZE),
    ttlMinutes: integerInRange(env.RADAR_GENERATION_TTL_MINUTES, 1, 60, DEFAULT_TTL_MINUTES),
    maxCandidateTiles: nonNegativeInteger(env.RADAR_GENERATION_MAX_CANDIDATE_TILES, DEFAULT_MAX_CANDIDATE_TILES),
    encodedTiles: env.RADAR_GENERATION_ENCODED_TILES === undefined
      ? true
      : booleanValue(env.RADAR_GENERATION_ENCODED_TILES),
    skipEmptyTiles: env.RADAR_GENERATION_SKIP_EMPTY_TILES === undefined
      ? true
      : booleanValue(env.RADAR_GENERATION_SKIP_EMPTY_TILES),
    outputPrefix: cleanKeyPrefix(env.RADAR_GENERATION_OUTPUT_PREFIX || DEFAULT_OUTPUT_PREFIX),
    source: {
      provider: "noaa-mrms-pds",
      region: cleanSegment(env.RADAR_GENERATION_REGION || DEFAULT_REGION),
      product: cleanSegment(env.RADAR_GENERATION_PRODUCT || DEFAULT_PRODUCT),
      frameLimit: integerInRange(env.RADAR_GENERATION_FRAME_LIMIT, 1, 6, 1)
    }
  };
}

function parseZooms(value, viewportZoom) {
  const explicit = String(value || "")
    .split(",")
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 22);
  const zooms = explicit.length ? explicit : DEFAULT_TILE_ZOOMS;
  const unique = [...new Set(zooms)].sort((a, b) => a - b);
  if (!Number.isFinite(Number(viewportZoom))) return unique;
  const target = Math.round(Number(viewportZoom));
  const min = Math.max(0, target - 3);
  const max = Math.min(22, target + 2);
  const nearby = unique.filter((zoom) => zoom >= min && zoom <= max);
  return nearby.length ? nearby : unique;
}

function coverageBoundsForViewport(viewport = {}) {
  const center = normalizePoint(viewport.center || viewport.activePoint);
  if (!center) return null;
  const explicit = normalizeBounds(viewport.bounds);
  if (explicit) return explicit;
  const radius = fallbackRadiusDegrees(viewport.zoom);
  return normalizeBounds({
    minLat: center.latitude - radius,
    minLon: center.longitude - radius,
    maxLat: center.latitude + radius,
    maxLon: center.longitude + radius
  });
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object") return null;
  const minLat = clampLatitude(Number(value.minLat));
  const maxLat = clampLatitude(Number(value.maxLat));
  const minLon = normalizeLongitude(Number(value.minLon));
  const maxLon = normalizeLongitude(Number(value.maxLon));
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  if (minLon > maxLon) return null;
  return {
    minLat: round(Math.min(minLat, maxLat), 5),
    minLon: round(minLon, 5),
    maxLat: round(Math.max(minLat, maxLat), 5),
    maxLon: round(maxLon, 5)
  };
}

function normalizePoint(value) {
  const latitude = clampLatitude(Number(value?.latitude));
  const longitude = normalizeLongitude(Number(value?.longitude));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude: round(latitude, 5),
    longitude: round(longitude, 5)
  };
}

function tileRangeForBounds(bounds, zoom, tileSize) {
  const nw = tileForLatLon(bounds.maxLat, bounds.minLon, zoom, tileSize);
  const se = tileForLatLon(bounds.minLat, bounds.maxLon, zoom, tileSize);
  const worldTiles = 2 ** zoom;
  return {
    minX: clampInteger(Math.min(nw.x, se.x), 0, worldTiles - 1),
    maxX: clampInteger(Math.max(nw.x, se.x), 0, worldTiles - 1),
    minY: clampInteger(Math.min(nw.y, se.y), 0, worldTiles - 1),
    maxY: clampInteger(Math.max(nw.y, se.y), 0, worldTiles - 1)
  };
}

function tileForLatLon(latitude, longitude, zoom, tileSize) {
  const lat = clampLatitude(latitude);
  const lon = normalizeLongitude(longitude);
  const worldSize = tileSize * (2 ** zoom);
  const sinLat = Math.sin(lat * Math.PI / 180);
  const x = ((lon + 180) / 360) * worldSize;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return {
    x: Math.floor(x / tileSize),
    y: Math.floor(y / tileSize)
  };
}

function tileRangeToBounds(range, zoom, tileSize) {
  const worldSize = tileSize * (2 ** zoom);
  const nw = worldToLonLat(range.minX * tileSize, range.minY * tileSize, worldSize);
  const se = worldToLonLat((range.maxX + 1) * tileSize, (range.maxY + 1) * tileSize, worldSize);
  return normalizeBounds({
    minLat: se.latitude,
    minLon: nw.longitude,
    maxLat: nw.latitude,
    maxLon: se.longitude
  });
}

function worldToLonLat(x, y, worldSize) {
  const longitude = x / worldSize * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / worldSize;
  const latitude = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

function tileCount(range) {
  return Math.max(0, range.maxX - range.minX + 1) * Math.max(0, range.maxY - range.minY + 1);
}

function fallbackRadiusDegrees(zoom) {
  const numericZoom = Number(zoom);
  if (!Number.isFinite(numericZoom)) return 0.4;
  return Math.max(0.18, Math.min(1.2, 120 / (2 ** numericZoom)));
}

function normalizePreferences(value) {
  return value && typeof value === "object" ? {
    radarProvider: stringValue(value.radarProvider) || "auto",
    timelineKind: stringValue(value.timelineKind) || "radar",
    mapRenderer: stringValue(value.mapRenderer) || "",
    immersive: Boolean(value.immersive)
  } : {
    radarProvider: "auto",
    timelineKind: "radar",
    mapRenderer: "",
    immersive: false
  };
}

function formatBounds(bounds) {
  return [bounds.minLat, bounds.minLon, bounds.maxLat, bounds.maxLon].map((value) => String(value)).join(",");
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

function joinKey(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function cleanKeyPrefix(value) {
  return joinKey(value || DEFAULT_OUTPUT_PREFIX);
}

function cleanSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function integerInRange(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function clampLatitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, number));
}

function normalizeLongitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return ((((number + 180) % 360) + 360) % 360) - 180;
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function round(value, places = 5) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}
