#!/usr/bin/env bash
# Adds the bridge to Claude Code for the current user.
# Requires: npm install -g github:hanyu1212/grokbot-bridge-mcp
claude mcp add grokbot --scope user -e GROKBOT_AGENTS="Grok Bot" -- grokbot-bridge-mcp
