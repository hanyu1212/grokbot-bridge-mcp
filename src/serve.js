import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseListeningUrl } from "./config.js";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 60_000;

function bdkBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@cursor/bdk/package.json");
  const { bin } = require(pkgPath);
  return join(dirname(pkgPath), typeof bin === "string" ? bin : bin.bdk);
}

/**
 * Start `bdk serve` on the bundled project, bound to loopback with a random
 * bearer token, and resolve once it is listening.
 */
export async function startServe({ agents, stateDir, log = () => {} }) {
  const token = randomBytes(24).toString("hex");
  const serveState = join(stateDir, "serve");
  mkdirSync(serveState, { recursive: true, mode: 0o700 });

  const child = spawn(
    process.execPath,
    [
      bdkBin(),
      "serve",
      "--dir",
      PROJECT_DIR,
      "--mode",
      "single",
      "--port",
      "0",
      "--bearer-token",
      token,
      "--state-root",
      serveState,
      "--no-playground",
      "--no-docs",
      "--no-schedules",
    ],
    {
      env: { ...process.env, GROKBOT_AGENTS: agents.join(",") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stop = () => {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  };
  process.once("exit", stop);

  const baseUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`bdk serve did not start within ${STARTUP_TIMEOUT_MS / 1000}s.\n${output.slice(-2000)}`));
    }, STARTUP_TIMEOUT_MS);
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      log(text);
      const url = parseListeningUrl(output);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`bdk serve exited (${code}) before it was ready.\n${output.slice(-2000)}`));
    });
  });

  return { mcpUrl: `${baseUrl}/v1/mcp`, token, child, stop };
}
