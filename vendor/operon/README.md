# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `1b6c69e` (Operon v0.4.0 release)
- Protocol version: `0.3`
- `operon_core_bg.wasm` SHA-256:
  `30bedbde71ab9150b2ba2806de442911d3cb00c84f3a1ec9f6e2b017ac7db38e`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search, typed session artifacts,
host-prepared skills, TaskGraph ready-set scheduling, completion contracts,
skill receipts, checkpoint snapshots, structured clarification, and bounded
replanning. Operon 0.4 also provides typed abstention and cancellation,
extractive evidence validation, reusable schema definitions, array bounds,
progress events, interruptible browser execution, source-bearing abstentions,
collision-free Apple schemas, and authoritative native stream completion.
