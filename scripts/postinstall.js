#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  if (process.env.CI) process.exit(0);
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const distPath = join(currentDir, "..", "dist", "index.js");
  if (existsSync(distPath)) {
    import(distPath).then(({ main }) => {
      main(["install", "--global"]).catch(() => {});
    }).catch(() => {});
  }
} catch {}
