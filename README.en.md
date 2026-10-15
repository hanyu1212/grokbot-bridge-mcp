# grokbot-bridge-mcp

[中文](README.md)

> **Unofficial.** Not affiliated with Cursor, Anysphere, or xAI. It relies on the Grok Bot extension in `@cursor/bdk`, and the API behind it may change at any time.

Let Cursor, Claude Code, Codex, or any MCP client hand work to your **Grok Bot**, check on it, and stop it.

Keep local work in your editor. Send remote, long-running, logged-in-browser, or scheduled work to Grok Bot's cloud computer with one sentence, without switching apps.

## Quick start

Needs Node.js 22.13+ and a Cursor account with Grok Bot access.

```bash
npx -y github:hanyu1212/grokbot-bridge-mcp setup
```

It will:

1. Sign you in to Cursor if needed (opens a browser)
2. Ask for your Bot name (default `Grok Bot`)
3. Install a copy under `~/.config/grokbot-bridge/app`, so clients start it in a second or two
4. Offer to configure each of Cursor, Codex and Claude Code it finds (backing up config files first)
5. Send a test message to confirm it works

Then restart your client and say "ask Grok Bot to …". Run the same command again to update.

## Tools

| Tool | What it does |
| --- | --- |
| `grokbot_ask` | Send a message and wait for the reply. `wait_seconds: 0` returns right after sending |
| `grokbot_check` | Read replies that arrived since the last ask/check (use when `ask` returned `status: "running"`) |
| `grokbot_interrupt` | Stop the Bot's current turn; its conversation and memory stay |
| `grokbot_list` | List allowed and already-contacted Bots. Sends nothing |

Replies come back verbatim; no extra model sits in between.

## Manual install

Skipping `setup`:

```bash
npx @cursor/bdk login                                  # or set CURSOR_API_KEY
npm install -g github:hanyu1212/grokbot-bridge-mcp     # provides the grokbot-bridge-mcp command
```

Then add a config for your client. Set `GROKBOT_AGENTS` to your Bot names **exactly** as shown in the Grok Bot app, comma-separated. Names outside the list are rejected; a misspelled name inside the list creates an empty Bot on first contact, and the result says `created: true`.

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "grokbot": {
      "command": "grokbot-bridge-mcp",
      "env": { "GROKBOT_AGENTS": "Grok Bot" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add grokbot --scope user -e GROKBOT_AGENTS="Grok Bot" -- grokbot-bridge-mcp
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.grokbot]
command = "grokbot-bridge-mcp"
startup_timeout_sec = 90
tool_timeout_sec = 660

[mcp_servers.grokbot.env]
GROKBOT_AGENTS = "Grok Bot"
```

- `tool_timeout_sec` must exceed the 600-second `wait_seconds` cap, or Codex cuts long asks short.
- `grokbot_ask` and `grokbot_interrupt` message your Bot, so Codex asks before each call. `grokbot_list` and `grokbot_check` are marked read-only. To skip the prompts, add `default_tools_approval_mode = "approve"`.
- Codex makes the model search for MCP tools, so with many skills installed "ask Grok Bot" can get routed elsewhere. A line in `~/.codex/AGENTS.md` saying to use the grokbot tools whenever Grok Bot is mentioned fixes that; `setup` offers to add it.
- The Codex desktop app ships its CLI at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` if you prefer `codex mcp add`; add the two timeouts by hand afterwards.

Don't launch it with `npx -y github:...` in a client config: that re-fetches from GitHub on every start (30+ seconds), and Codex gives up waiting. See [examples/](examples/) for more.

No skill is required: the server's MCP instructions and tool descriptions already tell the agent when to delegate and how to write messages, and every message gets a "finish within this turn" note appended (set `GROKBOT_FINISH_IN_TURN=0` to turn it off). The optional [skill](skill/SKILL.md) is a longer version you can tailor to how you split work.

## CLI

The global install also provides a CLI:

```bash
export GROKBOT_AGENTS="Grok Bot"
grokbot-bridge ask "Summarize today's AI news in 5 bullets" --wait 120
grokbot-bridge check
grokbot-bridge list
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
- No GitHub credentials: BDK looks for them at startup (env vars, then `gh auth token`) for its GitHub features. This bridge doesn't need them, so it strips those env vars and shadows `gh` before starting BDK.

## License

[MIT](LICENSE)
