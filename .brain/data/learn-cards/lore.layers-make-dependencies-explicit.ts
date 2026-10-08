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
    FileSystem.FileSystem.pipe(
      Effect.map((fs) => Notes.of({ read: (path) => fs.readFileString(path) }))
    )
  );
}

const files = FileSystem.layerNoop({});

export const notesOnly = Notes.layer.pipe(Layer.provide(files));

export const notesAndFiles = Notes.layer.pipe(Layer.provideMerge(files));
