# Nearcast AI architecture

Nearcast AI uses Operon 0.4 as the local agent runtime. Nearcast supplies the
weather data, typed app skills, session artifacts, memory authority, validation,
and side-effect boundaries; Operon lets the on-device model interpret language,
select and chain skills, request clarification, replan, and return a typed
terminal outcome.

## Runtime paths

- Eligible Apple devices run the complete Operon Swift driver with Apple's
  System Language Model. Swift Package Manager pins Operon 0.4.0.
- Other supported devices use the vendored Operon 0.3 WebAssembly driver with
  the local WebLLM provider.
- Both paths receive the same skill descriptors and completion contracts.
- Browser `AbortSignal` cancellation propagates into Swift tasks or WebLLM
  generation. Operon graph commands feed progress into the Nearcast AI UI.
- Apple agent turns consume Operon's native stream exactly once. Stage and
  skill events drive progress, provisional model text remains non-authoritative,
  and only the validated envelope carried by the finished event is rendered.
- Operon performance samples are retained only as a small private local ring
  buffer. Thermal pressure or Low Power Mode can reduce the next turn's replan
  budget without changing semantic skill selection or sending device data away.

## Context and memory

- Conversation referents are bounded, typed Operon session artifacts. They are
  replaced when conversational focus changes and cleared by New chat.
- Durable facts come only from current Nearcast application state: active and
  saved places, confirmed watched plans, and explicit app preferences. Model
  prose and transient forecasts never become durable memory automatically.
- Native runs refresh a private SQLite FTS5 index from that authoritative state
  before scoped retrieval. This prevents removed places or plans from surviving
  as stale agent context. The web path uses the same records and scope contract.

## Skills and safety

- The model chooses from Nearcast's finite typed skill catalog. The host resolves
  canonical places and dates, validates arguments and outputs, confirms guarded
  mutations, performs app navigation, and returns typed artifacts.
- Operon completion contracts are reserved for workflows that require a specific
  product result, such as a plan check. General management and navigation turns
  remain open to Operon's skill selection and graph chaining.
- A completed, clarification, abstained, or cancelled Operon result is trusted as
  the terminal state. Nearcast does not reparse agent prose to veto valid graphs.
- Abstentions remain first-class outcomes. Nearcast distinguishes no available
  context from evidence that was considered but could not support the request,
  and exposes a compact local-source disclosure instead of a generic help reply.

## Grounding

- Forecast summaries use Operon's extractive grounding. Each generated claim
  must carry a verbatim quote from the canonical Nearcast fact sheet before the
  existing numeric and sentence validators accept the summary.
- App skills continue to perform deterministic weather calculations and return
  canonical sources. The SLM interprets intent and composes workflows; it does
  not invent forecast observations or directly mutate app state.
