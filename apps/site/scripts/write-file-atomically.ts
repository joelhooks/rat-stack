import { Effect, FileSystem, Path } from "effect";

export const writeFileAtomically = Effect.fn("writeFileAtomically")(
  function* writeFileAtomically(file: string, text: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const directory = yield* fs.makeTempDirectoryScoped({
      directory: path.dirname(file),
      prefix: ".content-report.",
    });

    const temporary = path.join(directory, "report");

    yield* fs.writeFileString(temporary, text);
    yield* fs.rename(temporary, file);
  },
  Effect.scoped
);
