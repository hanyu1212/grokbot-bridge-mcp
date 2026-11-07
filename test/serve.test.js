import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createChildStopper, serveEnv } from "../src/serve.js";

const SERVE_GUARD_URL = new URL("../src/serve-guard.js", import.meta.url).href;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("serveEnv strips GitHub tokens and shadows gh", { skip: process.platform === "win32" }, () => {
  const stubDir = join(mkdtempSync(join(tmpdir(), "gbb-")), "no-github");
  const env = serveEnv(
    { PATH: process.env.PATH, GITHUB_TOKEN: "x", GH_TOKEN: "y", GITHUB_APP_PRIVATE_KEY: "z", KEEP: "1" },
    stubDir,
  );
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_APP_PRIVATE_KEY, undefined);
  assert.equal(env.KEEP, "1");
  assert.ok(env.PATH.startsWith(stubDir));
  assert.throws(() => execFileSync("gh", ["auth", "token"], { env, stdio: "ignore" }));
});

test("createChildStopper waits for SIGTERM exit and escalates to SIGKILL on timeout", async () => {
  const polite = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  const stopPolite = createChildStopper(polite, { timeoutMs: 2_000 });
  await stopPolite();
  assert.equal(isProcessAlive(polite.pid), false);

  const stubborn = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready\\n');"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  await new Promise((resolve) => stubborn.stdout.once("data", resolve));
  const stopStubborn = createChildStopper(stubborn, { timeoutMs: 150 });
  await stopStubborn();
  assert.equal(isProcessAlive(stubborn.pid), false);
});

test("serve-guard swallows broken pipe EPIPE without uncaughtException loop", async () => {
  const script = `
    let uncaught = 0;
    process.on("uncaughtException", () => {
      uncaught += 1;
      process.stderr.write("again\\n");
    });
    const err = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    process.stdout.emit("error", err);
    process.stderr.emit("error", err);
    if (uncaught !== 0) process.exit(2);
    process.exit(0);
  `;
  const child = spawn(process.execPath, ["--import", SERVE_GUARD_URL, "-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0);
});

test("serve-guard exits when parent process is killed with SIGKILL", async () => {
  const parentScript = `
    import { spawn } from "node:child_process";
    const child = spawn(
      process.execPath,
      ["--import", ${JSON.stringify(SERVE_GUARD_URL)}, "-e", "setInterval(() => {}, 1000); console.log(process.pid);"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdout.once("data", (chunk) => {
      process.stdout.write(chunk.toString().trim() + "\\n");
    });
    setInterval(() => {}, 1000);
  `;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", parentScript], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const grandchildPid = Number(
    await new Promise((resolve) => {
      parent.stdout.once("data", (chunk) => resolve(chunk.toString().trim()));
    }),
  );
  assert.ok(grandchildPid > 0);
  assert.equal(isProcessAlive(grandchildPid), true);

  parent.kill("SIGKILL");
  await new Promise((resolve) => parent.once("exit", resolve));

  const deadline = Date.now() + 3_000;
  while (isProcessAlive(grandchildPid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(isProcessAlive(grandchildPid), false);
});
