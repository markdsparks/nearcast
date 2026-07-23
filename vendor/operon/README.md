# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `e598cf5` (Operon v0.2.0 TaskGraph release)
- Protocol version: `0.2`
- `operon_core_bg.wasm` SHA-256:
  `21a22eb3749d3cb62dce2e73ed836a374b58a178a492d0aff53f76a0e376cec7`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search, typed session artifacts,
host-prepared skills, TaskGraph ready-set scheduling, completion contracts,
skill receipts, checkpoint snapshots, structured clarification, and bounded
replanning.
