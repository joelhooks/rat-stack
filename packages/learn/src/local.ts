import { implement } from "@rat-stack/capability/implement";
import {
  LearnerPreferences,
  LearnerProgress,
  LearnError,
  learnDeckContract,
  learnNextContract,
  learnPreferencesContract,
  learnRecordContract,
  learnSetPreferencesContract,
} from "@rat-stack/core/learn";
import { Clock, Config, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { learnCard, learnDeck } from "./capabilities.js";
import { Learner } from "./learner.js";

export { localLearnerPreferencesLayer } from "./local-preferences.js";

export { localLearnerProgressLayer } from "./local-store.js";

const remoteDeck = Effect.gen(function* remoteDeck() {
  const origin = yield* Config.String("RAT_LEARN_ORIGIN").pipe(
    Config.withDefault("https://ratstack.sh")
  );

  const http = yield* HttpClient.HttpClient;

  const response = yield* http.execute(
    HttpClientRequest.post(`${origin}/api/learnDeck`).pipe(
      HttpClientRequest.bodyJsonUnsafe({})
    )
  );

  if (response.status !== 200) {
    return yield* new LearnError({
      id: "deck",
      reason: `Public deck returned HTTP ${response.status}.`,
    });
  }

  const decoded = yield* Schema.decodeUnknownEffect(learnDeckContract.output)(
    yield* response.json
  );

  return decoded.cards;
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.mapError(
    () =>
      new LearnError({
        id: "deck",
        reason:
          "Public deck unavailable; retry when the learning endpoint is reachable.",
      })
  )
);

export const remoteLearnerLayer = Learner.layer(remoteDeck).pipe(
  Layer.provide(FetchHttpClient.layer)
);

const storeFailure = () =>
  new LearnError({
    id: "progress",
    reason:
      "Local progress operation failed. Preserve the log and check the local writer lock and schema.",
  });

export const localLearnNext = implement(
  {
    ...learnNextContract,
    annotations: { ...learnNextContract.annotations, readOnly: false },
    description:
      "Select from the local event log. Supplied progress is ignored; only learnRecord writes events.",
  },
  ({ context }) =>
    Effect.gen(function* selectLocalNext() {
      const selectedContext = context ?? {
        at: yield* Clock.currentTimeMillis,
        ids: [],
      };

      return yield* LearnerProgress.use((store) => store.next(selectedContext));
    }).pipe(Effect.mapError(storeFailure))
);

export const localLearnRecord = implement(
  {
    ...learnRecordContract,
    annotations: {
      ...learnRecordContract.annotations,
      idempotent: true,
      readOnly: false,
    },
    description:
      "Append an event to the local log and rebuild progress. Supplied progress is ignored; identical events are idempotent.",
  },
  ({ event }) =>
    LearnerProgress.use((store) => store.record(event)).pipe(
      Effect.mapError(storeFailure)
    )
);

const preferencesFailure = () =>
  new LearnError({
    id: "preferences",
    reason:
      "Local preferences could not be read or written. Check that ~/.rat-learn/preferences.json is valid JSON with width, visual and snippet fields, or remove it to use the defaults.",
  });

export const learnPreferences = implement(learnPreferencesContract, () =>
  LearnerPreferences.use((preferences) => preferences.read).pipe(
    Effect.mapError(preferencesFailure)
  )
);

export const learnSetPreferences = implement(
  learnSetPreferencesContract,
  (change) =>
    LearnerPreferences.use((preferences) => preferences.update(change)).pipe(
      Effect.mapError(preferencesFailure)
    )
);

export const localLearnCapabilities = [
  learnDeck,
  learnCard,
  localLearnNext,
  localLearnRecord,
  learnPreferences,
  learnSetPreferences,
] as const;
