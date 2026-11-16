import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";
import { isolatedStarter } from "#shared/core/testing.ts";

import { planLaunch } from "../../scripts/lib/pi.ts";
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

// These run in a copy of the starter (`isolatedStarter`): Pi at this
// checkout's root would read the guest's AGENTS.md, and the launcher their
// live sessions.
describe("a fresh Pi against the probe (live, no model)", () => {
  let starter = "";
  let cleanup: () => Promise<void> = async () => undefined;
  beforeAll(async () => {
    ({ root: starter, cleanup } = await isolatedStarter());
  });
  afterAll(() => cleanup());

  it("sees only Pi's own tools and no skill with nothing added", async () => {
    const outcome = await probeFreshPi(starter, {
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
    const outcome = await probeFreshPi(starter, {
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

  it("runs at the guest's root when the starter is a folder inside it", async () => {
    // The guest's repo, with its own extension, skill and AGENTS.md, and the
    // starter in workshop/ (the copy, linked, with an AGENTS.md of its own:
    // the guest's edits to this checkout's never reach a test).
    const guest = join(home, "guest");
    mkdirSync(join(guest, ".pi", "extensions"), { recursive: true });
    mkdirSync(join(guest, ".pi", "skills", "guest-ritual"), {
      recursive: true,
    });
    execFileSync("git", ["init", "-q", guest], {
      env: { PATH: process.env["PATH"] },
    });
    writeFileSync(join(guest, "AGENTS.md"), "GUEST-AGENTS-MARKER\n");
    writeFileSync(
      join(guest, ".pi", "extensions", "gauge.ts"),
      `export default function (pi: any) {
  pi.registerTool({ name: "guest_gauge", label: "g", description: "g", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: {} }) });
}
`
    );
    writeFileSync(
      join(guest, ".pi", "skills", "guest-ritual", "SKILL.md"),
      "---\nname: guest-ritual\ndescription: The guest's own.\n---\n\nSay it.\n"
    );
    writeFileSync(join(starter, "AGENTS.md"), "STARTER-AGENTS-MARKER\n");
    const workshop = join(guest, "workshop");
    mkdirSync(workshop);
    for (const name of ["node_modules", "exercises", "shared"]) {
      symlinkSync(join(starter, name), join(workshop, name));
    }
    const server = await startProbeServer();
    try {
      const launch = await planLaunch(probePiArgs, workshop, cleanEnv);
      expect(launch.cwd).toBe(guest);
      // Not spawnSync: the fake endpoint answers from this process.
      await new Promise((resolveExit) => {
        const child = spawn(process.execPath, [launch.cli, ...launch.args], {
          cwd: launch.cwd,
          env: { ...launch.env, TMX_PROBE_URL: server.url },
          stdio: "ignore",
          timeout: 60_000,
        });
        child.on("exit", resolveExit);
        child.on("error", resolveExit);
      });
      const first = server.requests[0];
      expect(seenInRequest(first)).toMatchObject({
        tools: ["read", "bash", "edit", "write", "guest_gauge"],
        skills: [{ name: "guest-ritual" }],
      });
      const text = JSON.stringify(first);
      expect(text).toContain("GUEST-AGENTS-MARKER");
      expect(text).toContain("STARTER-AGENTS-MARKER");
    } finally {
      await server.close();
    }
  });

  it("asks for a fresh session with no session file", () => {
    expect(probePiArgs).toContain("--no-session");
    expect(probePiArgs).toContain("--approve");
  });
});
