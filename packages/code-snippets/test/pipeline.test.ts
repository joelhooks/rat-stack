import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import {
  CodeBuildFailed,
  Drift,
  Highlighter,
  HighlightFault,
  SourceRepository,
  codeContentKey,
  decodeRepositories,
  formatCodeError,
  parseCodeRequest,
  prepareCode,
  printCodeRequest,
  renderCode,
} from "../src/index.ts";
import type { CodeFence, Range, Token } from "../src/index.ts";
import { plainLayer } from "../src/plain.ts";

const sha = "a".repeat(40);

const path = "example.ts";

const rows = Array.from({ length: 48 }, (_, index) => `line ${index + 1}`);

const repositories = [
  {
    adapter: "git",
    id: "rat-stack",
    linkTemplate: "https://example.test/{sha}/{path}#L{start}-L{end}",
    location: ".",
  },
];

const blobs = new Map([[`rat-stack:${sha}:${path}`, rows.join("\n")]]);

const layer = Layer.mergeAll(
  SourceRepository.memory(repositories, blobs),
  plainLayer(),
  Drift.silent
);

const fence = (
  meta = `repo=rat-stack path=${path} at=${sha} lines=2-4`,
  value = "",
  lang = "ts"
): CodeFence => ({ lang, line: 7, meta, value });

const compile = Effect.fn("compileTestFence")(function* compile(
  node: CodeFence
) {
  return yield* renderCode(yield* parseCodeRequest(node, "page.svx"));
});

const prefix = (
  tag: string,
  repo = "rat-stack",
  file = path,
  commit = sha,
  ranges = "2-4"
) => `page.svx:7 [${tag}] ${repo}:${file}@${commit} lines=${ranges}; `;

const messageCases = [
  {
    expected: `${prefix("CodeInvalidProps", "rat-stack", "<inline>", "<inline>", "all")}Add path for a pinned reference, or remove repo/at/lines.`,
    node: fence("repo=rat-stack"),
    tag: "CodeInvalidProps",
  },
  {
    expected: `${prefix("CodeUnknownRepo", "other")}Use an id from the configured repository registry.`,
    node: fence(`repo=other path=${path} at=${sha} lines=2-4`),
    tag: "CodeUnknownRepo",
  },
  {
    expected: `${prefix("CodeMissingCommit", "rat-stack", path, "b".repeat(40))}Commit ${"b".repeat(40)} isn't in rat-stack's local objects. Run pnpm sources:fetch (template children: once, after creating the repo).`,
    node: fence(`path=${path} at=${"b".repeat(40)} lines=2-4`),
    tag: "CodeMissingCommit",
  },
  {
    expected: `${prefix("CodeMissingPath", "rat-stack", "missing.ts")}File is not a blob at this commit; correct path or at.`,
    node: fence(`path=missing.ts at=${sha} lines=2-4`),
    tag: "CodeMissingPath",
  },
  {
    expected: `${prefix("CodeRangeOutOfBounds", "rat-stack", path, sha, "40-62")}File has 48 lines; range 40-62 ends past it. Choose lines within the file.`,
    node: fence(`path=${path} at=${sha} lines=40-62`),
    tag: "CodeRangeOutOfBounds",
  },
  {
    expected: `${prefix("CodeInvalidRanges", "rat-stack", path, sha, "4-6,5-7")}Order lines without overlaps, such as 3,5-7.`,
    node: fence(`path=${path} at=${sha} lines=4-6,5-7`),
    tag: "CodeInvalidRanges",
  },
  {
    expected: `${prefix("CodeHighlightOutsideRanges")}Highlighted line 5 is not shown; highlight only visible lines.`,
    node: fence(`path=${path} at=${sha} lines=2-4 {5}`),
    tag: "CodeHighlightOutsideRanges",
  },
  {
    expected: `${prefix("UnknownLanguage")}Unknown language nonexistent; use an active-engine language or explicit text.`,
    node: fence(undefined, "", "nonexistent"),
    tag: "UnknownLanguage",
  },
  {
    expected: `${prefix("CodeLineCapExceeded", "rat-stack", path, sha, "1-26")}26 visible lines exceeds the 25-line cap; choose a shorter excerpt.`,
    node: fence(`path=${path} at=${sha} lines=1-26`),
    tag: "CodeLineCapExceeded",
  },
  {
    expected: `${prefix("CodeUnknownKey", "rat-stack", "<inline>", "<inline>", "all")}Unknown key bogus; use repo, path, at, lines or title.`,
    node: fence("bogus=yes"),
    tag: "CodeUnknownKey",
  },
  {
    expected: `${prefix("CodeDuplicateKey", "rat-stack", "<inline>", "<inline>", "all")}Remove duplicate title.`,
    node: fence("title=a title=b"),
    tag: "CodeDuplicateKey",
  },
  {
    expected: `${prefix("CodeMalformedMeta", "rat-stack", "<inline>", "<inline>", "all")}Close the highlight set with }.`,
    node: fence("{3"),
    tag: "CodeMalformedMeta",
  },
  {
    expected: `${prefix("CodeBodyWithReference")}Remove the fence body; path references read their content from Git.`,
    node: fence(undefined, "copied code"),
    tag: "CodeBodyWithReference",
  },
];

