import { defineAgent } from "@cursor/bdk";

// The bridge only calls the mounted Grok Bot tools directly; no model turn runs here.
export default defineAgent({
  tools: [],
  local: { sandbox: false },
});
