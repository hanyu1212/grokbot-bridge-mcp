import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { GrokBotBridge } from "../src/bridge.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeServeFactory({ onCall } = {}) {
  const instances = [];
  const startServe = async (options) => {
    const child = new EventEmitter();
    const instance = {
      id: instances.length + 1,
      options,
      mcpUrl: `http://127.0.0.1:${40000 + instances.length}/v1/mcp`,
      token: `tok_${instances.length + 1}`,
      child,
      stopped: 0,
      stop: async () => {
        instance.stopped += 1;
        child.emit("exit", 0, null);
      },
      onCall,
    };
    instances.push(instance);
    return instance;
  };
  return { instances, startServe };
}

function fakeClientFactory({ failFirst = 0, onCallTool } = {}) {
  let attempts = 0;
  const clients = [];
  const connectClient = async (serve) => {
    attempts += 1;
    if (attempts <= failFirst) {
      throw new Error(`connect failed #${attempts}`);
    }
    const client = {
      serve,
      closed: 0,
      close: async () => {
        client.closed += 1;
      },
      callTool: async (req, _schema, opts) => {
        if (onCallTool) return onCallTool(req, opts, serve);
        return {
          content: [{ type: "text", text: JSON.stringify({ result: { configured: ["Grok Bot"], contacts: [] } }) }],
        };
      },
    };
    clients.push(client);
    return client;
  };
  return { clients, connectClient };
}

test("does not start serve until the first tool call", async () => {
  const { instances, startServe } = fakeServeFactory();
  const { connectClient } = fakeClientFactory();
  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    { startServe, connectClient, idleTimeoutMs: 0 },
  );

  assert.equal(instances.length, 0);
  const res = await bridge.list();
  assert.equal(instances.length, 1);
  assert.deepEqual(res.configured, ["Grok Bot"]);
  await bridge.close();
  assert.equal(instances[0].stopped, 1);
});

test("stops the spawned serve process when MCP client connection fails", async () => {
  const { instances, startServe } = fakeServeFactory();
  const { connectClient } = fakeClientFactory({ failFirst: 1 });
  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    { startServe, connectClient, idleTimeoutMs: 0 },
  );

  await assert.rejects(() => bridge.list(), /connect failed #1/);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].stopped, 1);

  // Next retry starts a fresh serve and succeeds.
  const res = await bridge.list();
  assert.equal(instances.length, 2);
  assert.equal(instances[1].stopped, 0);
  assert.deepEqual(res.configured, ["Grok Bot"]);
  await bridge.close();
  assert.equal(instances[1].stopped, 1);
});

test("shares a single startup across concurrent tool calls", async () => {
  const { instances, startServe } = fakeServeFactory();
  const { connectClient } = fakeClientFactory();
  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    {
      startServe: async (opts) => {
        await sleep(30);
        return startServe(opts);
      },
      connectClient,
      idleTimeoutMs: 0,
    },
  );

  const [a, b, c] = await Promise.all([bridge.list(), bridge.list(), bridge.list()]);
  assert.equal(instances.length, 1);
  assert.deepEqual(a.configured, ["Grok Bot"]);
  assert.deepEqual(b.configured, ["Grok Bot"]);
  assert.deepEqual(c.configured, ["Grok Bot"]);
  await bridge.close();
});

test("reclaims serve after idle timeout and transparently restarts on a later check", async () => {
  // Persisted contact state shared across serve restarts (simulating stateDir/serve/kv).
  const persistedContacts = new Map();
  const { instances, startServe } = fakeServeFactory();
  const { connectClient } = fakeClientFactory({
    onCallTool: async (req, _opts, serve) => {
      const { toolName, input } = req.arguments;
      if (toolName === "grokbot__ask") {
        persistedContacts.set(input.agent, { sessionId: "ses_42", cursor: "101" });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                result: { agent: input.agent, sessionId: "ses_42", status: "running", serveId: serve.id },
              }),
            },
          ],
        };
      }
      if (toolName === "grokbot__check") {
        const saved = persistedContacts.get(input.agent);
        assert.ok(saved, "expected contact state from earlier ask");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                result: {
                  agent: input.agent,
                  sessionId: saved.sessionId,
                  cursor: saved.cursor,
                  status: "finished",
                  reply: "done from background",
                  serveId: serve.id,
                },
              }),
            },
          ],
        };
      }
      throw new Error(`unexpected tool ${toolName}`);
    },
  });

  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    { startServe, connectClient, idleTimeoutMs: 60 },
  );

  const askRes = await bridge.ask({ message: "run long job", wait_seconds: 0 });
  assert.equal(askRes.status, "running");
  assert.equal(askRes.serveId, 1);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].stopped, 0);

  // Wait for idle reaper to stop the first serve.
  await sleep(120);
  assert.equal(instances[0].stopped, 1);

  // Later check transparently starts a second serve and resumes the task.
  const checkRes = await bridge.check({ wait_seconds: 5 });
  assert.equal(instances.length, 2);
  assert.equal(checkRes.serveId, 2);
  assert.equal(checkRes.sessionId, "ses_42");
  assert.equal(checkRes.reply, "done from background");

  await bridge.close();
  assert.equal(instances[1].stopped, 1);
});

test("does not idle-reclaim while check is waiting between polls", async () => {
  let polls = 0;
  const { instances, startServe } = fakeServeFactory();
  const { connectClient } = fakeClientFactory({
    onCallTool: async () => {
      polls += 1;
      const result =
        polls < 3
          ? { agent: "Grok Bot", sessionId: "ses_1", status: "finished" }
          : { agent: "Grok Bot", sessionId: "ses_1", status: "finished", reply: "arrived" };
      return { content: [{ type: "text", text: JSON.stringify({ result }) }] };
    },
  });

  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    { startServe, connectClient, idleTimeoutMs: 30, recheckIntervalMs: 50 },
  );

  const result = await bridge.check({ wait_seconds: 5 });
  assert.equal(result.reply, "arrived");
  assert.equal(instances.length, 1);
  assert.equal(instances[0].stopped, 0);

  await bridge.close();
  assert.equal(instances[0].stopped, 1);
});

test("ask keeps the reply and trims a large unread backlog", async () => {
  const { startServe } = fakeServeFactory();
  const backlog = Array.from({ length: 80 }, (_, i) => `routine ${i} `.repeat(200));
  const { connectClient } = fakeClientFactory({
    onCallTool: async () => {
      const result = { agent: "Grok Bot", status: "finished", reply: "PONG", earlierReplies: backlog };
      return { content: [{ type: "text", text: JSON.stringify({ result }) }] };
    },
  });
  const bridge = new GrokBotBridge(
    { agents: ["Grok Bot"], stateDir: "/tmp/gbb", finishInTurn: true },
    { startServe, connectClient, idleTimeoutMs: 0 },
  );

  const result = await bridge.ask({ message: "ping", wait_seconds: 1 });
  assert.equal(result.reply, "PONG");
  assert.equal(result.earlierReplies.length, 3);
  assert.ok(result.earlierReplies[2].startsWith("routine 79 "));
  assert.ok(result.earlierReplies.every((reply) => reply.length < 700));
  assert.equal(result.earlierRepliesOmitted, 77);
  assert.ok(JSON.stringify(result).length < 4000);

  await bridge.close();
});
