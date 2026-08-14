# Provider Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GPT-5.6 and future provider models appear in agent model settings through live adapter discovery without changing saved model selections.

**Architecture:** Keep model discovery behind `ServerAdapterModule.listModels` and `refreshModels`. Codex will merge its authenticated CLI catalog, the optional OpenAI Models API response, and bundled fallbacks; Cursor, OpenCode, and Pi will expose true cache-bypassing refresh functions through the same registry contract.

**Tech Stack:** TypeScript, Node.js `child_process`, React Query's existing adapter-model endpoint, Vitest, pnpm workspace packages.

---

## File Map

- Modify `packages/adapters/codex-local/src/index.ts`: add GPT-5.6 fallback model IDs available without live discovery.
- Modify `server/src/adapters/codex-models.ts`: parse and run `codex debug models`, merge model sources, cache successful catalogs, and expose test seams.
- Modify `server/src/adapters/cursor-models.ts`: add a cache-bypassing refresh function.
- Modify `packages/adapters/opencode-local/src/server/models.ts`: add a cache-bypassing refresh function.
- Modify `packages/adapters/opencode-local/src/server/index.ts`: export the OpenCode refresh function.
- Modify `packages/adapters/pi-local/src/server/models.ts`: add a cache-bypassing refresh function.
- Modify `packages/adapters/pi-local/src/server/index.ts`: export the Pi refresh function.
- Modify `server/src/adapters/registry.ts`: wire provider refresh functions to the adapter registry.
- Modify `server/src/__tests__/adapter-models.test.ts`: cover fallbacks, Codex parsing/discovery/cache behavior, and registry-level refresh behavior.
- Modify `packages/adapters/opencode-local/src/server/models.test.ts`: cover OpenCode forced refresh.
- Modify `packages/adapters/pi-local/src/server/models.test.ts`: cover Pi forced refresh.
- Modify `packages/adapters/codex-local/src/index.ts`: document live catalog discovery in the adapter configuration reference.

### Task 1: Add GPT-5.6 Fallback Models

**Files:**
- Modify: `packages/adapters/codex-local/src/index.ts`
- Test: `server/src/__tests__/adapter-models.test.ts`

- [ ] **Step 1: Write the failing fallback test**

Extend the existing `returns codex fallback models when no OpenAI key is available` test so it checks every official GPT-5.6 family ID:

```ts
expect(models.map((model) => model.id)).toEqual(
  expect.arrayContaining([
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]),
);
```

At the beginning of that test, inject a failed CLI result so it remains a deterministic fallback test:

```ts
setCodexModelsRunnerForTests(() => ({
  status: 1,
  stdout: "",
  stderr: "Codex catalog unavailable",
  hasError: false,
}));
```

