let driverPromise = null;
const OPERON_ASSET_VERSION = "3.0.286";

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
  return driver.run(
    query,
    sessionConfig({ schema, grounding, validateOutput, timeoutMs }),
    {
      generate: async ({ request }) => generate(request),
      retrieve: async ({ query: retrievalQuery, limit }) => {
        if (typeof grounding !== "function") return [];
        return grounding(retrievalQuery, limit);
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
