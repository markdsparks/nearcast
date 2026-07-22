// Browser host driver from markdsparks/operon. The WASM core owns deterministic
// orchestration; Nearcast owns model inference, weather retrieval, and output
// validation.
export const EXECUTION_PROTOCOL_VERSION = "0.1";

const HostFailure = Object.freeze({
  provider: "provider",
  grounding: "grounding",
  memory: "memory"
});

function protocolError(message) {
  return new Error(`Operon protocol error: ${message}`);
}

function parseStep(json) {
  let step;
  try { step = JSON.parse(json); } catch { throw protocolError("WASM session returned invalid JSON"); }
  if (!step || (step.kind !== "command" && step.kind !== "complete")) {
    throw protocolError("WASM session returned an unknown step");
  }
  return step;
}

function failureFor(command) {
  if (command.kind === "retrieve") return HostFailure.grounding;
  if (command.kind === "search_memory") return HostFailure.memory;
  return HostFailure.provider;
}

function eventFor(command, value) {
  const base = { protocol_version: command.protocol_version, request_id: command.request_id };
  switch (command.kind) {
    case "generate": return { kind: "generation_completed", ...base, response: value };
    case "retrieve": return { kind: "retrieval_completed", ...base, sources: value };
    case "search_memory": return { kind: "memory_search_completed", ...base, records: value };
    case "validate_output": return { kind: "output_validated", ...base, errors: value };
    default: throw protocolError(`unsupported command kind ${command.kind}`);
  }
}

export async function runSession(session, host) {
  let step = parseStep(session.start());
  while (step.kind === "command") {
    const command = step.command;
    let event;
    try {
      let value;
      if (command.kind === "generate") value = await host.generate(command);
      else if (command.kind === "retrieve") value = await host.retrieve(command);
      else if (command.kind === "search_memory") value = await host.searchMemory(command);
      else if (command.kind === "validate_output") value = await host.validateOutput(command);
      else throw protocolError(`unsupported command kind ${command.kind}`);
      event = eventFor(command, value);
    } catch (error) {
      event = {
        kind: "command_failed",
        protocol_version: command.protocol_version,
        request_id: command.request_id,
        failure: failureFor(command),
        message: error instanceof Error ? error.message : String(error)
      };
    }
    step = parseStep(session.resume(JSON.stringify(event)));
  }
  return step.result;
}

export function createBrowserDriver(wasm) {
  if (!wasm || typeof wasm.OperonWasmSession !== "function") {
    throw new TypeError("wasm must export OperonWasmSession");
  }
  return {
    protocolVersion: wasm.execution_protocol_version?.() || EXECUTION_PROTOCOL_VERSION,
    async run(query, config, host) {
      const session = new wasm.OperonWasmSession(query, JSON.stringify(config || {}));
      try { return await runSession(session, host); }
      finally { session.free?.(); }
    }
  };
}
