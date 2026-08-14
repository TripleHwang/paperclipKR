# Provider Model Discovery Design

Date: 2026-08-14
Status: Approved for implementation planning

## Problem

Paperclip exposes adapter model choices in agent configuration, but Codex relies on a static fallback list plus the OpenAI Models API. The API path requires an `OPENAI_API_KEY`, so it does not discover models available through a Codex subscription login. Consequently, newly released models can be absent from the model settings even when the local Codex installation can use them.

Other adapters have uneven discovery behavior. Cursor, OpenCode, and Pi already discover models from their CLIs, while some adapters expose only static lists. Paperclip needs a consistent refresh contract without changing an agent's selected model automatically.

## Goals

- Show GPT-5.6 family models in Codex model settings.
- Discover future Codex models from the authenticated local Codex CLI.
- Keep provider-specific discovery behind the existing adapter `listModels` and `refreshModels` interfaces.
- Refresh the visible model list without changing saved agent configuration.
- Preserve a useful model list when live discovery is unavailable or fails.

## Non-Goals

- Automatically migrate existing agents to a newly released model.
- Choose a "best" model based on version, price, or capability.
- Build a central Paperclip-hosted model catalog service.
- Guarantee discovery for providers that expose neither a model-list API nor a CLI command.

## Architecture

### Codex Discovery

Codex model discovery will use three sources, in priority order:

1. The authenticated Codex CLI catalog returned by `codex debug models`.
2. The OpenAI Models API when an OpenAI API key is configured.
3. The adapter's bundled fallback model list.

Successful source results are merged rather than treated as mutually exclusive. Model IDs are trimmed, deduplicated, and sorted with numeric-aware ordering. CLI display names may be used as labels, but the CLI slug remains the persisted model ID.

The bundled fallback list will include `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. This guarantees immediate GPT-5.6 visibility even when the installed CLI is older or live discovery is unavailable.

### Adapter Contract

The existing adapter registry remains the provider boundary:

- `listModels` returns a cached live catalog when available and otherwise returns fallbacks.
- `refreshModels` bypasses or invalidates discovery caches before querying provider-specific sources again.
- Adapters without refresh support continue returning their current model list.

Codex receives CLI-backed discovery and forced refresh. Existing CLI-backed providers retain their current behavior and can add `refreshModels` using the same contract without UI changes.

### UI Flow

Agent configuration continues loading models through the company-scoped adapter models endpoint. Opening the configuration uses the normal cached listing. Choosing **Refresh models** calls the same endpoint with `refresh=1`, replaces the query cache with the returned list, and leaves the current selection unchanged.

A manually configured model remains visible even when it is absent from the discovered catalog. No model is automatically selected, migrated, or persisted as a side effect of discovery.

## Failure Handling

- A missing or unsupported Codex CLI command does not fail the model settings screen.
- Invalid CLI output is ignored rather than partially accepted.
- Timeouts and non-zero CLI exits fall back to API, the last successful cache, or bundled models.
- API authentication or network failures remain non-fatal.
- Refresh returns the best available merged catalog and never clears a previously useful list solely because a live source failed.

## Security

- The CLI command is invoked without a shell and with fixed model-discovery arguments.
- Authentication tokens and API keys are never returned to the UI or included in cache keys in plaintext.
- Model discovery is read-only and remains behind existing company access checks.
- Discovered model IDs are treated as data; they are validated before being exposed or passed as CLI arguments during execution.

## Testing

- Parse representative `codex debug models` JSON and retain visible model slugs.
- Reject malformed or structurally invalid CLI output.
- Merge CLI, API, and fallback models without duplicates.
- Verify cached listing and forced refresh behavior.
- Verify failure fallback when the CLI or API is unavailable.
- Verify all GPT-5.6 fallback IDs appear in Codex settings data.
- Verify refresh does not mutate an existing selected model.

## Acceptance Criteria

1. Codex model settings include the four GPT-5.6 family IDs without requiring an API key.
2. A model newly returned by `codex debug models` appears after model refresh without a Paperclip code change.
3. Existing saved model selections remain unchanged during listing and refresh.
4. Discovery failures leave a usable fallback catalog and surface no fatal configuration error.
5. Provider-specific discovery continues to use the adapter registry rather than introducing provider checks into the UI.
