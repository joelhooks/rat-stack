import { Effect, Schema } from "effect";

import {
  CodeBuildFailed,
  CodeHighlightFailed,
  CodeHighlightOutsideRanges,
  CodeLineCapExceeded,
  CodeMissingCommit,
  CodeMissingPath,
  CodeRangeOutOfBounds,
  CodeSourceUnavailable,
  CodeUnknownRepo,
  UnknownLanguage,
  formatCodeError,
} from "./errors.ts";
import type { CodeError } from "./errors.ts";
import {
  CodeRequest,
  codeIdentity,
  codeLineCap,
  errorContext,
  sourceLines,
} from "./model.ts";
import type { CodeFence, Range, SnippetLine } from "./model.ts";
import { Drift, Highlighter, SourceRepository, sourceLink } from "./ports.ts";
import type { Diagnostics } from "./ports.ts";
import { parseCodeRequest } from "./scanner.ts";
import { CodeSnippet } from "./stages/code-snippet.ts";
import { HighlightedFile } from "./stages/highlighted-file.ts";
import { ResolvedCode } from "./stages/resolved-code.ts";

export const codeContentKey = (
  request: CodeRequest,
  source: string,
  fingerprint: string
) =>
  JSON.stringify([
    request.repo,
    request.commit,
    request.path,
    request.reference ? "" : source,
    request.ranges,
    request.highlights,
    request.language,
    request.title,
    fingerprint,
  ]);

export interface FenceJob {
  readonly node: CodeFence;
  readonly sourcePath: string;
}

export const shownLineNumbers = (ranges: readonly Range[]) =>
  ranges.flatMap((range) =>
    Array.from(
      { length: range.end - range.start + 1 },
      (_, index) => range.start + index
    )
  );

const sourceFailure = (
  request: CodeRequest,
  kind: "repo" | "commit" | "path" | "unavailable"
) => {
  if (kind === "repo") {
    return new CodeUnknownRepo(
      errorContext(
        request,
        "Use an id from the configured repository registry."
      )
    );
  }

  if (kind === "commit") {
    return new CodeMissingCommit(
      errorContext(
        request,
        `Commit ${request.commit} isn't in ${request.repo}'s local objects. Run pnpm sources:fetch (template children: once, after creating the repo).`
      )
    );
  }

  if (kind === "path") {
    return new CodeMissingPath(
      errorContext(
        request,
        "File is not a blob at this commit; correct path or at."
      )
    );
  }

  return new CodeSourceUnavailable(
    errorContext(
      request,
      "Git objects are unavailable; run pnpm sources:fetch or use a full clone containing the pinned history."
    )
  );
};

const resolveCode = Effect.fn("resolveCode")(function* resolveCode(
  request: CodeRequest
) {
  const mirror = yield* SourceRepository;

  const source = request.reference
    ? yield* mirror
        .resolve(request.repo, request.commit, request.path)
        .pipe(Effect.mapError((error) => sourceFailure(request, error.kind)))
    : request.body;

  const actualLength = sourceLines(source).length;

  const ranges = request.reference
    ? request.ranges
    : [{ end: actualLength, start: 1 }];

  for (const range of ranges) {
    if (range.end > actualLength || range.start > actualLength) {
      return yield* new CodeRangeOutOfBounds(
        errorContext(
          request,
          `File has ${actualLength} lines; range ${range.start}-${range.end} ends past it. Choose lines within the file.`,
          actualLength
        )
      );
    }
  }

  const visibleCount = ranges.reduce(
    (count, range) => count + range.end - range.start + 1,
    0
  );

  if (request.configured && visibleCount > codeLineCap) {
    return yield* new CodeLineCapExceeded(
      errorContext(
        request,
        `${visibleCount} visible lines exceeds the ${codeLineCap}-line cap; choose a shorter excerpt.`,
        actualLength
      )
    );
  }

  const visible = shownLineNumbers(ranges);
  const visibleSet = new Set(visible);

  for (const range of request.highlights) {
    for (let line = range.start; line <= range.end; line += 1) {
      if (!visibleSet.has(line)) {
        return yield* new CodeHighlightOutsideRanges(
          errorContext(
            request,
            `Highlighted line ${line} is not shown; highlight only visible lines.`,
            actualLength
          )
        );
      }
    }
  }

  return new ResolvedCode({
    actualLength,
    request: new CodeRequest({
      body: request.body,
      commit: request.commit,
      configured: request.configured,
      highlights: request.highlights,
      language: request.language,
      line: request.line,
      path: request.path,
      rangeText: request.rangeText,
      ranges,
      reference: request.reference,
      repo: request.repo,
      sourcePath: request.sourcePath,
      title: request.title,
    }),
    source,
  });
});

