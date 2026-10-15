import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveAgent } from "./config.js";
import { startServe } from "./serve.js";

const CALL_TIMEOUT_GRACE_MS = 30_000;
const NO_REPLY_RECHECK_MS = 5_000;

// Grok Bot is not woken up again after its turn ends, so a reply promised for
// "later" never arrives.
export const FINISH_IN_TURN_NOTE =
  "Finish this within the current turn and send the complete result before ending. " +
  "Do not reply with only an acknowledgement.";

export function withFinishNote(message) {
  return `${message.trimEnd()}\n\n${FINISH_IN_TURN_NOTE}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const text = this.config.finishInTurn ? withFinishNote(message) : message;
    return this.call(
      "grokbot__ask",
      { agent: resolveAgent(agent, this.config.agents), message: text, wait_seconds },
      wait_seconds,
    );
  }

  /**
   * Grok Bot often acknowledges, ends its turn, and posts the result later from
   * background work, so keep checking until a reply arrives or time runs out.
   */
  async check({ agent, wait_seconds }) {
    const name = resolveAgent(agent, this.config.agents);
    const deadline = Date.now() + wait_seconds * 1000;
    while (true) {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const result = await this.call("grokbot__check", { agent: name, wait_seconds: remaining }, remaining);
      if (result.reply !== undefined || result.status === "running" || Date.now() >= deadline) return result;
      await sleep(NO_REPLY_RECHECK_MS);
    }
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
