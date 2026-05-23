#!/usr/bin/env node

import { chmodSync } from "node:fs";
import esbuild from "esbuild";
import config from "../esbuild.config.mjs";

await esbuild.build(config);

if (process.platform !== "win32") {
  chmodSync("dist/index.js", 0o755);
}
