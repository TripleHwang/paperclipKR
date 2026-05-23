#!/usr/bin/env node

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(serverRoot, "src", "onboarding-assets");
const destination = join(serverRoot, "dist", "onboarding-assets");

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
