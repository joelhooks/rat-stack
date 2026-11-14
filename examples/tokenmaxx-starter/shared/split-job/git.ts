import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { gitEnv } from "#shared/core/git-env.ts";

// Git as the 06.1 environment uses it: read-only questions about the guest's
// repo and the workers' copies. Every call goes through `gitEnv`, so a
// command run from inside a hook (where git sets GIT_DIR and GIT_INDEX_FILE)
// still asks about the folder it's pointed at.

export { gitEnv };

export type GitRun = { readonly code: number | null; readonly stdout: string };

export function runGit(cwd: string, args: readonly string[]): Promise<GitRun> {
  return new Promise((resolveRun) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("error", () => resolveRun({ code: null, stdout }));
    child.on("close", (code) => resolveRun({ code, stdout }));
  });
}

/** Stdout of a git call that must succeed, or null when it doesn't. */
export async function gitOut(
  cwd: string,
  args: readonly string[]
): Promise<string | null> {
  const result = await runGit(cwd, args);
  return result.code === 0 ? result.stdout : null;
}

export const nulList = (text: string | null) =>
  (text ?? "").split("\0").filter((s) => s !== "");

/** The top of the git work tree holding `dir`, or null outside one. */
export async function topLevel(dir: string): Promise<string | null> {
  const out = await gitOut(dir, ["rev-parse", "--show-toplevel"]);
  const top = out?.trim() ?? "";
  return top === "" ? null : top;
}

/** The ID git gives these bytes as a blob (`git hash-object`). */
export function blobId(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  return createHash("sha1")
    .update(`blob ${data.length}\0`)
    .update(data)
    .digest("hex");
}
