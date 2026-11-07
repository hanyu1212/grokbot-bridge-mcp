import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GrokBotBridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { SERVER_INSTRUCTIONS, TOOLS } from "./tools.js";

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
const server = new McpServer(
  { name: "grokbot-bridge", version: "0.1.0" },
  { instructions: SERVER_INSTRUCTIONS },
);

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

let shuttingDown;
const shutdown = () => {
  shuttingDown ??= (async () => {
    await bridge.close();
    process.exit(0);
  })();
  return shuttingDown;
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

// `bdk serve` is started lazily on the first tool call and stopped after idle.
await server.connect(new StdioServerTransport());
