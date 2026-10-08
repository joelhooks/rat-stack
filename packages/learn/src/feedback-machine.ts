import { watchActor } from "@rat-stack/capability/actor-watch";
import { FeedbackGrant, LearnUnauthenticated } from "@rat-stack/core/learn";
import type { FeedbackPoll } from "@rat-stack/core/learn";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types } from "xstate";

import { FeedbackAuthor } from "./feedback-author.js";

interface DeviceContext {
  readonly deviceCode: string;
  readonly grant: typeof FeedbackGrant.Type | undefined;
  readonly result: typeof FeedbackPoll.Type | undefined;
  readonly error: LearnUnauthenticated | undefined;
}

const inspectDevice = fromEffect({
  effect: ({ input }) =>
    FeedbackAuthor.use((author) => author.inspectDevice(input.deviceCode)),
  schemas: { input: Schema.Struct({ deviceCode: Schema.String }) },
});

const issueCredential = fromEffect({
  effect: ({ input }) =>
    FeedbackAuthor.use((author) => author.issue(input)).pipe(
      Effect.map((token) => ({ expiresAt: input.expiresAt, token }))
    ),
  schemas: { input: FeedbackGrant },
});

export const feedbackDeviceMachine = setupEffect({
  actors: { inspectDevice, issueCredential },
  schemas: {
    context: types<DeviceContext>(),
    input: Schema.Struct({ deviceCode: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({
    deviceCode: input.deviceCode,
    error: undefined,
    grant: undefined,
    result: undefined,
  }),
  initial: "checking",
  output: ({ context }) => context,
  states: {
    approved: {
      invoke: {
        input: ({ context }) => {
          if (context.grant === undefined) {
            throw new Error("Approved device has no feedback grant");
          }

          return context.grant;
        },
        onDone: {
          context: ({ event }) => ({
            result: {
              expiresAt: event.output.expiresAt,
              state: "approved" as const,
              token: event.output.token,
            },
          }),
          target: "issued",
        },
        onError: {
          context: ({ event }) => ({ error: event.error }),
          target: "unauthenticated",
        },
        src: "issueCredential",
      },
    },
    checking: {
      invoke: {
        input: ({ context }) => ({ deviceCode: context.deviceCode }),
        onDone: ({ event }) =>
          event.output.state === "approved"
            ? { context: { grant: event.output.grant }, target: "approved" }
            : { context: { result: event.output }, target: event.output.state },
        onError: {
          context: ({ event }) => ({ error: event.error }),
          target: "unauthenticated",
        },
        src: "inspectDevice",
      },
    },
    denied: { type: "final" },
    expired: { type: "final" },
    issued: { type: "final" },
    pending: { type: "final" },
    "polled-too-fast": { type: "final" },
    unauthenticated: { type: "final" },
  },
});

const inspectCredential = fromEffect({
  effect: ({ input }) =>
    FeedbackAuthor.use((author) =>
      author.inspectCredential(input.token, input.capability)
    ),
  schemas: {
    input: Schema.Struct({ capability: Schema.String, token: Schema.String }),
  },
});

interface CredentialContext {
  readonly token: string;
  readonly capability: string;
  readonly personId: string | undefined;
}

export const feedbackCredentialMachine = setupEffect({
  actors: { inspectCredential },
  schemas: {
    context: types<CredentialContext>(),
    input: Schema.Struct({ capability: Schema.String, token: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({ ...input, personId: undefined }),
  initial: "validating",
  output: ({ context }) => context.personId,
  states: {
    active: { type: "final" },
    expired: { type: "final" },
    unauthenticated: { type: "final" },
    validating: {
      invoke: {
        input: ({ context }) => ({
          capability: context.capability,
          token: context.token,
        }),
        onDone: ({ event }) =>
          event.output.state === "active"
            ? { context: { personId: event.output.personId }, target: "active" }
            : { target: event.output.state },
        src: "inspectCredential",
      },
    },
  },
});

export const pollFeedbackDevice = Effect.fn("pollFeedbackDevice")(
  function* pollFeedbackDevice(deviceCode: string) {
    const actor = yield* createEffectActor(feedbackDeviceMachine, {
      input: { deviceCode },
    });

    yield* watchActor("feedbackDeviceMachine", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine failures stay defects; expected unauthentication is carried in the final context.
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (outcome.error !== undefined) {
      return yield* outcome.error;
    }

    if (outcome.result === undefined) {
      return yield* Effect.die(
        new Error("Device flow completed without an outcome")
      );
    }

    return outcome.result;
  },
  Effect.scoped
);

export const feedbackPerson = Effect.fn("feedbackPerson")(
  function* feedbackPerson(token: string, capability: string) {
    const actor = yield* createEffectActor(feedbackCredentialMachine, {
      input: { capability, token },
    });

    yield* watchActor("feedbackCredentialMachine", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Credential checks return explicit states; machine failures must not become authentication decisions.
    const personId = yield* join(actor).pipe(Effect.orDie);

    if (personId === undefined) {
      return yield* new LearnUnauthenticated({
        message:
          "Approve a new feedback device code. This credential authorizes learnFeedback only.",
      });
    }

    return personId;
  },
  Effect.scoped
);
