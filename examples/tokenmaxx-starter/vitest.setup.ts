import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

// Every test starts outside any workshop session. `pnpm pi` sets TMX_SESSION,
// TMX_GUEST_ROOT and friends for Pi and everything it runs, so a `pnpm check`
// (or a commit hook) run from inside a guest's Pi would otherwise hand them
// to the tests: a done check under test would then read the guest's live
// repo and sessions instead of its fixture. Tests that need one set it
// themselves. TMX_FENCE_TEST_PNPM is a knob for the fence tests, not session
// state, so it stays.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("TMX_") && key !== "TMX_FENCE_TEST_PNPM") {
    delete process.env[key];
  }
}

// And outside the guest's own Pi setup: a Pi a test starts gets an empty
// agent dir (no global extensions, packages, skills, settings, trust or
// sessions) unless the test names one.
const agentDir = mkdtempSync(join(tmpdir(), "tmx-test-pi-agent-"));
process.env["PI_CODING_AGENT_DIR"] = agentDir;
delete process.env["PI_CODING_AGENT_SESSION_DIR"];
afterAll(() => rmSync(agentDir, { recursive: true, force: true }));
