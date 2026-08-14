import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureOpenCodeModelConfiguredAndAvailable,
  listOpenCodeModels,
  requireOpenCodeModelId,
  refreshOpenCodeModels,
  resetOpenCodeModelsCacheForTests,
  setOpenCodeModelsDiscoveryForTests,
} from "./models.js";

describe("openCode models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    setOpenCodeModelsDiscoveryForTests(null);
    resetOpenCodeModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";
    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
  });

  it("accepts a provider/model id without running discovery", () => {
    expect(requireOpenCodeModelId("openai/gpt-5.2-codex")).toBe("openai/gpt-5.2-codex");
  });

  it("rejects malformed provider/model ids before discovery", () => {
    expect(() => requireOpenCodeModelId("gpt-5.2-codex")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
    expect(() => requireOpenCodeModelId("openai/")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openai/gpt-5",
      }),
    ).rejects.toThrow("Failed to start command");
  });

  it("refreshes the cached model catalog on demand", async () => {
    const discovery = vi.fn()
      .mockResolvedValueOnce([{ id: "openai/old", label: "openai/old" }])
      .mockResolvedValueOnce([{ id: "openai/new", label: "openai/new" }]);
    setOpenCodeModelsDiscoveryForTests(discovery);

    const initial = await listOpenCodeModels();
    const cached = await listOpenCodeModels();
    const refreshed = await refreshOpenCodeModels();

    expect(discovery).toHaveBeenCalledTimes(2);
    expect(initial).toEqual([{ id: "openai/old", label: "openai/old" }]);
    expect(cached).toEqual([{ id: "openai/old", label: "openai/old" }]);
    expect(refreshed).toEqual([{ id: "openai/new", label: "openai/new" }]);
  });

  it("does not let an in-flight discovery overwrite a refreshed catalog", async () => {
    const oldModels = [{ id: "openai/old", label: "openai/old" }];
    const newModels = [{ id: "openai/new", label: "openai/new" }];
    let resolveOld!: (models: typeof oldModels) => void;
    const oldDiscovery = new Promise<typeof oldModels>((resolve) => {
      resolveOld = resolve;
    });
    const discovery = vi.fn()
      .mockImplementationOnce(() => oldDiscovery)
      .mockResolvedValueOnce(newModels);
    setOpenCodeModelsDiscoveryForTests(discovery);

    const oldList = listOpenCodeModels();
    const refreshed = await refreshOpenCodeModels();
    resolveOld(oldModels);
    await oldList;
    const cached = await listOpenCodeModels();

    expect(refreshed).toEqual(newModels);
    expect(cached).toEqual(newModels);
    expect(discovery).toHaveBeenCalledTimes(2);
  });
});
