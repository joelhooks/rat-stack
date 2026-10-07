import { implement } from "@rat-stack/capability/implement";
import {
  learnCardContract,
  learnDeckContract,
  learnNextContract,
  learnRecordContract,
} from "@rat-stack/core/learn";
import { Effect } from "effect";

import { Learner } from "./learner.js";

export const learnDeck = implement(learnDeckContract, () =>
  Learner.use((learner) =>
    learner.deck.pipe(
      Effect.map(
        (cards) =>
          ({ cards, version: 1 }) satisfies { cards: typeof cards; version: 1 }
      )
    )
  )
);

export const learnCard = implement(learnCardContract, ({ id, depth }) =>
  Learner.use((learner) =>
    Effect.map(learner.card(id), (card) => ({ card, depth }))
  )
);

export const learnNext = implement(learnNextContract, ({ progress, context }) =>
  Learner.use((learner) => learner.next(progress, context))
);

export const learnRecord = implement(
  learnRecordContract,
  ({ progress, event }) =>
    Learner.use((learner) => learner.record(progress, event))
);

export const learnCapabilities = [
  learnDeck,
  learnCard,
  learnNext,
  learnRecord,
] as const;
