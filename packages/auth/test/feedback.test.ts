import { expect, it } from "@effect/vitest";
import { RuntimeContext } from "alchemy";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { TestClock } from "effect/testing";

import { Auth } from "../src/auth.js";
import { FeedbackIdentity } from "../src/feedback.js";

const providerRequest = Effect.fn("providerRequest")(function* providerRequest(
  path: string,
  body?: Schema.Json,
  cookie?: string
) {
  const auth = yield* Auth;

  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://auth.test",
  });

  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }

  const request =
    body === undefined
      ? new Request(`http://auth.test/auth${path}`, { headers })
      : new Request(`http://auth.test/auth${path}`, {
          body: JSON.stringify(body),
          headers,
          method: "POST",
        });

  const response = yield* auth.fetch.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(request)
    ),
    Effect.orDie
  );

  return HttpServerResponse.toWeb(response);
});

const Signup = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

const makeFixture = Effect.gen(function* makeFixture() {
  const response = yield* providerRequest("/sign-up/email", {
    email: "feedback@example.com",
    name: "Feedback Person",
    password: "password1234",
  });

  expect(response.status).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((part) => part.split(";")[0])
    .join("; ");

  const signup = yield* Effect.promise(response.json.bind(response)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Signup)),
    Effect.orDie
  );

  const identity = yield* FeedbackIdentity;
  const requested = yield* identity.request;

  const approved = yield* providerRequest(
    "/device/approve",
    { userCode: requested.userCode },
    cookie
  );

  expect(approved.status).toBe(200);
  const observed = yield* identity.inspectDevice(requested.deviceCode);

  if (observed.state !== "approved") {
    return yield* Effect.die(
      new Error("Approved device did not return a feedback grant")
    );
  }

  const token = yield* identity.issue(observed.grant);

  return {
    cookie,
    grant: observed.grant,
    personId: signup.user.id,
    request: requested,
    token,
  };
});

class Fixture extends Context.Service<
  Fixture,
  Effect.Success<typeof makeFixture>
>()("FeedbackTest/Fixture") {}

const services = Layer.effect(Fixture, makeFixture).pipe(
  Layer.provideMerge(
    FeedbackIdentity.layer.pipe(
      Layer.provideMerge(
        Auth.memoryLayer("feedback-test-secret-with-enough-entropy", {
          baseURL: "http://auth.test",
        })
      )
    )
  ),
  Layer.provideMerge(RuntimeContext.phantom)
);

const nonFeedbackCapability = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.filter((name) => name !== "learnFeedback")
);

it.layer(services)((test) => {
  test.effect.prop(
    "a valid feedback credential cannot authorize any non-feedback capability or a normal sign-in session",
    {
      capability: nonFeedbackCapability,
      transport: Schema.Literals(["bearer", "cookie"]),
    },
    ({ capability, transport }) =>
      Effect.gen(function* scopeProperty() {
        const fixture = yield* Fixture;
        const identity = yield* FeedbackIdentity;
        const auth = yield* Auth;
        expect(
          yield* identity.inspectCredential(fixture.token, "learnFeedback")
        ).toStrictEqual({ personId: fixture.personId, state: "active" });
        expect(
          yield* identity.inspectCredential(fixture.token, capability)
        ).toStrictEqual({ state: "unauthenticated" });

        const headers =
          transport === "bearer"
            ? new Headers({ authorization: `Bearer ${fixture.token}` })
            : new Headers({
                cookie: `better-auth.session_token=${fixture.token}`,
              });

        expect(yield* auth.getSession(headers)).toBeNull();
        expect(
          (yield* auth.getSession(new Headers({ cookie: fixture.cookie })))
            ?.user.id
        ).toBe(fixture.personId);
      })
  );

  test.effect.prop(
    "tampering cannot create a feedback author",
    { suffix: Schema.String.check(Schema.isNonEmpty()) },
    ({ suffix }) =>
      Effect.gen(function* tamperProperty() {
        const fixture = yield* Fixture;
        const identity = yield* FeedbackIdentity;
        expect(
          yield* identity.inspectCredential(
            `${fixture.token}${suffix}`,
            "learnFeedback"
          )
        ).toStrictEqual({ state: "unauthenticated" });
      })
  );

  test.effect(
    "the stock device exchange is unreachable even for an approved device",
    () =>
      Effect.gen(function* rawExchange() {
        const fixture = yield* Fixture;

        const response = yield* providerRequest("/device/token", {
          client_id: "rat-stack-learn-feedback",
          device_code: fixture.request.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });

        expect(response.status).toBe(404);
        expect(
          (yield* providerRequest("/device/code", {
            client_id: "rat-stack-learn-feedback",
            scope: "learn:feedback",
          })).status
        ).toBe(404);
      })
  );

  test.effect("expired credentials authorize no feedback", () =>
    Effect.gen(function* expiry() {
      const fixture = yield* Fixture;
      const identity = yield* FeedbackIdentity;
      const before = yield* Clock.currentTimeMillis;
      yield* Effect.gen(function* advanceDeadline() {
        yield* TestClock.setTime(fixture.grant.expiresAt);
        expect(
          yield* identity.inspectCredential(fixture.token, "learnFeedback")
        ).toStrictEqual({ state: "expired" });
        expect(
          (yield* identity.inspectDevice(fixture.request.deviceCode)).state
        ).toBe("expired");
      }).pipe(Effect.ensuring(TestClock.setTime(before)));
    })
  );

  test.effect(
    "feedback belongs to the approving person and a denied device grants nothing",
    () =>
      Effect.gen(function* personIsolation() {
        const fixture = yield* Fixture;
        const identity = yield* FeedbackIdentity;
        const auth = yield* Auth;

        const resolved = yield* identity.inspectCredential(
          fixture.token,
          "learnFeedback"
        );

        if (resolved.state !== "active") {
          return yield* Effect.die(
            new Error("Fixture credential was not active")
          );
        }

        const saved = yield* identity.save(
          resolved.personId,
          "lore.effect-basics",
          "The code example helped."
        );

        const instance = yield* auth.auth;

        const context = yield* Effect.promise(
          // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
          () => instance.$context
        );

        const raw = yield* Effect.promise(
          // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
          () =>
            context.adapter.findOne({
              model: "learnFeedback",
              where: [{ field: "id", value: saved.id }],
            })
        );

        const row = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            cardId: Schema.String,
            feedback: Schema.String,
            personId: Schema.String,
          })
        )(raw).pipe(Effect.orDie);

        expect(row).toStrictEqual({
          cardId: "lore.effect-basics",
          feedback: "The code example helped.",
          personId: fixture.personId,
        });
        const requested = yield* identity.request;
        expect(
          (yield* providerRequest(
            "/device/deny",
            { userCode: requested.userCode },
            fixture.cookie
          )).status
        ).toBe(200);
        expect(
          (yield* identity.inspectDevice(requested.deviceCode)).state
        ).toBe("denied");
        expect(
          (yield* providerRequest(
            "/device/approve",
            { userCode: requested.userCode },
            fixture.cookie
          )).status
        ).toBe(400);
        expect(
          (yield* identity.inspectDevice(requested.deviceCode)).state
        ).toBe("denied");

        return yield* Effect.void;
      })
  );
});
