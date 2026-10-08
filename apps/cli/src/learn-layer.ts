import { homedir } from "node:os";

import { NodeServices } from "@effect/platform-node";
import {
  localLearnerPreferencesLayer,
  localLearnerProgressLayer,
  remoteLearnerLayer,
} from "@rat-stack/learn/local";
import { Effect, Layer, Path } from "effect";

export const localLearnLayer = Layer.unwrap(
  Effect.gen(function* localLearn() {
    const path = yield* Path.Path;

    const directory = path.join(homedir(), ".rat-learn");

    return Layer.merge(
      localLearnerProgressLayer(directory),
      localLearnerPreferencesLayer(directory)
    ).pipe(Layer.provideMerge(remoteLearnerLayer));
  })
).pipe(Layer.provide(NodeServices.layer));
