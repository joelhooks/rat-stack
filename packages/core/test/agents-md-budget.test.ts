// @effect-diagnostics nodeBuiltinImport:off -- This test reads the repository's agent docs from disk.
import { existsSync, globSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const projectDocMaxBytes = 32 * 1024;

const ignoredDirs = new Set([
  ".agent_sources",
  ".git",
  "node_modules",
  "vendor",
]);

const agentsDocs = globSync("**/AGENTS.md", { cwd: repoRoot }).filter(
  (doc) => !doc.split("/").some((part) => ignoredDirs.has(part))
);

const chainDirectories = (doc: string) => {
  const dir = path.posix.dirname(doc);
  const parts = dir === "." ? [] : dir.split("/");

  return [".", ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))];
};

const chainBytes = (doc: string) => {
  let total = 0;

  for (const dir of chainDirectories(doc)) {
    const candidate =
      dir === "." ? "AGENTS.md" : path.posix.join(dir, "AGENTS.md");

    const file = path.join(repoRoot, candidate);

    if (existsSync(file)) {
      total += statSync(file).size;
    }
  }

  return total;
};

describe("AGENTS.md byte budget", () => {
  it("keeps every root-to-leaf chain inside Codex's default project_doc_max_bytes", () => {
    const overBudget = agentsDocs
      .map((doc) => ({ bytes: chainBytes(doc), doc }))
      .filter(({ bytes }) => bytes > projectDocMaxBytes);

    const report = overBudget
      .map(({ bytes, doc }) => `${doc} chain totals ${bytes} bytes`)
      .join("; ");

    expect(
      overBudget,
      `AGENTS.md chain exceeds ${projectDocMaxBytes} bytes. Codex reads at most project_doc_max_bytes across the AGENTS.md files from repo root to the working directory, so the tail sections never load. Fix: move task-conditional material behind a pointer like skills/rat-stack-mode/references/packages.md. ${report}`
    ).toEqual([]);
  });
});
