#!/usr/bin/env bash
# Adds the bridge to Claude Code for the current user.
claude mcp add grokbot --scope user -e GROKBOT_AGENTS="Grok Bot" -- npx -y grokbot-bridge-mcp
