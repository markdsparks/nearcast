# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `6a99bc1`
- Protocol version: `0.1`
- `operon_core_bg.wasm` SHA-256:
  `9eb89d5d7cf232e55e6dd99a3ca9b91101fecfa00cbd8f46429e081ae6457dc3`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search and host-controlled typed skills.
