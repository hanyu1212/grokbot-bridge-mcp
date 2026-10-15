export const SERVER_NAME = "grokbot";

const AGENTS_MD_START = "<!-- grokbot-bridge:start -->";
const AGENTS_MD_END = "<!-- grokbot-bridge:end -->";

export const ROUTING_NOTE =
  'When the user mentions Grok Bot (for example "ask Grok Bot", "have Grok Bot…", "让 Grok Bot…", "问问 Grok Bot", "交给 Grok Bot"), ' +
  "use the grokbot MCP tools (grokbot_ask, grokbot_check). Do not reach it through messaging apps or computer control.";

/** The stdio launch entry every client config points at. */
export function serverEntry(launch, agents) {
  return { command: launch.command, args: launch.args, env: { GROKBOT_AGENTS: agents.join(",") } };
}

/** Add or replace the grokbot server in a Cursor `mcp.json`. */
export function updateCursorConfig(text, entry) {
  const config = text?.trim() ? JSON.parse(text) : {};
  config.mcpServers = { ...config.mcpServers, [SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

const tomlString = (value) => JSON.stringify(value);

function isGrokbotTable(header) {
  const name = header.replace(/^\[+|\]+$/g, "").trim();
  return name === `mcp_servers.${SERVER_NAME}` || name.startsWith(`mcp_servers.${SERVER_NAME}.`);
}

/** Add or replace the grokbot server in a Codex `config.toml`, leaving everything else untouched. */
export function updateCodexConfig(text, entry) {
  const kept = [];
  let skipping = false;
  for (const line of (text ?? "").split("\n")) {
    const header = line.trim().match(/^\[\[?[^\]]+\]\]?$/)?.[0];
    if (header) skipping = isGrokbotTable(header);
    if (!skipping) kept.push(line);
  }
  const block = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    "startup_timeout_sec = 90",
    "tool_timeout_sec = 660",
    "",
    `[mcp_servers.${SERVER_NAME}.env]`,
    ...Object.entries(entry.env).map(([key, value]) => `${key} = ${tomlString(value)}`),
  ].join("\n");
  const head = kept.join("\n").trimEnd();
  return `${head ? `${head}\n\n` : ""}${block}\n`;
}

/** Add or replace the routing note in an AGENTS.md. */
export function updateAgentsMd(text) {
  const note = `${AGENTS_MD_START}\n${ROUTING_NOTE}\n${AGENTS_MD_END}`;
  const current = text ?? "";
  const start = current.indexOf(AGENTS_MD_START);
  const end = current.indexOf(AGENTS_MD_END);
  if (start !== -1 && end > start) {
    return current.slice(0, start) + note + current.slice(end + AGENTS_MD_END.length);
  }
  const head = current.trimEnd();
  return `${head ? `${head}\n\n` : ""}${note}\n`;
}
