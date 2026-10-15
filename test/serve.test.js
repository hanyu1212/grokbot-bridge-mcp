import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveEnv } from "../src/serve.js";

test("serveEnv strips GitHub tokens and shadows gh", { skip: process.platform === "win32" }, () => {
  const stubDir = join(mkdtempSync(join(tmpdir(), "gbb-")), "no-github");
  const env = serveEnv(
    { PATH: process.env.PATH, GITHUB_TOKEN: "x", GH_TOKEN: "y", GITHUB_APP_PRIVATE_KEY: "z", KEEP: "1" },
    stubDir,
  );
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_APP_PRIVATE_KEY, undefined);
  assert.equal(env.KEEP, "1");
  assert.ok(env.PATH.startsWith(stubDir));
  assert.throws(() => execFileSync("gh", ["auth", "token"], { env, stdio: "ignore" }));
});
