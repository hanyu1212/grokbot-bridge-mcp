#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GrokBotBridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { TOOLS } from "./tools.js";

// stdout carries MCP messages; everything else goes to stderr.
const log = (text) => process.stderr.write(text);

let config;
try {
  config = loadConfig();
} catch (error) {
  log(`grokbot-bridge-mcp: ${error.message}\n`);
  process.exit(1);
}

const bridge = new GrokBotBridge(config, { log });
const server = new McpServer({ name: "grokbot-bridge", version: "0.1.0" });

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    },
    async (input) => {
      try {
        const result = await tool.run(bridge, input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    },
  );
}

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
// Start bdk serve in the background so the first tool call is fast.
bridge.connect().catch((error) => log(`grokbot-bridge-mcp: ${error.message}\n`));