for (const example of messageCases) {
  it.effect(`renders exact ${example.tag} repair message`, () =>
    Effect.gen(function* exactMessage() {
      const error = yield* compile(example.node).pipe(Effect.flip);
      expect(error._tag).toBe(example.tag);
      expect(formatCodeError(error)).toBe(example.expected);
    }).pipe(Effect.provide(layer))
  );
}

it.effect("renders exact CodeSourceUnavailable repair message", () =>
  Effect.gen(function* unavailableMessage() {
    const error = yield* compile(fence()).pipe(Effect.flip);
    expect(formatCodeError(error)).toBe(
      `${prefix("CodeSourceUnavailable")}Git objects are unavailable; run pnpm sources:fetch or use a full clone containing the pinned history.`
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        SourceRepository.memory(repositories, blobs, true),
        plainLayer(),
        Drift.silent
      )
    )
  )
);

const brokenEngine = Layer.succeed(
  Highlighter,
  Highlighter.of({
    aliases: () => ({}),
    fingerprint: "broken",
    languages: () => ["typescript"],
    themes: () => ["none"],
    tokens: () => Effect.fail(new HighlightFault({ kind: "render" })),
  })
);

it.effect("renders exact CodeHighlightFailed repair message", () =>
  Effect.gen(function* failedHighlighterMessage() {
    const error = yield* compile(fence()).pipe(Effect.flip);
    expect(formatCodeError(error)).toBe(
      `${prefix("CodeHighlightFailed")}Highlighter could not tokenize this file; check the language and source encoding.`
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        SourceRepository.memory(repositories, blobs),
        brokenEngine,
        Drift.silent
      )
    )
  )
);

it.effect("renders exact bad-config repair message", () =>
  Effect.gen(function* configMessage() {
    const error = yield* decodeRepositories([{ id: "only-id" }]).pipe(
      Effect.flip
    );

    expect(error.message).toBe(
      "[CodeRepositoryConfigInvalid] Configure repositories as {id, adapter, location, linkTemplate?}."
    );
  })
);

const options = { arbitrary: { runs: 40, size: 16 } };

const small = Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }));

const text = Schema.String.check(Schema.isMaxLength(30));

const data = {
  highlights: Schema.Array(Schema.Boolean),
  lines: Schema.Array(text).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(25)
  ),
  selected: Schema.Array(Schema.Boolean),
};

