import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveAgent } from "./config.js";
import { startServe } from "./serve.js";

const CALL_TIMEOUT_GRACE_MS = 30_000;
const NO_REPLY_RECHECK_MS = 5_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

// Grok Bot is not woken up again after its turn ends, so a reply promised for
// "later" never arrives.
export const FINISH_IN_TURN_NOTE =
  "Finish this within the current turn and send the complete result before ending. " +
  "Do not reply with only an acknowledgement.";

export function withFinishNote(message) {
  return `${message.trimEnd()}\n\n${FINISH_IN_TURN_NOTE}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function defaultConnectClient(serve) {
  const client = new Client({ name: "grokbot-bridge", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(serve.mcpUrl), {
        requestInit: { headers: { authorization: `Bearer ${serve.token}` } },
      }),
    );
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

function resolveIdleTimeoutMs(explicit, configValue, envValue = process.env.GROKBOT_IDLE_TIMEOUT_MS) {
  if (explicit !== undefined) return explicit;
  if (configValue !== undefined) return configValue;
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

/**
 * Talks to Grok Bot through the `call_tool` tool that `bdk serve` exposes on
 * its MCP endpoint, so every request runs the cursor-grokbot-agents extension
 * directly without a model turn.
 */
export class GrokBotBridge {
  constructor(
    config,
    {
      log,
      idleTimeoutMs,
      recheckIntervalMs = NO_REPLY_RECHECK_MS,
      startServe: startServeImpl = startServe,
      connectClient = defaultConnectClient,
    } = {},
  ) {
    this.config = config;
    this.log = log;
    this.idleTimeoutMs = resolveIdleTimeoutMs(idleTimeoutMs, config?.idleTimeoutMs);
    this.recheckIntervalMs = recheckIntervalMs;
    this.startServe = startServeImpl;
    this.connectClient = connectClient;
    this.ready = undefined;
    this.serve = undefined;
    this.client = undefined;
    this.closing = undefined;
    this.activeCalls = 0;
    this.idleTimer = undefined;
    this.connectEpoch = 0;
  }

  #clearIdleTimer() {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  #scheduleIdleTimer() {
    this.#clearIdleTimer();
    if (!(this.idleTimeoutMs > 0) || !Number.isFinite(this.idleTimeoutMs)) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.activeCalls === 0) {
        this.close().catch((error) => this.log?.(`grokbot-bridge-mcp: ${error.message}\n`));
      }
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  connect() {
    this.#clearIdleTimer();
    if (this.ready) return this.ready;

    const epoch = ++this.connectEpoch;
    const attempt = (async () => {
      if (this.closing) await this.closing;
      if (this.connectEpoch !== epoch) {
        throw new Error("Bridge closed before starting.");
      }
      const serve = await this.startServe({ ...this.config, log: this.log });
      let client;
      try {
        if (this.connectEpoch !== epoch) {
          throw new Error("Bridge closed while starting.");
        }
        client = await this.connectClient(serve);
        if (this.connectEpoch !== epoch) {
          throw new Error("Bridge closed while connecting.");
        }
      } catch (error) {
        await client?.close?.().catch(() => {});
        await serve.stop();
        throw error;
      }
      this.serve = serve;
      this.client = client;
      serve.child?.once?.("exit", () => {
        if (this.serve === serve) {
          this.ready = undefined;
          this.serve = undefined;
          this.client = undefined;
          this.#clearIdleTimer();
        }
      });
      if (this.activeCalls === 0) {
        this.#scheduleIdleTimer();
      }
    })();

    const tracked = attempt.catch((error) => {
      if (this.ready === tracked) this.ready = undefined;
      throw error;
    });
    this.ready = tracked;
    return this.ready;
  }

  async #withActiveCall(fn) {
    this.activeCalls += 1;
    this.#clearIdleTimer();
    try {
      return await fn();
    } finally {
      this.activeCalls -= 1;
      if (this.activeCalls === 0 && this.ready) {
        this.#scheduleIdleTimer();
      }
    }
  }

  call(toolName, input, waitSeconds = 0) {
    return this.#withActiveCall(async () => {
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
    });
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
  check({ agent, wait_seconds }) {
    return this.#withActiveCall(async () => {
      const name = resolveAgent(agent, this.config.agents);
      const deadline = Date.now() + wait_seconds * 1000;
      while (true) {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        const result = await this.call("grokbot__check", { agent: name, wait_seconds: remaining }, remaining);
        if (result.reply !== undefined || result.status === "running" || Date.now() >= deadline) return result;
        await sleep(this.recheckIntervalMs);
      }
    });
  }

  interrupt({ agent }) {
    return this.call("grokbot__interrupt", { agent: resolveAgent(agent, this.config.agents) });
  }

  list() {
    return this.call("grokbot__list", {});
  }

  close() {
    this.#clearIdleTimer();
    this.connectEpoch += 1;
    const pendingConnect = this.ready;
    this.ready = undefined;
    const prevClosing = this.closing;
    const currentClosing = (async () => {
      await prevClosing?.catch(() => {});
      await pendingConnect?.catch(() => {});
      const client = this.client;
      const serve = this.serve;
      this.client = undefined;
      this.serve = undefined;
      await client?.close?.().catch(() => {});
      await serve?.stop();
    })();
    this.closing = currentClosing.finally(() => {
      if (this.closing === currentClosing) this.closing = undefined;
    });
    return this.closing;
  }
}
