import { Console, Effect, FileSystem, Schema } from "effect";

export class ReadError extends Schema.TaggedError<ReadError>()("ReadError", {
  path: Schema.String,
  reason: Schema.String,
}) {}

const read = (path: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path)),
    Effect.mapError((cause) => new ReadError({ path, reason: cause.message }))
  );

export const main = read("notes.md").pipe(
  Effect.catchTag("ReadError", (failure) =>
    Console.error(`${failure.path}: ${failure.reason}`).pipe(
      Effect.andThen(Effect.fail(failure))
    )
  )
);
