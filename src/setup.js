import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { GrokBotBridge } from "./bridge.js";
import {
  SERVER_NAME,
  serverEntry,
  updateAgentsMd,
  updateCodexConfig,
  updateCursorConfig,
} from "./clients.js";
import { loadConfig, parseAgents } from "./config.js";
import { bdkBin } from "./serve.js";

const MIN_NODE = [22, 13];
const SERVER_JS = join(dirname(fileURLToPath(import.meta.url)), "server.js");

const USAGE = `Usage: npx grokbot-bridge-mcp setup [options]

Signs you in to Cursor if needed, then adds the grokbot MCP server to
Cursor, Codex and Claude Code. Existing config files are backed up first.

Options:
  --agents <names>   Grok Bot names, comma-separated (default: ask)
  --clients <list>   cursor,codex,claude (default: every one detected)
  -y, --yes          Accept the defaults without asking
  --skip-test        Don't send a test message at the end
  -h, --help         Show this help`;

const say = (text = "") => console.log(text);

function nodeIsRecentEnough() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/**
 * Write the launch command that keeps working after setup exits: npx when
 * setup itself ran from the npx cache, otherwise this exact install.
 */
function resolveLaunch() {
  if (/[\\/]_npx[\\/]/.test(SERVER_JS)) {
    return { command: "npx", args: ["-y", "grokbot-bridge-mcp"] };
  }
  return { command: stableNodePath(), args: [SERVER_JS] };
}

/**
 * Prefer the `node` on PATH (e.g. /opt/homebrew/bin/node) over
 * process.execPath, which can be a versioned path that breaks on upgrade.
 */
function stableNodePath() {
  const lookup = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], { encoding: "utf8" });
  const found = lookup.status === 0 ? lookup.stdout.split(/\r?\n/)[0].trim() : "";
  return found || process.execPath;
}

function bdk(args, options = {}) {
  return spawnSync(process.execPath, [bdkBin(), ...args], { encoding: "utf8", ...options });
}