it.effect.prop(
  "P1 canonical requests round-trip through fence metadata",
  {
    length: small,
    single: Schema.Boolean,
    start: small,
    title: text,
  },
  ({ start, length, single, title }) =>
    Effect.gen(function* roundTrip() {
      let ranges = `${start}-${start + length}`;

      if (single) {
        ranges = String(start).padStart(2, "0");
      }

      const lines = `lines=${JSON.stringify(ranges)}`;

      const original = yield* parseCodeRequest(
        fence(
          `repo=${JSON.stringify(`repo ${title}`)} path=${path} at=${sha} ${lines} {${start}} title=${JSON.stringify(title || "Code")}`
        ),
        "page.svx"
      );

      const decoded = yield* parseCodeRequest(
        printCodeRequest(original),
        "page.svx"
      );

      expect(decoded).toEqual(original);
    }),
  options
);

it.effect.prop(
  "P2 arbitrary metadata always succeeds or fails with a typed error",
  { meta: Schema.String },
  ({ meta }) =>
    Effect.gen(function* scannerTotality() {
      const result = yield* parseCodeRequest(fence(meta), "page.svx").pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "success",
        })
      );

      expect([
        "success",
        "CodeInvalidProps",
        "CodeBodyWithReference",
        "CodeInvalidRanges",
        "CodeMalformedMeta",
        "CodeDuplicateKey",
        "CodeUnknownKey",
      ]).toContain(result);
    }),
  options
);

it.effect.prop(
  "P3 out-of-bounds lines are rejected rather than clamped",
  { extra: small },
  ({ extra }) =>
    Effect.gen(function* bounds() {
      const error = yield* compile(
        fence(`path=${path} at=${sha} lines=48-${48 + extra}`)
      ).pipe(Effect.flip);

      expect(error._tag).toBe("CodeRangeOutOfBounds");
      expect(error.actualLength).toBe(48);
    }).pipe(Effect.provide(layer)),
  options
);

const rangesFor = (numbers: readonly number[]): readonly Range[] => {
  const ranges: { start: number; end: number }[] = [];

  for (const number of numbers) {
    const previous = ranges.at(-1);

    if (previous !== undefined && previous.end + 1 === number) {
      previous.end = number;
    } else {
      ranges.push({ end: number, start: number });
    }
  }

  return ranges;
};

const model = (
  lines: readonly string[],
  visible: readonly number[],
  highlighted: ReadonlySet<number>
) =>
  visible.map((number, index) => ({
    gapBefore: index === 0 ? 0 : number - (visible[index - 1] ?? number) - 1,
    highlighted: highlighted.has(number),
    number,
    text: lines[number - 1],
  }));

it.effect.prop(
  "P4 plain-array model agrees with ranges, gaps, highlights and source text",
  data,
  ({ lines, selected, highlights }) =>
    Effect.gen(function* referenceModel() {
      const source = lines.map((line) =>
        line.replaceAll("\n", " ").replaceAll("\r", " ")
      );

      const visible = source.flatMap((_, index) =>
        selected[index % Math.max(1, selected.length)] === true
          ? [index + 1]
          : []
      );

      if (visible.length === 0) {
        visible.push(1);
      }

      const highlighted = visible.filter(
        (number) =>
          highlights[(number - 1) % Math.max(1, highlights.length)] === true
      );

      const rangeText = rangesFor(visible)
        .map((range) => `${range.start}-${range.end}`)
        .join(",");

      const highlightText =
        highlighted.length === 0 ? "" : ` {${highlighted.join(",")}}`;

      const request = yield* parseCodeRequest(
        fence(`path=${path} at=${sha} lines=${rangeText}${highlightText}`),
        "page.svx"
      );

      const result = yield* renderCode(request).pipe(
        Effect.provide(
          Layer.mergeAll(
            SourceRepository.memory(
              repositories,
              new Map([[`rat-stack:${sha}:${path}`, `${source.join("\n")}\n`]])
            ),
            plainLayer(),
            Drift.silent
          )
        )
      );

      expect(
        result.snippet.lines.map(
          ({ number, text: value, highlighted: marked, gapBefore }) => ({
            gapBefore,
            highlighted: marked,
            number,
            text: value,
          })
        )
      ).toEqual(model(source, visible, new Set(highlighted)));
      expect(
        result.snippet.lines.flatMap((line) =>
          line.tokens.map((token) => token.text).join("")
        )
      ).toEqual(visible.map((number) => source[number - 1]));
    }),
  options
);

