import cursorGrokBotAgents from "@cursor/bdk/extensions/cursor-grokbot-agents";

// A misspelled name would silently create an empty Grok Bot, so an explicit allowlist is required.
const agents = (process.env.GROKBOT_AGENTS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

if (agents.length === 0) {
  throw new Error('GROKBOT_AGENTS is required, e.g. GROKBOT_AGENTS="Grok Bot,Research Bot".');
}

export default cursorGrokBotAgents({ agents });
