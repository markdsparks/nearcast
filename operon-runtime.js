let driverPromise = null;
const OPERON_ASSET_VERSION = "3.0.287";

// Some guided model providers treat a source's display path as its identifier.
// Operon's contract intentionally distinguishes the stable ID (S1) from the
// path, so canonicalize only exact paths that the host supplied before the
// response reaches Operon's provenance validator.
export function normalizeProviderCitations(response, sources = []) {
  if (!response?.text || !Array.isArray(sources) || sources.length === 0) return response;
  try {
    const payload = JSON.parse(response.text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response;
    const pathToId = new Map(
      sources
        .filter((source) => source?.id && source?.path && source.id !== source.path)
        .map((source) => [String(source.path), String(source.id)])
    );
    if (pathToId.size === 0) return response;

    let changed = false;
    if (Array.isArray(payload.used_source_ids)) {
      payload.used_source_ids = payload.used_source_ids.map((value) => {
        const replacement = pathToId.get(String(value));
        if (replacement) changed = true;
        return replacement || value;
      });
    }
    if (typeof payload.answer === "string") {
      for (const [path, id] of pathToId) {
        const citation = `[${path}]`;
        if (payload.answer.includes(citation)) {
          payload.answer = payload.answer.split(citation).join(`[${id}]`);
          changed = true;
        }
      }
    }
    return changed ? { ...response, text: JSON.stringify(payload) } : response;
  } catch {
    return response;
  }
}

async function loadDriver() {
  if (!driverPromise) {
    driverPromise = Promise.all([
      import(`./vendor/operon/operon_core.js?v=${OPERON_ASSET_VERSION}`),
      import(`./vendor/operon/driver.js?v=${OPERON_ASSET_VERSION}`)
    ]).then(async ([wasm, driver]) => {
      await wasm.default(new URL(`./vendor/operon/operon_core_bg.wasm?v=${OPERON_ASSET_VERSION}`, import.meta.url));
      return driver.createBrowserDriver(wasm);
    }).catch((error) => {
      driverPromise = null;
      throw error;
    });
  }
  return driverPromise;
}

function sessionConfig({ schema, grounding, validateOutput, timeoutMs }) {
  return {
    policy: {
      local_only: true,
      planning: "never",
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: timeoutMs || 60000
    },
    has_grounding: Boolean(grounding),
    output_schema: schema,
    has_application_validator: typeof validateOutput === "function"
  };
}

export async function runOperon({
  query,
  schema,
  generate,
  grounding = null,
  validateOutput = null,
  timeoutMs = 60000
}) {
  if (typeof generate !== "function") throw new TypeError("Operon requires a generation provider");
  const driver = await loadDriver();
  let suppliedSources = [];
  return driver.run(
    query,
    sessionConfig({ schema, grounding, validateOutput, timeoutMs }),
    {
      generate: async ({ request }) => normalizeProviderCitations(
        await generate(request),
        suppliedSources
      ),
      retrieve: async ({ query: retrievalQuery, limit }) => {
        if (typeof grounding !== "function") return [];
        const sources = await grounding(retrievalQuery, limit);
        suppliedSources = Array.isArray(sources) ? sources : [];
        return suppliedSources;
      },
      validateOutput: async ({ output }) => {
        if (typeof validateOutput !== "function") return [];
        return validateOutput(output);
      }
    }
  );
}

export async function operonProtocolVersion() {
  return (await loadDriver()).protocolVersion;
}