function whoami() {
  const result = bdk(["whoami", "--json"]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function backup(path) {
  if (!existsSync(path)) return undefined;
  const target = `${path}.bak-grokbot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(path, target);
  return target;
}

function rewrite(path, update) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const after = update(before);
  if (after === before) return { changed: false };
  mkdirSync(dirname(path), { recursive: true });
  const saved = backup(path);
  writeFileSync(path, after);
  return { changed: true, backup: saved };
}

function reportWrite(label, path, result) {
  if (!result.changed) say(`  ${label}: already up to date (${path})`);
  else say(`  ${label}: updated ${path}${result.backup ? `\n    backup: ${result.backup}` : ""}`);
}

function detectClients() {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const claude = spawnSync("claude", ["--version"], { stdio: "ignore" });
  return {
    cursor: { found: existsSync(join(homedir(), ".cursor")), label: "Cursor" },
    codex: { found: existsSync(codexHome), label: "Codex", home: codexHome },
    claude: { found: claude.status === 0, label: "Claude Code" },
  };
}

function installCursor(entry) {
  const path = join(homedir(), ".cursor", "mcp.json");
  reportWrite("Cursor", path, rewrite(path, (text) => updateCursorConfig(text, entry)));
}

function installCodex(entry, home, addRoutingNote) {
  const path = join(home, "config.toml");
  reportWrite("Codex", path, rewrite(path, (text) => updateCodexConfig(text, entry)));
  if (addRoutingNote) {
    const notes = join(home, "AGENTS.md");
    reportWrite("Codex AGENTS.md", notes, rewrite(notes, updateAgentsMd));
  }
}

function installClaude(entry) {
  spawnSync("claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"], { stdio: "ignore" });
  const env = Object.entries(entry.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const result = spawnSync(
    "claude",
    ["mcp", "add", SERVER_NAME, "--scope", "user", ...env, "--", entry.command, ...entry.args],
    { encoding: "utf8" },
  );
  if (result.status === 0) say("  Claude Code: added (user scope)");
  else say(`  Claude Code: failed to add\n${result.stderr || result.stdout}`);
}

async function sendTestMessage(agents) {
  const bridge = new GrokBotBridge(loadConfig({ ...process.env, GROKBOT_AGENTS: agents.join(",") }));
  try {
    const result = await bridge.ask({
      agent: agents[0],
      message: "Setup test from grokbot-bridge-mcp. Reply with one short line confirming you received this. Do nothing else.",
      wait_seconds: 120,
    });
    if (result.created) {
      say(`\n  Warning: no Bot named "${agents[0]}" existed, so an empty one was just created.`);
      say("  Check the exact name in the Grok Bot app, delete the empty Bot, and run setup again.");
      return false;
    }
    if (result.reply) say(`\n  ${agents[0]} replied: ${result.reply.slice(0, 500)}`);
    else say(`\n  Message delivered; ${agents[0]} is still working (status: ${result.status}).`);
    return true;
  } catch (error) {
    say(`\n  Test message failed: ${error.message}`);
    return false;
  } finally {
    await bridge.close();
  }
}

/**
 * readline's question() drops lines that arrive before it is called (piped
 * input), so queue every line and hand them out in order. EOF yields undefined.
 */
function lineReader() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()(undefined);
  });
  return {
    question(prompt) {
      process.stdout.write(prompt);
      if (lines.length) return Promise.resolve(lines.shift());
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
  };
}

export async function runSetup(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      agents: { type: "string" },
      clients: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      "skip-test": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    say(USAGE);
    return 0;
  }

  const rl = values.yes ? undefined : lineReader();
  const ask = async (question, fallback) => {
    if (!rl) return fallback;
    const answer = (await rl.question(`${question} `))?.trim();
    return answer || fallback;
  };
  const confirm = async (question, fallback = true) => {
    const answer = await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`, fallback ? "y" : "n");
    return /^y(es)?$/i.test(answer);
  };

  try {
    say("grokbot-bridge-mcp setup\n");

    if (!nodeIsRecentEnough()) {
      say(`Node ${MIN_NODE.join(".")} or newer is required (you have ${process.versions.node}).`);
      return 1;
    }

    let account = whoami();
    if (!account) {
      say("You are not signed in to Cursor.");
      if (values.yes || !(await confirm("Sign in now? A browser window will open."))) {
        say("Run `npx @cursor/bdk login` or set CURSOR_API_KEY, then run setup again.");
        return 1;
      }
      bdk(["login"], { stdio: "inherit" });
      account = whoami();
      if (!account) {
        say("Still not signed in. Run `npx @cursor/bdk login`, then run setup again.");
        return 1;
      }
    }
    say(`Signed in to Cursor as ${account.email ?? "your account"}.\n`);

    say("Bot names must match the Grok Bot app exactly; a wrong name creates a new empty Bot.");
    const agents = parseAgents(values.agents ?? (await ask("Grok Bot name(s), comma-separated [Grok Bot]:", "Grok Bot")));
    if (agents.length === 0) {
      say("No Bot name given.");
      return 1;
    }

    const clients = detectClients();
    const requested = values.clients ? new Set(parseAgents(values.clients).map((c) => c.toLowerCase())) : undefined;
    const entry = serverEntry(resolveLaunch(), agents);
    say(`\nLaunch command: ${[entry.command, ...entry.args].join(" ")}\n`);

    let configured = 0;
    for (const [id, client] of Object.entries(clients)) {
      if (requested ? !requested.has(id) : !client.found) continue;
      if (!requested && !(await confirm(`Add grokbot to ${client.label}?`))) continue;
      if (id === "cursor") installCursor(entry);
      if (id === "codex") {
        const note = await confirm(
          "  Also add a line to Codex's AGENTS.md so it routes \"ask Grok Bot\" to these tools?",
        );
        installCodex(entry, client.home, note);
      }
      if (id === "claude") installClaude(entry);
      configured += 1;
    }
    if (configured === 0) {
      say("No client configured. Copy a config from examples/ in the repository instead.");
    }

    if (!values["skip-test"] && (await confirm(`\nSend a short test message to "${agents[0]}" now?`))) {
      await sendTestMessage(agents);
    }

    say("\nDone. Restart (or reload MCP in) each client, then say “ask Grok Bot to …”.");
    return 0;
  } finally {
    rl?.close();
  }
}
