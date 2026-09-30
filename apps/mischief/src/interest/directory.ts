import {
  InterestDirectory,
  interestOutcome,
  summarize,
} from "@rat-stack/core/interest";
import type { InterestOutcome, InterestRecord } from "@rat-stack/core/interest";
import { Clock, Effect, Layer } from "effect";

export interface InterestStub {
  readonly confirm: (address: string) => Effect.Effect<InterestOutcome>;
  readonly mailFailed: (address: string) => Effect.Effect<InterestOutcome>;
  readonly register: (address: string) => Effect.Effect<InterestOutcome>;
}

export interface InterestIndexStub {
  readonly note: (record: InterestRecord) => Effect.Effect<void>;
  readonly records: () => Effect.Effect<readonly InterestRecord[]>;
}

export const interestDirectoryLayer = (
  interests: (address: string) => InterestStub,
  index: () => InterestIndexStub
) => {
  const noteChanges = (outcome: InterestOutcome) =>
    interestOutcome.$match(outcome, {
      ConfirmRefused: () => Effect.void,
      Confirmed: ({ record }) => index().note(record),
      Quiet: () => Effect.void,
      SendConfirmation: ({ record }) => index().note(record),
    });

  const run = (
    call: (stub: InterestStub) => Effect.Effect<InterestOutcome>,
    address: string
  ) => call(interests(address)).pipe(Effect.tap(noteChanges));

  return Layer.succeed(InterestDirectory, {
    confirm: (address: string) => run((stub) => stub.confirm(address), address),
    mailFailed: (address: string) =>
      interests(address).mailFailed(address).pipe(Effect.asVoid),
    register: (address: string) =>
      run((stub) => stub.register(address), address),
    summary: Effect.gen(function* currentSummary() {
      const now = yield* Clock.currentTimeMillis;

      return summarize(yield* index().records(), now);
    }),
  });
};
