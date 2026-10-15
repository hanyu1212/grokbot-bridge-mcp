import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveAgent } from "./config.js";
import { startServe } from "./serve.js";

const CALL_TIMEOUT_GRACE_MS = 30_000;

/**
 * Talks to Grok Bot through the `call_tool` tool that `bdk serve` exposes on
 * its MCP endpoint, so every request runs the cursor-grokbot-agents extension
 * directly without a model turn.
 */
export class GrokBotBridge {
  constructor(config, { log } = {}) {
    this.config = config;
    this.log = log;
    this.ready = undefined;
  }

  connect() {
    this.ready ??= (async () => {
      this.serve = await startServe({ ...this.config, log: this.log });
      this.client = new Client({ name: "grokbot-bridge", version: "0.1.0" });
      await this.client.connect(
        new StreamableHTTPClientTransport(new URL(this.serve.mcpUrl), {
          requestInit: { headers: { authorization: `Bearer ${this.serve.token}` } },
        }),
      );
    })().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async call(toolName, input, waitSeconds = 0) {
    await this.connect();
    const response = await this.client.callTool(
      { name: "call_tool", arguments: { toolName, input } },
      undefined,
      { timeout: waitSeconds * 1000 + CALL_TIMEOUT_GRACE_MS },
    );
    const text = response.content?.find((part) => part.type === "text")?.text ?? "";
    if (response.isError) throw new Error(text || `${toolName} failed.`);
    const payload = JSON.parse(text);
    if (payload.isError) {
      const message = payload.result?.content?.find((part) => part.type === "text")?.text;
      throw new Error(message ?? payload.errorMessage ?? `${toolName} failed.`);
    }
    return payload.result;
  }

  ask({ agent, message, wait_seconds }) {
    return this.call(
      "grokbot__ask",
      { agent: resolveAgent(agent, this.config.agents), message, wait_seconds },
      wait_seconds,
    );
  }

  check({ agent, wait_seconds }) {
    return this.call("grokbot__check", { agent: resolveAgent(agent, this.config.agents), wait_seconds }, wait_seconds);
  }

  interrupt({ agent }) {
    return this.call("grokbot__interrupt", { agent: resolveAgent(agent, this.config.agents) });
  }

  list() {
    return this.call("grokbot__list", {});
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.serve?.stop();
  }
}
