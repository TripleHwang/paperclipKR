import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePiModelConfiguredAndAvailable,
  listPiModels,
  refreshPiModels,
  resetPiModelsCacheForTests,
  setPiModelsDiscoveryForTests,
} from "./models.js";

describe("pi models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_PI_COMMAND;
    setPiModelsDiscoveryForTests(null);
    resetPiModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(listPiModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensurePiModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("Pi requires `adapterConfig.model`");
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(
      ensurePiModelConfiguredAndAvailable({
        model: "xai/grok-4",
      }),
    ).rejects.toThrow();
  });

  it("refreshes the cached model catalog on demand", async () => {
    const discovery = vi.fn()
      .mockResolvedValueOnce([{ id: "xai/old", label: "xai/old" }])
      .mockResolvedValueOnce([{ id: "xai/new", label: "xai/new" }]);
    setPiModelsDiscoveryForTests(discovery);

    const initial = await listPiModels();
    const cached = await listPiModels();
    const refreshed = await refreshPiModels();

    expect(discovery).toHaveBeenCalledTimes(2);
    expect(initial).toEqual([{ id: "xai/old", label: "xai/old" }]);
    expect(cached).toEqual([{ id: "xai/old", label: "xai/old" }]);
    expect(refreshed).toEqual([{ id: "xai/new", label: "xai/new" }]);
  });

  it("does not let an in-flight discovery overwrite a refreshed catalog", async () => {
    const oldModels = [{ id: "xai/old", label: "xai/old" }];
    const newModels = [{ id: "xai/new", label: "xai/new" }];
    let resolveOld!: (models: typeof oldModels) => void;
    const oldDiscovery = new Promise<typeof oldModels>((resolve) => {
      resolveOld = resolve;
    });
    const discovery = vi.fn()
      .mockImplementationOnce(() => oldDiscovery)
      .mockResolvedValueOnce(newModels);
    setPiModelsDiscoveryForTests(discovery);

    const oldList = listPiModels();
    const refreshed = await refreshPiModels();
    resolveOld(oldModels);
    await oldList;
    const cached = await listPiModels();

    expect(refreshed).toEqual(newModels);
    expect(cached).toEqual(newModels);
    expect(discovery).toHaveBeenCalledTimes(2);
  });
});
