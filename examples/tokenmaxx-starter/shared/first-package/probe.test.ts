import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";

import { catchUpArchive, unpackCatchUp } from "./catch-up.ts";
import {
  addedTools,
  probeFreshPi,
  probePiArgs,
  seenInRequest,
  skillsInPrompt,
  startProbeServer,
} from "./probe.ts";

const repoRoot = findRepoRoot();
const home = realpathSync(mkdtempSync(join(tmpdir(), "tmx-probe-home-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A Pi with nothing of its own: empty HOME and agent dir, no network. */
const cleanEnv: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"],
  HOME: home,
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
  PI_OFFLINE: "1",
  RATKING_NAME: "off",
};

const prompt = `You are a coding agent.

<available_skills>
  <skill>
    <name>wombat-ritual</name>
    <description>Prove it &amp; say so.</description>
    <location>/repo/skills/wombat-ritual/SKILL.md</location>
  </skill>
  <skill>
    <name>other</name>
    <description>x</description>
    <location>/elsewhere/.pi/agent/skills/other/SKILL.md</location>
  </skill>
</available_skills>`;

describe("reading what a fresh Pi sent", () => {
  it("finds every skill in the system prompt", () => {
    expect(skillsInPrompt(prompt)).toEqual([
      {
        name: "wombat-ritual",
        location: "/repo/skills/wombat-ritual/SKILL.md",
      },
      { name: "other", location: "/elsewhere/.pi/agent/skills/other/SKILL.md" },
    ]);
    expect(skillsInPrompt("no skills here")).toEqual([]);
  });

  it("reads tools and skills from a chat-completions body", () => {
    const seen = seenInRequest({
      messages: [
        { role: "system", content: [{ type: "text", text: prompt }] },
        { role: "user", content: "hi" },
      ],
      tools: [
        { type: "function", function: { name: "read" } },
        { type: "function", function: { name: "wombat_gauge" } },
      ],
    });
    expect(seen.tools).toEqual(["read", "wombat_gauge"]);
    expect(addedTools(seen)).toEqual(["wombat_gauge"]);
    expect(seen.skills.map((s) => s.name)).toEqual(["wombat-ritual", "other"]);
    expect(seenInRequest("nonsense")).toEqual({ tools: [], skills: [] });
  });

  it("serves a fake endpoint that records the request and answers", async () => {
    const server = await startProbeServer();
    try {
      const res = await fetch(`${server.url}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ stream: true, tools: [] }),
      });
      expect(await res.text()).toContain("data: [DONE]");
      expect(server.requests).toEqual([{ stream: true, tools: [] }]);
    } finally {
      await server.close();
    }
  });
});

// These run in the guest's own repo, so they ignore its project resources
// (`--no-approve`): a guest's package must never turn `pnpm check` red.
const ignoreProject = (args: readonly string[]) =>
  args.map((arg) => (arg === "--approve" ? "--no-approve" : arg));

describe("a fresh Pi against the probe (live, no model)", () => {
  it("sees only Pi's own tools and no skill with nothing added", async () => {
    const outcome = await probeFreshPi(repoRoot, {
      env: cleanEnv,
      mapArgs: ignoreProject,
    });
    expect(outcome).toEqual({
      ok: true,
      seen: { tools: ["read", "bash", "edit", "write"], skills: [] },
    });
  });

  it("sees a tool and a skill a package adds", async () => {
    const pkg = join(home, "catch-up");
    await unpackCatchUp(catchUpArchive(repoRoot), pkg);
    const outcome = await probeFreshPi(repoRoot, {
      env: cleanEnv,
      mapArgs: (args) => [
        "-e",
        join(pkg, "extensions", "wombat-gauge.ts"),
        "--skill",
        join(pkg, "skills"),
        ...ignoreProject(args),
      ],
    });
    expect(outcome).toMatchObject({
      ok: true,
      seen: {
        tools: ["read", "bash", "edit", "write", "wombat_gauge"],
        skills: [{ name: "wombat-ritual" }],
      },
    });
  });

  it("asks for a fresh session with no session file", () => {
    expect(probePiArgs).toContain("--no-session");
    expect(probePiArgs).toContain("--approve");
  });
});
