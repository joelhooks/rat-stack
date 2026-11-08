import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path } from "effect";

import {
  checkSpec,
  onlyInvariant,
  warnNotChecked,
} from "./fixtures/protocol-spec.js";

const module = "JoinIntake";

const budget = "20 seconds";

const files = Effect.gen(function* readSpecFiles() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");

  const read = (file: string) =>
    fileSystem.readFileString(path.join(root, file));

  return {
    cfg: (name: string) => read(`packages/core/spec/${name}.cfg`),
    read,
    spec: yield* read(`packages/core/spec/${module}.tla`),
  };
});

const safety = [
  {
    cfg: module,
    holds:
      "holds every safety invariant through crashes, provider retries and a Basin outage",
  },
  {
    cfg: "JoinIntakeEraseSticky",
    holds:
      "holds every safety invariant when setState reads then writes and the store refuses a save over an erase marker",
  },
] as const;

const weaker = [
  {
    cfg: "JoinIntakeIndexAfterRecord",
    environment:
      "the Durable Object store writes the record before the sweep index",
    violates: "OwedIsFindable",
  },
  {
    cfg: "JoinIntakeSetStateRace",
    environment:
      "the Durable Object store's setState reads and then writes in two calls",
    violates: "EraseWins",
  },
  {
    cfg: "JoinIntakeEarlyErase",
    environment:
      "an erase lands between the request's commit read and commit write",
    violates: "EraseWins",
  },
  {
    cfg: "JoinIntakeMarkBeforeSave",
    environment:
      "the store marks the sweep index before the record and the sweep clears it between",
    violates: "OwedIsFindable",
  },
] as const;

