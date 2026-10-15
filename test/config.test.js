import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, parseAgents, parseListeningUrl, resolveAgent } from "../src/config.js";

test("parseAgents trims and drops empty names", () => {
  assert.deepEqual(parseAgents(" Grok Bot , ,Research Bot "), ["Grok Bot", "Research Bot"]);
  assert.deepEqual(parseAgents(undefined), []);
});

test("loadConfig requires an allowlist", () => {
  assert.throws(() => loadConfig({}), /GROKBOT_AGENTS is not set/);
  const config = loadConfig({ GROKBOT_AGENTS: "Grok Bot", GROKBOT_BRIDGE_STATE_DIR: "/tmp/x" });
  assert.deepEqual(config, { agents: ["Grok Bot"], stateDir: "/tmp/x" });
});

test("resolveAgent defaults to the only allowed bot", () => {
  assert.equal(resolveAgent(undefined, ["Grok Bot"]), "Grok Bot");
  assert.equal(resolveAgent("  ", ["Grok Bot"]), "Grok Bot");
});

test("resolveAgent matches case-insensitively and returns the configured spelling", () => {
  assert.equal(resolveAgent("grok bot", ["Grok Bot", "Research Bot"]), "Grok Bot");
});

test("resolveAgent rejects names outside the allowlist", () => {
  assert.throws(() => resolveAgent("Grok Bto", ["Grok Bot"]), /not in GROKBOT_AGENTS/);
});

test("resolveAgent needs a name when several bots are allowed", () => {
  assert.throws(() => resolveAgent(undefined, ["A", "B"]), /name one of: A, B/);
});

test("parseListeningUrl reads the api line from bdk serve output", () => {
  const output = [
    "[bdk] GitHub auth: gh auth token",
    "grokbot-bridge-mcp listening (@cursor/bdk 0.2.25)",
    "  api  http://127.0.0.1:63203",
    "  POST http://127.0.0.1:63203/v1/session",
  ].join("\n");
  assert.equal(parseListeningUrl(output), "http://127.0.0.1:63203");
  assert.equal(parseListeningUrl("starting..."), undefined);
});
