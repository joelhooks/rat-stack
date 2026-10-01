import { Clock, Context, Effect, Layer, Option, Ref } from "effect";

import { normalizeAddress } from "./interest-address.js";
import { InterestStore, runInterestMachine } from "./interest-machine.js";
import type {
  CaptureRequest,
  InterestOutcome,
  InterestRecord,
} from "./interest-machine.js";

export interface InterestSummary {
  readonly captured: number;
  readonly confirmed: readonly {
    readonly address: string;
    readonly confirmedAt: number;
  }[];
  readonly pending: number;
}

export type RemoveSelector =
  | { readonly addresses: readonly string[] }
  | { readonly submissionIds: readonly string[] };

export interface RemoveCounts {
  readonly deleted: number;
  readonly notFound: number;
  readonly requested: number;
}

export const summarize = (
  records: readonly InterestRecord[],
  now: number
): InterestSummary => ({
  captured: records.filter((record) => record.status === "captured").length,
  confirmed: records.flatMap((record) =>
    record.status === "confirmed" && record.confirmedAt !== undefined
      ? [{ address: record.address, confirmedAt: record.confirmedAt }]
      : []
  ),
  pending: records.filter(
    (record) => record.status === "pending" && (record.expiresAt ?? 0) > now
  ).length,
});

export const removeRecords = Effect.fn("removeRecords")(function* removeRecords(
  selector: RemoveSelector,
  io: {
    readonly forget: (address: string) => Effect.Effect<boolean>;
    readonly records: Effect.Effect<readonly InterestRecord[]>;
  }
) {
  const { addresses, requested } = yield* Effect.gen(
    function* resolveTargets() {
      if ("addresses" in selector) {
        const normalized = new Set(
          selector.addresses.map((raw) =>
            normalizeAddress(raw).pipe(Option.getOrElse(() => raw))
          )
        );

        return { addresses: normalized, requested: normalized.size };
      }

      const wanted = new Set(selector.submissionIds);
      const all = yield* io.records;

      const found = new Set(
        all.flatMap((record) =>
          record.capture !== undefined &&
          wanted.has(record.capture.submissionId)
            ? [record.address]
            : []
        )
      );

      return { addresses: found, requested: wanted.size };
    }
  );

  const results = yield* Effect.forEach([...addresses], (address) =>
    io.forget(address)
  );

  const deleted = results.filter(Boolean).length;

  return { deleted, notFound: requested - deleted, requested } as const;
});

export class InterestDirectory extends Context.Service<
  InterestDirectory,
  {
    readonly captures: Effect.Effect<readonly InterestRecord[]>;
    readonly confirm: (address: string) => Effect.Effect<InterestOutcome>;
    readonly mailFailed: (address: string) => Effect.Effect<void>;
    readonly register: (
      address: string,
      capture?: CaptureRequest
    ) => Effect.Effect<InterestOutcome>;
    readonly remove: (selector: RemoveSelector) => Effect.Effect<RemoveCounts>;
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
        command: "confirm" | "mailFailed" | "register",
        capture?: CaptureRequest
      ) {
        const store = {
          load: Ref.get(records).pipe(Effect.map((all) => all.get(address))),
          save: (record: InterestRecord) =>
            Ref.update(records, (all) => new Map(all).set(address, record)),
        };

        return yield* runInterestMachine(address, command, capture).pipe(
          Effect.provideService(InterestStore, store)
        );
      });

      const all = Ref.get(records).pipe(
        Effect.map((entries) => [...entries.values()])
      );

      return {
        captures: all.pipe(
          Effect.map((entries) =>
            entries.filter((record) => record.status === "captured")
          )
        ),
        confirm: (address: string) => run(address, "confirm"),
        mailFailed: (address: string) =>
          run(address, "mailFailed").pipe(Effect.asVoid),
        register: (address: string, capture?: CaptureRequest) =>
          run(address, "register", capture),
        remove: (selector: RemoveSelector) =>
          removeRecords(selector, {
            forget: (address) =>
              Ref.modify(records, (entries) => {
                const next = new Map(entries);

                return [next.delete(address), next];
              }),
            records: all,
          }),
        summary: Effect.gen(function* currentSummary() {
          const now = yield* Clock.currentTimeMillis;

          return summarize(yield* all, now);
        }),
      };
    })
  );
}
