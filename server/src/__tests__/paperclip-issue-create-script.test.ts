import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

describe("paperclip issue create helper", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  async function makeTempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-issue-create-helper-"));
    cleanupDirs.add(dir);
    return dir;
  }

  it("reads multilingual issue text from a UTF-8 payload file", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "payload.json");
    await fs.writeFile(
      payloadPath,
      JSON.stringify({
        title: "한국어 하위 작업",
        description: "中文说明\n日本語の説明",
        parentId: "11111111-1111-4111-8111-111111111111",
      }),
      "utf8",
    );

    const scriptPath = path.resolve(process.cwd(), "scripts", "paperclip-issue-create.mjs");
    const { stdout } = await execFile(process.execPath, [scriptPath, "--payload-file", payloadPath, "--dry-run"], {
      encoding: "utf8",
    });

    expect(JSON.parse(stdout)).toMatchObject({
      title: "한국어 하위 작업",
      description: "中文说明\n日本語の説明",
      parentId: "11111111-1111-4111-8111-111111111111",
      status: "todo",
      priority: "medium",
    });
  });

  it("allows a UTF-8 title file to override payload title text", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "payload.json");
    const titlePath = path.join(dir, "title.txt");
    await fs.writeFile(payloadPath, JSON.stringify({ title: "placeholder" }), "utf8");
    await fs.writeFile(titlePath, "한글 제목\n", "utf8");

    const scriptPath = path.resolve(process.cwd(), "scripts", "paperclip-issue-create.mjs");
    const { stdout } = await execFile(
      process.execPath,
      [scriptPath, "--payload-file", payloadPath, "--title-file", titlePath, "--dry-run"],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout).title).toBe("한글 제목");
  });
});
