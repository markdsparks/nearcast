# Vendored Operon browser core

This directory contains the browser execution core used by Nearcast's private
SLM layer.

- Source repository: `markdsparks/operon`
- Source commit: `884d6386a3ca34e7800f3468f9d924d853613630`
- Protocol version: `0.2`
- `operon_core_bg.wasm` SHA-256:
  `e3948db178112e61eda1e135a544dbfe3307fc6e8daaae421f21dffda65052b7`

The model, weather sources, validation, storage, and network authority remain
owned by Nearcast. The WASM module only runs Operon's deterministic resumable
state machine, including scoped memory search, typed session artifacts,
host-prepared skills, structured clarification, and bounded replanning.
