import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CommitTry, FenceReport } from "./fence.ts";
import { addedTools, type LoadedSkill, type ProbeOutcome } from "./probe.ts";

// The done check's rules: what was observed in, which claims pass out. None of
// them imports or names anything the guest built.

export type Claim = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

/** A line `done` prints but doesn't count: the stretch. */
export type Stretch = {
  readonly name: string;
  readonly held: boolean;
  readonly detail: string;
};

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .findLast((l) => l !== "") ?? "(no output)";

/** At most `max` names, then a count, so a busy Pi setup stays readable. */
export function listed(names: readonly string[], max = 8): string {
  return names.length <= max
    ? names.join(", ")
    : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

const said = (attempt: CommitTry) => attempt.output.split("\n").slice(-3);

/** Past this, the hook-time line warns. It never fails the check. */
export const slowHookMs = 30_000;

/**
 * How long the commit without the type error took, hook included; or, when
 * git found no commit hook at all, that it found none.
 */
export function hookTime(
  control: CommitTry,
  hooks?: readonly string[]
): string[] {
  if (hooks !== undefined && hooks.length === 0) {
    return [
      "No commit hook found: git runs no pre-commit, prepare-commit-msg or commit-msg hook in this repo.",
    ];
  }
  if (control.ms === undefined) {
    return [];
  }
  const seconds = (control.ms / 1000).toFixed(1);
  return control.ms > slowHookMs
    ? [
        `Hook time: ${seconds} s for the commit without the error.`,
        `Warning: that's over ${slowHookMs / 1000} s. It doesn't fail this check, but a slow fence is one people and agents learn to skip.`,
      ]
    : [`Hook time: ${seconds} s for the commit without the error.`];
}

export function fenceClaim(report: FenceReport): Claim {
  const name = "a type-broken commit is refused";
  switch (report._tag) {
    case "NotARepo":
      return {
        name,
        ok: false,
        detail: `This folder isn't in a git repository, so there's no commit to refuse. (${report.detail})`,
      };
    case "InsideAnotherRepo":
      return {
        name,
        ok: false,
        detail: `This folder isn't a git repository of its own: the nearest one is ${report.top}. The check only tests this folder's own repository.`,
      };
    case "NoCommit":
      return {
        name,
        ok: false,
        detail:
          "The repository has no commit yet. Commit once, then run this again.",
      };
    case "NoDeps":
      return {
        name,
        ok: false,
        detail: [
          "Couldn't install your dependencies offline in the throwaway copy; this usually means the repo was installed with a different pnpm. Run `pnpm install` again, then run this again.",
          `\`${report.command}\` said:`,
          ...report.output.split("\n").slice(-3),
        ].join("\n"),
      };
    case "Tried": {
      const own = report.places - 1;
      const what =
        own === 0
          ? "a commit that adds a file with a type error at the root (there's no TypeScript of yours outside shared/, scripts/ and exercises/ yet)"
          : own === 1
            ? "a commit that adds a file with a type error at the root and in your one TypeScript folder"
            : `a commit that adds a file with a type error at the root and in each of your ${own} TypeScript folders`;
      if (report.control.refused) {
        return {
          name,
          ok: false,
          detail: [
            "It also refused the same commit without the type error, so it can't tell broken from fine. It said:",
            ...said(report.control),
            ...hookTime(report.control, report.hooks),
          ].join("\n"),
        };
      }
      if (!report.broken.refused) {
        return {
          name,
          ok: false,
          detail: [
            `Went through: ${what}.`,
            ...hookTime(report.control, report.hooks),
          ].join("\n"),
        };
      }
      return {
        name,
        ok: true,
        detail: [
          `Refused ${what}, and let the same commit through without the error. It said: ${lastLine(report.broken.output)}`,
          ...hookTime(report.control, report.hooks),
        ].join("\n"),
      };
    }
  }
}

export function stretchLine(report: FenceReport): Stretch | null {
  if (report._tag !== "Tried" || !report.broken.refused) {
    return null;
  }
  const verdict = (attempt: CommitTry) =>
    attempt.refused ? "refused" : "got through";
  return {
    name: "it still refuses with git commit -n, or with LEFTHOOK=0",
    held: report.noVerify.refused && report.lefthookOff.refused,
    detail: `git commit -n: ${verdict(report.noVerify)}. LEFTHOOK=0 git commit: ${verdict(report.lefthookOff)}.`,
  };
}

/** Prints a warning when the fence test left the repo different. Should never fire. */
export function changedWarning(report: FenceReport): string | null {
  return report._tag === "Tried" && report.changed !== null
    ? `Warning: the repo looks different after the fence test:\n${report.changed}`
    : null;
}

/**
 * `trusted` is a fresh Pi as you'd start it; `untrusted` is the same Pi told
 * to ignore this repo's own settings and resources (`--no-approve`). A tool or
 * skill only the first one has came from this repo. Only those count: one the
 * guest's own Pi setup adds would load on their machine and nowhere else.
 */
export function packageClaim(
  trusted: ProbeOutcome,
  untrusted: ProbeOutcome | null
): Claim {
  const name = "a fresh Pi session loads a tool and a skill from this repo";
  if (!trusted.ok) {
    return {
      name,
      ok: false,
      detail: `Couldn't see what a fresh Pi loads: ${trusted.reason}`,
    };
  }
  if (untrusted === null || !untrusted.ok) {
    return {
      name,
      ok: false,
      detail: `Couldn't tell what comes from this repo: ${untrusted?.ok === false ? untrusted.reason : "no second Pi ran"}`,
    };
  }
  const key = (skill: LoadedSkill) => `${skill.name}\0${skill.location}`;
  const outsideTools = new Set(untrusted.seen.tools);
  const outsideSkills = new Set(untrusted.seen.skills.map(key));
  const tools = addedTools(trusted.seen);
  const repoTools = tools.filter((t) => !outsideTools.has(t));
  const setupTools = tools.filter((t) => outsideTools.has(t));
  const repoSkills = trusted.seen.skills
    .filter((s) => !outsideSkills.has(key(s)))
    .map((s) => s.name);
  const setupSkills = trusted.seen.skills
    .filter((s) => outsideSkills.has(key(s)))
    .map((s) => s.name);
  const lines = [
    repoTools.length === 0
      ? `Tools from this repo: none. (Pi's own: ${trusted.seen.tools.filter((t) => !tools.includes(t)).join(", ") || "none"}.)`
      : `Tools from this repo: ${listed(repoTools)}.`,
    repoSkills.length === 0
      ? "Skills from this repo: none."
      : `Skills from this repo: ${listed(repoSkills)}.`,
  ];
  if (setupTools.length > 0 || setupSkills.length > 0) {
    const parts = [
      ...(setupTools.length > 0
        ? [
            `${setupTools.length} tool${setupTools.length === 1 ? "" : "s"} (${listed(setupTools, 5)})`,
          ]
        : []),
      ...(setupSkills.length > 0
        ? [
            `${setupSkills.length} skill${setupSkills.length === 1 ? "" : "s"} (${listed(setupSkills, 5)})`,
          ]
        : []),
    ];
    lines.push(
      `Note: your own Pi setup also adds ${parts.join(" and ")}. They don't count: a fresh Pi on another machine wouldn't load them.`
    );
  }
  return {
    name,
    ok: repoTools.length > 0 && repoSkills.length > 0,
    detail: lines.join("\n"),
  };
}

/** A why file: VISION or WHY at the repo root, any case, any extension. */
export const whyPattern = /^(vision|why)(\.[a-z0-9]+)?$/i;

export type WhyFile = { readonly name: string; readonly text: string };

export async function findWhyFiles(repoRoot: string): Promise<WhyFile[]> {
  const found: WhyFile[] = [];
  for (const entry of await readdir(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && whyPattern.test(entry.name)) {
      found.push({
        name: entry.name,
        text: await readFile(join(repoRoot, entry.name), "utf8"),
      });
    }
  }
  return found.toSorted((a, b) => a.name.localeCompare(b.name));
}

export function whyClaim(files: readonly WhyFile[]): Claim {
  const name = "the repo says why it exists";
  const written = files.find((f) => f.text.trim() !== "");
  if (written !== undefined) {
    const words = written.text.trim().split(/\s+/).length;
    return {
      name,
      ok: true,
      detail: `${written.name}: ${words} word${words === 1 ? "" : "s"}.`,
    };
  }
  return {
    name,
    ok: false,
    detail:
      files.length === 0
        ? "No VISION or WHY file at the repo root."
        : `${files.map((f) => f.name).join(", ")} is empty.`,
  };
}
