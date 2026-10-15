import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROUTING_NOTE,
  serverEntry,
  updateAgentsMd,
  updateCodexConfig,
  updateCursorConfig,
} from "../src/clients.js";

const entry = serverEntry({ command: "npx", args: ["-y", "grokbot-bridge-mcp"] }, ["Grok Bot", "Ops Bot"]);

test("updateCursorConfig keeps other servers and replaces grokbot", () => {
  const before = JSON.stringify({ mcpServers: { blender: { command: "uvx" }, grokbot: { command: "old" } }, x: 1 });
  const after = JSON.parse(updateCursorConfig(before, entry));
  assert.deepEqual(after.mcpServers.blender, { command: "uvx" });
  assert.deepEqual(after.mcpServers.grokbot, {
    command: "npx",
    args: ["-y", "grokbot-bridge-mcp"],
    env: { GROKBOT_AGENTS: "Grok Bot,Ops Bot" },
  });
  assert.equal(after.x, 1);
  assert.deepEqual(JSON.parse(updateCursorConfig(undefined, entry)).mcpServers.grokbot, after.mcpServers.grokbot);
});

test("updateCodexConfig replaces old grokbot tables and keeps the rest", () => {
  const before = [
    'model = "gpt"',
    "",
    "[mcp_servers.grokbot]",
    'command = "old"',
    "",
    "[mcp_servers.grokbot.env]",
    'GROKBOT_AGENTS = "Old"',
    "",
    "[mcp_servers.other]",
    'command = "keep"',
  ].join("\n");
  const after = updateCodexConfig(before, entry);
  assert.ok(after.startsWith('model = "gpt"'));
  assert.ok(after.includes('[mcp_servers.other]\ncommand = "keep"'));
  assert.ok(!after.includes('"old"'));
  assert.ok(!after.includes('"Old"'));
  assert.equal(after.match(/\[mcp_servers\.grokbot\]/g).length, 1);
  assert.ok(after.includes('args = ["-y", "grokbot-bridge-mcp"]'));
  assert.ok(after.includes("tool_timeout_sec = 660"));
  assert.ok(after.includes('GROKBOT_AGENTS = "Grok Bot,Ops Bot"'));
  assert.equal(updateCodexConfig(after, entry), after);
});

test("updateAgentsMd appends once and replaces in place", () => {
  const once = updateAgentsMd("# Notes\n");
  assert.ok(once.startsWith("# Notes\n\n"));
  assert.ok(once.includes(ROUTING_NOTE));
  assert.equal(updateAgentsMd(once), once);
  assert.equal(updateAgentsMd(undefined).trim().split("\n").length, 3);
});
