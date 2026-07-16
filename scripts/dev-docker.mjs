#!/usr/bin/env node
/**
 * Arranque en contenedor: API con --watch + Vite HMR.
 * node_modules vive solo dentro del contenedor.
 */
import { spawn } from "node:child_process";

const kids = [];

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  kids.push(child);
  child.on("exit", (code, signal) => {
    console.error(`[dev] ${cmd} salió`, { code, signal });
    for (const k of kids) {
      if (k !== child && !k.killed) k.kill("SIGTERM");
    }
    process.exit(code ?? 1);
  });
}

run("node", ["--watch", "server/index.mjs"]);
run("npx", ["vite", "--host", "0.0.0.0", "--port", "5173"]);

process.on("SIGINT", () => {
  for (const k of kids) k.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  for (const k of kids) k.kill("SIGTERM");
  process.exit(0);
});
