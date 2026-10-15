# Client config examples

The easiest path is `npx -y github:hanyu1212/grokbot-bridge-mcp setup`, which writes these for you. To do it by hand, first `npm install -g github:hanyu1212/grokbot-bridge-mcp`, then replace `Grok Bot` with your Bot names (comma-separated, exactly as shown in the Grok Bot app).

| Client | File |
| --- | --- |
| Cursor | [cursor-mcp.json](cursor-mcp.json) → merge into `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project) |
| Claude Code | [claude-code.sh](claude-code.sh) |
| Codex | [codex-config.toml](codex-config.toml) → merge into `~/.codex/config.toml` |
| Claude Desktop / generic stdio clients | [generic-mcp.json](generic-mcp.json) |

Running from a local checkout instead: replace `"command": "grokbot-bridge-mcp"` with `"command": "node", "args": ["/absolute/path/to/grokbot-bridge-mcp/src/server.js"]`.
