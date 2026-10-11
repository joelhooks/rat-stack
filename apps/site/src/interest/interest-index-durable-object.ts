import type { InterestRecord } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Clock } from "effect";
import * as Effect from "effect/Effect";

const ENTRIES_KEY = "entries";

type Entries = Readonly<Record<string, InterestRecord>>;

const liveEntries = (entries: Entries, now: number): Entries =>
  Object.fromEntries(
    Object.entries(entries).filter(
      ([, record]) =>
        record.status !== "pending" || (record.expiresAt ?? 0) > now
    )
  );

export default class InterestIndex extends Cloudflare.DurableObject<InterestIndex>()(
  "InterestIndex",
  Effect.gen(function* makeInterestIndex() {
    const state = yield* Cloudflare.DurableObjectState;

    // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's DurableObject contract returns the per-instance Effect.
    return Effect.gen(function* makeInstance() {
      const runtime = yield* Effect.context<RuntimeContext>();

      const load = state.storage
        .get<Entries>(ENTRIES_KEY)
        .pipe(Effect.map((entries) => entries ?? {}));

      const note = Effect.fn("InterestIndex.note")(function* note(
        record: InterestRecord
      ) {
        const now = yield* Clock.currentTimeMillis;
        const entries = liveEntries(yield* load, now);

        yield* state.storage.put(ENTRIES_KEY, {
          ...entries,
          [record.address]: record,
        });
      });

      const forget = Effect.fn("InterestIndex.forget")(function* forget(
        address: string
      ) {
        const entries = yield* load;

        if (!(address in entries)) {
          return false;
        }

        const rest = Object.fromEntries(
          Object.entries(entries).filter(([key]) => key !== address)
        );

        yield* state.storage.put(ENTRIES_KEY, rest);

        return true;
      });

      const records = Effect.gen(function* currentRecords() {
        const now = yield* Clock.currentTimeMillis;

        return Object.values(liveEntries(yield* load, now));
      });

      return {
        applicationIds: () =>
          state.storage.list<string>({ prefix: "application:" }).pipe(
            Effect.map((entries) => [...entries.values()]),
            Effect.provideContext(runtime)
          ),
        forget: (address: string) =>
          forget(address).pipe(Effect.provideContext(runtime)),
        note: (record: InterestRecord) =>
          note(record).pipe(Effect.provideContext(runtime)),
        noteApplication: (submissionId: string) =>
          state.storage
            .put(`application:${submissionId}`, submissionId)
            .pipe(Effect.provideContext(runtime)),
        records: () => records.pipe(Effect.provideContext(runtime)),
      };
    });
  })
) {}
