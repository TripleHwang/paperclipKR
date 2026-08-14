import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { AdapterModel } from "./types.js";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { readConfigFile } from "../config-file.js";

const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENAI_MODELS_TIMEOUT_MS = 5000;
const OPENAI_MODELS_CACHE_TTL_MS = 60_000;
const CODEX_MODELS_TIMEOUT_MS = 10_000;
const CODEX_MODELS_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

type CodexModelsCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  hasError: boolean;
};

let cached: { identity: string; expiresAt: number; models: AdapterModel[] } | null = null;

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function mergedWithFallback(models: AdapterModel[]): AdapterModel[] {
  return dedupeModels([...models, ...codexFallbackModels])
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function resolveOpenAiApiKey(): string | null {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const config = readConfigFile();
  if (config?.llm?.provider !== "openai") return null;
  const configKey = config.llm.apiKey?.trim();
  return configKey && configKey.length > 0 ? configKey : null;
}

function cacheIdentity(command: string, apiKey: string | null): string {
  const keyPart = apiKey ? createHash("sha256").update(apiKey).digest("hex") : "no-api-key";
  return `${command}:${keyPart}`;
}

export function parseCodexModelsOutput(stdout: string): AdapterModel[] {
  try {
    const payload = JSON.parse(stdout) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
    const entries = (payload as { models?: unknown }).models;
    if (!Array.isArray(entries)) return [];

    const models: AdapterModel[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const { slug, display_name: displayName, visibility } = entry as {
        slug?: unknown;
        display_name?: unknown;
        visibility?: unknown;
      };
      if (visibility !== undefined && visibility !== "list") continue;
      if (typeof slug !== "string") continue;
      const id = slug.trim();
      if (id !== slug) continue;
      if (!SAFE_MODEL_ID.test(id)) continue;
      const label = typeof displayName === "string" && displayName.trim() ? displayName.trim() : id;
      models.push({ id, label });
    }
    return dedupeModels(models);
  } catch {
    return [];
  }
}

function resolveCodexCommand(command: string): string {
  if (command.includes("/") || command.includes("\\")) {
    return path.isAbsolute(command) ? command : path.resolve(command);
  }
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  const hasExtension = process.platform === "win32" && path.extname(command).length > 0;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of hasExtension ? [""] : extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/%/g, "%%").replace(/"/g, "\\\"")}"`;
}

function defaultCodexModelsRunner(): CodexModelsCommandResult {
  const command = process.env.PAPERCLIP_CODEX_COMMAND?.trim() || "codex";
  const executable = resolveCodexCommand(command);
  const isWindowsWrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  const result = isWindowsWrapper
    ? spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"), [
      "/d", "/s", "/c", `${quoteForCmd(executable)} debug models`,
    ], {
      encoding: "utf8",
      timeout: CODEX_MODELS_TIMEOUT_MS,
      maxBuffer: CODEX_MODELS_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    : spawnSync(executable, ["debug", "models"], {
      encoding: "utf8",
      timeout: CODEX_MODELS_TIMEOUT_MS,
      maxBuffer: CODEX_MODELS_MAX_BUFFER_BYTES,
      windowsHide: true,
    });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    hasError: Boolean(result.error),
  };
}

let codexModelsRunner: () => CodexModelsCommandResult = defaultCodexModelsRunner;

function fetchCodexModelsFromCli(): AdapterModel[] {
  const result = codexModelsRunner();
  if (result.status !== 0 || result.hasError) return [];
  return parseCodexModelsOutput(result.stdout);
}

async function fetchOpenAiModels(apiKey: string): Promise<AdapterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: unknown };
    const data = Array.isArray(payload.data) ? payload.data : [];
    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || id.trim().length === 0) continue;
      models.push({ id, label: id });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCodexModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const forceRefresh = options?.forceRefresh === true;
  const apiKey = resolveOpenAiApiKey();
  const command = process.env.PAPERCLIP_CODEX_COMMAND?.trim() || "codex";
  const identity = cacheIdentity(command, apiKey);
  const now = Date.now();
  if (!forceRefresh && cached?.identity === identity && cached.expiresAt > now) return cached.models;

  const cliModels = fetchCodexModelsFromCli();
  const apiModels = apiKey ? await fetchOpenAiModels(apiKey) : [];
  if (cliModels.length > 0 || apiModels.length > 0) {
    const models = mergedWithFallback([...cliModels, ...apiModels]);
    cached = { identity, expiresAt: now + OPENAI_MODELS_CACHE_TTL_MS, models };
    return models;
  }

  if (cached?.identity === identity && cached.models.length > 0) return cached.models;
  return dedupeModels(codexFallbackModels);
}

export async function listCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels();
}

export async function refreshCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels({ forceRefresh: true });
}

export function resetCodexModelsCacheForTests() {
  cached = null;
}

export function setCodexModelsRunnerForTests(runner: (() => CodexModelsCommandResult) | null) {
  codexModelsRunner = runner ?? defaultCodexModelsRunner;
}