- [ ] **Step 2: Run the test and confirm the new assertion fails**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
```

Expected: FAIL because the four GPT-5.6 IDs are absent from `codexFallbackModels`.

- [ ] **Step 3: Add the fallback entries**

Place the current family before GPT-5.5 in `packages/adapters/codex-local/src/index.ts`:

```ts
export const models = [
  { id: "gpt-5.6", label: "gpt-5.6" },
  { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
  { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
  { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.4", label: "gpt-5.4" },
  { id: DEFAULT_CODEX_LOCAL_MODEL, label: DEFAULT_CODEX_LOCAL_MODEL },
  { id: "gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark" },
  { id: "gpt-5", label: "gpt-5" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4-mini" },
  { id: "gpt-5-mini", label: "gpt-5-mini" },
  { id: "gpt-5-nano", label: "gpt-5-nano" },
  { id: "o3-mini", label: "o3-mini" },
  { id: "codex-mini-latest", label: "Codex Mini" },
];
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
```

Expected: PASS for the fallback test and the rest of `adapter-models.test.ts`.

- [ ] **Step 5: Commit the fallback change**

```powershell
git add packages/adapters/codex-local/src/index.ts server/src/__tests__/adapter-models.test.ts
git commit -m "feat(codex): add GPT-5.6 model fallbacks"
```

### Task 2: Discover Models From the Authenticated Codex CLI

**Files:**
- Modify: `server/src/adapters/codex-models.ts`
- Test: `server/src/__tests__/adapter-models.test.ts`

- [ ] **Step 1: Add failing parser and discovery tests**

Import the new test seams:

```ts
import {
  parseCodexModelsOutput,
  resetCodexModelsCacheForTests,
  setCodexModelsRunnerForTests,
} from "../adapters/codex-models.js";
```

Set a deterministic failed runner in `beforeEach` so legacy API/fallback tests never spawn the developer's real Codex installation:

```ts
setCodexModelsRunnerForTests(() => ({
  status: 1,
  stdout: "",
  stderr: "Codex catalog unavailable in test",
  hasError: false,
}));
```

Add tests that define the accepted CLI shape and hide non-listable entries:

```ts
it("parses visible models from the Codex CLI catalog", () => {
  expect(parseCodexModelsOutput(JSON.stringify({
    models: [
      { slug: "gpt-5.6", display_name: "GPT-5.6", visibility: "list" },
      { slug: "gpt-internal", display_name: "Internal", visibility: "hidden" },
      { slug: "gpt-5.6-terra", visibility: "list" },
    ],
  }))).toEqual([
    { id: "gpt-5.6", label: "GPT-5.6" },
    { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
  ]);
});

it("ignores malformed Codex CLI catalogs", () => {
  expect(parseCodexModelsOutput("not-json")).toEqual([]);
  expect(parseCodexModelsOutput(JSON.stringify({ models: "invalid" }))).toEqual([]);
});

it("loads Codex models from the authenticated CLI without an API key", async () => {
  const runner = vi.fn(() => ({
    status: 0,
    stdout: JSON.stringify({
      models: [{ slug: "gpt-next-codex", display_name: "GPT Next", visibility: "list" }],
    }),
    stderr: "",
    hasError: false,
  }));
  setCodexModelsRunnerForTests(runner);

  const first = await listAdapterModels("codex_local");
  const second = await listAdapterModels("codex_local");

  expect(runner).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
  expect(first).toContainEqual({ id: "gpt-next-codex", label: "GPT Next" });
  expect(first).toEqual(expect.arrayContaining(codexFallbackModels));
});
```

- [ ] **Step 2: Run the tests and confirm they fail for missing exports**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
```

Expected: FAIL because the parser and runner injection functions do not exist and Codex does not invoke the CLI.

- [ ] **Step 3: Implement CLI output parsing and the injectable runner**

Add Node imports and fixed execution limits in `server/src/adapters/codex-models.ts`:

```ts
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const CODEX_MODELS_TIMEOUT_MS = 10_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

type CodexModelsCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  hasError: boolean;
};
```

Implement a parser that accepts only list-visible slugs and safe labels:

```ts
export function parseCodexModelsOutput(stdout: string): AdapterModel[] {
  try {
    const payload = JSON.parse(stdout) as { models?: unknown };
    if (!Array.isArray(payload.models)) return [];

    const parsed: AdapterModel[] = [];
    for (const item of payload.models) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.slug === "string" ? record.slug.trim() : "";
      const visibility = typeof record.visibility === "string" ? record.visibility : "list";
      if (!id || visibility !== "list") continue;
      const displayName = typeof record.display_name === "string" ? record.display_name.trim() : "";
      parsed.push({ id, label: displayName || id });
    }
    return dedupeModels(parsed);
  } catch {
    return [];
  }
}

function resolveCodexCommand(): string {
  return process.env.PAPERCLIP_CODEX_COMMAND?.trim() || "codex";
}

function defaultCodexModelsRunner(command: string): CodexModelsCommandResult {
  const result = spawnSync(command, ["debug", "models"], {
    encoding: "utf8",
    timeout: CODEX_MODELS_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    hasError: Boolean(result.error),
  };
}

let codexModelsRunner = defaultCodexModelsRunner;

export function setCodexModelsRunnerForTests(
  runner: ((command: string) => CodexModelsCommandResult) | null,
) {
  codexModelsRunner = runner ?? defaultCodexModelsRunner;
}
```

- [ ] **Step 4: Merge CLI, API, cache, and fallback sources**

Replace the API-key-only cache identity with a command plus SHA-256 key fingerprint:

```ts
let cached: { cacheKey: string; expiresAt: number; models: AdapterModel[] } | null = null;

function fingerprint(apiKey: string | null): string {
  return apiKey ? createHash("sha256").update(apiKey).digest("hex") : "no-api-key";
}

function fetchCodexModelsFromCli(command: string): AdapterModel[] {
  const result = codexModelsRunner(command);
  if (result.hasError || result.status !== 0) return [];
  return parseCodexModelsOutput(result.stdout);
}
```

Refactor `loadCodexModels` so cached normal loads avoid external work, forced refresh bypasses the cache, live results are merged, and failed refreshes preserve the previous successful list:

```ts
async function loadCodexModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const now = Date.now();
  const command = resolveCodexCommand();
  const apiKey = resolveOpenAiApiKey();
  const cacheKey = `${command}:${fingerprint(apiKey)}`;

  if (!options?.forceRefresh && cached?.cacheKey === cacheKey && cached.expiresAt > now) {
    return cached.models;
  }

  const cliModels = fetchCodexModelsFromCli(command);
  const apiModels = apiKey ? await fetchOpenAiModels(apiKey) : [];
  const liveModels = dedupeModels([...cliModels, ...apiModels]);
  if (liveModels.length > 0) {
    const models = mergedWithFallback(liveModels);
    cached = { cacheKey, expiresAt: now + OPENAI_MODELS_CACHE_TTL_MS, models };
    return models;
  }

  if (cached?.cacheKey === cacheKey && cached.models.length > 0) return cached.models;
  return dedupeModels(codexFallbackModels);
}
```

- [ ] **Step 5: Add forced-refresh and failure-preservation tests**

Replace the current API-only refresh fixture with a CLI sequence:

```ts
it("refreshes the cached Codex CLI catalog on demand", async () => {
  const runner = vi.fn()
    .mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: "gpt-old", visibility: "list" }] }),
      stderr: "",
      hasError: false,
    })
    .mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: "gpt-new", visibility: "list" }] }),
      stderr: "",
      hasError: false,
    });
  setCodexModelsRunnerForTests(runner);

  expect(await listAdapterModels("codex_local")).toContainEqual({ id: "gpt-old", label: "gpt-old" });
  expect(await refreshAdapterModels("codex_local")).toContainEqual({ id: "gpt-new", label: "gpt-new" });
  expect(runner).toHaveBeenCalledTimes(2);
});

it("keeps the last successful Codex catalog when refresh fails", async () => {
  const runner = vi.fn()
    .mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: "gpt-kept", visibility: "list" }] }),
      stderr: "",
      hasError: false,
    })
    .mockReturnValueOnce({ status: 1, stdout: "", stderr: "failed", hasError: false });
  setCodexModelsRunnerForTests(runner);

  await listAdapterModels("codex_local");
  expect(await refreshAdapterModels("codex_local")).toContainEqual({ id: "gpt-kept", label: "gpt-kept" });
});
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
pnpm --filter @paperclipai/server typecheck
```

Expected: both commands PASS. The test runner must not invoke a real Codex process because every dynamic behavior test injects a runner and fallback tests inject a failed runner.

- [ ] **Step 7: Commit Codex live discovery**

```powershell
git add server/src/adapters/codex-models.ts server/src/__tests__/adapter-models.test.ts
git commit -m "feat(codex): discover models from CLI catalog"
```

### Task 3: Make Refresh Bypass Other Provider Caches

**Files:**
- Modify: `server/src/adapters/cursor-models.ts`
- Modify: `packages/adapters/opencode-local/src/server/models.ts`
- Modify: `packages/adapters/opencode-local/src/server/index.ts`
- Modify: `packages/adapters/pi-local/src/server/models.ts`
- Modify: `packages/adapters/pi-local/src/server/index.ts`
- Modify: `server/src/adapters/registry.ts`
- Test: `server/src/__tests__/adapter-models.test.ts`
- Test: `packages/adapters/opencode-local/src/server/models.test.ts`
- Test: `packages/adapters/pi-local/src/server/models.test.ts`

- [ ] **Step 1: Add a failing Cursor registry refresh test**

Add a runner sequence proving `refreshAdapterModels("cursor")` executes discovery twice:

```ts
it("refreshes Cursor models by bypassing its discovery cache", async () => {
  const runner = vi.fn()
    .mockReturnValueOnce({ status: 0, stdout: "Available models: cursor-old", stderr: "", hasError: false })
    .mockReturnValueOnce({ status: 0, stdout: "Available models: cursor-new", stderr: "", hasError: false });
  setCursorModelsRunnerForTests(runner);

  expect(await listAdapterModels("cursor")).toContainEqual({ id: "cursor-old", label: "cursor-old" });
  expect(await refreshAdapterModels("cursor")).toContainEqual({ id: "cursor-new", label: "cursor-new" });
  expect(runner).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the Cursor test and confirm cached output causes failure**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
```

Expected: FAIL because the cursor adapter has no `refreshModels` hook and returns `cursor-old` from cache.

- [ ] **Step 3: Implement and register Cursor refresh**

Add to `server/src/adapters/cursor-models.ts`:

```ts
export async function refreshCursorModels(): Promise<AdapterModel[]> {
  cached = null;
  return listCursorModels();
}
```

Update the registry import and adapter module:

```ts
import { listCursorModels, refreshCursorModels } from "./cursor-models.js";

const cursorLocalAdapter: ServerAdapterModule = {
  type: "cursor",
  execute: cursorExecute,
  testEnvironment: cursorTestEnvironment,
  listSkills: listCursorSkills,
  syncSkills: syncCursorSkills,
  sessionCodec: cursorSessionCodec,
  sessionManagement: getAdapterSessionManagement("cursor") ?? undefined,
  models: cursorModels,
  modelProfiles: cursorModelProfiles,
  listModels: listCursorModels,
  refreshModels: refreshCursorModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: buildCursorRuntimeCommandSpec,
  agentConfigurationDoc: cursorAgentConfigurationDoc,
};
```

- [ ] **Step 4: Add OpenCode and Pi refresh unit tests**

Add `setOpenCodeModelsDiscoveryForTests` and `setPiModelsDiscoveryForTests` imports to the corresponding test files. Inject sequential async discovery results and prove a normal list call is cached while refresh invokes discovery again:

```ts
const runner = vi.fn()
  .mockResolvedValueOnce([{ id: "provider/old", label: "provider/old" }])
  .mockResolvedValueOnce([{ id: "provider/new", label: "provider/new" }]);
setOpenCodeModelsDiscoveryForTests(runner);
const first = await listOpenCodeModels();
const refreshed = await refreshOpenCodeModels();
expect(first).toContainEqual({ id: "provider/old", label: "provider/old" });
expect(refreshed).toContainEqual({ id: "provider/new", label: "provider/new" });
expect(runner).toHaveBeenCalledTimes(2);
```

```ts
const runner = vi.fn()
  .mockResolvedValueOnce([{ id: "provider/old", label: "provider/old" }])
  .mockResolvedValueOnce([{ id: "provider/new", label: "provider/new" }]);
setPiModelsDiscoveryForTests(runner);
const first = await listPiModels();
const refreshed = await refreshPiModels();
expect(first).toContainEqual({ id: "provider/old", label: "provider/old" });
expect(refreshed).toContainEqual({ id: "provider/new", label: "provider/new" });
expect(runner).toHaveBeenCalledTimes(2);
```

- [ ] **Step 5: Run OpenCode and Pi tests and confirm missing refresh exports fail**

Run:

```powershell
pnpm exec vitest run --project @paperclipai/adapter-opencode-local packages/adapters/opencode-local/src/server/models.test.ts
pnpm exec vitest run --project @paperclipai/adapter-pi-local packages/adapters/pi-local/src/server/models.test.ts
```

Expected: FAIL because `refreshOpenCodeModels` and `refreshPiModels` are not defined.

- [ ] **Step 6: Implement OpenCode and Pi refresh functions**

In each `models.ts`, route cached discovery through an injectable function while keeping the real discovery function as the production default:

```ts
let openCodeModelsDiscovery = discoverOpenCodeModels;

export function setOpenCodeModelsDiscoveryForTests(
  discovery: typeof discoverOpenCodeModels | null,
) {
  openCodeModelsDiscovery = discovery ?? discoverOpenCodeModels;
}
```

Change `discoverOpenCodeModelsCached` to call:

```ts
const models = await openCodeModelsDiscovery({ command, cwd, env });
```

Use the equivalent Pi implementation:

```ts
let piModelsDiscovery = discoverPiModels;

export function setPiModelsDiscoveryForTests(
  discovery: typeof discoverPiModels | null,
) {
  piModelsDiscovery = discovery ?? discoverPiModels;
}
```

Change `discoverPiModelsCached` to call:

```ts
const models = await piModelsDiscovery({ command, cwd, env });
```

Add production refresh functions to the respective files:

```ts
export async function refreshOpenCodeModels(): Promise<AdapterModel[]> {
  clearOpenCodeModelsCache();
  return listOpenCodeModels();
}
```

```ts
export async function refreshPiModels(): Promise<AdapterModel[]> {
  clearPiModelsCache();
  return listPiModels();
}
```

Implement private cache-clear helpers so production refresh code does not call test-named functions. Both the test reset export and refresh function call the same private helper:

```ts
function clearOpenCodeModelsCache() {
  discoveryCache.clear();
}

export function resetOpenCodeModelsCacheForTests() {
  clearOpenCodeModelsCache();
}
```

```ts
function clearPiModelsCache() {
  discoveryCache.clear();
}

export function resetPiModelsCacheForTests() {
  clearPiModelsCache();
}
```

Export the refresh and discovery-injection functions from each package's `src/server/index.ts`. Import only the refresh functions in `server/src/adapters/registry.ts`, then assign them to `refreshModels` for `opencode_local` and `pi_local`.

- [ ] **Step 7: Run all provider refresh tests**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts
pnpm exec vitest run --project @paperclipai/adapter-opencode-local packages/adapters/opencode-local/src/server/models.test.ts
pnpm exec vitest run --project @paperclipai/adapter-pi-local packages/adapters/pi-local/src/server/models.test.ts
```

Expected: all commands PASS and each refresh assertion observes the second catalog.

- [ ] **Step 8: Commit provider refresh behavior**

```powershell
git add server/src/adapters/cursor-models.ts server/src/adapters/registry.ts server/src/__tests__/adapter-models.test.ts packages/adapters/opencode-local/src/server/models.ts packages/adapters/opencode-local/src/server/index.ts packages/adapters/opencode-local/src/server/models.test.ts packages/adapters/pi-local/src/server/models.ts packages/adapters/pi-local/src/server/index.ts packages/adapters/pi-local/src/server/models.test.ts
git commit -m "feat(adapters): refresh discovered model catalogs"
```

### Task 4: Integration Verification and Documentation Alignment

**Files:**
- Modify: `packages/adapters/codex-local/src/index.ts`
- Verify: `ui/src/components/AgentConfigForm.tsx`
- Verify: `server/src/routes/agents.ts`

- [ ] **Step 1: Confirm the UI refresh path preserves the current selection**

Verify `handleRefreshModels` only replaces the React Query data and does not call the model `onChange`/`mark` path:

```ts
const refreshed = await agentsApi.adapterModels(selectedCompanyId, adapterType, { refresh: true });
queryClient.setQueryData(modelQueryKey, refreshed);
```

No UI code change is required if this invariant still holds.

- [ ] **Step 2: Confirm the route uses the adapter refresh contract**

Verify `GET /companies/:companyId/adapters/:type/models?refresh=1` still selects:

```ts
const models = refresh
  ? await refreshAdapterModels(type)
  : await listAdapterModels(type);
```

Run the existing route test:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-model-refresh-routes.test.ts
```

Expected: PASS, including `uses refreshModels when refresh=1 is requested`.

- [ ] **Step 3: Update Codex adapter documentation**

Add this note to `agentConfigurationDoc`:

```md
- Paperclip discovers selectable models from `codex debug models` and merges them with bundled fallbacks. Use **Refresh models** in agent settings after updating Codex or receiving access to a new model.
```

- [ ] **Step 4: Run targeted verification**

Run:

```powershell
pnpm exec vitest run --project server server/src/__tests__/adapter-models.test.ts server/src/__tests__/adapter-model-refresh-routes.test.ts
pnpm exec vitest run --project @paperclipai/adapter-opencode-local packages/adapters/opencode-local/src/server/models.test.ts
pnpm exec vitest run --project @paperclipai/adapter-pi-local packages/adapters/pi-local/src/server/models.test.ts
pnpm --filter @paperclipai/adapter-codex-local typecheck
pnpm --filter @paperclipai/adapter-opencode-local typecheck
pnpm --filter @paperclipai/adapter-pi-local typecheck
pnpm --filter @paperclipai/server typecheck
```

Expected: every command PASS.

- [ ] **Step 5: Run PR-ready repository verification**

Run the repository-required full check:

```powershell
pnpm -r typecheck
pnpm test:run
pnpm build
```

Expected: all commands exit 0. If an unrelated pre-existing failure occurs, record the exact command and error without changing unrelated code.

- [ ] **Step 6: Inspect the final diff and commit the documentation update**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only planned files are modified.

```powershell
git add packages/adapters/codex-local/src/index.ts
git commit -m "docs(codex): explain live model refresh"
```
