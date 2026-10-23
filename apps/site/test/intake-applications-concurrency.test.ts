import { expect, it } from "@effect/vitest";
import { ContactRefSchema, IntakeEvents } from "@rat-stack/core/intake";
import type { ContactRef, IntakeStatement } from "@rat-stack/core/intake";
import {
  IntakeApplications,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import type { IntakeApplication } from "@rat-stack/core/join-interest";
import {
  makeMemoryIntakeVault,
  sealedIntakeEventsLayer,
} from "@rat-stack/intake-live";
import { Deferred, Effect, Option, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  applicationReadConcurrency,
  intakeApplicationsLayer,
} from "../src/interest/applications.js";

type Kind = "live" | "vault-erased" | "erased-indexed" | "legacy";

const kinds: readonly Kind[] = [
  "live",
  "vault-erased",
  "erased-indexed",
  "legacy",
];

const contactRef = (index: number): ContactRef =>
  Schema.decodeSync(ContactRefSchema)(`synthetic-contact-${index}`);

const submissionFor = (index: number) => `synthetic-submission-${index}`;

const statementsFor = (index: number): readonly IntakeStatement[] => {
  const context = {
    intake: "tokenmaxx",
    submissionId: submissionFor(index),
  } as const;

  const actor = contactRef(index);
  const timestamp = "2026-10-01T18:00:00.000Z";

  const id = (suffix: number) =>
    `0199a000-0000-7000-8000-${String(index * 10 + suffix).padStart(12, "0")}`;

  return [
    {
      actor,
      context,
      id: id(1),
      object: "tokenmaxx/consents/share",
      result: true,
      timestamp,
      verb: "consented",
    },
    {
      actor,
      context,
      id: id(2),
      object: "tokenmaxx/intake",
      result: { held: false, score: 0, signals: [] },
      timestamp,
      verb: "submitted",
    },
  ];
};

const build = (
  mix: readonly Kind[],
  gate: (stage: "contact" | "vault") => Effect.Effect<void>
) =>
  Effect.gen(function* buildFixture() {
    const vault = yield* makeMemoryIntakeVault;

    const base = yield* Layer.build(
      Layer.mergeAll(
        JoinContactStore.testLayer,
        sealedIntakeEventsLayer.pipe(Layer.provide(vault.layer))
      )
    );

    const contacts = yield* JoinContactStore.pipe(Effect.provideContext(base));
    const events = yield* IntakeEvents.pipe(Effect.provideContext(base));
    const indexed = yield* Ref.make<readonly string[]>([]);
    const idCalls = yield* Ref.make(0);

    for (const [index, kind] of mix.entries()) {
      const submissionId = submissionFor(index);

      if (kind === "live" || kind === "vault-erased") {
        yield* contacts.save({
          agentRef: "synthetic-agent",
          clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
          contactRef: contactRef(index),
          email: `synthetic-${index}@example.test`,
          hold: false,
          score: 0,
          signals: [],
          state: "held",
          submissionId,
          ticket: "synthetic-ticket",
        });
      }

      if (kind === "live") {
        yield* events.record(statementsFor(index));
      }

      if (kind !== "legacy") {
        yield* Ref.update(indexed, (all) => [...all, submissionId]);
      }
    }

    const slowContacts: JoinContactStore["Service"] = {
      ...contacts,
      read: (submissionId) =>
        gate("contact").pipe(Effect.andThen(contacts.read(submissionId))),
    };

    const reader = yield* IntakeApplications.pipe(
      Effect.provide(
        intakeApplicationsLayer(
          () =>
            Ref.update(idCalls, (n) => n + 1).pipe(
              Effect.andThen(Ref.get(indexed))
            ),
          (actor) => ({
            intakeRead: () =>
              gate("vault").pipe(
                Effect.andThen(vault.contents),
                Effect.map((all) => {
                  const held = all.get(actor);

                  return {
                    key: held?.key,
                    rows: [...(held?.rows ?? [])].map(([id, sealed]) => ({
                      id,
                      sealed,
                    })),
                  };
                })
              ),
          })
        ).pipe(Layer.provide(Layer.succeed(JoinContactStore, slowContacts)))
      )
    );

    return { idCalls, reader };
  });

const expectedFor = (kind: Kind): string => {
  if (kind === "live") {
    return "forwarded-or-held";
  }

  return kind === "legacy" ? "no-answers" : "erased";
};

const summarize = (applications: readonly IntakeApplication[]) =>
  applications.map((application) => [
    application.submissionId,
    application.state === "held" ? "forwarded-or-held" : application.state,
  ]);

it.effect.prop(
  "returns the same applications, in id order, as a serial read of any erased or missing mix",
  {
    mix: Arbitrary.schema(
      Schema.Array(Schema.Literals(kinds)).check(Schema.isMaxLength(20))
    ),
  },
  ({ mix }) =>
    Effect.gen(function* parallelMatchesSerial() {
      const { idCalls, reader } = yield* build(mix, () => Effect.void);

      const listed = yield* reader.list();
      const indexedKinds = mix.filter((kind) => kind !== "legacy");

      expect(listed).toHaveLength(indexedKinds.length);

      const expected = mix.flatMap((kind, index) =>
        kind === "legacy" ? [] : [[submissionFor(index), expectedFor(kind)]]
      );

      expect(summarize(listed)).toEqual(expected);
      expect(yield* Ref.get(idCalls)).toBe(1);

      for (const [index, kind] of mix.entries()) {
        const [single] = yield* reader.list(submissionFor(index));
        expect(
          single?.state === "held" ? "forwarded-or-held" : single?.state
        ).toBe(expectedFor(kind));
      }
    }).pipe(Effect.scoped)
);

it.effect("overlaps contact and vault reads across applications", () =>
  Effect.gen(function* overlapping() {
    const size = applicationReadConcurrency;
    const inflight = yield* Ref.make(0);
    const peak = yield* Ref.make(0);
    const release = yield* Deferred.make<true>();

    const gate = () =>
      Ref.modify(inflight, (n) => [n + 1, n + 1] as const).pipe(
        Effect.flatMap((now) =>
          Ref.update(peak, (p) => Math.max(p, now)).pipe(
            Effect.andThen(
              now >= 2 ? Deferred.succeed(release, true) : Effect.void
            )
          )
        ),
        Effect.andThen(Deferred.await(release)),
        Effect.ensuring(Ref.update(inflight, (n) => n - 1))
      );

    const { reader } = yield* build(
      Array.from({ length: size }, (): Kind => "live"),
      gate
    );

    const listed = yield* reader.list().pipe(
      Effect.timeoutOption("5 seconds"),
      Effect.map((option) => (Option.isSome(option) ? option.value : []))
    );

    expect(listed).toHaveLength(size);
    expect(yield* Ref.get(peak)).toBeGreaterThanOrEqual(2);
  }).pipe(Effect.scoped)
);

it.effect.prop(
  "never has more application reads in flight than the bound, at any index size",
  {
    size: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 40, minimum: 1 }))
    ),
  },
  ({ size }) =>
    Effect.gen(function* boundedFanOut() {
      const inflight = yield* Ref.make(0);
      const peak = yield* Ref.make(0);

      const gate = () =>
        Ref.modify(inflight, (n) => [n + 1, n + 1] as const).pipe(
          Effect.flatMap((now) => Ref.update(peak, (p) => Math.max(p, now))),
          Effect.andThen(Effect.repeat(Effect.yieldNow, { times: 8 })),
          Effect.ensuring(Ref.update(inflight, (n) => n - 1))
        );

      const { reader } = yield* build(
        Array.from({ length: size }, (): Kind => "live"),
        gate
      );

      const listed = yield* reader.list();

      expect(listed.map((application) => application.submissionId)).toEqual(
        Array.from({ length: size }, (_unused, index) => submissionFor(index))
      );
      expect(yield* Ref.get(peak)).toBeLessThanOrEqual(
        applicationReadConcurrency
      );
      expect(yield* Ref.get(peak)).toBe(
        Math.min(size, applicationReadConcurrency)
      );
    }).pipe(Effect.scoped)
);
