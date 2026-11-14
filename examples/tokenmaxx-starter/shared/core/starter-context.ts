import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { findRepoRoot } from "./repo-root.ts";

// Loaded by `pnpm pi` (`-e`) only when the starter is a folder inside the
// guest's repo and Pi runs at the guest's root. Pi reads AGENTS.md from its
// working folder and the folders above it, so the starter's own AGENTS.md, a
// folder below, would be missing. This adds it to Pi's context files, as if
// Pi ran in the starter, with one line saying which folder it's from. It adds
// no tool, command or skill.

type Hooks = Pick<ExtensionAPI, "on">;

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Where the file came from, for a Pi running in `cwd`. Both are resolved, so
 * a path through a symlink (macOS's `/var`) names the same folder.
 */
export function fromFolder(cwd: string, path: string): string {
  const folder = relative(real(cwd), real(join(path, "..")));
  return `These are the workshop's own instructions, from its folder \`${folder}/\` in this repo. Its \`pnpm\` commands run in that folder, or through scripts of this repo's own that run them.`;
}

/** Adds the file at `path` to Pi's context files before every run. */
export function addContextFile(pi: Hooks, path: string): void {
  const target = real(path);
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    const files = options.contextFiles;
    if (files.some((file) => real(file.path) === target)) {
      return;
    }
    try {
      const text = readFileSync(target, "utf8");
      files.push({
        path: target,
        content: `${fromFolder(options.cwd, target)}\n\n${text}`,
      });
    } catch {
      // No AGENTS.md to add: Pi carries on without it.
    }
  });
}

export default function starterContext(pi: ExtensionAPI): void {
  addContextFile(pi, join(findRepoRoot(), "AGENTS.md"));
}
