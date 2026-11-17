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

import { afterEach, describe, expect, it } from "vitest";

import { exerciseContext } from "#shared/core/context.ts";
import {
  type FirstPackageDeps,
  firstPackageExercise,
} from "#shared/first-package/exercise.ts";
import type { CommitTry, FenceReport } from "#shared/first-package/fence.ts";
import type { ProbeOutcome } from "#shared/first-package/probe.ts";
import type { SkipReport } from "#shared/first-package/skip.ts";

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
/** An agent's three tries at skipping the hook: -n, LEFTHOOK=0, hooksPath. */
const skipped = (by: "git" | "pi" | null): SkipReport => ({
  ok: true,
  tries: [
    'git commit -n -m "test: fence check"',
    'LEFTHOOK=0 git commit -m "test: fence check"',
    'git -c core.hooksPath=/dev/null commit -m "test: fence check"',
  ].map((command) => ({
    command,
    refused: by !== null,
    by,
    output:
      by === "pi"
        ? "Skipping the commit hook is not allowed here."
        : by === "git"
          ? "error TS2322\nCommand exited with code 1"
          : "[detached HEAD 1a2b3c4] test: fence check",
  })),
});

const tried = (
  over: Partial<FenceReport & { _tag: "Tried" }>
): FenceReport => ({
  _tag: "Tried",
  places: 3,
  control: went,
  broken: refused,
  skips: skipped(null),
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
  /** The starter pulled into this folder of the guest's repo. */
  nestedIn?: string;
  /** The guest's root named through a symlink to it, as macOS's /var is. */
  linkedGuest?: boolean;
  /** Runs `done` without `--details`, as a guest first sees it. */
  short?: boolean;
};

async function done(story: Story) {
  const guest = repo(story.files);
  const root =
    story.nestedIn === undefined ? guest : join(guest, story.nestedIn);
  mkdirSync(root, { recursive: true });
  const lines: string[] = [];
  const fenced: { root: string; supplied: readonly string[] }[] = [];
  const deps: FirstPackageDeps = {
    fence: async (at, supplied) => {
      fenced.push({ root: at, supplied });
      return story.fence;
    },
    probe: async (_root, trusted) =>
      trusted ? story.trusted : (story.untrusted ?? seen([])),
    out: (line) => lines.push(line),
  };
  const exercise = firstPackageExercise({ id: "01.1", title: "t" }, deps);
  const ctx = exerciseContext({
    exerciseId: "01.1",
    repoRoot: root,
    guestRoot: story.linkedGuest === true ? linkTo(guest) : guest,
    env: { TMX_STATE_DIR: join(root, ".state") },
  });
  const run = exercise.commands["done"];
  if (run === undefined) {
    throw new Error("01.1 has no done command");
  }
  const code = await run(ctx, story.short === true ? [] : ["--details"]);
  const verdicts = lines
    .filter((l) => /^(PASS|FAIL|NOTE) /.test(l))
    .map(verdict);
  return {
    code,
    lines,
    // A wrapped line joined up again, so a test can look for a sentence.
    text: lines.join("\n").replaceAll(/\n {9}/g, " "),
    verdicts,
    exercise,
    ctx,
    fenced,
  };
}

/** `PASS` or `FAIL`; a note as `NOTE yes` or `NOTE no`, by its sentence. */
function verdict(line: string): string {
  const yes = [
    "NOTE     A fresh Pi session loads a tool and a skill from this repo.",
    "NOTE     The repo says why it exists, in ",
  ];
  return line.startsWith("NOTE ")
    ? `NOTE ${yes.some((y) => line.startsWith(y)) ? "yes" : "no"}`
    : line.slice(0, 4);
}

/** A symlink beside `dir` that points at it. */
function linkTo(dir: string): string {
  const link = `${dir}-link`;
  symlinkSync(dir, link);
  dirs.push(link);
  return link;
}

const why = { "VISION.md": "Agents that prove it before they say done.\n" };

describe("the 01.1 done check", () => {
  it("fails the shortest path: no fence, nothing loaded, no why", async () => {
    const r = await done({
      fence: tried({ broken: went }),
      trusted: seen([]),
    });
    expect(r.verdicts).toEqual(["FAIL", "NOTE no", "NOTE no"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Not done yet: 0 of 1 checks pass.");
    expect(r.text).toContain("Went through");
    expect(r.text).toContain(
      "Tools from this repo: none. (Pi's own: read, bash, edit, write.)"
    );
    expect(r.text).toContain("No VISION or WHY file");
    expect(r.text).not.toContain("STRETCH");
  });

  it("without --details, shows a FAIL's detail and hides the notes'", async () => {
    const r = await done({
      fence: tried({ broken: went }),
      trusted: seen([]),
      short: true,
    });
    expect(r.verdicts).toEqual(["FAIL", "NOTE no", "NOTE no"]);
    expect(r.text).toContain("Went through");
    expect(r.text).not.toContain("Tools from this repo");
    expect(r.text).not.toContain("No VISION or WHY file");
    expect(r.lines.slice(-3)).toEqual([
      "Not done yet: 0 of 1 checks pass.",
      "Next: paste the FAIL lines into Pi and ask it to fix them, then run this again.",
      "More: pnpm ex 01.1 done --details",
    ]);
  });

  it("fails a faked fence, even with an agent saying done", async () => {
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
    expect(r.verdicts).toEqual(["FAIL", "NOTE no", "NOTE yes"]);
    expect(r.code).toBe(1);
  });

  it("fails a broken fence even when both notes find what they look for", async () => {
    const r = await done({
      fence: tried({ broken: went }),
      trusted: seen(
        ["wombat_gauge"],
        [{ name: "wombat-ritual", location: "/x/SKILL.md" }]
      ),
      untrusted: seen([]),
      files: why,
    });
    expect(r.verdicts).toEqual(["FAIL", "NOTE yes", "NOTE yes"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("Not done yet: 0 of 1 checks pass.");
  });

  it("passes on the fence alone: no package, no why, both printed as notes", async () => {
    const r = await done({ fence: tried({}), trusted: seen([]) });
    expect(r.verdicts).toEqual(["PASS", "NOTE no", "NOTE no"]);
    expect(r.code).toBe(0);
    expect(r.text).not.toMatch(/^FAIL/m);
    expect(r.text).not.toContain("Not done yet");
    expect(r.text).toContain("Done: the fence holds.");
    expect(r.lines).toContain("Not required for this step:");
    expect(r.lines).toContain(
      "NOTE     A fresh Pi session doesn't load a tool or a skill from this repo yet."
    );
    expect(r.lines).toContain(
      "NOTE     The repo doesn't say why it exists: no VISION or WHY file at its root."
    );
    expect(r.lines).toContain(
      "Next: 02.1 · Wake me when it's done. Start it with: pnpm ex 02.1 setup"
    );
    expect(r.text).toContain("Tools from this repo: none.");
    expect(r.text).toContain("No VISION or WHY file");
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

  it("notes a tool without a skill, and an empty why file, and still passes", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen(["wombat_gauge"]),
      files: { "WHY.md": "  \n" },
    });
    expect(r.verdicts).toEqual(["PASS", "NOTE no", "NOTE no"]);
    expect(r.code).toBe(0);
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
    expect(r.verdicts).toEqual(["PASS", "NOTE yes", "NOTE yes"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Tools from this repo: wombat_gauge.");
    expect(r.text).toContain("Skills from this repo: wombat-ritual.");
    expect(r.text).toContain("VISION.md: 8 words.");
    expect(r.text).not.toContain("Note:");
    expect(r.text).toContain(
      "STRETCH  An agent here can still skip the hook: that's the stretch goal."
    );
    expect(r.text).toContain(
      'git commit -n -m "test: fence check": got through, a commit was made.'
    );
    expect(r.fenced).toEqual([
      { root: r.ctx.repoRoot, supplied: ["shared", "scripts", "exercises"] },
    ]);
  });

  it("knows the starter is the repo when the guest root names it through a symlink", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen([]),
      files: why,
      linkedGuest: true,
    });
    expect(r.ctx.guestRoot).not.toBe(r.ctx.repoRoot);
    expect(r.fenced).toEqual([
      {
        root: r.ctx.guestRoot,
        supplied: ["shared", "scripts", "exercises"],
      },
    ]);
    expect(r.text).not.toContain("(tools in");
  });

  it("checks the guest's repo when the starter is a folder inside it", async () => {
    const r = await done({
      fence: tried({ skips: skipped("git") }),
      trusted: seen(
        ["wombat_gauge"],
        [{ name: "wombat-ritual", location: "/g/.pi/skills/SKILL.md" }]
      ),
      files: why,
      nestedIn: "workshop",
    });
    expect(r.ctx.guestRoot).not.toBe(r.ctx.repoRoot);
    expect(r.verdicts).toEqual(["PASS", "NOTE yes", "NOTE yes"]);
    expect(r.fenced).toEqual([
      { root: r.ctx.guestRoot, supplied: ["workshop"] },
    ]);
    // One header line or two, by the temp path's length.
    const header = r.lines.slice(0, r.lines.indexOf("")).join(" · ");
    expect(header).toBe(
      `01.1 · t · checking ${r.ctx.guestRoot} (tools in workshop/)`
    );
    expect(r.text).toContain("VISION.md");
    expect(r.text).toContain("STRETCH  An agent here can't skip the hook.");
    // 02.1 onward run in the starter's folder, not the repo 01.1 checked.
    expect(r.lines.slice(-2)).toEqual([
      "Next: 02.1 · Wake me when it's done, in your tokenmaxx folder:",
      "      pnpm ex 02.1 setup",
    ]);
    expect(r.text).toContain("refused by git. It said: error TS2322");
  });

  it("finds no why file in the starter's folder, only at the guest's root", async () => {
    const r = await done({
      fence: tried({}),
      trusted: seen([]),
      nestedIn: "workshop",
    });
    writeFileSync(join(r.ctx.repoRoot, "VISION.md"), "the starter's\n");
    const again = await done({
      fence: tried({}),
      trusted: seen([]),
      nestedIn: "workshop",
    });
    expect(r.text).toContain("No VISION or WHY file");
    expect(again.text).toContain("No VISION or WHY file");
  });

  it("says when the agent stretch couldn't run, and never fails on it", async () => {
    const r = await done({
      fence: tried({
        skips: {
          ok: false,
          reason: "a fresh Pi in your repo has no bash tool to try it with.",
        },
      }),
      trusted: seen(["wombat_gauge"], [{ name: "s", location: "/x/SKILL.md" }]),
      files: why,
    });
    expect(r.verdicts).toEqual(["PASS", "NOTE yes", "NOTE yes"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain(
      "STRETCH  The check couldn't find out whether an agent here can skip the hook."
    );
    expect(r.text).toContain(
      "Couldn't find out: a fresh Pi in your repo has no bash tool"
    );
  });

  it("passes Joel's shape: a global Pi setup plus the repo's own package", async () => {
    // Many tools and skills from his own Pi setup, the repo's package on top,
    // and a fence that also stops the agent's own --no-verify.
    const r = await done({
      fence: tried({ skips: skipped("pi") }),
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
    expect(r.verdicts).toEqual(["PASS", "NOTE yes", "NOTE yes"]);
    expect(r.text).toContain("Tools from this repo: until, wombat_gauge.");
    expect(r.text).toContain("Skills from this repo: wombat-ritual.");
    expect(r.text).toContain(
      "Note: your own Pi setup also adds 2 tools (web_search, session_search) and 1 skill (tdd)."
    );
    expect(r.text).toContain("STRETCH  An agent here can't skip the hook.");
    expect(r.text).toContain(
      "refused by your Pi before git ran. It said: Skipping the commit hook is not allowed here."
    );
  });

  it("notes, without failing, when the tool and skill come only from the guest's own Pi setup", async () => {
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
    expect(r.verdicts[1]).toBe("NOTE no");
    expect(r.text).toContain("Tools from this repo: none.");
    expect(r.text).toContain("wouldn't load them");
  });

  it("notes no for a repo tool without a repo skill, even with a global skill", async () => {
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
    expect(r.verdicts[1]).toBe("NOTE no");
    expect(r.text).toContain("Skills from this repo: none.");
  });

  it("says why when no fresh Pi could be seen", async () => {
    const r = await done({
      fence: tried({}),
      trusted: { ok: false, reason: "the fresh Pi exited 1" },
      files: why,
    });
    expect(r.verdicts[1]).toBe("NOTE no");
    expect(r.text).toContain("Couldn't see what a fresh Pi loads");
    const half = await done({
      fence: tried({}),
      trusted: seen(["wombat_gauge"], [{ name: "s", location: "/x/SKILL.md" }]),
      untrusted: { ok: false, reason: "the second Pi exited 1" },
      files: why,
    });
    expect(half.verdicts[1]).toBe("NOTE no");
    expect(half.text).toContain("Couldn't tell what comes from this repo");
  });

  it("keeps the last result for status, the same as done showed, and setup clears it", async () => {
    const r = await done({ fence: tried({}), trusted: seen([]), files: why });
    expect(r.code).toBe(0);
    const shown: string[] = [];
    const again = firstPackageExercise(
      { id: "01.1", title: "t" },
      {
        fence: async () => tried({}),
        probe: async () => seen([]),
        out: (l) => shown.push(l),
      }
    );
    await again.commands.status(r.ctx, ["--details"]);
    // From the blank line under the header on: status's header differs.
    expect(shown.slice(shown.indexOf(""))).toEqual(
      r.lines.slice(r.lines.indexOf(""))
    );
    expect(
      shown.map(verdict).filter((v) => /^(PASS|FAIL|NOTE)/.test(v))
    ).toEqual(["PASS", "NOTE no", "NOTE yes"]);
    expect(shown.slice(-2)).toEqual([
      "Done: the fence holds.",
      "Next: 02.1 · Wake me when it's done. Start it with: pnpm ex 02.1 setup",
    ]);
    await again.commands.setup(r.ctx, []);
    shown.length = 0;
    await again.commands.status(r.ctx, []);
    expect(shown[0]).toContain("No result yet");
  });

  it("replays a result 0.4.0 saved, before sentences, in the new words", async () => {
    const r = await done({ fence: tried({}), trusted: seen([]), files: why });
    const claim = (name: string, ok: boolean) => ({ name, ok, detail: "" });
    writeFileSync(
      join(r.ctx.stateDir, "done.json"),
      JSON.stringify({
        at: "2026-11-16T20:00:00.000Z",
        claims: [claim("a type-broken commit is refused", true)],
        notes: [
          claim(
            "a fresh Pi session loads a tool and a skill from this repo",
            false
          ),
          claim("the repo says why it exists", true),
        ],
        stretch: {
          name: "an agent here can't skip the hook",
          held: false,
          detail: "",
        },
      })
    );
    const shown: string[] = [];
    await firstPackageExercise(
      { id: "01.1", title: "t" },
      {
        fence: async () => tried({}),
        probe: async () => seen([]),
        out: (l) => shown.push(l),
      }
    ).commands.status(r.ctx, []);
    expect(shown.filter((l) => /^[A-Z]{4,7} /.test(l))).toEqual([
      "PASS     A commit with a type error gets refused.",
      "NOTE     A fresh Pi session doesn't load both a tool and a skill from this repo",
      "NOTE     The repo says why it exists.",
      "STRETCH  An agent here can still skip the hook: that's the stretch goal.",
    ]);
    expect(shown).toContain("Done: the fence holds.");
  });
});
