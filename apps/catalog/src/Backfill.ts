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
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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

export const listBackfillInputs = Effect.fnUntraced(
  function* listBackfillInputs(directory: string) {
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

    return {
      files: sortBackfillFiles(files),
      ignoredFiles: ignoredFiles.toSorted(),
    };
  }
);

type Api = Effect.Success<ReturnType<typeof OperatorApi.clientHttp>>;

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

export const backfillFiles = Effect.fnUntraced(function* backfillFiles(
  directory: string,
  inputs: Effect.Success<ReturnType<typeof listBackfillInputs>>,
  send?: ReturnType<typeof backfillSender>
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

  for (const file of inputs.files) {
    const summary: FileSummary = {
      file: file.name,
      kind: file.kind,
      commands: 0,
      groupKeys: 0,
      malformedLines: [],
    };

    files.push(summary);

    const read = yield* fs.stream(path.join(directory, file.name)).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.zipWithIndex,
      Stream.runForEach(([line, index]) =>
        Effect.gen(function* backfillLine() {
          const lineNumber = index + 1;
          const decoded = decodeBackfillLine(file, lineNumber, line);

          if (decoded.tag === "malformed") {
            summary.malformedLines.push(lineNumber);
          } else if (decoded.tag === "groupKey") {
            summary.groupKeys += 1;
          } else if (decoded.tag === "command") {
            summary.commands += 1;

            if (send !== undefined) {
              const outcome = yield* send(decoded.command);

              if (Result.isSuccess(outcome)) {
                delivery[outcome.success] += 1;
              } else {
                delivery.failed += 1;
                failedCommands.push({
                  file: file.name,
                  line: lineNumber,
                  reason: outcome.failure,
                });
              }
            }
          }
        })
      ),
      Effect.result
    );

    const kind = byKind[summary.kind];
    kind.files += 1;
    kind.commands += summary.commands;
    kind.groupKeys += summary.groupKeys;
    kind.malformed += summary.malformedLines.length;

    if (Result.isFailure(read)) {
      unreadableFile = file.name;
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
    unreadableFile,
    delivery: send === undefined ? undefined : { ...delivery, failedCommands },
  };
});
