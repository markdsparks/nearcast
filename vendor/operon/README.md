# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `6ba7848d2bd140b3bf01945fd081ecbe74e21062`
- Protocol version: `0.2`
- `operon_core_bg.wasm` SHA-256:
  `4ffa340c93517df8cd188e21d9b58fa87c90ede8ad3aa1081560b42ebf275661`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search, typed session artifacts,
host-prepared skills, structured clarification, and bounded replanning.
