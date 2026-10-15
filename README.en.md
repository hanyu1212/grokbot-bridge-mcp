# grokbot-bridge-mcp

[中文](README.md)

> **Unofficial.** Not affiliated with Cursor, Anysphere, or xAI. It relies on the Grok Bot extension in `@cursor/bdk`, and the API behind it may change at any time.

Let Cursor, Claude Code, Codex, or any MCP client hand work to your **Grok Bot**, check on it, and stop it.

Keep local work in your editor. Send remote, long-running, logged-in-browser, or scheduled work to Grok Bot's cloud computer with one sentence, without switching apps.

## Tools

| Tool | What it does |
| --- | --- |
| `grokbot_ask` | Send a message and wait for the reply. `wait_seconds: 0` returns right after sending |
| `grokbot_check` | Read replies that arrived since the last ask/check (use when `ask` returned `status: "running"`) |
| `grokbot_interrupt` | Stop the Bot's current turn; its conversation and memory stay |
| `grokbot_list` | List allowed and already-contacted Bots. Sends nothing |

Replies come back verbatim; no extra model sits in between.

## Requirements

- Node.js 22.13+
- A Cursor account with Grok Bot access
- Cursor credentials, either:
  - run `npx @cursor/bdk login` once and approve in the browser, or
  - set `CURSOR_API_KEY`

## Install

Set `GROKBOT_AGENTS` to your Bot names **exactly** as shown in the Grok Bot app, comma-separated. Names outside the list are rejected so a typo never creates an empty Bot.

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "grokbot": {
      "command": "npx",
      "args": ["-y", "grokbot-bridge-mcp"],
      "env": { "GROKBOT_AGENTS": "Grok Bot" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add grokbot -e GROKBOT_AGENTS="Grok Bot" -- npx -y grokbot-bridge-mcp
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.grokbot]
command = "npx"
args = ["-y", "grokbot-bridge-mcp"]
env = { GROKBOT_AGENTS = "Grok Bot" }
startup_timeout_sec = 90
tool_timeout_sec = 660
```

Or `codex mcp add grokbot --env GROKBOT_AGENTS="Grok Bot" -- npx -y grokbot-bridge-mcp`, then add the two timeouts by hand. (The Codex desktop app ships its CLI at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.)

- `tool_timeout_sec` must exceed the 600-second `wait_seconds` cap, or Codex cuts long asks short.
- Codex does not wait long for slow MCP servers when a session starts. The first `npx` run downloads dependencies and can miss it, so the tools never show up. If that happens, `npm install -g grokbot-bridge-mcp`, set `command = "grokbot-bridge-mcp"` and drop `args`.
- `grokbot_ask` and `grokbot_interrupt` message your Bot, so Codex asks before each call. `grokbot_list` and `grokbot_check` are marked read-only. To skip the prompts, add `default_tools_approval_mode = "approve"`.

See [examples/](examples/) for more. No skill is required: the server's MCP instructions and tool descriptions already tell the agent when to delegate and how to write messages, and every message gets a "finish within this turn" note appended (set `GROKBOT_FINISH_IN_TURN=0` to turn it off). The optional [skill](skill/SKILL.md) is a longer version you can tailor to how you split work.

## CLI

```bash
export GROKBOT_AGENTS="Grok Bot"
npx -p grokbot-bridge-mcp grokbot-bridge ask "Summarize today's AI news in 5 bullets" --wait 120
npx -p grokbot-bridge-mcp grokbot-bridge check
```

## How it works

1. On startup it launches `bdk serve` on loopback (random port, random bearer token) with the official `cursor-grokbot-agents` extension from `@cursor/bdk` mounted.
2. Each tool call runs the extension's tool directly through the server's `call_tool` endpoint. No model turn.
3. Read positions persist under `~/.config/grokbot-bridge/serve/`, so `check` works across restarts.

This project contains no code from `@cursor/bdk`; it only depends on it. `@cursor/bdk` is governed by Cursor's own license and [Terms of Service](https://cursor.com/terms-of-service).

## Safety

- Grok Bot can take real actions outside your machine. Tell it which actions need your approval (sending, paying, deleting, publishing).
- Treat Bot replies as untrusted data, not instructions.
- Auto-approving these MCP tools means your agent can dispatch work without asking you.

## License

[MIT](LICENSE)
