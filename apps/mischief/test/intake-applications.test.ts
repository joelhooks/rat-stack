import { expect, it } from "@effect/vitest";
import { CallWatch } from "@rat-stack/capability/call-watch";
import { ContactRefSchema, IntakeEvents } from "@rat-stack/core/intake";
import type { IntakeStatement } from "@rat-stack/core/intake";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import {
  IntakeApplications,
  IntakeErasure,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import { withEventCapture } from "@rat-stack/events";
import { EventSinkMemory, memoryEventsLayer } from "@rat-stack/events/memory";
import {
  makeMemoryIntakeVault,
  sealedIntakeEventsLayer,
} from "@rat-stack/intake-live";
import { Effect, Layer, Logger, Redacted, Ref, Schema, Tracer } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpRouter from "effect/http/HttpRouter";

import { privateHttpTracingLayer } from "../src/http-privacy.js";
import { intakeApplicationsLayer } from "../src/interest/applications.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { interestRoutes } from "../src/interest/routes.js";
import { fakeIntakeLayer } from "./fixtures/fake-intake.js";

const call = (
  handler: (request: Request) => Promise<Response>,
  request: Request
) =>
  Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- The in-memory router owns this Promise boundary.
    () => handler(request)
  );

const actor = Schema.decodeSync(ContactRefSchema)("synthetic-contact");

const fixtureStatements = (
  building: string,
  share = true,
  identity: { readonly name?: string; readonly x?: string } = {}
): readonly IntakeStatement[] => [
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000006",
    object: "tokenmaxx/intake",
    result: identity,
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "started",
  },
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000001",
    object: "tokenmaxx/questions/building",
    result: building,
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "answered",
  },
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000002",
    object: "tokenmaxx/consents/share",
    result: share,
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "consented",
  },
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000003",
    object: "tokenmaxx/intake",
    result: { held: false, score: 0, signals: [] },
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "submitted",
  },
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000004",
    object: "tokenmaxx/questions/today",
    result: building,
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "answered",
  },
  {
    actor,
    context: { intake: "tokenmaxx", submissionId: "synthetic-submission" },
    id: "0199a000-0000-7000-8000-000000000005",
    object: "tokenmaxx/questions/leaveWith",
    result: building,
    timestamp: "2026-10-01T18:00:00.000Z",
    verb: "answered",
  },
];

