// @effect-diagnostics nodeBuiltinImport:off -- These tests write temporary lint fixtures and run the real oxlint binary against them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const oxlint = path.join(repoRoot, "node_modules/.bin/oxlint");

const plugin = path.join(repoRoot, "scripts/oxlint-plugin-patterns.ts");

const rule = "rat-stack-patterns/audited-content-regex";

const lint = (files: readonly string[]) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-content-regex-"));
  const config = path.join(directory, "oxlint.json");

  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "rat-stack-patterns", specifier: plugin }],
      rules: { [rule]: "error" },
    })
  );

  try {
    const result = spawnSync(oxlint, ["-c", config, "--no-ignore", ...files], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status ?? -1,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const lintSource = (source: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-content-source-"));
  const file = path.join(directory, "content-lib.ts");
  writeFileSync(file, source);

  try {
    return lint([file]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("audited content regular expressions", () => {
  it("keeps svx syntax out of the content pipeline's regular expressions", () => {
    const result = lint(
      ["content-lib.ts", "generate-content.ts", "wiki-prose.ts"].map((name) =>
        path.join(repoRoot, "apps/mischief/scripts", name)
      )
    );

    expect(result.output).not.toContain(rule);
    expect(result.status).toBe(0);
  });

  it.each([
    [
      "export const parse = (rawText: string) => /<AgentOnly>(.*?)<\\/AgentOnly>/gu.exec(rawText);",
      "over raw svx source",
    ],
    [
      "export const links = (source: string) => /\\[.+\\]\\((.+)\\)/gu.exec(source);",
      "over raw svx source",
    ],
    [
      'export const parse = (value: string) => new RegExp("<Diagram", "g").test(value);',
      'Unaudited regular expression new RegExp("<Diagram", "g")',
    ],
    [
      "export const parse = (rawText: string) => rawText.match(/^\\d{4}-\\d{2}-\\d{2}$/u);",
      "over raw svx source",
    ],
  ])("rejects %s", (source, message) => {
    const result = lintSource(source);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(message);
  });

  it("accepts an audited expression over a parsed value", () => {
    const result = lintSource(
      "export const heading = (tagName: string) => /^h[1-6]$/u.test(tagName);"
    );

    expect(result.output).not.toContain(rule);
    expect(result.status).toBe(0);
  });
});
