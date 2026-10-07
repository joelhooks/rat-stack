import { Context, Effect, FileSystem, Layer } from "effect";
import type { PlatformError } from "effect";

export class Notes extends Context.Service<
  Notes,
  {
    readonly read: (
      path: string
    ) => Effect.Effect<string, PlatformError.PlatformError>;
  }
>()("myapp/Notes") {
  static readonly layer = Layer.effect(
    Notes,
    Effect.gen(function* makeNotes() {
      const fs = yield* FileSystem.FileSystem;

      return Notes.of({ read: (path) => fs.readFileString(path) });
    })
  );
}
