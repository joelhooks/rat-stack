import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "tokenmaxx-starter";

/** Walks up from `from` to the directory whose package.json is this starter. */
export function findRepoRoot(
  from: string = dirname(fileURLToPath(import.meta.url))
): string {
  let dir = resolve(from);
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && readPackageName(pkg) === packageName) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No ${packageName} package.json above ${from}`);
    }
    dir = parent;
  }
}

function readPackageName(path: string): string | undefined {
  const parsed: { name?: unknown } = JSON.parse(readFileSync(path, "utf8"));
  return typeof parsed.name === "string" ? parsed.name : undefined;
}
