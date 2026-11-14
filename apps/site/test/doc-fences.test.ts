// @effect-diagnostics nodeBuiltinImport:off -- The seam test writes a planted fence module and runs the real effect-tsrs checker on it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.js";
import {
  assertPublishedFencesChecked,
  docFenceModule,
  docFences,
} from "../scripts/doc-fences.ts";
import type { DocFence } from "../scripts/doc-fences.ts";

const pin = "a".repeat(40);

const FenceKind = Schema.Literals([
  "ts",
  "typescript",
  "tsx",
  "titled-ts",
  "nocheck-ts",
  "reference-ts",
  "text",
  "sh",
  "nested-ts",
]);

const fenceSource = (kind: typeof FenceKind.Type, index: number) => {
  const body = `export const value${index} = ${index};`;

  switch (kind) {
    case "ts":
    case "typescript":
    case "tsx":
    case "text":
    case "sh": {
      return `\`\`\`${kind}\n${body}\n\`\`\``;
    }

    case "titled-ts": {
      return `\`\`\`ts title="value${index}.ts"\n${body}\n\`\`\``;
    }

    case "nocheck-ts": {
      return `\`\`\`ts nocheck="fragment ${index}"\n${body}\n\`\`\``;
    }

    case "reference-ts": {
      return `\`\`\`ts repo=rat-stack path=packages/core/src/index.ts at=${pin} lines=1-2\n\`\`\``;
    }

    case "nested-ts": {
      return `\`\`\`\`markdown\n\`\`\`ts\n${body}\n\`\`\`\n\`\`\`\``;
    }

    default: {
      return kind satisfies never;
    }
  }
};

interface ExpectedFence {
  readonly noCheck: string | undefined;
  readonly value: string;
}

const expected = (
  kind: typeof FenceKind.Type,
  index: number
): readonly ExpectedFence[] => {
  const value = `export const value${index} = ${index};`;

  switch (kind) {
    case "ts":
    case "typescript":
    case "titled-ts":
    case "tsx": {
      return [{ noCheck: undefined, value }];
    }

    case "nocheck-ts": {
      return [{ noCheck: `fragment ${index}`, value }];
    }

    case "reference-ts":
    case "text":
    case "sh":
    case "nested-ts": {
      return [];
    }

    default: {
      return kind satisfies never;
    }
  }
};

const fenceKinds = Arbitrary.array(Arbitrary.schema(FenceKind), {
  maxLength: 8,
});

const fence = (): DocFence => ({
  language: "typescript",
  line: 1,
  noCheck: undefined,
  sourcePath: "page.svx",
  value: "export {};",
});

describe("doc fence extraction", () => {
  it.effect.prop(
    "rejects agent output with a TypeScript fence no source fence produced",
    { known: Arbitrary.schema(Schema.Boolean) },
    ({ known }) =>
      Effect.gen(function* publishedFences() {
        const value = "export const published = 1;";
        const text = `# Page\n\n\`\`\`typescript\n${value}\n\`\`\`\n`;

        const check = assertPublishedFencesChecked(
          [{ routePath: "/lore/page", text }],
          known ? [{ ...fence(), value }] : [],
          new Set()
        );

        if (known) {
          yield* check;

          return;
        }

        const failure = yield* Effect.flip(check);
        expect(failure.message).toContain("/lore/page");
        expect(fenceMessage(failure.message)).toBeDefined();
      })
  );

  it.effect.prop(
    "extracts every TypeScript fence a page publishes, and only those",
    { kinds: fenceKinds },
    ({ kinds }) =>
      Effect.gen(function* extraction() {
        const source = [
          "# Page",
          ...kinds.map((kind, index) => fenceSource(kind, index)),
        ].join("\n\n");

        const fences = yield* docFences("page.svx", source);

        expect(
          fences.map(({ noCheck, value }) => ({ noCheck, value }))
        ).toEqual(kinds.flatMap((kind, index) => expected(kind, index)));
      })
  );
});

const siteRoot = path.resolve(import.meta.dirname, "..");

const checker = path.resolve(siteRoot, "../../node_modules/.bin/effect-tsrs");

const typecheckFence = (value: string) => {
  const directory = mkdtempSync(path.join(siteRoot, "dist/doc-fence-plant-"));

  const module = docFenceModule({
    language: "typescript",
    line: 7,
    noCheck: undefined,
    sourcePath: ".brain/resources/lore/planted.svx",
    value,
  });

  const file = path.join(directory, module.path);

  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, module.text);
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(siteRoot, "tsconfig.doc-fences.json"),
        include: [path.join(directory, "**/*.ts")],
      })
    );

    return spawnSync(
      checker,
      [
        "diagnostics",
        "--project",
        path.join(directory, "tsconfig.json"),
        "--strict",
        "--type-check",
      ],
      { cwd: siteRoot, encoding: "utf-8" }
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("doc fence typecheck", () => {
  it("fails a planted broken fence and names its source and line", () => {
    const result = typecheckFence(
      'import { Effect } from "effect";\n\nexport const answer: number = Effect.succeed("42");'
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(
      "_brain/resources/lore/planted.svx/L7.ts"
    );
  });

  it("passes the same fence once it compiles", () => {
    const result = typecheckFence(
      'import { Effect } from "effect";\n\nexport const answer = Effect.succeed(42);'
    );

    expect(result.stdout + result.stderr).toContain("1 files checked");
    expect(result.stdout + result.stderr).toContain("0 TypeScript diagnostics");
    expect(result.status).toBe(0);
  });
});
