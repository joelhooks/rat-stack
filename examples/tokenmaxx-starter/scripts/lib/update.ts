import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// Updates a copy of the starter from a newer copy of it, in place. A guest's
// copy came from tiged, so it has no git history to pull: the newer copy is
// fetched beside it, into `.workshop-state/update/`, and this compares the two
// file by file.
//
// It recognises a file by its contents. `starter-files.json` holds the git
// blob hash of every version of every file the starter has shipped, so a file
// that matches any of them is the starter's, untouched, and gets the new
// version. One that matches none was edited by the guest. A doc or exercise
// file they edited stays as they left it, and is named. A file the new
// version can't run without (`requiredFile`) stops the update before it
// writes anything, unless `backup` is set: then every file it doesn't
// recognise moves to `.workshop-state/update-backup/<time>/` first. Files the
// guest made, `.workshop-state/` and git history are never touched.
//
// `.pi/` follows the same rules as everything else. Its only starter file is
// `.pi/settings.json`: unedited, it gets the new version; edited (say by
// `pi install -l`), it stays as the guest left it, and is named. An unedited
// extension an older starter shipped there is removed. Everything else in
// `.pi/` is the guest's or Pi's own (their extensions, installed packages)
// and is left alone.
//
// This runs before `pnpm install` on the new tree, so it imports nothing but
// Node.

export const historyFile = "starter-files.json";

/** The file the 01.1 done check commits in its throwaway copy; never shipped. */
export const fenceProbeName = "tmx-fence-check.ts";

export type History = {
  readonly files: Readonly<Record<string, readonly string[]>>;
};

/** Git's blob id for these bytes, cut to 16 hex digits. */
export function blobHash(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex")
    .slice(0, 16);
}

export const fileHash = (path: string): string => blobHash(readFileSync(path));

/** Files the new version can't run without: a guest edit there stops the update. */
export function requiredFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return (
    name === "package.json" ||
    name === "pnpm-lock.yaml" ||
    name === "pnpm-workspace.yaml" ||
    name === "turbo.json" ||
    /^tsconfig.*\.json$/.test(name) ||
    /^vitest\..*\.ts$/.test(path) ||
    path.startsWith(".githooks/")
  );
}

/** Folders a copy of the starter never ships: installs, runtime state, caches. */
const skipped = new Set(["node_modules", ".git", ".turbo", ".workshop-state"]);

/** Every file under `dir`, relative, with `/` separators. */
export function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) {
          walk(path);
        }
      } else if (entry.isFile()) {
        found.push(relative(dir, path).split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return found.toSorted();
}

export type Plan = {
  /** New files, and starter files the new version changes. */
  readonly write: readonly string[];
  /** Starter files the new version drops. */
  readonly remove: readonly string[];
  /** Guest-edited files that stay as they are. */
  readonly kept: readonly string[];
  /** Guest-edited files the new version can't run without. */
  readonly blocked: readonly string[];
  /** Guest-edited files the new version drops. */
  readonly leftover: readonly string[];
};

export function plan(target: string, source: string, history: History): Plan {
  const known = (path: string, hash: string) =>
    history.files[path]?.includes(hash) ?? false;
  const sourceFiles = listFiles(source);
  const shipped = new Set(sourceFiles);
  const write: string[] = [];
  const kept: string[] = [];
  const blocked: string[] = [];
  for (const path of sourceFiles) {
    const local = join(target, path);
    if (!existsSync(local)) {
      write.push(path);
      continue;
    }
    const hash = fileHash(local);
    if (hash === fileHash(join(source, path))) {
      continue;
    }
    if (path === historyFile || known(path, hash)) {
      write.push(path);
    } else if (requiredFile(path)) {
      blocked.push(path);
    } else {
      kept.push(path);
    }
  }
  const remove: string[] = [];
  const leftover: string[] = [];
  for (const path of Object.keys(history.files).toSorted()) {
    const local = join(target, path);
    if (shipped.has(path) || !existsSync(local)) {
      continue;
    }
    (known(path, fileHash(local)) ? remove : leftover).push(path);
  }
  return { write, remove, kept, blocked, leftover };
}

export type UpdateOptions = {
  /** Move every file it doesn't recognise aside, then update. */
  readonly backup: boolean;
  /** For the backup folder's name. */
  readonly now: Date;
};

export type UpdateResult =
  | { readonly ok: false; readonly blocked: readonly string[] }
  | {
      readonly ok: true;
      readonly plan: Plan;
      /** Where moved files went, relative to the target; null when none moved. */
      readonly backupDir: string | null;
    };

const copyInto = (from: string, to: string) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  chmodSync(to, statSync(from).mode & 0o777);
};

/** Plans, then writes. Writes nothing when it stops. */
export function applyUpdate(
  target: string,
  source: string,
  history: History,
  opts: UpdateOptions
): UpdateResult {
  const planned = plan(target, source, history);
  if (planned.blocked.length > 0 && !opts.backup) {
    return { ok: false, blocked: planned.blocked };
  }
  const moving = opts.backup
    ? [...planned.blocked, ...planned.kept, ...planned.leftover]
    : [];
  const stamp = opts.now.toISOString().replace(/[:.]/g, "-");
  const backupDir =
    moving.length > 0 ? `.workshop-state/update-backup/${stamp}` : null;
  for (const path of moving) {
    const to = join(target, backupDir ?? "", path);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(join(target, path), to);
  }
  const replaced = opts.backup
    ? [...planned.write, ...planned.blocked, ...planned.kept]
    : planned.write;
  for (const path of replaced) {
    copyInto(join(source, path), join(target, path));
  }
  for (const path of planned.remove) {
    rmSync(join(target, path), { force: true });
  }
  const done: Plan = opts.backup
    ? {
        write: replaced.toSorted(),
        remove: planned.remove,
        kept: [],
        blocked: [],
        leftover: [],
      }
    : planned;
  return { ok: true, plan: done, backupDir };
}

/** A short fingerprint of a tree's files, so two copies can be compared by eye. */
export function fingerprint(dir: string): string {
  const hash = createHash("sha256");
  for (const path of listFiles(dir)) {
    hash.update(`${path}\0${fileHash(join(dir, path))}\n`);
  }
  return hash.digest("hex").slice(0, 7);
}
