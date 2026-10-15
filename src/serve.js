import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
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

const GITHUB_ENV_VARS = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
];

/**
 * `bdk serve` looks for GitHub credentials at startup (env vars, then
 * `gh auth token`) for GitHub channels this bridge never uses. Strip the env
 * vars and shadow `gh` with a stub that always fails, so no GitHub token is
 * ever loaded into the serve process.
 */
export function serveEnv(env, stubDir) {
  mkdirSync(stubDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(stubDir, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(stubDir, "gh.cmd"), "@exit /b 1\r\n");
  const next = { ...env };
  for (const name of GITHUB_ENV_VARS) delete next[name];
  const pathKey = Object.keys(next).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  next[pathKey] = [stubDir, next[pathKey]].filter(Boolean).join(delimiter);
  return next;
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
      env: { ...serveEnv(process.env, join(stateDir, "no-github")), GROKBOT_AGENTS: agents.join(",") },
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
