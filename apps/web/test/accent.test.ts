import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

const allowed = new Set(["focus"]);

const pink = /#(?:ff1493|c8006e)\b/giu;

const violations = (file: string, source: string) => {
  if (file.endsWith("tokens.stylex.ts")) {
    return [];
  }

  const raw = [...source.matchAll(pink)].map(
    (match) => `${file}: raw ${match[0]}`
  );

  const usages = [
    ...source.matchAll(/\baccent\.(?:accent|accentText)\b/gu),
  ].flatMap((match) => {
    const preceding = source.slice(0, match.index);
    const names = [...preceding.matchAll(/^ {2}(?<name>\w+): \{/gmu)];
    const name = names.at(-1)?.groups?.name ?? "outside-style";

    return allowed.has(name) ? [] : [`${file}: ${name}`];
  });

  return [...raw, ...usages];
};

it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))(
  "browser accent",
  (test) => {
    test.effect(
      "limits pink to the token file and allowed StyleX recipes",
      () =>
        Effect.gen(function* checkAccent() {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const root = yield* path.fromFileUrl(
            new URL("../src/", import.meta.url)
          );

          const files = yield* fs.readDirectory(root, { recursive: true });

          const found = yield* Effect.forEach(
            files.filter((file) => /\.(?:ts|css)$/u.test(file)),
            (file) =>
              fs
                .readFileString(path.join(root, file))
                .pipe(Effect.map((source) => violations(file, source)))
          );

          expect(found.flat()).toEqual([]);
        })
    );
  }
);

it("rejects an accent on a link and a raw pink outside tokens", () => {
  expect(
    violations(
      "chrome.stylex.ts",
      "  link: {\n    color: accent.accentText,\n  }"
    )
  ).toEqual(["chrome.stylex.ts: link"]);
  expect(violations("view.ts", "const color = '#ff1493';")).toEqual([
    "view.ts: raw #ff1493",
  ]);
});
