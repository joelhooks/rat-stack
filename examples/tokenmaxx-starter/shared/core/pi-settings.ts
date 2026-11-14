import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Schema } from "effect";

import { writeJsonAtomic } from "./store.ts";

// Catch-up packages: a working version of a piece, as a Pi package declared in
// `.pi/settings.json`. Each ships declared but switched off, with Pi's
// package-object filters set to `[]` for every resource type: Pi installs a git
// package on the first trusted start but loads nothing from it, so no tool, no
// skill, no command and nothing about it in the prompt. Guests build their own
// first. `pnpm ex <id> catch-up` drops the filters, once, for every later Pi
// start (see ./catch-up.ts).
//
// Why filters and not launcher flags: they are Pi's documented per-package
// resource filters (the Pi package's docs/packages.md, "Select package
// resources"), so they hold for `pnpm pi`, a bare `pi` and `pi -p` alike. A
// project entry also replaces a guest's own install of the same package, so
// the filters hide that copy too. `pi install -l` keeps them.
//
// Two kinds of source, both named the way Pi identifies them:
// - `git:<repo>`: pinned in settings as `git:<repo>@<40-char sha>`; Pi clones
//   it into `.pi/git/<repo>`.
// - a local path, relative to `.pi/` (Pi resolves relative paths from the
//   settings file), e.g. `../catch-up/<name>`. Loaded in place.

/** Every resource type a Pi package can carry. Off means all of them `[]`. */
export const resourceTypes = [
  "extensions",
  "skills",
  "prompts",
  "themes",
] as const;

const Settings = Schema.Record(Schema.String, Schema.Unknown);
const PackageObject = Schema.Record(Schema.String, Schema.Unknown);
const Packages = Schema.Array(Schema.Union([Schema.String, PackageObject]));

const decodeSettings = Schema.decodeUnknownSync(Settings);
const decodePackages = Schema.decodeUnknownSync(Packages);

type Entry = string | Readonly<Record<string, unknown>>;

export const settingsPath = (repoRoot: string) =>
  join(repoRoot, ".pi", "settings.json");

export type DeclaredPackage = {
  /** The entry's source exactly as settings has it. */
  readonly source: string;
  /** The pinned commit of a git source; null for a local path. */
  readonly commit: string | null;
  /** False while every resource type is filtered to `[]`. */
  readonly switchedOn: boolean;
};

export type PinnedGitPackage = {
  /** e.g. `github.com/joelhooks/pi-until` */
  readonly repo: string;
  readonly commit: string;
  /** `git:<repo>@<commit>` */
  readonly source: string;
};

const pinnedGit = /^git:(.+)@([0-9a-f]{40})$/;

const entrySource = (entry: Entry): unknown =>
  typeof entry === "string" ? entry : entry["source"];

/** True when `entry` is the package `source` names (see the header). */
function matches(entry: Entry, source: string): boolean {
  const declared = entrySource(entry);
  if (typeof declared !== "string") {
    return false;
  }
  if (source.startsWith("git:")) {
    const match = pinnedGit.exec(declared);
    return match !== null && `git:${match[1]}` === source;
  }
  return declared === source;
}

const isOff = (entry: Entry) =>
  typeof entry !== "string" &&
  resourceTypes.every((type) => {
    const filter = entry[type];
    return Array.isArray(filter) && filter.length === 0;
  });

type Parsed = {
  readonly settings: Record<string, unknown>;
  readonly packages: readonly Entry[];
};

function parse(text: string): Parsed {
  const settings = decodeSettings(JSON.parse(text));
  return { settings, packages: decodePackages(settings["packages"] ?? []) };
}

const readSettings = (repoRoot: string) =>
  parse(readFileSync(settingsPath(repoRoot), "utf8"));

function find(parsed: Parsed, source: string): number {
  const index = parsed.packages.findIndex((entry) => matches(entry, source));
  if (index === -1) {
    throw new Error(
      source.startsWith("git:")
        ? `.pi/settings.json does not pin ${source}@<40-char sha>`
        : `.pi/settings.json does not declare ${source}`
    );
  }
  return index;
}

function declaredFrom(entry: Entry): DeclaredPackage {
  const source = String(entrySource(entry));
  return {
    source,
    commit: pinnedGit.exec(source)?.[2] ?? null,
    switchedOn: !isOff(entry),
  };
}

/** The declared entry for `source`. Throws when there is none. */
export function readDeclared(
  repoRoot: string,
  source: string
): DeclaredPackage {
  const parsed = readSettings(repoRoot);
  const entry = parsed.packages[find(parsed, source)];
  if (entry === undefined) {
    throw new Error(`.pi/settings.json does not declare ${source}`);
  }
  return declaredFrom(entry);
}

/** Every `git:<repo>@<sha>` entry, on or off: what Pi installs into `.pi/git/`. */
export function pinnedGitPackages(repoRoot: string): PinnedGitPackage[] {
  const pinned: PinnedGitPackage[] = [];
  for (const entry of readSettings(repoRoot).packages) {
    const source = entrySource(entry);
    const match = typeof source === "string" ? pinnedGit.exec(source) : null;
    if (
      typeof source === "string" &&
      match?.[1] !== undefined &&
      match[2] !== undefined
    ) {
      pinned.push({ repo: match[1], commit: match[2], source });
    }
  }
  return pinned;
}

/**
 * Switches `source` on (drops its resource filters) or off (sets every one to
 * `[]`). Other keys and packages stay as they are. Returns whether the file
 * changed. A running Pi picks it up on its next start or `/reload`.
 */
export async function setSwitchedOn(
  repoRoot: string,
  source: string,
  on: boolean
): Promise<boolean> {
  const parsed = readSettings(repoRoot);
  const index = find(parsed, source);
  const entry = parsed.packages[index];
  if (entry === undefined || declaredFrom(entry).switchedOn === on) {
    return false;
  }
  const declared = String(entrySource(entry));
  const rest =
    typeof entry === "string"
      ? {}
      : Object.fromEntries(
          Object.entries(entry).filter(
            ([key]) =>
              key !== "source" &&
              !(resourceTypes as readonly string[]).includes(key)
          )
        );
  const off = Object.fromEntries(resourceTypes.map((type) => [type, []]));
  const next: Entry = on
    ? Object.keys(rest).length === 0
      ? declared
      : { source: declared, ...rest }
    : { source: declared, ...rest, ...off };
  await writeJsonAtomic(settingsPath(repoRoot), {
    ...parsed.settings,
    packages: parsed.packages.map((p, i) => (i === index ? next : p)),
  });
  return true;
}
