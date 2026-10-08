import { implement } from "@rat-stack/capability/implement";
import {
  learnFeedbackContract,
  learnFeedbackPollContract,
  learnFeedbackStartContract,
} from "@rat-stack/core/learn";
import { Effect } from "effect";

import { FeedbackAuthor } from "./feedback-author.js";
import { feedbackPerson, pollFeedbackDevice } from "./feedback-machine.js";
import { Learner } from "./learner.js";

export { FeedbackAuthor } from "./feedback-author.js";

export {
  feedbackCredentialMachine,
  feedbackDeviceMachine,
  feedbackPerson,
  pollFeedbackDevice,
} from "./feedback-machine.js";

export const learnFeedbackStart = implement(learnFeedbackStartContract, () =>
  FeedbackAuthor.use((author) => author.request)
);

export const learnFeedbackPoll = implement(
  learnFeedbackPollContract,
  ({ deviceCode }) => pollFeedbackDevice(deviceCode)
);

export const learnFeedback = implement(learnFeedbackContract, (input) =>
  Effect.gen(function* leaveFeedback() {
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
