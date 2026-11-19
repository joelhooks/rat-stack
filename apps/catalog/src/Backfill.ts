import {
  backfillFile,
  decodeBackfillLine,
  sortBackfillFiles,
} from "@rat-stack/catalog/Backfill";
import type {
  BackfillCommand,
  BackfillFile,
} from "@rat-stack/catalog/Backfill";
import type { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { forEach as forEachEffect } from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export class BackfillInputError extends Schema.TaggedError<
  BackfillInputError,
  { readonly brand: unique symbol }
>()("BackfillInputError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const decodeBackfillDefect = Schema.decodeUnknownOption(
  Schema.instanceOf(Error)
);

const safeDefectName = Schema.decodeUnknownOption(
  Schema.Literals([
    "AbortError",
    "AggregateError",
    "Error",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TimeoutError",
    "TypeError",
  ])
);

const safeDefectMessage = Schema.decodeUnknownOption(
  Schema.Literals([
    "fetch failed",
    "terminated",
    "This operation was aborted",
    "The operation was aborted due to timeout",
    "Maximum call stack size exceeded",
    "Error decoding HTTP response",
    "HTTP response ended before RPC request completed",
    "Received empty HTTP response from RPC server",
  ])
);

const backfillDefectMessage = (defect: Error | undefined, location: string) => {
  const name = Option.getOrElse(safeDefectName(defect?.name), () =>
    defect === undefined ? "Defect" : "Error"
  );

  const detail = Option.getOrElse(
    safeDefectMessage(defect?.message),
    () => "Untrusted message withheld"
  );

  return `Backfill stopped unexpectedly ${location}. ${name}: ${detail}. Fix: check the summary and operator Api, then rerun from the earliest incomplete file with \`--from <file>\`.`;
};

export const backfillDefectAt = (location: string) =>
  Effect.catchDefect(
    (defect) =>
      new BackfillInputError({
        message: backfillDefectMessage(
          Option.getOrUndefined(decodeBackfillDefect(defect)),
          location
        ),
      })
  );

export const reportBackfillFailure = (error: BackfillInputError) =>
  Console.error(error.message);

export const listBackfillInputs = Effect.fnUntraced(
  function* listBackfillInputs(directory: string, from?: string) {
    const fs = yield* FileSystem.FileSystem;

    const entries = yield* fs.readDirectoryEntries(directory).pipe(
      Effect.mapError(
        (cause) =>
          new BackfillInputError({
            cause,
            message:
              "Backfill directory is missing or unreadable. The input files cannot be listed. Fix: pass a readable directory as `<directory>`.",
          })
      )
    );

    const files: BackfillFile[] = [];
    const ignoredFiles: string[] = [];

    for (const entry of entries) {
      const file = entry.type === "File" ? backfillFile(entry.name) : null;

      if (file === null) {
        ignoredFiles.push(entry.name);
      } else {
        files.push(file);
      }
    }

    if (files.length === 0) {
      return yield* new BackfillInputError({
        message:
          "Backfill directory has no matching JSONL files. There is nothing to import. Fix: pass a directory containing `<YYYY-MM-DD>-<kind>.jsonl` files.",
      });
    }

    const sorted = sortBackfillFiles(files);

    const start =
      from === undefined ? 0 : sorted.findIndex(({ name }) => name === from);

    if (start < 0) {
      return yield* new BackfillInputError({
        message:
          "Backfill start file did not match an input. A wrong start could omit commands. Fix: pass the exact filename of an input as `--from <file>`.",
      });
    }

    return {
      files: sorted.slice(start),
      skippedFiles: sorted.slice(0, start).map(({ name }) => name),
      ignoredFiles: ignoredFiles.toSorted(),
    };
  }
);

type OperatorClient = Effect.Success<ReturnType<typeof OperatorApi.clientHttp>>;

type Api = Pick<OperatorClient, "RecordSighting" | "Keep" | "Drop"> & {
  readonly ItemHistory: Pick<OperatorClient["ItemHistory"], "snapshot">;
};

type Disposition = "sent" | "skippedDuplicates" | "unseen";

type SendFailure = "read-history" | "send-command" | "earlier-failure";

type SendOutcome = Result.Result<Disposition, SendFailure>;

export const backfillSender = (api: Api, token: Redacted.Redacted) => {
  const headers = { authorization: `Bearer ${Redacted.value(token)}` };
  const versions = new Map<BackfillCommand["item"], number>();
  const blocked = new Set<BackfillCommand["item"]>();

  const send = Effect.fnUntraced(function* send(command: BackfillCommand) {
    const { item, commandId, tag, input } = command;
    const options = { commandId, headers };

    if (tag === "RecordSighting") {
      return yield* api.RecordSighting(item, input, options);
    }

    return yield* tag === "Keep"
      ? api.Keep(item, input, options)
      : api.Drop(item, input, options);
  });

  return Effect.fnUntraced(function* sendBackfillCommand(
    command: BackfillCommand
  ): Effect.fn.Return<SendOutcome> {
    const { item } = command;

    if (blocked.has(item)) {
      return Result.fail("earlier-failure");
    }

    let version = versions.get(item);

    if (version === undefined) {
      const baseline = yield* api.ItemHistory.snapshot(item, { headers }).pipe(
        Effect.result
      );

      if (Result.isFailure(baseline)) {
        blocked.add(item);

        return Result.fail("read-history");
      }

      version = baseline.success.cursor;
      versions.set(item, version);
    }

    const outcome = yield* send(command).pipe(Effect.result);

    if (Result.isFailure(outcome)) {
      if (Predicate.isTagged(outcome.failure, "UnseenItem")) {
        return Result.succeed("unseen");
      }

      blocked.add(item);

      return Result.fail("send-command");
    }

    const receipt = outcome.success;
    versions.set(item, Math.max(version, receipt.version));

    return Result.succeed(
      receipt.version <= version ? "skippedDuplicates" : "sent"
    );
  });
};

interface FileSummary {
  readonly file: string;
  readonly kind: BackfillFile["kind"];
  commands: number;
  groupKeys: number;
  readonly malformedLines: number[];
}

const counts = () => ({ files: 0, commands: 0, groupKeys: 0, malformed: 0 });

export const defaultBackfillConcurrency = 8;

const batchSize = 128;

interface BackfillOptions {
  readonly concurrency?: number;
  readonly send?: ReturnType<typeof backfillSender> | undefined;
}

export const backfillFiles = Effect.fnUntraced(function* backfillFiles(
  directory: string,
  inputs: Effect.Success<ReturnType<typeof listBackfillInputs>>,
  { concurrency = defaultBackfillConcurrency, send }: BackfillOptions = {}
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: FileSummary[] = [];

  const byKind = {
    github: counts(),
    x: counts(),
    youtube: counts(),
    decisions: counts(),
  };

  const delivery = { sent: 0, skippedDuplicates: 0, unseen: 0, failed: 0 };

  const failedCommands: { file: string; line: number; reason: SendFailure }[] =
    [];

  let unreadableFile: string | null = null;
  let stoppedFile: string | null = null;
  let defectMessage: string | null = null;

  for (const file of inputs.files) {
    const summary: FileSummary = {
      file: file.name,
      kind: file.kind,
      commands: 0,
      groupKeys: 0,
      malformedLines: [],
    };

    files.push(summary);

    const atLine = (line: number) =>
      backfillDefectAt(`at ${file.name}:${line}`);

    const sendLine = Effect.fnUntraced(function* sendLine(
      { command, line }: { command: BackfillCommand; line: number },
      sender: ReturnType<typeof backfillSender>
    ) {
      const outcome = yield* Effect.suspend(() => sender(command)).pipe(
        atLine(line)
      );

      if (Result.isSuccess(outcome)) {
        delivery[outcome.success] += 1;
      } else {
        delivery.failed += 1;
        failedCommands.push({ file: file.name, line, reason: outcome.failure });
      }
    });

    const read = yield* Effect.suspend(() =>
      fs.stream(path.join(directory, file.name)).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.zipWithIndex,
        Stream.grouped(batchSize),
        Stream.runForEach((batch) =>
          Effect.gen(function* backfillBatch() {
            const byItem = new Map<
              BackfillCommand["item"],
              { command: BackfillCommand; line: number }[]
            >();

            for (const [line, index] of batch) {
              const lineNumber = index + 1;

              const decoded = yield* Effect.sync(() =>
                decodeBackfillLine(file, lineNumber, line)
              ).pipe(atLine(lineNumber));

              if (decoded.tag === "malformed") {
                summary.malformedLines.push(lineNumber);
              } else if (decoded.tag === "groupKey") {
                summary.groupKeys += 1;
              } else if (decoded.tag === "command") {
                summary.commands += 1;

                if (send !== undefined) {
                  const { item } = decoded.command;
                  const pending = byItem.get(item) ?? [];
                  pending.push({ command: decoded.command, line: lineNumber });
                  byItem.set(item, pending);
                }
              }
            }

            if (send === undefined) {
              return;
            }

            yield* forEachEffect(
              byItem.values(),
              Effect.fnUntraced(function* sendItem(pending) {
                for (const entry of pending) {
                  yield* sendLine(entry, send);
                }
              }),
              { concurrency, discard: true }
            );
          })
        )
      )
    ).pipe(backfillDefectAt(`while processing ${file.name}`), Effect.result);

    const kind = byKind[summary.kind];
    kind.files += 1;
    kind.commands += summary.commands;
    kind.groupKeys += summary.groupKeys;
    kind.malformed += summary.malformedLines.length;

    if (Result.isFailure(read)) {
      stoppedFile = file.name;

      if (Predicate.isTagged(read.failure, "BackfillInputError")) {
        defectMessage = read.failure.message;
      } else {
        unreadableFile = file.name;
      }

      break;
    }
  }

  return {
    files: files.map((file) => ({
      ...file,
      malformed: file.malformedLines.length,
    })),
    byKind,
    ignoredFiles: inputs.ignoredFiles,
    skippedFiles: inputs.skippedFiles,
    firstIncompleteFile: failedCommands[0]?.file ?? stoppedFile,
    unreadableFile,
    defectMessage,
    delivery: send === undefined ? undefined : { ...delivery, failedCommands },
  };
});

export const runBackfill = Effect.fnUntraced(function* runBackfill(
  directory: string,
  inputs: Effect.Success<ReturnType<typeof listBackfillInputs>>,
  options: BackfillOptions
) {
  const { defectMessage, ...summary } = yield* backfillFiles(
    directory,
    inputs,
    options
  );

  yield* Console.log(JSON.stringify(summary, null, 2));

  if (defectMessage !== null) {
    return yield* new BackfillInputError({ message: defectMessage });
  }

  if (summary.firstIncompleteFile !== null) {
    return yield* new BackfillInputError({
      message:
        "Backfill did not finish cleanly. Some input or commands could not be processed. Fix: check the summary, directory and operator Api, then rerun from the earliest incomplete file with `--from <file>`.",
    });
  }

  return yield* Effect.void;
});
