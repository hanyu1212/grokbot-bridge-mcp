import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseListeningUrl } from "./config.js";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_GUARD_URL = new URL("./serve-guard.js", import.meta.url).href;
const STARTUP_TIMEOUT_MS = 60_000;
export const STOP_TIMEOUT_MS = 5_000;

export function bdkBin() {
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
 * Create an idempotent async `stop()` that sends SIGTERM, waits for the child
 * to actually exit, and escalates to SIGKILL after `timeoutMs`.
 */
export function createChildStopper(child, { timeoutMs = STOP_TIMEOUT_MS } = {}) {
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  const onProcessExit = () => {
    if (!hasExited()) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  };
  process.once("exit", onProcessExit);
  child.once("exit", () => {
    process.off("exit", onProcessExit);
  });

  let stopPromise;
  return () => {
    stopPromise ??= (async () => {
      process.off("exit", onProcessExit);
      if (hasExited()) return;

      await new Promise((resolve) => {
        let killTimer;
        let giveUpTimer;
        const onExit = () => {
          clearTimeout(killTimer);
          clearTimeout(giveUpTimer);
          resolve();
        };
        child.once("exit", onExit);
        if (hasExited()) {
          child.off("exit", onExit);
          resolve();
          return;
        }
        try {
          child.kill("SIGTERM");
        } catch {
          child.off("exit", onExit);
          resolve();
          return;
        }
        killTimer = setTimeout(() => {
          if (!hasExited()) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
          giveUpTimer = setTimeout(() => {
            child.off("exit", onExit);
            resolve();
          }, 1_000);
          giveUpTimer.unref?.();
        }, timeoutMs);
        killTimer.unref?.();
      });

      try {
        child.stdin?.destroy();
      } catch {}
    })();
    return stopPromise;
  };
}

/**
 * Start `bdk serve` on the bundled project, bound to loopback with a random
 * bearer token, and resolve once it is listening.
 */
export async function startServe({
  agents,
  stateDir,
  log = () => {},
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
}) {
  const token = randomBytes(24).toString("hex");
  const serveState = join(stateDir, "serve");
  mkdirSync(serveState, { recursive: true, mode: 0o700 });

  const child = spawn(
    process.execPath,
    [
      "--import",
      SERVE_GUARD_URL,
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
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.on("error", () => {});

  const stop = createChildStopper(child, { timeoutMs: stopTimeoutMs });

  let baseUrl;
  try {
    baseUrl = await new Promise((resolve, reject) => {
      let output = "";
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        child.off("exit", onExit);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`bdk serve did not start within ${startupTimeoutMs / 1000}s.\n${output.slice(-2000)}`));
      }, startupTimeoutMs);
      timer.unref?.();
      const onData = (chunk) => {
        const text = chunk.toString();
        output += text;
        log(text);
        const url = parseListeningUrl(output);
        if (url) {
          cleanup();
          resolve(url);
        }
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`bdk serve exited (${code ?? signal}) before it was ready.\n${output.slice(-2000)}`));
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", onExit);
    });
  } catch (error) {
    await stop();
    throw error;
  }

  child.stdout.on("data", (chunk) => log(chunk.toString()));
  child.stderr.on("data", (chunk) => log(chunk.toString()));

  return { mcpUrl: `${baseUrl}/v1/mcp`, token, child, stop };
}
