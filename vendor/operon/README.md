# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `e9016de`
- Protocol version: `0.1`
- `operon_core_bg.wasm` SHA-256:
  `2424d19a9f738c916f515a26e770557ecb13d8a924587a461c1c35f8ab8835a4`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine.
