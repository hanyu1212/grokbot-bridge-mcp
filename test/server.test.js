import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GrokBotBridge } from "../src/bridge.js";

const SERVER = fileURLToPath(new URL("../src/server.js", import.meta.url));
const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));

function findChildren(ppid) {
  const out = spawnSync("pgrep", ["-P", String(ppid)], { encoding: "utf8" });
  if (out.status !== 0) return [];
  return out.stdout
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter(Boolean);
}

function findStateRootProcesses(stateDir) {
  const out = spawnSync("pgrep", ["-f", stateDir], { encoding: "utf8" });
  if (out.status !== 0) return [];
  return out.stdout
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((pid) => pid > 0 && pid !== process.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("server exits with a clear error when GROKBOT_AGENTS is missing", () => {
  const env = { ...process.env };
  delete env.GROKBOT_AGENTS;
  const result = spawnSync(process.execPath, [SERVER], { env, encoding: "utf8", input: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GROKBOT_AGENTS is not set/);
});

test(
  "MCP server does not start bdk serve when no tool is called, and repeated open/close leaves zero processes",
  { skip: process.platform === "win32" },
  async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "gbb-idle-"));
    for (let i = 0; i < 3; i += 1) {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER],
        env: { ...process.env, GROKBOT_AGENTS: "Grok Bot", GROKBOT_BRIDGE_STATE_DIR: stateDir },
      });
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(transport);
      try {
        const pid = transport.pid;
        assert.ok(pid > 0);
        const { tools } = await client.listTools();
        assert.equal(tools.length, 4);
        // Wait briefly to confirm no background bdk serve is spawned on connect.
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.deepEqual(findChildren(pid), []);
        assert.deepEqual(findStateRootProcesses(stateDir), []);
      } finally {
        await client.close();
      }
    }
    assert.deepEqual(findStateRootProcesses(stateDir), []);
  },
);

test(
  "real bdk serve: on-demand start, idle reclamation, state persistence across restart, and SIGKILL parent cleanup",
  { skip: process.platform === "win32" },
  async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "gbb-lifecycle-"));
    const bridge = new GrokBotBridge(
      { agents: ["Grok Bot"], stateDir, finishInTurn: true },
      { idleTimeoutMs: 250 },
    );

    // 1. Not started before first call.
    assert.equal(bridge.serve, undefined);
    assert.deepEqual(findStateRootProcesses(stateDir), []);

    // 2. First call starts bdk serve and returns configured bots.
    const firstList = await bridge.list();
    assert.deepEqual(firstList.configured, [{ name: "Grok Bot" }]);
    const firstPid = bridge.serve?.child?.pid;
    assert.ok(firstPid > 0);
    assert.equal(isProcessAlive(firstPid), true);

    // Seed a contact record in the KV store as if an earlier `ask` recorded it.
    const kvDir = join(stateDir, "serve", "kv");
    mkdirSync(kvDir, { recursive: true });
    const kvFile = join(
      kvDir,
      `${encodeURIComponent("agentkit/v1/grokbot-bridge-mcp/kv/grokbot-agents%2Fprincipals%2Fservice%253Abearer")}.json`,
    );
    writeFileSync(
      kvFile,
      JSON.stringify([
        {
          name: "Grok Bot",
          sessionId: "ses_persisted_123",
          cursor: "99",
          firstContactAt: "2026-11-07T00:00:00.000Z",
          lastContactAt: "2026-11-07T00:00:00.000Z",
        },
      ]),
    );

    // 3. After idleTimeoutMs with no active calls, bdk serve is stopped and reaped.
    const idleDeadline = Date.now() + 5_000;
    while (isProcessAlive(firstPid) && Date.now() < idleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(isProcessAlive(firstPid), false);
    assert.equal(bridge.serve, undefined);

    // 4. Subsequent call restarts bdk serve on demand and still sees persisted contact state.
    const secondList = await bridge.list();
    const secondPid = bridge.serve?.child?.pid;
    assert.ok(secondPid > 0 && secondPid !== firstPid);
    assert.deepEqual(secondList.contacted, [
      {
        name: "Grok Bot",
        sessionId: "ses_persisted_123",
        firstContactAt: "2026-11-07T00:00:00.000Z",
        lastContactAt: "2026-11-07T00:00:00.000Z",
      },
    ]);
    const savedRaw = JSON.parse(readFileSync(kvFile, "utf8"));
    assert.equal(savedRaw[0].cursor, "99");

    await bridge.close();
    assert.equal(isProcessAlive(secondPid), false);

    // 5. Verify forced client/MCP kill (SIGKILL) does not leave bdk serve behind.
    const holder = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { startServe } from ${JSON.stringify(new URL("../src/serve.js", import.meta.url).href)};
          const s = await startServe({ agents: ["Grok Bot"], stateDir: ${JSON.stringify(stateDir)} });
          process.stdout.write(String(s.child.pid) + "\\n");
          setInterval(() => {}, 1000);
        `,
      ],
      { cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"] },
    );
    const servePid = Number(
      await new Promise((resolve, reject) => {
        let stderr = "";
        holder.stderr.on("data", (c) => {
          stderr += c.toString();
        });
        holder.stdout.once("data", (chunk) => resolve(chunk.toString().trim()));
        holder.once("exit", (code) => reject(new Error(`holder exited (${code}): ${stderr}`)));
      }),
    );
    assert.ok(servePid > 0);
    assert.equal(isProcessAlive(servePid), true);

    holder.kill("SIGKILL");
    await new Promise((resolve) => holder.once("exit", resolve));

    const killDeadline = Date.now() + 5_000;
    while (isProcessAlive(servePid) && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(isProcessAlive(servePid), false);
    assert.deepEqual(findStateRootProcesses(stateDir), []);
  },
);

// Talks to the real Grok Bot API; needs Cursor credentials (bdk login or CURSOR_API_KEY).
test("lists tools and calls grokbot_list end to end", { skip: !process.env.GROKBOT_E2E }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, GROKBOT_AGENTS: process.env.GROKBOT_AGENTS ?? "Grok Bot" },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "grokbot_ask",
      "grokbot_check",
      "grokbot_interrupt",
      "grokbot_list",
    ]);
    const result = await client.callTool({ name: "grokbot_list", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.ok(JSON.parse(result.content[0].text).configured.length >= 1);
  } finally {
    await client.close();
  }
});
