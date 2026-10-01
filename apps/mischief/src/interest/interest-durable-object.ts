import { InterestStore, runInterestMachine } from "@rat-stack/core/interest";
import type { CaptureRequest, InterestRecord } from "@rat-stack/core/interest";
import type { SealedRow, TicketBinding } from "@rat-stack/intake-live";
import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";

const RECORD_KEY = "record";

const TICKET_KEY = "ticket";

const INTAKE_KEY = "intake-key";

const INTAKE_STATEMENT_PREFIX = "intake-statement:";

interface TicketHold {
  readonly expiresAt: number;
  readonly submissionId: string;
}

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
        command: "confirm" | "mailFailed" | "register",
        capture?: CaptureRequest
      ) =>
        runInterestMachine(address, command, capture).pipe(
          Effect.provideService(InterestStore, store)
        );

      const storage = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) =>
        effect.pipe(Effect.provideContext(runtime));

      const bindTicket = (submissionId: string, expiresAt: number) =>
        Effect.gen(function* bind() {
          const held = yield* storage(
            state.storage.get<TicketHold>(TICKET_KEY)
          );

          if (held === undefined) {
            yield* storage(
              state.storage.put(TICKET_KEY, { expiresAt, submissionId })
            );

            return "first" satisfies TicketBinding;
          }

          return held.submissionId === submissionId ? "same" : "other";
        });

      const intakeKey = (candidate: string) =>
        Effect.gen(function* key() {
          const held = yield* storage(state.storage.get<string>(INTAKE_KEY));

          if (held !== undefined) {
            return held;
          }

          yield* storage(state.storage.put(INTAKE_KEY, candidate));

          return candidate;
        });

      const intakeStore = (rows: readonly SealedRow[]) =>
        Effect.gen(function* storeRows() {
          for (const row of rows) {
            const key = `${INTAKE_STATEMENT_PREFIX}${row.id}`;
            const held = yield* storage(state.storage.get<string>(key));

            if (held === undefined) {
              yield* storage(state.storage.put(key, row.sealed));
            }
          }
        });

      return {
        bindTicket,
        confirm: (address: string) => run(address, "confirm"),
        forget: () =>
          state.storage.delete(RECORD_KEY).pipe(Effect.provideContext(runtime)),
        intakeErase: () => storage(state.storage.deleteAll()),
        intakeKey,
        intakeStore,
        mailFailed: (address: string) => run(address, "mailFailed"),
        register: (address: string, capture?: CaptureRequest) =>
          run(address, "register", capture),
      };
    });
  })
) {}
