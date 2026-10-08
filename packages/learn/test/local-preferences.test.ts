import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  LearnerPreferences,
  LearnPreferencesChangeSchema,
  defaultPreferences,
} from "@rat-stack/core/learn";
import type {
  LearnPreferences,
  LearnPreferencesChange,
} from "@rat-stack/core/learn";
import { ConfigProvider, Effect, FileSystem, Layer, Path } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { localLearnerPreferencesLayer } from "../src/local-preferences.js";

const changes = Arbitrary.array(
  Arbitrary.schema(LearnPreferencesChangeSchema),
  {
    maxLength: 6,
  }
);

it.effect.prop(
  "preferences start as narrow inline text and equal the fold of every change, across fresh layers",
  { changes },
  ({ changes: sequence }) =>
    Effect.gen(function* preferenceHistory() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();

      const config = ConfigProvider.fromUnknown({
        RAT_LEARN_DIRECTORY: directory,
      });

      const layer = localLearnerPreferencesLayer(directory).pipe(
        Layer.provide(Layer.succeed(ConfigProvider.ConfigProvider, config))
      );

      const latest = <Field extends keyof LearnPreferencesChange>(
        field: Field
      ) => sequence.findLast((change) => field in change)?.[field];

      const expected: LearnPreferences = {
        snippet: latest("snippet") ?? defaultPreferences.snippet,
        version: 1,
        visual: latest("visual") ?? defaultPreferences.visual,
        width: latest("width") ?? defaultPreferences.width,
      };

      yield* Effect.gen(function* applyChanges() {
        const preferences = yield* LearnerPreferences;
        expect(yield* preferences.read).toStrictEqual(defaultPreferences);

        for (const change of sequence) {
          yield* preferences.update(change);
        }
      }).pipe(Effect.provide(layer, { local: true }));

      const reread = yield* LearnerPreferences.use(
        (preferences) => preferences.read
      ).pipe(Effect.provide(layer, { local: true }));

      expect(reread).toStrictEqual(expected);
      expect(yield* fs.exists(path.join(directory, "preferences.json"))).toBe(
        sequence.length > 0
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect("a damaged preferences file fails typed and is left in place", () =>
  Effect.gen(function* damagedPreferences() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped();
    const file = path.join(directory, "preferences.json");
    yield* fs.writeFileString(file, "{ width: wide");

    const error = yield* LearnerPreferences.use((preferences) =>
      preferences.update({ width: "wide" })
    ).pipe(
      Effect.provide(localLearnerPreferencesLayer(directory)),
      Effect.flip
    );

    expect(error).toHaveProperty("operation", "preferences.read");
    expect(yield* fs.readFileString(file)).toBe("{ width: wide");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
