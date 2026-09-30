import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  fromEffect,
  join,
  send,
  setupEffect,
} from "@xstate/effect";
import {
  Clock,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { types } from "xstate";

export const CONFIRMATION_WINDOW_MS = 72 * 60 * 60 * 1000;

export const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const InterestRecordSchema = Schema.Struct({
  address: Schema.String,
  confirmedAt: Schema.optionalKey(Schema.Finite),
  expiresAt: Schema.Finite,
  lastSentAt: Schema.optionalKey(Schema.Finite),
  requestedAt: Schema.Finite,
  status: Schema.Literals(["pending", "confirmed"]),
});

export type InterestRecord = typeof InterestRecordSchema.Type;

export type InterestOutcome = Data.TaggedEnum<{
  Confirmed: { readonly record: InterestRecord };
  ConfirmRefused: { readonly reason: "expired" | "unknown" };
  Quiet: { readonly reason: "confirmed" | "cooldown" | "mail-failed" };
  SendConfirmation: { readonly record: InterestRecord };
}>;

export const interestOutcome = Data.taggedEnum<InterestOutcome>();

export type InterestCommand = "confirm" | "mailFailed" | "register";

export class InterestStore extends Context.Service<
  InterestStore,
  {
    readonly load: Effect.Effect<InterestRecord | undefined>;
    readonly save: (record: InterestRecord) => Effect.Effect<void>;
  }
>()("@rat-stack/core/InterestStore") {
  static readonly memory = Layer.effect(
    this,
    Effect.gen(function* makeMemoryInterestStore() {
      const cell = yield* Ref.make(Option.none<InterestRecord>());

      return {
        load: Ref.get(cell).pipe(Effect.map(Option.getOrUndefined)),
        save: (record: InterestRecord) => Ref.set(cell, Option.some(record)),
      } as const;
    })
  );
}

interface InterestContext {
  readonly address: string;
  readonly now: number;
  readonly outcome: InterestOutcome | undefined;
  readonly record: InterestRecord | undefined;
}

interface Step {
  readonly context: InterestContext;
  readonly target: "persisting" | "settled";
}

const MachineInput = Schema.Struct({
  address: Schema.String,
  now: Schema.Finite,
  record: Schema.UndefinedOr(InterestRecordSchema),
});

const persistRecord = fromEffect({
  effect: ({ input }) =>
    InterestStore.use((store) =>
      input.record === undefined ? Effect.void : store.save(input.record)
    ),
  schemas: {
    input: Schema.Struct({ record: Schema.UndefinedOr(InterestRecordSchema) }),
  },
});

const freshRecord = (address: string, now: number): InterestRecord => ({
  address,
  expiresAt: now + CONFIRMATION_WINDOW_MS,
  lastSentAt: now,
  requestedAt: now,
  status: "pending",
});

const cooldownElapsed = (record: InterestRecord, now: number) =>
  record.lastSentAt === undefined ||
  now - record.lastSentAt >= RESEND_COOLDOWN_MS;

const withoutLastSent = (record: InterestRecord): InterestRecord => ({
  address: record.address,
  expiresAt: record.expiresAt,
  requestedAt: record.requestedAt,
  status: record.status,
});

const settle = (context: InterestContext, outcome: InterestOutcome): Step => ({
  context: { ...context, outcome },
  target: "settled",
});

const persist = (
  context: InterestContext,
  record: InterestRecord,
  outcome: InterestOutcome
): Step => ({
  context: { ...context, outcome, record },
  target: "persisting",
});

const quiet = (
  context: InterestContext,
  reason: "confirmed" | "cooldown" | "mail-failed"
) => settle(context, interestOutcome.Quiet({ reason }));

const refuse = (context: InterestContext, reason: "expired" | "unknown") =>
  settle(context, interestOutcome.ConfirmRefused({ reason }));

const register = (context: InterestContext, now: number) => {
  const record = freshRecord(context.address, now);

  return persist(context, record, interestOutcome.SendConfirmation({ record }));
};

const withRecord = (
  context: InterestContext,
  handle: (record: InterestRecord) => Step
) =>
  context.record === undefined
    ? refuse(context, "unknown")
    : handle(context.record);

export const interestMachine = setupEffect({
  actors: { persistRecord },
  schemas: {
    context: types<InterestContext>(),
    events: {
      CONFIRM: Schema.Struct({ now: Schema.Finite }),
      MAIL_FAILED: Schema.Struct({}),
      REGISTER: Schema.Struct({ now: Schema.Finite }),
    },
    input: MachineInput,
  },
}).createMachine({
  context: ({ input }) => ({
    address: input.address,
    now: input.now,
    outcome: undefined,
    record: input.record,
  }),
  initial: "hydrating",
  output: ({ context }) => context.outcome,
  states: {
    confirmed: {
      on: {
        CONFIRM: ({ context }) =>
          withRecord(context, (record) =>
            settle(context, interestOutcome.Confirmed({ record }))
          ),
        MAIL_FAILED: ({ context }) => quiet(context, "mail-failed"),
        REGISTER: ({ context }) => quiet(context, "confirmed"),
      },
    },
    expired: {
      on: {
        CONFIRM: ({ context }) => refuse(context, "expired"),
        MAIL_FAILED: ({ context }) => quiet(context, "mail-failed"),
        REGISTER: ({ context, event }) => register(context, event.now),
      },
    },
    hydrating: {
      always: ({ context }) => {
        const { now, record } = context;

        if (record === undefined) {
          return { target: "unregistered" };
        }

        if (record.status === "confirmed") {
          return { target: "confirmed" };
        }

        return { target: record.expiresAt <= now ? "expired" : "pending" };
      },
    },
    pending: {
      on: {
        CONFIRM: ({ context, event }) =>
          withRecord(context, (record) => {
            const confirmed: InterestRecord = {
              ...record,
              confirmedAt: event.now,
              status: "confirmed",
            };

            return persist(
              context,
              confirmed,
              interestOutcome.Confirmed({ record: confirmed })
            );
          }),
        MAIL_FAILED: ({ context }) =>
          withRecord(context, (record) =>
            persist(
              context,
              withoutLastSent(record),
              interestOutcome.Quiet({ reason: "mail-failed" })
            )
          ),
        REGISTER: ({ context, event }) =>
          withRecord(context, (record) => {
            if (!cooldownElapsed(record, event.now)) {
              return quiet(context, "cooldown");
            }

            const resent: InterestRecord = {
              ...record,
              lastSentAt: event.now,
            };

            return persist(
              context,
              resent,
              interestOutcome.SendConfirmation({ record: resent })
            );
          }),
      },
    },
    persisting: {
      invoke: {
        input: ({ context }) => ({ record: context.record }),
        onDone: { target: "settled" },
        src: "persistRecord",
      },
    },
    settled: { type: "final" },
    unregistered: {
      on: {
        CONFIRM: ({ context }) => refuse(context, "unknown"),
        MAIL_FAILED: ({ context }) => quiet(context, "mail-failed"),
        REGISTER: ({ context, event }) => register(context, event.now),
      },
    },
  },
});

const eventFor = (command: InterestCommand, now: number) => {
  switch (command) {
    case "confirm": {
      return { now, type: "CONFIRM" } as const;
    }

    case "mailFailed": {
      return { type: "MAIL_FAILED" } as const;
    }

    case "register": {
      return { now, type: "REGISTER" } as const;
    }

    default: {
      return command satisfies never;
    }
  }
};

export const runInterestMachine = Effect.fn("runInterestMachine")(
  function* runInterestMachine(address: string, command: InterestCommand) {
    const store = yield* InterestStore;
    const now = yield* Clock.currentTimeMillis;
    const record = yield* store.load;

    const actor = yield* createEffectActor(interestMachine, {
      input: { address, now, record },
    });

    yield* watchActor("interestMachine", actor);

    yield* send(actor, eventFor(command, now));

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- A machine's ErrorFrom is unknown (statelyai/xstate#5725); a machine-level error here is a programming error and orDie closes it.
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (outcome === undefined) {
      return yield* Effect.die(
        new Error("interestMachine completed without an outcome")
      );
    }

    return outcome;
  },
  Effect.scoped
);