const flips = [
  {
    bug: "a late delivery result overwriting the erase marker",
    cfg: "JoinIntakeEraseSticky",
    code: [
      {
        file: "apps/site/src/interest/join-contact-cell.ts",
        guard: "if (eraseMarked && !erase) {",
      },
      {
        file: "apps/site/src/interest/join-contact-store.ts",
        guard: 'contact.pending === "erase"\n        );',
      },
    ],
    guard:
      'Refused(p) == erasedKey \\/ (EraseSticky /\\ pend = "erase" /\\ p # "erase")',
    invariant: "EraseWins",
    seeded: "Refused(p) == erasedKey",
    twin: {
      file: "apps/site/test/join-contact-cell.test.ts",
      title:
        "a delivery result read before an erase cannot overwrite the erase marker",
    },
  },
  {
    bug: "the answer leaving before the commit",
    cfg: module,
    code: [
      {
        file: "packages/core/src/join-intake.ts",
        guard:
          'yield* contacts.save(\n          withPending(withState(committed, "ready"), "delivery")\n        );\n\n        yield* request.afterResponse(',
      },
    ],
    guard: 'Answer ==\n  /\\ req = "committing"',
    invariant: "AnswerAtCommit",
    seeded: 'Answer ==\n  /\\ req = "recorded"',
    twin: {
      file: "packages/core/test/join-answer-at-commit.model.test.ts",
      title:
        "join answers at commit before drovr is called, and waitUntil or the redelivery backstop settles the same submission id",
    },
  },
  {
    bug: "a deliverer sending its own key",
    cfg: module,
    code: [
      {
        file: "packages/core/src/join-delivery-machine.ts",
        guard: "submissionId: contact.submissionId,",
      },
    ],
    guard: "KeyFor(d) == Sub",
    invariant: "SameKey",
    seeded: "KeyFor(d) == d",
    twin: {
      file: "packages/core/test/join-answer-at-commit.model.test.ts",
      title:
        "join answers at commit before drovr is called, and waitUntil or the redelivery backstop settles the same submission id",
    },
  },
  {
    bug: "delivery ignoring the erase marker",
    cfg: module,
    code: [
      {
        file: "packages/core/src/join-delivery-machine.ts",
        guard: 'contact.pending === "erase" ||',
      },
    ],
    guard: 'IF rec \\in {"absent", "held"} \\/ pend = "erase"',
    invariant: "NoSendAfterErase",
    seeded: 'IF rec \\in {"absent", "held"}',
    twin: {
      file: "packages/core/test/intake-sweep.model.test.ts",
      title:
        "the sweep finishes every pending delivery or erase; erase wins, tombstones land first, and nothing is sent after erase or acceptance",
    },
  },
  {
    bug: "the contact removed before its event tombstone",
    cfg: module,
    code: [
      {
        file: "packages/core/src/intake-erase.ts",
        guard:
          "Effect.retry(RETRY_ERASE_TOMBSTONE),\n    Effect.andThen(contacts.erase(submissionId)),",
      },
    ],
    guard: 'idx["eraser"] = "none"\n  /\\ epc\' = "tombstoning"',
    invariant: "TombstoneBeforeRemove",
    seeded: 'idx["eraser"] = "none"\n  /\\ epc\' = "removing"',
    twin: {
      file: "packages/core/test/intake-sweep.model.test.ts",
      title:
        "the sweep finishes every pending delivery or erase; erase wins, tombstones land first, and nothing is sent after erase or acceptance",
    },
  },
  {
    bug: "a delivery result dropping the erase marker",
    cfg: module,
    code: [
      {
        file: "packages/core/src/join-contact-store.ts",
        guard: 'return pending === "erase" ||',
      },
    ],
    guard: 'IF p = "erase" THEN "erase"',
    invariant: "EraseWins",
    seeded: 'IF FALSE THEN "erase"',
    twin: {
      file: "packages/core/test/intake-sweep.model.test.ts",
      title:
        "the sweep finishes every pending delivery or erase; erase wins, tombstones land first, and nothing is sent after erase or acceptance",
    },
  },
  {
    bug: "the store indexing only pending deliveries",
    cfg: module,
    code: [
      {
        file: "apps/site/src/interest/join-contact-store.ts",
        guard: "contact.pending !== undefined",
      },
    ],
    guard: 'indexed\' = (p # "none")',
    invariant: "OwedIsFindable",
    seeded: 'indexed\' = (p = "delivery")',
    twin: {
      file: "apps/site/test/join-contact-erase.test.ts",
      title:
        "keeps the sweep's pending index in step with each contact's marker and clears it on erase",
    },
  },
] as const;

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "join intake model",
  (test) => {
    for (const { cfg: name, holds } of safety) {
      test.effect(holds, () =>
        Effect.gen(function* safetyHolds() {
          const { cfg, spec } = yield* files;

          const outcome = yield* checkSpec({
            budget,
            cfg: yield* cfg(name),
            module,
            spec,
          });

          expect(outcome).toMatchObject({ kind: "pass" });
          expect(outcome.kind === "pass" && outcome.distinct).toBeGreaterThan(
            100_000
          );
        })
      );
    }

    test.effect(
      "settles every owed delivery or erase while the sweep keeps running",
      () =>
        Effect.gen(function* liveness() {
          const { cfg, spec } = yield* files;

          const outcome = yield* checkSpec({
            budget,
            cfg: yield* cfg("JoinIntakeSettles"),
            module,
            spec,
          });

          yield* warnNotChecked("JoinIntakeSettles", outcome);
          expect(outcome.kind).not.toBe("counterexample");
        })
    );

    for (const { cfg: name, environment, violates } of weaker) {
      test.effect(`${violates} fails when ${environment}`, () =>
        Effect.gen(function* weakerEnvironment() {
          const { cfg, spec } = yield* files;

          const outcome = yield* checkSpec({
            budget,
            cfg: yield* cfg(name),
            module,
            spec,
          });

          expect(outcome).toEqual({
            exit: 12,
            kind: "counterexample",
            violated: violates,
          });
        })
      );
    }

    for (const {
      bug,
      cfg: name,
      code,
      guard,
      invariant,
      seeded,
      twin,
    } of flips) {
      test.effect(`${invariant} alone catches ${bug}`, () =>
        Effect.gen(function* guardFlip() {
          const { cfg, read, spec } = yield* files;

          expect(spec.split(guard)).toHaveLength(2);
          expect(yield* read(twin.file)).toContain(twin.title);

          for (const site of code) {
            expect(yield* read(site.file)).toContain(site.guard);
          }

          const single = onlyInvariant(yield* cfg(name), invariant);

          expect(Option.isSome(single)).toBe(true);

          const outcome = yield* checkSpec({
            budget,
            cfg: Option.getOrElse(single, () => ""),
            module,
            spec: spec.replace(guard, seeded),
          });

          expect(outcome).toEqual({
            exit: 12,
            kind: "counterexample",
            violated: invariant,
          });
        })
      );
    }

    test.effect("never reports a spec that does not parse as checked", () =>
      Effect.gen(function* malformed() {
        const { cfg, spec } = yield* files;

        const outcome = yield* checkSpec({
          budget,
          cfg: yield* cfg(module),
          module,
          spec: spec.replace("Owed ==", "Owed == (("),
        });

        expect(outcome.kind).toBe("notChecked");
        expect(outcome.kind === "notChecked" ? outcome.reason : "").toContain(
          "tla-ts exited 150"
        );
      })
    );

    test.effect("never reports a run stopped by its budget as checked", () =>
      Effect.gen(function* budgetKill() {
        const { cfg, spec } = yield* files;

        const outcome = yield* checkSpec({
          budget: "1 millis",
          cfg: yield* cfg(module),
          module,
          spec,
        });

        expect(outcome.kind).toBe("notChecked");
        expect(outcome.kind === "notChecked" ? outcome.reason : "").toContain(
          "budget"
        );
      })
    );
  }
);
