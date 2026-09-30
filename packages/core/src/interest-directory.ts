import { Clock, Context, Effect, Layer, Ref } from "effect";

import { InterestStore, runInterestMachine } from "./interest-machine.js";
import type { InterestOutcome, InterestRecord } from "./interest-machine.js";

export interface InterestSummary {
  readonly confirmed: readonly {
    readonly address: string;
    readonly confirmedAt: number;
  }[];
  readonly pending: number;
}

export const summarize = (
  records: readonly InterestRecord[],
  now: number
): InterestSummary => ({
  confirmed: records.flatMap((record) =>
    record.status === "confirmed" && record.confirmedAt !== undefined
      ? [{ address: record.address, confirmedAt: record.confirmedAt }]
      : []
  ),
  pending: records.filter(
    (record) => record.status === "pending" && record.expiresAt > now
  ).length,
});

export class InterestDirectory extends Context.Service<
  InterestDirectory,
  {
    readonly confirm: (address: string) => Effect.Effect<InterestOutcome>;
    readonly mailFailed: (address: string) => Effect.Effect<void>;
    readonly register: (address: string) => Effect.Effect<InterestOutcome>;
    readonly summary: Effect.Effect<InterestSummary>;
  }
>()("@rat-stack/core/InterestDirectory") {
  static readonly memory = Layer.effect(
    this,
    Effect.gen(function* makeMemoryInterestDirectory() {
      const records = yield* Ref.make<ReadonlyMap<string, InterestRecord>>(
        new Map()
      );

      const run = Effect.fn("InterestDirectory.run")(function* run(
        address: string,
        command: "confirm" | "mailFailed" | "register"
      ) {
        const store = {
          load: Ref.get(records).pipe(Effect.map((all) => all.get(address))),
          save: (record: InterestRecord) =>
            Ref.update(records, (all) => new Map(all).set(address, record)),
        };

        return yield* runInterestMachine(address, command).pipe(
          Effect.provideService(InterestStore, store)
        );
      });

      return {
        confirm: (address: string) => run(address, "confirm"),
        mailFailed: (address: string) =>
          run(address, "mailFailed").pipe(Effect.asVoid),
        register: (address: string) => run(address, "register"),
        summary: Effect.gen(function* currentSummary() {
          const now = yield* Clock.currentTimeMillis;
          const all = yield* Ref.get(records);

          return summarize([...all.values()], now);
        }),
      };
    })
  );
}
