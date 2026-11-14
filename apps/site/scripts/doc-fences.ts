import {
  normalizeCodeLanguage,
  parseCodeRequest,
} from "@rat-stack/code-snippets";
import type { CodeSnippet } from "@rat-stack/code-snippets";
import { Effect, FileSystem, Path, Schema } from "effect";

import { collectCodeFences } from "./code-pipeline.ts";
import { buildError, ContentBuildError, violation } from "./content-error.ts";

export const docFenceDirectory = "apps/site/dist/doc-fences";

const typeScriptLanguages = new Set(["typescript", "tsx", "mts", "cts"]);

export interface DocFence {
  readonly language: string;
  readonly line: number;
  readonly noCheck: string | undefined;
  readonly sourcePath: string;
  readonly value: string;
}

export const docFences = Effect.fn("docFences")(function* docFences(
  sourcePath: string,
  source: string
) {
  const fences: DocFence[] = [];

  for (const node of collectCodeFences(source, sourcePath)) {
    const request = yield* parseCodeRequest(node, sourcePath).pipe(
      Effect.mapError((cause) => buildError("doc fence", sourcePath, cause))
    );

    if (typeScriptLanguages.has(request.language) && !request.reference) {
      fences.push({
        language: request.language,
        line: node.line,
        noCheck: request.noCheck,
        sourcePath,
        value: node.value,
      });
    }
  }

  return fences;
});

const moduleExtension = (language: string) =>
  language === "typescript" ? "ts" : language;

const visibleSegment = (segment: string) =>
  segment.startsWith(".") ? `_${segment.slice(1)}` : segment;

const modulePath = (sourcePath: string) =>
  sourcePath.split("/").map(visibleSegment).join("/");

export const docFenceModule = (fence: DocFence) => ({
  path: `${docFenceDirectory}/${modulePath(fence.sourcePath)}/L${fence.line}.${moduleExtension(fence.language)}`,
  text: `${fence.value}\n\nexport {};\n`,
});

const located = (fences: readonly DocFence[]) =>
  fences.map((fence) => `${fence.sourcePath}:${fence.line}`).join(", ");

export const reportDocFenceOptOuts = (fences: readonly DocFence[]) => {
  const optOuts = fences.filter((fence) => fence.noCheck !== undefined);

  return optOuts.length === 0
    ? Effect.void
    : Effect.logInfo(
        `${optOuts.length} TypeScript fences opt out of the doc typecheck: ${located(optOuts)}.`
      );
};

const fenceBody = (text: string) => text.trimEnd();

export const referenceBodies = (snippets: Iterable<CodeSnippet>) =>
  new Set(
    [...snippets].flatMap((snippet) =>
      snippet.request.reference
        ? [fenceBody(snippet.lines.map((line) => line.text).join("\n"))]
        : []
    )
  );

const outputFences = (routePath: string, text: string) =>
  collectCodeFences(text, routePath).filter((node) =>
    typeScriptLanguages.has(normalizeCodeLanguage(node.lang ?? ""))
  );

export const assertPublishedFencesChecked = (
  published: readonly { readonly routePath: string; readonly text: string }[],
  authored: readonly DocFence[],
  references: ReadonlySet<string>
) => {
  const known = new Set([
    ...references,
    ...authored.map((fence) => fenceBody(fence.value)),
  ]);

  const [first] = published.flatMap((page) =>
    outputFences(page.routePath, page.text)
      .filter((fence) => !known.has(fenceBody(fence.value)))
      .map((fence) => ({ line: fence.line, routePath: page.routePath }))
  );

  return first === undefined
    ? Effect.void
    : Effect.fail(
        buildError(
          "doc fence output",
          first.routePath,
          violation(
            `${first.routePath} publishes a TypeScript fence at line ${first.line} that no checked source fence produced.`,
            "Every TypeScript example in the agent Markdown and llms.txt output must typecheck or carry a recorded opt-out.",
            "author the example as a fence in the page source so `apps/site/dist/doc-fences` picks it up, or quote real code with `path=`."
          )
        )
      );
};

export interface DocFenceSources {
  readonly published: readonly {
    readonly routePath: string;
    readonly sourcePath: string;
    readonly text: string;
  }[];
  readonly references: ReadonlySet<string>;
  readonly root: string;
}

export const writeDocFences = Effect.fn("writeDocFences")(
  function* writeDocFences(sources: DocFenceSources) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sourcePaths = [
      ...new Set(sources.published.map((page) => page.sourcePath)),
    ].toSorted();

    const readDocFences = (sourcePath: string) =>
      Effect.gen(function* readSourceFences() {
        const absolute = path.join(sources.root, sourcePath);

        const file =
          sourcePath !== "" &&
          (yield* fileSystem.exists(absolute)) &&
          (yield* fileSystem.stat(absolute)).type === "File";

        return file
          ? yield* docFences(
              sourcePath,
              yield* fileSystem.readFileString(absolute)
            )
          : [];
      }).pipe(
        Effect.mapError((cause) =>
          Schema.is(ContentBuildError)(cause)
            ? cause
            : buildError("doc fence read", sourcePath, cause)
        )
      );

    const authored = (yield* Effect.forEach(
      sourcePaths.values(),
      readDocFences
    )).flat();

    yield* reportDocFenceOptOuts(authored);
    yield* assertPublishedFencesChecked(
      sources.published,
      authored,
      sources.references
    );

    const directory = path.join(sources.root, docFenceDirectory);

    yield* fileSystem
      .remove(directory, { force: true, recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          buildError("doc fence clean", docFenceDirectory, cause)
        )
      );

    const checked = authored.filter((fence) => fence.noCheck === undefined);

    const writeModule = (fence: DocFence) => {
      const module = docFenceModule(fence);
      const target = path.join(sources.root, module.path);

      return fileSystem
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(
          Effect.andThen(fileSystem.writeFileString(target, module.text)),
          Effect.mapError((cause) =>
            buildError("doc fence write", module.path, cause)
          )
        );
    };

    yield* Effect.forEach(checked.values(), writeModule);

    yield* Effect.logInfo(
      `Doc fences: ${checked.length} typechecked, ${authored.length - checked.length} opted out`
    );
  }
);