const makeReaderFixture = Effect.gen(function* makeFixture() {
  const vault = yield* makeMemoryIntakeVault;

  const sealedContacts = yield* Ref.make<ReadonlyMap<string, string>>(
    new Map()
  );

  const indexed = yield* Ref.make<readonly string[]>([]);
  const failErase = yield* Ref.make(false);

  const services = yield* Layer.build(
    joinContactStoreLayer(
      (submissionId) => ({
        joinErase: () =>
          Ref.get(failErase).pipe(
            Effect.flatMap((fail) =>
              fail
                ? Effect.die(
                    "synthetic-private-answer-marker:synthetic@example.test"
                  )
                : Ref.update(
                    sealedContacts,
                    (all) =>
                      new Map([...all].filter(([id]) => id !== submissionId))
                  )
            )
          ),
        joinRead: () =>
          Ref.get(sealedContacts).pipe(
            Effect.map((all) => all.get(submissionId))
          ),
        joinSave: (sealed) =>
          Ref.update(sealedContacts, (all) =>
            new Map(all).set(submissionId, sealed)
          ),
      }),
      (submissionId) =>
        Ref.update(indexed, (ids) => [...new Set([...ids, submissionId])])
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          InterestTokens.layer(Redacted.make("synthetic-reader-secret")),
          sealedIntakeEventsLayer.pipe(Layer.provide(vault.layer))
        )
      )
    )
  );

  const contacts = yield* JoinContactStore.pipe(
    Effect.provideContext(services)
  );

  const events = yield* IntakeEvents.pipe(Effect.provideContext(services));

  const reader = yield* IntakeApplications.pipe(
    Effect.provide(
      intakeApplicationsLayer(
        () => Ref.get(indexed),
        (contactRef) => ({
          intakeRead: () =>
            vault.contents.pipe(
              Effect.map((contents) => {
                const held = contents.get(contactRef);

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
      ).pipe(Layer.provide(Layer.succeedContext(services)))
    )
  );

  return {
    contacts,
    events,
    failErase,
    indexed,
    reader,
    sealedContacts,
    vault,
  };
});

const seedContact = (
  contacts: JoinContactStore["Service"],
  state: "held" | "accepted"
) =>
  contacts.save({
    agentRef: "synthetic-agent",
    clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
    contactRef: actor,
    email: "synthetic@example.test",
    hold: false,
    score: 0,
    signals: [],
    state,
    submissionId: "synthetic-submission",
    ticket: "synthetic-ticket",
  });

it.effect.prop(
  "unseals arbitrary answers and keeps erased or legacy lookups free of contact data",
  {
    building: Arbitrary.schema(Schema.String),
    forwarded: Arbitrary.schema(Schema.Boolean),
    share: Arbitrary.schema(Schema.Boolean),
    withIdentity: Arbitrary.schema(Schema.Boolean),
  },
  ({ building, forwarded, share, withIdentity }) =>
    Effect.gen(function* roundTrip() {
      const { contacts, events, indexed, reader, sealedContacts } =
        yield* makeReaderFixture;

      expect(yield* reader.list()).toEqual([]);
      yield* seedContact(contacts, forwarded ? "accepted" : "held");

      const identity = withIdentity
        ? { name: "Fake Applicant", x: "https://x.com/fake_applicant" }
        : {};

      const statements = fixtureStatements(building, share, identity);

      yield* events.record(
        withIdentity
          ? statements
          : statements.filter((row) => row.verb !== "started")
      );
      expect(yield* Ref.get(indexed)).toEqual(["synthetic-submission"]);
      expect(
        JSON.stringify([...(yield* Ref.get(sealedContacts)).values()])
      ).not.toContain("synthetic@example.test");
      expect(yield* reader.list()).toEqual([
        {
          answers: { building, leaveWith: building, today: building },
          email: "synthetic@example.test",
          ...identity,
          hold: false,
          score: 0,
          share,
          signals: [],
          source: "agent",
          state: forwarded ? "forwarded" : "held",
          submissionId: "synthetic-submission",
          submittedAt: "2026-10-01T18:00:00.000Z",
        },
      ]);
      expect(yield* reader.list("legacy-browser-submission")).toEqual([
        {
          reason: "no answers: legacy browser signup or erased contact",
          state: "no-answers",
          submissionId: "legacy-browser-submission",
        },
      ]);
      yield* events.erase(actor);
      expect(yield* reader.list()).toEqual([
        {
          reason: "erased",
          state: "erased",
          submissionId: "synthetic-submission",
        },
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "guards the operator reader and emits neither plaintext nor operator metadata to observers",
  () =>
    Effect.gen(function* privateReader() {
      const { contacts, events, failErase, reader, sealedContacts, vault } =
        yield* makeReaderFixture;

      const answer = "synthetic-private-answer-marker";
      yield* seedContact(contacts, "accepted");

      const identity = {
        name: "Fake Private Applicant",
        x: "https://x.com/fake_private",
      };

      yield* events.record(fixtureStatements(answer, true, identity));

      const sealedRows = JSON.stringify(
        [...(yield* vault.contents).values()].map((held) => [
          ...held.rows.values(),
        ])
      );

      for (const value of [answer, identity.name, identity.x]) {
        expect(sealedRows).not.toContain(value);
      }

      const logs: unknown[] = [];
      const spans: Tracer.NativeSpan[] = [];
      const calls: unknown[] = [];

      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);

          return span;
        },
      });

      const telemetry = yield* Layer.build(
        Layer.mergeAll(
          memoryEventsLayer("synthetic-salt"),
          Logger.layer([Logger.make(({ message }) => logs.push(message))]),
          Layer.succeed(Tracer.Tracer, tracer),
          Layer.succeed(CallWatch, {
            around: (_contract, input, run) => {
              calls.push(input);

              return run;
            },
          })
        )
      );

      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestMode.layer("drovr"),
          InterestTokens.layer(Redacted.make("synthetic-secret")),
          SubscriberConfirm.unconfigured,
          recordingMailerLayer,
          fakeIntakeLayer
        )
      );

      const routes = interestRoutes({
        applications: reader,
        erasure: yield* IntakeErasure.pipe(
          Effect.provide(IntakeErasure.layer),
          Effect.provideService(JoinContactStore, contacts)
        ),
        operatorToken: "synthetic-operator",
        services,
      }).pipe(
        Layer.provideMerge(privateHttpTracingLayer),
        Layer.provideMerge(Layer.succeedContext(telemetry))
      );

      const { handler, dispose } = HttpRouter.toWebHandler(routes, {
        disableLogger: true,
        middleware: withEventCapture({
          identityMode: "daily",
          runInBackground: (effect) => effect,
        }),
      });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      for (const token of [undefined, "wrong", "synthetic-operator"]) {
        const request = new Request(
          "https://ratstack.sh/operator/interest/applications",
          {
            headers:
              token === undefined ? {} : { authorization: `Bearer ${token}` },
          }
        );

        const response = yield* call(handler, request);

        expect(response.status).toBe(
          token === "synthetic-operator" ? 200 : 401
        );

        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex");

        if (response.status === 200) {
          const body = yield* Effect.promise(response.json.bind(response));
          expect(body).toMatchObject([
            {
              answers: { building: answer },
              email: "synthetic@example.test",
              ...identity,
            },
          ]);
        }
      }

      for (const token of [undefined, "wrong", "synthetic-operator"]) {
        const response = yield* call(
          handler,
          new Request(
            "https://ratstack.sh/operator/interest/applications/erase",
            {
              body: JSON.stringify({ submissionIds: 42 }),
              headers:
                token === undefined ? {} : { authorization: `Bearer ${token}` },
              method: "POST",
            }
          )
        );

        expect(response.status).toBe(
          token === "synthetic-operator" ? 400 : 401
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex");
      }

      for (const body of [
        "{",
        "{}",
        JSON.stringify({ submissionIds: [] }),
        JSON.stringify({ submissionIds: [""] }),
        JSON.stringify({ submissionIds: [42] }),
      ]) {
        const response = yield* call(
          handler,
          new Request(
            "https://ratstack.sh/operator/interest/applications/erase",
            {
              body,
              headers: { authorization: "Bearer synthetic-operator" },
              method: "POST",
            }
          )
        );

        expect(response.status).toBe(400);
      }

      const historical = yield* call(
        handler,
        new Request(
          "https://ratstack.sh/operator/interest/applications?submissionId=legacy-browser-submission",
          { headers: { authorization: "Bearer synthetic-operator" } }
        )
      );

      expect(historical.status).toBe(200);
      expect(
        yield* Effect.promise(historical.json.bind(historical))
      ).toMatchObject([{ state: "no-answers" }]);

      yield* Ref.set(failErase, true);

      const partial = yield* call(
        handler,
        new Request(
          "https://ratstack.sh/operator/interest/applications/erase",
          {
            body: JSON.stringify({ submissionIds: ["synthetic-submission"] }),
            headers: { authorization: "Bearer synthetic-operator" },
            method: "POST",
          }
        )
      );

      expect(partial.status).toBe(200);
      expect(yield* Effect.promise(partial.json.bind(partial))).toEqual({
        alreadyGone: 0,
        erased: 0,
        failed: 1,
      });
      expect(yield* contacts.read("synthetic-submission")).toBeDefined();
      expect((yield* vault.contents).size).toBe(0);
      yield* Ref.set(failErase, false);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const erased = yield* call(
          handler,
          new Request(
            "https://ratstack.sh/operator/interest/applications/erase",
            {
              body: JSON.stringify({
                submissionIds: ["synthetic-submission", "synthetic-submission"],
              }),
              headers: { authorization: "Bearer synthetic-operator" },
              method: "POST",
            }
          )
        );

        expect(erased.status).toBe(200);
        expect(yield* Effect.promise(erased.json.bind(erased))).toEqual({
          alreadyGone: attempt === 0 ? 0 : 1,
          erased: attempt === 0 ? 1 : 0,
          failed: 0,
        });

        const after = yield* call(
          handler,
          new Request(
            "https://ratstack.sh/operator/interest/applications?submissionId=synthetic-submission",
            {
              headers: { authorization: "Bearer synthetic-operator" },
            }
          )
        );

        expect(yield* Effect.promise(after.json.bind(after))).toEqual([
          {
            reason: "erased",
            state: "erased",
            submissionId: "synthetic-submission",
          },
        ]);
        expect(yield* contacts.read("synthetic-submission")).toBeUndefined();
        expect((yield* vault.contents).size).toBe(0);
      }

      yield* Ref.update(sealedContacts, (all) =>
        new Map(all).set(
          "synthetic-submission",
          `${answer}:synthetic@example.test`
        )
      );

      const corrupted = yield* call(
        handler,
        new Request("https://ratstack.sh/operator/interest/applications", {
          headers: { authorization: "Bearer synthetic-operator" },
        })
      );

      expect(corrupted.status).toBe(503);
      expect(yield* Effect.promise(corrupted.text.bind(corrupted))).toBe(
        "Applications unavailable.\n"
      );

      const sink = yield* EventSinkMemory.pipe(
        Effect.provideContext(telemetry)
      );

      expect(yield* sink.events).toEqual([]);
      expect(logs).toEqual([]);
      expect(spans).toEqual([]);
      expect(calls).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect("disables the route when no operator token is configured", () =>
  Effect.gen(function* unconfiguredReader() {
    const services = yield* Layer.build(
      Layer.mergeAll(
        InterestDirectory.memory,
        InterestMode.layer("drovr"),
        InterestTokens.layer(Redacted.make("synthetic-secret")),
        SubscriberConfirm.unconfigured,
        recordingMailerLayer,
        fakeIntakeLayer
      )
    );

    const { handler, dispose } = HttpRouter.toWebHandler(
      interestRoutes({ services }),
      { disableLogger: true }
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const response = yield* call(
      handler,
      new Request("https://ratstack.sh/operator/interest/applications")
    );

    expect(response.status).toBe(404);

    const erased = yield* call(
      handler,
      new Request("https://ratstack.sh/operator/interest/applications/erase", {
        body: JSON.stringify({ submissionIds: ["synthetic-submission"] }),
        method: "POST",
      })
    );

    expect(erased.status).toBe(404);
    expect(erased.headers.get("cache-control")).toBe("no-store");
    expect(erased.headers.get("x-robots-tag")).toBe("noindex");
  }).pipe(Effect.scoped)
);
