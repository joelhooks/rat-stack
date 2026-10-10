import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { buildError } from "./content-error.ts";

export const LEARN_SNIPPET_DIRECTORY = ".brain/data/learn-cards";

export interface LearnSnippet {
  readonly diagnostics: readonly string[];
  readonly id: string;
  readonly text: string;
}

const diagnosticLine =
  /^(?<file>[^(\n]+)\((?<line>\d+),(?<column>\d+)\): error (?<message>.+)$/u;

export const groupSnippetDiagnostics = (output: string) => {
  const byFile = new Map<string, string[]>();

  for (const line of output.split("\n")) {
    const match = diagnosticLine.exec(line.trim());

    if (match?.groups !== undefined) {
      const {
        column = "",
        file = "",
        line: row = "",
        message = "",
      } = match.groups;

      const name = file.split(/[\\/]/u).at(-1) ?? file;

      byFile.set(name, [
        ...(byFile.get(name) ?? []),
        `${row}:${column} ${message}`,
      ]);
    }
  }

  return byFile;
};

const snippetFailure = (cause: unknown) =>
  buildError("learn snippets", LEARN_SNIPPET_DIRECTORY, cause);

export const collectLearnSnippets = Effect.fn("collectLearnSnippets")(
  function* collectLearnSnippets(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const directory = path.join(root, LEARN_SNIPPET_DIRECTORY);

    const files = (yield* fs
      .readDirectory(directory)
      .pipe(Effect.mapError(snippetFailure)))
      .filter((file) => file.endsWith(".ts"))
      .toSorted();

    if (files.length === 0) {
      return [];
    }

    const tsconfig = path.join(directory, "tsconfig.json");

    const [output, exitCode] = yield* Effect.scoped(
      Effect.gen(function* compileSnippets() {
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            path.join(root, "node_modules/.bin/tsc"),
            ["--noEmit", "--pretty", "false", "-p", tsconfig],
            { cwd: root, stderr: "inherit" }
          )
        );

        return yield* Effect.all(
          [
            handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: 2 }
        );
      })
    ).pipe(Effect.mapError(snippetFailure));

    const diagnostics = groupSnippetDiagnostics(output);

    const unowned = [...diagnostics.keys()].filter(
      (file) => !files.includes(file)
    );

    if (exitCode !== 0 && (diagnostics.size === 0 || unowned.length > 0)) {
      return yield* buildError(
        "learn snippets",
        tsconfig,
        new Error(
          `tsc exited ${exitCode} without diagnostics in snippet files; run node_modules/.bin/tsc -p ${LEARN_SNIPPET_DIRECTORY}/tsconfig.json and fix the reported configuration error.\n${output}`
        )
      );
    }

    return yield* Effect.forEach((file: string) =>
      fs.readFileString(path.join(directory, file)).pipe(
        Effect.mapError(snippetFailure),
        Effect.map((text): LearnSnippet => ({
          diagnostics: diagnostics.get(file) ?? [],
          id: file.slice(0, -".ts".length),
          text: text.replace(/\n+$/u, ""),
        }))
      )
    )(files);
  }
);
