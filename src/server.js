#!/usr/bin/env node
if (process.argv[2] === "setup") {
  const { runSetup } = await import("./setup.js");
  process.exitCode = await runSetup(process.argv.slice(3));
} else {
  await import("./mcp-server.js");
}
