# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `d6c64e3` (Operon v0.3.0 release)
- Protocol version: `0.3`
- `operon_core_bg.wasm` SHA-256:
  `fc5505e725750dec6d9e6148659810c20e1e3cdf732b5c982705eb8346c4dd2a`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search, typed session artifacts,
host-prepared skills, TaskGraph ready-set scheduling, completion contracts,
skill receipts, checkpoint snapshots, structured clarification, and bounded
replanning. Operon 0.3 also provides typed abstention and cancellation,
extractive evidence validation, reusable schema definitions, array bounds,
progress events, and interruptible browser execution.
