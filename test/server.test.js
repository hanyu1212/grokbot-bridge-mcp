import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("server exits with a clear error when GROKBOT_AGENTS is missing", async () => {
  const { spawnSync } = await import("node:child_process");
  const env = { ...process.env };
  delete env.GROKBOT_AGENTS;
  const result = spawnSync(process.execPath, [SERVER], { env, encoding: "utf8", input: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GROKBOT_AGENTS is not set/);
});

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