export const decorateCode = Effect.fn("decorateCode")(function* decorateCode(
  file: HighlightedFile,
  url?: string
) {
  const { request, source } = file.resolved;
  const original = sourceLines(source);
  const visible = shownLineNumbers(request.ranges);
  const highlighted = new Set(shownLineNumbers(request.highlights));
  const lines: (typeof SnippetLine.Type)[] = [];
  let previous = 0;

  for (const number of visible) {
    const text = original[number - 1];
    const tokens = file.tokens[number - 1];

    if (
      text === undefined ||
      tokens === undefined ||
      tokens.map((token) => token.text).join("") !== text
    ) {
      return yield* new CodeHighlightFailed(
        errorContext(
          request,
          `Highlighter did not preserve source line ${number}; check the engine adapter token output.`,
          file.resolved.actualLength
        )
      );
    }

    lines.push({
      gapBefore: previous === 0 ? 0 : number - previous - 1,
      highlighted: highlighted.has(number),
      number,
      text,
      tokens,
    });
    previous = number;
  }

  return new CodeSnippet({ lines, request, url: url ?? "" });
});

export const renderCode = Effect.fn("renderCode")(function* renderCode(
  request: CodeRequest
) {
  const highlighter = yield* Highlighter;
  const drift = yield* Drift;
  const resolved = yield* resolveCode(request);

  const canonicalLanguage =
    highlighter.aliases()[request.language] ?? request.language;

  if (!highlighter.languages().includes(canonicalLanguage)) {
    return yield* new UnknownLanguage(
      errorContext(
        request,
        `Unknown language ${request.language}; use an active-engine language or explicit text.`,
        resolved.actualLength
      )
    );
  }

  const repository = yield* SourceRepository;

  const tokens = yield* highlighter
    .tokens(
      resolved.source,
      canonicalLanguage,
      request.reference
        ? JSON.stringify([request.repo, request.commit, request.path])
        : resolved.source
    )
    .pipe(
      Effect.mapError((error) =>
        error.kind === "language"
          ? new UnknownLanguage(
              errorContext(
                request,
                `Unknown language ${request.language}; use an active-engine language or explicit text.`,
                resolved.actualLength
              )
            )
          : new CodeHighlightFailed(
              errorContext(
                request,
                "Highlighter could not tokenize this file; check the language and source encoding.",
                resolved.actualLength
              )
            )
      )
    );

  const file = yield* Schema.decodeEffect(HighlightedFile)({
    resolved,
    tokens,
  }).pipe(
    Effect.mapError(
      () =>
        new CodeHighlightFailed(
          errorContext(
            request,
            "Highlighter returned invalid tokens; check the active engine version.",
            resolved.actualLength
          )
        )
    )
  );

  return {
    diagnostics: yield* drift.check(request, resolved.source),
    snippet: yield* decorateCode(
      file,
      sourceLink(
        repository.repositories.find((entry) => entry.id === request.repo),
        file.resolved.request
      )
    ),
  };
});

export const prepareCode = Effect.fn("prepareCode")(function* prepareCode(
  jobs: readonly FenceJob[]
) {
  const snippets = new Map<string, CodeSnippet>();
  const renderCache = new Map<string, CodeSnippet>();
  const diagnostics: Diagnostics[] = [];
  yield* Effect.validate(jobs, ({ node, sourcePath }) =>
    Effect.gen(function* validateFence() {
      const request = yield* parseCodeRequest(node, sourcePath);
      const highlighter = yield* Highlighter;

      const canonicalLanguage =
        highlighter.aliases()[request.language] ?? request.language;

      if (!request.configured) {
        if (!highlighter.languages().includes(canonicalLanguage)) {
          return yield* new UnknownLanguage(
            errorContext(
              request,
              `Unknown language ${request.language}; use an active-engine language or explicit text.`
            )
          );
        }

        yield* highlighter
          .tokens(request.body, canonicalLanguage, request.body)
          .pipe(
            Effect.mapError(
              () =>
                new CodeHighlightFailed(
                  errorContext(
                    request,
                    "Highlighter could not load this grammar; check the pinned engine version."
                  )
                )
            )
          );

        return null;
      }

      const { snippet, diagnostics: warnings } = yield* renderCode(request);

      const key = codeContentKey(
        snippet.request,
        request.body,
        highlighter.fingerprint
      );

      const cached = renderCache.get(key) ?? snippet;
      renderCache.set(key, cached);
      snippets.set(codeIdentity(node), cached);
      diagnostics.push(...warnings);

      return null;
    })
  ).pipe(
    Effect.mapError(
      (errors: readonly CodeError[]) =>
        new CodeBuildFailed({
          failures: errors,
          messages: errors.map(formatCodeError),
        })
    )
  );

  return { diagnostics, snippets };
});
