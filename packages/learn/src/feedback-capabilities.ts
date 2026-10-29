import { implement } from "@rat-stack/capability/implement";
import {
  learnFeedbackContract,
  learnFeedbackPollContract,
  learnFeedbackStartContract,
} from "@rat-stack/core/learn";
import { Effect } from "effect";

import { FeedbackAuthor } from "./feedback-author.js";
import { loadFeedbackMachine } from "./feedback-loader.js";
import { Learner } from "./learner.js";

export const learnFeedbackStart = implement(learnFeedbackStartContract, () =>
  FeedbackAuthor.use((author) => author.request)
);

export const learnFeedbackPoll = implement(
  learnFeedbackPollContract,
  ({ deviceCode }) =>
    Effect.gen(function* pollFeedbackOnRequest() {
      const pending = import("./feedback-machine.js");

      const { pollFeedbackDevice } = yield* loadFeedbackMachine(pending);

      return yield* pollFeedbackDevice(deviceCode);
    })
);

export const learnFeedback = implement(learnFeedbackContract, (input) =>
  Effect.gen(function* leaveFeedback() {
    const pending = import("./feedback-machine.js");

    const { feedbackPerson } = yield* loadFeedbackMachine(pending);

    const personId = yield* feedbackPerson(input.token, "learnFeedback");
    yield* Learner.use((learner) => learner.card(input.cardId));

    return yield* FeedbackAuthor.use((author) =>
      author.save(personId, input.cardId, input.feedback)
    );
  })
);

export const feedbackCapabilities = [
  learnFeedbackStart,
  learnFeedbackPoll,
  learnFeedback,
] as const;