it.effect("engine port rejects missing and changed source tokens", () =>
  Effect.gen(function* tokenBoundary() {
    const request = yield* parseCodeRequest(fence(), "page.svx");
    const token: Token = { fontStyle: 0, role: "ink", text: "changed" };
    const outputs = [[], Array.from({ length: rows.length }, () => [token])];

    for (const tokens of outputs) {
      const highlighter = Highlighter.of({
        aliases: () => ({}),
        fingerprint: "broken@1",
        languages: () => ["typescript"],
        themes: () => ["none"],
        tokens: () => Effect.succeed(tokens),
      });

      const error = yield* renderCode(request).pipe(
        Effect.provideService(Highlighter, highlighter),
        Effect.flip
      );

      expect(error._tag).toBe("CodeHighlightFailed");
      expect(error.fix).toBe(
        "Highlighter did not preserve source line 2; check the engine adapter token output."
      );
    }
  }).pipe(Effect.provide(layer))
);

it.effect.prop(
  "P7 independent failures all report before asset emission",
  { count: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })) },
  ({ count }) =>
    Effect.gen(function* accumulation() {
      let written = 0;

      const jobs = Array.from({ length: count }, (_, index) => ({
        node: fence(`repo=missing${index} path=${path} at=${sha} lines=2-4`),
        sourcePath: `page${index}.svx`,
      }));

      const error = yield* prepareCode(jobs).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            written += 1;
          })
        ),
        Effect.flip
      );

      expect(error).toBeInstanceOf(CodeBuildFailed);
      expect(error.messages).toHaveLength(count);
      expect(error.failures?.map((failure) => failure._tag)).toEqual(
        Array.from({ length: count }, () => "CodeUnknownRepo")
      );
      expect(written).toBe(0);
    }).pipe(Effect.provide(layer)),
  options
);

it.effect.prop(
  "P8 repeated rendering and canonical cache keys are deterministic",
  { start: small, title: text },
  ({ start, title }) =>
    Effect.gen(function* determinism() {
      const request = yield* parseCodeRequest(
        fence(
          `path=${path} at=${sha} lines=${start}-${start + 2} title=${JSON.stringify(title || "Code")}`
        ),
        "page.svx"
      );

      const first = yield* renderCode(request);
      const second = yield* renderCode(request);
      expect(JSON.stringify(first.snippet)).toBe(
        JSON.stringify(second.snippet)
      );
      expect(codeContentKey(request, "", "plain@1:none")).toBe(
        codeContentKey(request, "", "plain@1:none")
      );
      expect(codeContentKey(request, "", "plain@1:none")).not.toBe(
        codeContentKey(request, "", "different-engine")
      );
    }).pipe(Effect.provide(layer)),
  options
);

it.effect(
  "explicit language wins, missing language infers extension then markdown",
  () =>
    Effect.gen(function* languages() {
      expect(
        (yield* parseCodeRequest(
          fence(undefined, "", "javascript"),
          "page.svx"
        )).language
      ).toBe("javascript");
      expect(
        (yield* parseCodeRequest(fence(undefined, "", ""), "page.svx")).language
      ).toBe("typescript");
      expect(
        (yield* parseCodeRequest(
          fence(`path=unknown.xyz at=${sha} lines=1`, "", ""),
          "page.svx"
        )).language
      ).toBe("markdown");
      expect(
        (yield* parseCodeRequest({ line: 1, value: "# heading" }, "page.svx"))
          .language
      ).toBe("markdown");
    })
);
