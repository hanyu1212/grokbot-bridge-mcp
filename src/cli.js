#!/usr/bin/env node
import { parseArgs } from "node:util";
import { GrokBotBridge } from "./bridge.js";
import { DEFAULT_WAIT_SECONDS, loadConfig } from "./config.js";

const USAGE = `Usage:
  grokbot-bridge ask "<message>" [--agent <name>] [--wait <seconds>]
  grokbot-bridge check [--agent <name>] [--wait <seconds>]
  grokbot-bridge interrupt [--agent <name>]
  grokbot-bridge list

Environment:
  GROKBOT_AGENTS   Comma-separated Grok Bot names (required)
  CURSOR_API_KEY   Cursor API key (or run \`npx bdk login\` once)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: "string" },
    wait: { type: "string" },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...rest] = positionals;
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command || values.help ? 0 : 1);
}

const wait = values.wait === undefined ? DEFAULT_WAIT_SECONDS : Number(values.wait);
if (!Number.isInteger(wait) || wait < 0) {
  console.error("--wait must be a non-negative integer.");
  process.exit(1);
}

let bridge;
try {
  bridge = new GrokBotBridge(loadConfig(), {
    log: values.verbose ? (text) => process.stderr.write(text) : undefined,
  });
  let result;
  switch (command) {
    case "ask": {
      const message = rest.join(" ").trim();
      if (!message) throw new Error('ask needs a message: grokbot-bridge ask "..."');
      result = await bridge.ask({ agent: values.agent, message, wait_seconds: wait });
      break;
    }
    case "check":
      result = await bridge.check({ agent: values.agent, wait_seconds: wait });
      break;
    case "interrupt":
      result = await bridge.interrupt({ agent: values.agent });
      break;
    case "list":
      result = await bridge.list();
      break;
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await bridge?.close();
}
