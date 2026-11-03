import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const sourceDirectory = new URL("../src/", import.meta.url).pathname;

const IMPORT_SPECIFIER = /from\s+"(?<specifier>[^"]+)"/gu;

describe("vendoring", () => {
  it.layer(NodeFileSystem.layer)((test) => {
    test.effect(
      "the core modules import only each other and touch no browser global, so a consumer can vendor them",
      () =>
        Effect.gen(function* checkCoreModules() {
          const fileSystem = yield* FileSystem.FileSystem;

          const modules = (yield* fileSystem.readDirectory(sourceDirectory))
            .filter((name) => name.endsWith(".pure.ts"))
            .toSorted();

          expect(modules).toStrictEqual([
            "easing.pure.ts",
            "interpolate.pure.ts",
            "spring.pure.ts",
            "tween.pure.ts",
          ]);

          for (const name of modules) {
            const source = yield* fileSystem.readFileString(
              `${sourceDirectory}${name}`
            );

            const specifiers = Array.from(
              source.matchAll(IMPORT_SPECIFIER),
              (match) => match.groups?.specifier ?? ""
            );

            expect(
              specifiers.filter(
                (specifier) => !/^\.\/[a-z]+\.pure\.js$/u.test(specifier)
              )
            ).toStrictEqual([]);
            expect(source).not.toMatch(/\b(?:window|document|globalThis)\b/u);
          }
        })
    );
  });
});
