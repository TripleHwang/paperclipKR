#!/usr/bin/env node

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageRoot, "src", "migrations");
const destination = join(packageRoot, "dist", "migrations");

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
