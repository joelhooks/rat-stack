import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { expect } from "vitest";

import { sourceRegexViolations } from "../scripts/source-regex-policy.ts";

it.effect("keeps svx syntax out of the regular-expression utilities", () =>
  Effect.gen(function* checkSourceRegexPolicy() {
    const fileSystem = yield* FileSystem.FileSystem;

    for (const fileName of ["content-lib.ts", "generate-content.ts"]) {
      const file = new URL(`../scripts/${fileName}`, import.meta.url).pathname;
      const source = yield* fileSystem.readFileString(file);
      expect(sourceRegexViolations(source, fileName)).toEqual([]);
    }
  }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("rejects a planted component or link regex over source", () =>
  Effect.sync(() => {
    for (const source of [
      "const parse = rawText => /<AgentOnly>(.*?)<\\/AgentOnly>/gu.exec(rawText);",
      "const links = source => /\\[.+\\]\\((.+)\\)/gu.exec(source);",
      'const parse = source => new RegExp("<Diagram", "g").test(source);',
      "const parse = rawText => rawText.match(/^\\d{4}-\\d{2}-\\d{2}$/u);",
    ]) {
      expect(sourceRegexViolations(source, "content-lib.ts")).not.toEqual([]);
    }
  })
);
