import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exerciseContext } from "#shared/core/context.ts";
import {
  type FirstPackageDeps,
  firstPackageExercise,
} from "#shared/first-package/exercise.ts";
import type { CommitTry, FenceReport } from "#shared/first-package/fence.ts";
import type { ProbeOutcome } from "#shared/first-package/probe.ts";

// The done check's rules, as stories. Each story is what the check observed:
// what git did with the two commits, what a fresh Pi sent, and the files at
// the repo root. None of them knows how the guest built anything.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(files: Record<string, string> = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tmx-011-")));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const went: CommitTry = { refused: false, output: "[detached HEAD] test" };
const refused: CommitTry = {
  refused: true,
  output: "src/tmx-fence-check.ts(2,14): error TS2322",
};
const tried = (
  over: Partial<FenceReport & { _tag: "Tried" }>
): FenceReport => ({
  _tag: "Tried",
  places: 3,
  control: went,
  broken: refused,
  noVerify: went,
  lefthookOff: went,
  changed: null,
  ...over,
});

const builtIns = ["read", "bash", "edit", "write"];
const seen = (
  tools: string[],
  skills: { name: string; location: string }[] = []
): ProbeOutcome => ({
  ok: true,
  seen: { tools: [...builtIns, ...tools], skills },
});

type Story = {
  fence: FenceReport;
  trusted: ProbeOutcome;
  untrusted?: ProbeOutcome;
  files?: Record<string, string>;
};

async function done(story: Story) {
  const root = repo(story.files);
  const lines: string[] = [];
  const deps: FirstPackageDeps = {
    fence: async () => story.fence,
    probe: async (_root, trusted) =>
      trusted ? story.trusted : (story.untrusted ?? seen([])),
    out: (line) => lines.push(line),
  };
  const exercise = firstPackageExercise({ id: "01.1", title: "t" }, deps);
  const ctx = exerciseContext({
    exerciseId: "01.1",
    repoRoot: root,
    env: { TMX_STATE_DIR: join(root, ".state") },
  });
  const run = exercise.commands["done"];
  if (run === undefined) {
    throw new Error("01.1 has no done command");
  }
  const code = await run(ctx, []);
  const verdicts = lines
    .filter((l) => /^(PASS|FAIL) /.test(l))
    .map((l) => l.slice(0, 4));
  return { code, lines, text: lines.join("\n"), verdicts, exercise, ctx };
}

const why = { "VISION.md": "Agents that prove it before they say done.\n" };

