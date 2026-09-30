import { InterestStore, runInterestMachine } from "@rat-stack/core/interest";
import type { InterestRecord } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";

const RECORD_KEY = "record";

export default class Interest extends Cloudflare.DurableObject<Interest>()(
  "Interest",
  Effect.gen(function* makeInterest() {
    const state = yield* Cloudflare.DurableObjectState;

    // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's DurableObject contract returns the per-instance Effect.
    return Effect.gen(function* makeInstance() {
      const runtime = yield* Effect.context<RuntimeContext>();

      const store = {
        load: state.storage
          .get<InterestRecord>(RECORD_KEY)
          .pipe(Effect.provideContext(runtime)),
        save: (record: InterestRecord) =>
          state.storage
            .put(RECORD_KEY, record)
            .pipe(Effect.provideContext(runtime)),
      };

      const run = (
        address: string,
        command: "confirm" | "mailFailed" | "register"
      ) =>
        runInterestMachine(address, command).pipe(
          Effect.provideService(InterestStore, store)
        );

      return {
        confirm: (address: string) => run(address, "confirm"),
        mailFailed: (address: string) => run(address, "mailFailed"),
        register: (address: string) => run(address, "register"),
      };
    });
  })
) {}
