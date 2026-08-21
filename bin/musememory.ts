#!/usr/bin/env bun
import { main } from "../src/cli.ts";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});