describe("the 01.1 done check", () => {
  it("fails the shortest path: no fence, nothing loaded, no why", async () => {
    const r = await done({
      fence: tried({ broken: went }),
      trusted: seen([]),
    });
    expect(r.verdicts).toEqual(["FAIL", "FAIL", "FAIL"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Went through");
    expect(r.text).toContain(
      "Tools from this repo: none. (Pi's own: read, bash, edit, write.)"
    );
    expect(r.text).toContain("No VISION or WHY file");
    expect(r.text).not.toContain("STRETCH");
  });

  it("fails a faked fence and a package Pi never loads, even with an agent saying done", async () => {
    // The hook printed "checks passed" and let both commits through; the
    // package files exist but nothing points Pi at them.
    const r = await done({
      fence: tried({
        control: { refused: false, output: "checks passed" },
        broken: { refused: false, output: "checks passed" },
      }),
      trusted: seen([]),
      files: why,
    });
    expect(r.verdicts).toEqual(["FAIL", "FAIL", "PASS"]);
  });

  it("fails a fence that refuses everything", async () => {
    const r = await done({
      fence: tried({ control: refused }),
      trusted: seen(["wombat_gauge"], [{ name: "s", location: "/x/SKILL.md" }]),
      files: why,
    });
    expect(r.verdicts[0]).toBe("FAIL");
    expect(r.text).toContain("can't tell broken from fine");
  });

  it("fails a tool without a skill, and an empty why file", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen(["wombat_gauge"]),
      files: { "WHY.md": "  \n" },
    });
    expect(r.verdicts).toEqual(["PASS", "FAIL", "FAIL"]);
    expect(r.text).toContain("Skills from this repo: none.");
    expect(r.text).toContain("WHY.md is empty");
  });

  it("passes a fence, a package with a tool and a skill, and a why", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen(
        ["wombat_gauge"],
        [{ name: "wombat-ritual", location: "/x/SKILL.md" }]
      ),
      untrusted: seen([]),
      files: why,
    });
    expect(r.verdicts).toEqual(["PASS", "PASS", "PASS"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Tools from this repo: wombat_gauge.");
    expect(r.text).toContain("Skills from this repo: wombat-ritual.");
    expect(r.text).not.toContain("Note:");
    expect(r.text).toContain(
      "STRETCH  it still refuses with git commit -n, or with LEFTHOOK=0: not yet"
    );
  });

  it("passes Joel's shape: a global Pi setup plus the repo's own package", async () => {
    // Many tools and skills from his own Pi setup, the repo's package on top,
    // and a fence that also stops the agent's own --no-verify.
    const r = await done({
      fence: tried({ noVerify: refused, lefthookOff: refused }),
      trusted: seen(
        ["web_search", "session_search", "until", "wombat_gauge"],
        [
          { name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" },
          { name: "wombat-ritual", location: "/r/mine/SKILL.md" },
        ]
      ),
      untrusted: seen(
        ["web_search", "session_search"],
        [{ name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" }]
      ),
      files: { "VISION.md": "Build my own tools.\n" },
    });
    expect(r.verdicts).toEqual(["PASS", "PASS", "PASS"]);
    expect(r.text).toContain("Tools from this repo: until, wombat_gauge.");
    expect(r.text).toContain("Skills from this repo: wombat-ritual.");
    expect(r.text).toContain(
      "Note: your own Pi setup also adds 2 tools (web_search, session_search) and 1 skill (tdd)."
    );
    expect(r.text).toContain("LEFTHOOK=0: yes");
  });

  it("fails, with a note, when the tool and skill come only from the guest's own Pi setup", async () => {
    // A busy global Pi passes nothing on its own: the repo has to carry them.
    const r = await done({
      fence: tried({}),
      trusted: seen(
        ["web_search"],
        [{ name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" }]
      ),
      untrusted: seen(
        ["web_search"],
        [{ name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" }]
      ),
      files: why,
    });
    expect(r.verdicts[1]).toBe("FAIL");
    expect(r.text).toContain("Tools from this repo: none.");
    expect(r.text).toContain("wouldn't load them");
  });

  it("fails a repo tool without a repo skill, even with a global skill", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen(
        ["wombat_gauge"],
        [{ name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" }]
      ),
      untrusted: seen(
        [],
        [{ name: "tdd", location: "/elsewhere/skills/tdd/SKILL.md" }]
      ),
      files: why,
    });
    expect(r.verdicts[1]).toBe("FAIL");
    expect(r.text).toContain("Skills from this repo: none.");
  });

  it("says why when no fresh Pi could be seen", async () => {
    const r = await done({
      fence: tried({}),
      trusted: { ok: false, reason: "the fresh Pi exited 1" },
      files: why,
    });
    expect(r.verdicts[1]).toBe("FAIL");
    expect(r.text).toContain("Couldn't see what a fresh Pi loads");
    const half = await done({
      fence: tried({}),
      trusted: seen(["wombat_gauge"], [{ name: "s", location: "/x/SKILL.md" }]),
      untrusted: { ok: false, reason: "the second Pi exited 1" },
      files: why,
    });
    expect(half.verdicts[1]).toBe("FAIL");
    expect(half.text).toContain("Couldn't tell what comes from this repo");
  });

  it("keeps the last result for status, and setup clears it", async () => {
    const r = await done({ fence: tried({}), trusted: seen([]), files: why });
    const shown: string[] = [];
    const again = firstPackageExercise(
      { id: "01.1", title: "t" },
      {
        fence: async () => tried({}),
        probe: async () => seen([]),
        out: (l) => shown.push(l),
      }
    );
    await again.commands.status(r.ctx, []);
    expect(shown.filter((l) => /^(PASS|FAIL) /.test(l))).toHaveLength(3);
    await again.commands.setup(r.ctx, []);
    shown.length = 0;
    await again.commands.status(r.ctx, []);
    expect(shown[0]).toContain("No result yet");
  });
});
