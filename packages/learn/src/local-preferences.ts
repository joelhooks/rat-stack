import type {
  LearnPreferences,
  LearnPreferencesChange,
} from "@rat-stack/core/learn";
import {
  LearnerPreferences,
  LearnerProgressError,
  LearnPreferencesSchema,
  defaultPreferences,
} from "@rat-stack/core/learn";
import { Config, Effect, FileSystem, Layer, Path, Schema } from "effect";

export const PREFERENCES_FILE = "preferences.json";

export const localLearnerPreferencesLayer = (defaultDirectory: string) =>
  Layer.effect(
    LearnerPreferences,
    Effect.gen(function* makeLocalPreferences() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = yield* Config.String("RAT_LEARN_DIRECTORY").pipe(
        Config.withDefault(defaultDirectory)
      );

      const file = path.join(directory, PREFERENCES_FILE);
      const codec = Schema.fromJsonString(LearnPreferencesSchema);

      const read = Effect.gen(function* readPreferences() {
        if (!(yield* fs.exists(file))) {
          return defaultPreferences;
        }

        return yield* Schema.decodeEffect(codec)(
          yield* fs.readFileString(file)
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new LearnerProgressError({ cause, operation: "preferences.read" })
        )
      );

      const write = Effect.fn("LearnerPreferences.write")(
        function* write(preferences: LearnPreferences) {
          const encoded = yield* Schema.encodeEffect(LearnPreferencesSchema)(
            preferences
          );

          yield* fs.makeDirectory(directory, { mode: 0o700, recursive: true });

          const temporary = yield* fs.makeTempFileScoped({
            directory,
            prefix: ".preferences-",
          });

          yield* fs.writeFileString(
            temporary,
            `${JSON.stringify(encoded, null, 2)}\n`,
            { mode: 0o600 }
          );
          yield* fs.chmod(temporary, 0o600);
          yield* fs.rename(temporary, file);
        },
        Effect.scoped,
        Effect.mapError(
          (cause) =>
            new LearnerProgressError({ cause, operation: "preferences.write" })
        )
      );

      const update = Effect.fn("LearnerPreferences.update")(function* update(
        change: LearnPreferencesChange
      ) {
        const next = { ...(yield* read), ...change };
        yield* write(next);

        return next;
      });

      return LearnerPreferences.of({ read, update });
    })
  );
