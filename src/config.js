import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_WAIT_SECONDS = 90;
export const MAX_WAIT_SECONDS = 600;

export function parseAgents(raw) {
  return (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const agents = parseAgents(env.GROKBOT_AGENTS);
  if (agents.length === 0) {
    throw new Error(
      'GROKBOT_AGENTS is not set. List the Grok Bot names exactly as shown in the Grok Bot app, e.g. GROKBOT_AGENTS="Grok Bot".',
    );
  }
  return {
    agents,
    stateDir: env.GROKBOT_BRIDGE_STATE_DIR ?? join(homedir(), ".config", "grokbot-bridge"),
    finishInTurn: !["0", "false", "off"].includes((env.GROKBOT_FINISH_IN_TURN ?? "").trim().toLowerCase()),
  };
}

export function resolveAgent(requested, agents) {
  const name = requested?.trim();
  if (!name) {
    if (agents.length === 1) return agents[0];
    throw new Error(`Several Grok Bots are allowed; name one of: ${agents.join(", ")}.`);
  }
  const match = agents.find((agent) => agent.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`"${name}" is not in GROKBOT_AGENTS (${agents.join(", ")}).`);
  return match;
}

/** The loopback API URL `bdk serve` prints once it is listening. */
export function parseListeningUrl(output) {
  return output.match(/\bapi\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
}
