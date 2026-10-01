import {
  InterestDirectory,
  interestOutcome,
  removeRecords,
  summarize,
} from "@rat-stack/core/interest";
import type {
  CaptureRequest,
  InterestOutcome,
  InterestRecord,
  RemoveSelector,
} from "@rat-stack/core/interest";
import { Clock, Effect, Layer } from "effect";

export interface InterestStub {
  readonly confirm: (address: string) => Effect.Effect<InterestOutcome>;
  readonly forget: () => Effect.Effect<boolean>;
  readonly mailFailed: (address: string) => Effect.Effect<InterestOutcome>;
  readonly register: (
    address: string,
    capture?: CaptureRequest
  ) => Effect.Effect<InterestOutcome>;
}

export interface InterestIndexStub {
  readonly forget: (address: string) => Effect.Effect<boolean>;
  readonly note: (record: InterestRecord) => Effect.Effect<void>;
  readonly records: () => Effect.Effect<readonly InterestRecord[]>;
}

export const interestDirectoryLayer = (
  interests: (address: string) => InterestStub,
  index: () => InterestIndexStub
) => {
  const noteChanges = (outcome: InterestOutcome) =>
    interestOutcome.$match(outcome, {
      Captured: ({ record }) => index().note(record),
      ConfirmRefused: () => Effect.void,
      Confirmed: ({ record }) => index().note(record),
      Quiet: () => Effect.void,
      SendConfirmation: ({ record }) => index().note(record),
    });

  const run = (
    call: (stub: InterestStub) => Effect.Effect<InterestOutcome>,
    address: string
  ) => call(interests(address)).pipe(Effect.tap(noteChanges));

  const records = Effect.suspend(() => index().records());

  return Layer.succeed(InterestDirectory, {
    captures: records.pipe(
      Effect.map((all) => all.filter((record) => record.status === "captured"))
    ),
    confirm: (address: string) => run((stub) => stub.confirm(address), address),
    mailFailed: (address: string) =>
      interests(address).mailFailed(address).pipe(Effect.asVoid),
    register: (address: string, capture?: CaptureRequest) =>
      run((stub) => stub.register(address, capture), address),
    remove: (selector: RemoveSelector) =>
      removeRecords(selector, {
        forget: (address) =>
          Effect.all([
            interests(address).forget(),
            index().forget(address),
          ]).pipe(Effect.map(([held, listed]) => held || listed)),
        records,
      }),
    summary: Effect.gen(function* currentSummary() {
      const now = yield* Clock.currentTimeMillis;

      return summarize(yield* records, now);
    }),
  });
};
