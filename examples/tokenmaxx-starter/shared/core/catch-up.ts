import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExerciseCommand } from "./exercise.ts";
import { readDeclared, setSwitchedOn } from "./pi-settings.ts";

// `pnpm ex <id> catch-up`: switch on a working version of the piece, a Pi
// package declared in `.pi/settings.json` and shipped switched off (see
// ./pi-settings.ts). For a guest who is stuck, joined late, or wants to
// compare after time is called. Once is enough for every later Pi start.
//
// An exercise names its package and adds the command:
//
//   commands: { ..., "catch-up": catchUp(somePackage) }
//
// The exercise's readme never mentions the command; the next piece's does.

export type CatchUpPackage = {
  /** What it does, in plain words: "a wait that wakes the agent". */
  readonly piece: string;
  /**
   * How `.pi/settings.json` names it: `git:<repo>` for a package pinned there
   * at a commit, or a local path relative to `.pi/`, e.g. `../catch-up/<name>`.
   */
  readonly source: string;
  /** Where to read it: a public repo, or the package's folder in this repo. */
  readonly url: string;
};

export type CatchUpIo = { readonly out: (line: string) => void };

const consoleIo: CatchUpIo = { out: (line) => console.log(line) };

export function catchUp(
  pkg: CatchUpPackage,
  io: CatchUpIo = consoleIo
): ExerciseCommand {
  return async (ctx) => {
    if (
      !pkg.source.startsWith("git:") &&
      !existsSync(join(ctx.repoRoot, ".pi", pkg.source))
    ) {
      throw new Error(
        `${pkg.piece}: .pi/settings.json points at ${pkg.source}, which is not in this checkout`
      );
    }
    const changed = await setSwitchedOn(ctx.repoRoot, pkg.source, true);
    const { source } = readDeclared(ctx.repoRoot, pkg.source);
    io.out(
      changed
        ? `Switched on ${pkg.piece}: ${source}`
        : `${pkg.piece} was already switched on: ${source}`
    );
    io.out(`Read how it works: ${pkg.url}`);
    io.out(
      "Next: quit any running Pi and start it again with pnpm pi, or run /reload in it."
    );
    return 0;
  };
}
