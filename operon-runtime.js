let driverPromise = null;
const OPERON_ASSET_VERSION = "3.0.312";

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

function sessionConfig({
  schema,
  grounding,
  validateOutput,
  timeoutMs,
  planning = "never",
  memoryScope = null,
  skills = [],
  sessionId = null,
  maxSessionArtifacts = 8,
  maxReplans = 0,
  requireSkillOrClarification = false,
  completion = null
}) {
  return {
    policy: {
      local_only: true,
      planning,
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: timeoutMs || 60000,
      max_replans: Math.max(0, Math.min(3, Number(maxReplans) || 0)),
      require_skill_or_clarification: requireSkillOrClarification === true
    },
    has_grounding: Boolean(grounding),
    output_schema: schema,
    has_application_validator: typeof validateOutput === "function",
    memory_scope: memoryScope,
    skills: Array.isArray(skills) ? skills : [],
    completion: completion && typeof completion === "object" ? completion : null,
    session_id: sessionId ? String(sessionId) : null,
    max_session_artifacts: sessionId
      ? Math.max(1, Math.min(16, Number(maxSessionArtifacts) || 8))
      : 0
  };
}

export async function runOperon({
  query,
  schema,
  generate,
  grounding = null,
  validateOutput = null,
  planning = "never",
  memoryScope = null,
  searchMemory = null,
  skills = [],
  invokeSkill = null,
  sessionId = null,
  maxSessionArtifacts = 8,
  loadSession = null,
  prepareSkill = null,
  maxReplans = 0,
  requireSkillOrClarification = false,
  completion = null,
  checkpoint = null,
  timeoutMs = 60000
}) {
  if (typeof generate !== "function") throw new TypeError("Operon requires a generation provider");
  const driver = await loadDriver();
  let suppliedSources = [];
  return driver.run(
    query,
    sessionConfig({
      schema,
      grounding,
      validateOutput,
      timeoutMs,
      planning,
      memoryScope,
      skills,
      sessionId,
      maxSessionArtifacts,
      maxReplans,
      requireSkillOrClarification,
      completion
    }),
    {
      checkpoint: typeof checkpoint === "function"
        ? async ({ snapshot, command }) => checkpoint({ snapshot, command })
        : undefined,
      generate: async ({ request }) => normalizeProviderCitations(
        await generate(request),
        suppliedSources
      ),
      retrieve: async ({ query: retrievalQuery, limit }) => {
        if (typeof grounding !== "function") return [];
        const sources = await grounding(retrievalQuery, limit);
        const retrieved = Array.isArray(sources) ? sources : [];
        const offset = suppliedSources.length;
        suppliedSources.push(...retrieved.map((source, index) => ({
          ...source,
          id: `S${offset + index + 1}`
        })));
        return retrieved;
      },
      searchMemory: async ({ query: memoryQuery, scope, limit }) => {
        if (typeof searchMemory !== "function") return [];
        const records = await searchMemory(memoryQuery, scope, limit);
        return Array.isArray(records) ? records : [];
      },
      loadSession: async ({ session_id, limit }) => {
        if (typeof loadSession !== "function") return [];
        const artifacts = await loadSession(session_id, limit);
        return Array.isArray(artifacts) ? artifacts : [];
      },
      prepareSkill: async ({ skill_id, partial_arguments, artifacts }) => {
        if (typeof prepareSkill !== "function") {
          return { kind: "ready", arguments: partial_arguments || {} };
        }
        return prepareSkill({
          skillId: skill_id,
          partialArguments: partial_arguments || {},
          artifacts: Array.isArray(artifacts) ? artifacts : []
        });
      },
      invokeSkill: async ({ skill_id, arguments: skillArguments, requires_user_confirmation, idempotency_key }) => {
        if (typeof invokeSkill !== "function") {
          throw new Error(`No Nearcast handler is registered for ${skill_id}`);
        }
        const result = await invokeSkill({
          skillId: skill_id,
          arguments: skillArguments,
          requiresUserConfirmation: requires_user_confirmation === true,
          idempotencyKey: String(idempotency_key || "")
        });
        const skillSources = Array.isArray(result?.sources) ? result.sources : [];
        const offset = suppliedSources.length;
        suppliedSources.push({ id: `S${offset + 1}`, path: `skill://${skill_id}` });
        suppliedSources.push(...skillSources.map((source, index) => ({
          ...source,
          id: `S${offset + index + 2}`
        })));
        return {
          ...result,
          artifacts: Array.isArray(result?.artifacts) ? result.artifacts : []
        };
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
