import type {
  FeedbackCredential,
  FeedbackDevice,
  FeedbackGrant,
  FeedbackRequest,
  LearnUnauthenticated,
} from "@rat-stack/core/learn";
import { LearnUnauthenticated as UnauthenticatedFailure } from "@rat-stack/core/learn";
import { Context, Effect } from "effect";

export class FeedbackAuthor extends Context.Reference<{
  readonly request: Effect.Effect<
    typeof FeedbackRequest.Type,
    LearnUnauthenticated
  >;
  readonly inspectDevice: (
    code: string
  ) => Effect.Effect<typeof FeedbackDevice.Type, LearnUnauthenticated>;
  readonly issue: (
    grant: typeof FeedbackGrant.Type
  ) => Effect.Effect<string, LearnUnauthenticated>;
  readonly inspectCredential: (
    token: string,
    capability: string
  ) => Effect.Effect<typeof FeedbackCredential.Type>;
  readonly save: (
    personId: string,
    cardId: string,
    feedback: string
  ) => Effect.Effect<{ readonly id: string }>;
}>("@rat-stack/learn/FeedbackAuthor", {
  defaultValue: () => ({
    inspectCredential: () => Effect.succeed({ state: "unauthenticated" }),
    inspectDevice: () =>
      Effect.fail(
        new UnauthenticatedFailure({
          message: "Learn feedback sign-in is disabled.",
        })
      ),
    issue: () =>
      Effect.fail(
        new UnauthenticatedFailure({
          message: "Learn feedback sign-in is disabled.",
        })
      ),
    request: Effect.fail(
      new UnauthenticatedFailure({
        message: "Learn feedback sign-in is disabled.",
      })
    ),
    save: () =>
      Effect.die(new Error("No feedback author adapter was supplied")),
  }),
}) {}
