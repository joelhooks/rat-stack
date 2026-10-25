import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  Semaphore,
} from "effect";

import { FlagActor } from "./flag-control.js";
import {
  FlagFlipRefused,
  flagPartition,
  validateFlagScope,
} from "./flag-ladder.js";
import type {
  FlagAuthorityRole,
  FlipFlagInput,
  RecordFlagEvidenceInput,
  FlagPosition,
} from "./flag-ladder.js";
import { FlagLedger } from "./flag-ledger.js";
import type { FlagStorageError } from "./flag-storage-error.js";
import { Flags, InvalidFlagValue, UnknownFlag } from "./flags.js";

export class FlagStateStore extends Context.Service<
  FlagStateStore,
  {
    readonly load: (
      key: string
    ) => Effect.Effect<
      Option.Option<typeof FlagPosition.Type>,
      FlagStorageError
    >;
    readonly save: (
      key: string,
      position: typeof FlagPosition.Type
    ) => Effect.Effect<void, FlagStorageError>;
  }
>()("@rat-stack/core/FlagStateStore") {}

const authorityRank: Readonly<Record<FlagAuthorityRole, number>> = {
  agent: 0,
  arbiter: 1,
  owner: 2,
};

export const flagLedgerEngine = Layer.effect(
  FlagLedger,
  Effect.gen(function* makeFlagLedger() {
    const flags = yield* Flags;
    const store = yield* FlagStateStore;
    const gate = yield* Semaphore.make(1);

    const locate = Effect.fn("FlagLedger.locate")(function* locate(
      name: string,
      requested: Schema.Json = "global"
    ) {
      const flag = flags.registry.find((entry) => entry.name === name);

      if (flag === undefined) {
        return yield* new UnknownFlag({
          name,
          repair: "Choose a name returned by listFlags.",
        });
      }

      const scope = yield* validateFlagScope(flag, requested);
      const key = flagPartition(name, scope);
      const held = yield* store.load(key);

      const value = yield* Schema.encodeEffect(flag.schema)(flag.default).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.mapError(
          () =>
            new InvalidFlagValue({
              name,
              repair: "Declare JSON-encoded rung values.",
            })
        )
      );

      return {
        flag,
        key,
        position: Option.getOrElse(held, () => ({
          evidence: [],
          revision: 0,
          rung: flag.rungs[0].name,
          value,
        })),
        scope,
      };
    });

    const flip = Effect.fn("FlagLedger.flip")(
      function* flip(input: typeof FlipFlagInput.Type, actor?: string) {
        const { flag, key, scope, position } = yield* locate(
          input.name,
          input.scope
        );

        const at = flag.rungs.findIndex((rung) => rung.name === position.rung);
        const here = flag.rungs[at];

        const refuse = (reason: FlagFlipRefused["reason"], repair: string) =>
          new FlagFlipRefused({ name: input.name, reason, repair });

        const off = Predicate.isTagged(input.target, "off");

        if (off && Predicate.isTagged(flag.kill, "none")) {
          return yield* refuse("off-refused", flag.kill.reason);
        }

        const targetName = Predicate.isTagged(input.target, "rung")
          ? input.target.name
          : undefined;

        const next = off
          ? flag.rungs[
              Predicate.isTagged(flag.kill, "previous-rung")
                ? Math.max(0, at - 1)
                : 0
            ]
          : flag.rungs.find((rung) => rung.name === targetName);

        if (next === undefined) {
          return yield* refuse(
            "unknown-rung",
            "Choose a rung declared in this flag's ladder."
          );
        }

        if (!off) {
          if (here === undefined || flag.rungs.indexOf(next) !== at + 1) {
            return yield* refuse(
              "not-next-rung",
              "Climb exactly one rung. To step down, flip off first."
            );
          }

          if (
            authorityRank[input.authority] < authorityRank[next.authority] ||
            (next.authority !== "agent" && input.approvalRef === undefined)
          ) {
            return yield* refuse(
              "approval-required",
              `Supply ${next.authority} authority and an approvalRef quote for a climb above agent.`
            );
          }

          if (
            !Predicate.isTagged(here.exit, "evidence") ||
            here.exit.requirements.some((requirement) => {
              const evidence = position.evidence.find(
                (record) =>
                  record.rung === here.name &&
                  record.event === requirement.event &&
                  record.read === requirement.read
              );

              return (
                evidence === undefined ||
                (Predicate.isTagged(requirement.threshold, "at-least")
                  ? evidence.observed < requirement.threshold.count
                  : evidence.observed > requirement.threshold.count)
              );
            })
          ) {
            return yield* refuse(
              "evidence-required",
              "Record each exit measurement at this rung and this exact scope before climbing."
            );
          }
        }

        const value = yield* Schema.encodeEffect(flag.schema)(next.value).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.mapError(
            () =>
              new InvalidFlagValue({
                name: input.name,
                repair: "Declare JSON-encoded rung values.",
              })
          )
        );

        const revision = position.revision + 1;

        const receipt = {
          actor: actor ?? (yield* FlagActor),
          approvalRef: input.approvalRef ?? null,
          authority: input.authority,
          evidenceRefs: off
            ? []
            : position.evidence.map((record) => record.ref),
          from: position.rung,
          name: input.name,
          reason: input.reason,
          revision,
          scope,
          to: next.name,
          value,
        };

        yield* store.save(key, {
          evidence: [],
          receipt,
          revision,
          rung: next.name,
          value,
        });

        return receipt;
      },
      (effect) => gate.withPermit(effect)
    );

    const recordEvidence = Effect.fn("FlagLedger.recordEvidence")(
      function* recordEvidence(
        input: typeof RecordFlagEvidenceInput.Type,
        actor?: string
      ) {
        const { flag, key, scope, position } = yield* locate(
          input.name,
          input.scope
        );

        const rung = flag.rungs.find((entry) => entry.name === position.rung);

        if (
          rung?.name !== input.rung ||
          !Predicate.isTagged(rung.exit, "evidence") ||
          !rung.exit.requirements.some(
            (requirement) =>
              requirement.event === input.event &&
              requirement.read === input.read
          )
        ) {
          return yield* new FlagFlipRefused({
            name: input.name,
            reason: "evidence-required",
            repair:
              "Measure a declared exit event at the current rung, using its declared read location and exact scope.",
          });
        }

        const recordedAt = yield* Clock.currentTimeMillis;
        const recordedBy = actor ?? (yield* FlagActor);
        yield* store.save(key, {
          ...position,
          evidence: [
            ...position.evidence.filter((entry) => entry.event !== input.event),
            { ...input, recordedAt, recordedBy, scope },
          ],
        });

        return yield* Effect.void;
      },
      (effect) => gate.withPermit(effect)
    );

    return FlagLedger.of({
      flip,
      read: (name, scope) =>
        locate(name, scope).pipe(Effect.map(({ position }) => position)),
      recordEvidence,
    });
  })
);
