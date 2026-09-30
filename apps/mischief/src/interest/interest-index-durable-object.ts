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
      ([, record]) => record.status === "confirmed" || record.expiresAt > now
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

      const records = Effect.gen(function* currentRecords() {
        const now = yield* Clock.currentTimeMillis;

        return Object.values(liveEntries(yield* load, now));
      });

      return {
        note: (record: InterestRecord) =>
          note(record).pipe(Effect.provideContext(runtime)),
        records: () => records.pipe(Effect.provideContext(runtime)),
      };
    });
  })
) {}
