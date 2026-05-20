#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";

function usage() {
  process.stdout.write(`Usage:
  node scripts/paperclip-issue-create.mjs --payload-file PATH [options]

Creates an issue with a UTF-8 JSON request body. This avoids Windows shell/curl
argument encoding problems when issue text contains Korean, Chinese, Japanese,
emoji, or other non-ASCII characters.

For non-ASCII text on Windows, do not pass the title or description as command
arguments. Use --payload-file, --title-file, --description-file, or stdin so the
text is read as UTF-8 bytes instead.

Options:
  --company-id ID              Defaults to PAPERCLIP_COMPANY_ID
  --title TEXT                 Issue title
  --title-file PATH            Read title from a UTF-8 file
  --title-stdin                Read title from stdin as UTF-8
  --description TEXT           Issue description
  --description-file PATH      Read description from a UTF-8 file
  --description-stdin          Read description from stdin as UTF-8
  --status STATUS              Defaults to todo
  --priority PRIORITY          Defaults to medium
  --assignee-agent-id ID
  --parent-id ID
  --goal-id ID
  --project-id ID
  --blocked-by-issue-id ID     Repeatable
  --payload-file PATH          Read a full UTF-8 JSON payload file, then apply flags
  --payload-stdin              Read a full UTF-8 JSON payload from stdin, then apply flags
  --dry-run                    Print JSON payload only

Example:
  node scripts/paperclip-issue-create.mjs \\
    --payload-file .paperclip-issue-payload.json
`);
}

function readArg(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function readStdinUtf8() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return stripUtf8Bom(Buffer.concat(chunks).toString("utf8"));
}

function stripUtf8Bom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

async function readTextFileUtf8(filePath) {
  return stripUtf8Bom(await readFile(filePath, "utf8"));
}

function parseJsonObject(raw, sourceLabel) {
  const parsed = JSON.parse(stripUtf8Bom(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must contain a JSON object.`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const payload = {};
const blockedByIssueIds = [];
let companyId = process.env.PAPERCLIP_COMPANY_ID ?? "";
let dryRun = false;
let titleFromStdin = false;
let titleFile = "";
let descriptionFromStdin = false;
let descriptionFile = "";
let payloadFromStdin = false;
let payloadFile = "";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  switch (arg) {
    case "--help":
    case "-h":
      usage();
      process.exit(0);
      break;
    case "--company-id":
      companyId = readArg(args, index, arg);
      index += 1;
      break;
    case "--title":
      payload.title = readArg(args, index, arg);
      index += 1;
      break;
    case "--title-file":
      titleFile = readArg(args, index, arg);
      index += 1;
      break;
    case "--title-stdin":
      titleFromStdin = true;
      break;
    case "--description":
      payload.description = readArg(args, index, arg);
      index += 1;
      break;
    case "--description-file":
      descriptionFile = readArg(args, index, arg);
      index += 1;
      break;
    case "--description-stdin":
      descriptionFromStdin = true;
      break;
    case "--status":
      payload.status = readArg(args, index, arg);
      index += 1;
      break;
    case "--priority":
      payload.priority = readArg(args, index, arg);
      index += 1;
      break;
    case "--assignee-agent-id":
      payload.assigneeAgentId = readArg(args, index, arg);
      index += 1;
      break;
    case "--parent-id":
      payload.parentId = readArg(args, index, arg);
      index += 1;
      break;
    case "--goal-id":
      payload.goalId = readArg(args, index, arg);
      index += 1;
      break;
    case "--project-id":
      payload.projectId = readArg(args, index, arg);
      index += 1;
      break;
    case "--blocked-by-issue-id":
      blockedByIssueIds.push(readArg(args, index, arg));
      index += 1;
      break;
    case "--payload-file":
      payloadFile = readArg(args, index, arg);
      index += 1;
      break;
    case "--payload-stdin":
      payloadFromStdin = true;
      break;
    case "--dry-run":
      dryRun = true;
      break;
    default:
      throw new Error(`Unknown argument: ${arg}`);
  }
}

const stdinReaders = [titleFromStdin, descriptionFromStdin, payloadFromStdin].filter(Boolean).length;
if (stdinReaders > 1) {
  throw new Error("Only one of --title-stdin, --description-stdin, or --payload-stdin can read stdin.");
}

if (payloadFile) {
  Object.assign(payload, parseJsonObject(await readTextFileUtf8(payloadFile), "--payload-file"));
}
if (payloadFromStdin) {
  Object.assign(payload, parseJsonObject(await readStdinUtf8(), "--payload-stdin"));
}
if (titleFile) {
  payload.title = await readTextFileUtf8(titleFile);
}
if (titleFromStdin) {
  payload.title = await readStdinUtf8();
}
if (descriptionFile) {
  payload.description = await readTextFileUtf8(descriptionFile);
}
if (descriptionFromStdin) {
  payload.description = await readStdinUtf8();
}
if (blockedByIssueIds.length > 0) {
  payload.blockedByIssueIds = blockedByIssueIds;
}
if (!payload.status) {
  payload.status = "todo";
}
if (!payload.priority) {
  payload.priority = "medium";
}

if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
  throw new Error("Missing title. Pass --title, --title-file, --title-stdin, or --payload-file.");
}
payload.title = payload.title.trim();
if (typeof payload.description === "string") {
  payload.description = payload.description.trim();
  if (!payload.description) {
    delete payload.description;
  }
}

const body = JSON.stringify(payload);
if (dryRun) {
  process.stdout.write(`${body}\n`);
  process.exit(0);
}

const apiUrl = process.env.PAPERCLIP_API_URL;
const apiKey = process.env.PAPERCLIP_API_KEY;
if (!companyId) {
  throw new Error("Missing company id. Pass --company-id or set PAPERCLIP_COMPANY_ID.");
}
if (!apiUrl || !apiKey) {
  throw new Error("Missing PAPERCLIP_API_URL or PAPERCLIP_API_KEY.");
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json; charset=utf-8",
};
if (process.env.PAPERCLIP_RUN_ID) {
  headers["X-Paperclip-Run-Id"] = process.env.PAPERCLIP_RUN_ID;
}

const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/companies/${companyId}/issues`, {
  method: "POST",
  headers,
  body,
});
const text = await response.text();
if (!response.ok) {
  throw new Error(`Paperclip issue create failed (${response.status}): ${text}`);
}
process.stdout.write(`${text}\n`);
