import { beforeEach, describe, expect, it, vi } from "vitest";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { models as cursorFallbackModels } from "@paperclipai/adapter-cursor-local";
import { models as opencodeFallbackModels } from "@paperclipai/adapter-opencode-local";
import { resetOpenCodeModelsCacheForTests } from "@paperclipai/adapter-opencode-local/server";
import { listAdapterModels, listServerAdapters, refreshAdapterModels } from "../adapters/index.js";
import {
  parseCodexModelsOutput,
  resetCodexModelsCacheForTests,
  setCodexModelsRunnerForTests,
} from "../adapters/codex-models.js";
import { resetCursorModelsCacheForTests, setCursorModelsRunnerForTests } from "../adapters/cursor-models.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

describe("adapter model listing", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.PAPERCLIP_CODEX_COMMAND;
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    resetCodexModelsCacheForTests();
    setCodexModelsRunnerForTests(() => ({
      status: null,
      stdout: "",
      stderr: "",
      hasError: true,
    }));
    resetCursorModelsCacheForTests();
    setCursorModelsRunnerForTests(null);
    resetOpenCodeModelsCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns an empty list for unknown adapters", async () => {
    const models = await listAdapterModels("unknown_adapter");
    expect(models).toEqual([]);
  });

  it("uses provider-prefixed ACPX fallback model labels", () => {
    const adapter = listServerAdapters().find((candidate) => candidate.type === "acpx_local");

    expect(adapter?.models?.some((model) => model.label.startsWith("Claude: "))).toBe(true);
    expect(adapter?.models?.some((model) => model.label.startsWith("Codex: "))).toBe(true);
  });

  it("returns codex fallback models when no OpenAI key is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const models = await listAdapterModels("codex_local");

    expect(models).toEqual(codexFallbackModels);
    expect(models.slice(0, 5)).toEqual([
      { id: "gpt-5.6", label: "gpt-5.6" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
      { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
      { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
      { id: "gpt-5.5", label: "gpt-5.5" },
    ]);
    for (const modelId of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(models.some((model) => model.id === modelId)).toBe(true);
    }
    expect(models.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses visible Codex CLI models with display-name fallback and deduplication", () => {
    const models = parseCodexModelsOutput(JSON.stringify({
      models: [
        { slug: "gpt-5.6", display_name: " GPT 5.6 ", visibility: "list" },
        { slug: "gpt-5.5", display_name: "   " },
        { slug: "gpt-5.6", display_name: "Ignored duplicate", visibility: "list" },
      ],
    }));

    expect(models).toEqual([
      { id: "gpt-5.6", label: "GPT 5.6" },
      { id: "gpt-5.5", label: "gpt-5.5" },
    ]);
  });

  it("rejects hidden, malformed, and unsafe Codex CLI model entries", () => {
    expect(parseCodexModelsOutput(JSON.stringify({
      models: [
        { slug: "gpt-5.6", visibility: "hidden" },
        { slug: "gpt 5.6", visibility: "list" },
        { slug: "gpt-5.6;whoami", visibility: "list" },
        { slug: 42, visibility: "list" },
        { slug: "gpt-5.5", visibility: "list" },
      ],
    }))).toEqual([{ id: "gpt-5.5", label: "gpt-5.5" }]);
  });

  it("returns no Codex CLI models for malformed JSON or non-model payloads", () => {
    expect(parseCodexModelsOutput("not json")).toEqual([]);
    expect(parseCodexModelsOutput(JSON.stringify({ data: [] }))).toEqual([]);
    expect(parseCodexModelsOutput(JSON.stringify({ models: {} }))).toEqual([]);
  });

  it("discovers Codex CLI models without an API key and merges fallbacks", async () => {
    setCodexModelsRunnerForTests(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: "gpt-5.7-preview", display_name: "GPT 5.7 Preview", visibility: "list" }] }),
      stderr: "",
      hasError: false,
    }));

    const models = await listAdapterModels("codex_local");

    expect(models.some((model) => model.id === "gpt-5.7-preview" && model.label === "GPT 5.7 Preview")).toBe(true);
    expect(models.some((model) => model.id === "gpt-5.6")).toBe(true);
  });

  it("caches Codex CLI model discovery on normal calls", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [{ slug: "gpt-5.7-preview", visibility: "list" }] }),
      stderr: "",
      hasError: false,
    }));
    setCodexModelsRunnerForTests(runner);

    await listAdapterModels("codex_local");
    await listAdapterModels("codex_local");

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("caches fallbacks after a valid empty Codex CLI catalog", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [] }),
      stderr: "",
      hasError: false,
    }));
    setCodexModelsRunnerForTests(runner);

    const first = await listAdapterModels("codex_local");
    const second = await listAdapterModels("codex_local");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "gpt-5.6")).toBe(true);
  });

  it("does not cache malformed successful-process Codex CLI output", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ data: [] }),
      stderr: "",
      hasError: false,
    }));
    setCodexModelsRunnerForTests(runner);

    await listAdapterModels("codex_local");
    await listAdapterModels("codex_local");

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("refreshes Codex CLI models on demand", async () => {
    const runner = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ models: [{ slug: "gpt-5.7", visibility: "list" }] }), stderr: "", hasError: false })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ models: [{ slug: "gpt-5.8", visibility: "list" }] }), stderr: "", hasError: false });
    setCodexModelsRunnerForTests(runner);

    const initial = await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(runner).toHaveBeenCalledTimes(2);
    expect(initial.some((model) => model.id === "gpt-5.7")).toBe(true);
    expect(refreshed.some((model) => model.id === "gpt-5.8")).toBe(true);
  });

  it("preserves the last successful Codex CLI catalog after a failed refresh", async () => {
    const runner = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ models: [{ slug: "gpt-5.7", visibility: "list" }] }), stderr: "", hasError: false })
      .mockReturnValueOnce({ status: null, stdout: "", stderr: "", hasError: true });
    setCodexModelsRunnerForTests(runner);

    await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(refreshed.some((model) => model.id === "gpt-5.7")).toBe(true);
  });

  it("loads codex models dynamically and merges fallback options", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-5-pro" },
          { id: "gpt-5" },
        ],
      }),
    } as Response);

    const first = await listAdapterModels("codex_local");
    const second = await listAdapterModels("codex_local");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "gpt-5-pro")).toBe(true);
    expect(first.some((model) => model.id === "codex-mini-latest")).toBe(true);
  });

  it("caches fallbacks after a valid empty OpenAI model catalog", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    const first = await listAdapterModels("codex_local");
    const second = await listAdapterModels("codex_local");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "gpt-5.6")).toBe(true);
  });

  it("refreshes cached codex models on demand", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-5" }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-5.5" }],
        }),
      } as Response);

    const initial = await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(initial.some((model) => model.id === "gpt-5")).toBe(true);
    expect(refreshed.some((model) => model.id === "gpt-5.5")).toBe(true);
  });

  it("falls back to static codex models when OpenAI model discovery fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    const models = await listAdapterModels("codex_local");
    expect(models).toEqual(codexFallbackModels);
  });


  it("returns cursor fallback models when CLI discovery is unavailable", async () => {
    setCursorModelsRunnerForTests(() => ({
      status: null,
      stdout: "",
      stderr: "",
      hasError: true,
    }));

    const models = await listAdapterModels("cursor");
    expect(models).toEqual(cursorFallbackModels);
  });

  it("returns opencode fallback models including gpt-5.4", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";

    const models = await listAdapterModels("opencode_local");

    expect(models).toEqual(opencodeFallbackModels);
  });

  it("loads cursor models dynamically and caches them", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: "Available models: auto, composer-1.5, gpt-5.3-codex-high, sonnet-4.6",
      stderr: "",
      hasError: false,
    }));
    setCursorModelsRunnerForTests(runner);

    const first = await listAdapterModels("cursor");
    const second = await listAdapterModels("cursor");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "auto")).toBe(true);
    expect(first.some((model) => model.id === "gpt-5.3-codex-high")).toBe(true);
    expect(first.some((model) => model.id === "composer-1")).toBe(true);
  });

});
