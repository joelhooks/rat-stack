import { expect, it } from "@effect/vitest";
import {
  InterestMailer,
  RecordedMail,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";

import {
  plainTextToHtml,
  postShibaMailerLayer,
  sendsUrl,
} from "../src/postshiba.js";

const mail = {
  from: "workshop@example.test",
  idempotencyKey: "key-1",
  subject: "Confirm",
  text: "Hi\n\nhttps://example.test/confirm?token=a.b",
  to: "reader@example.com",
};

const settings = {
  apiKey: Redacted.make("test-api-key"),
  cluster: "cluster-1",
  enabled: false,
  team: "team-1",
};

const fakeClient = (status: number) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ queued: true }, { status })
        )
      );
    })
  );

  return { layer, requests };
};

it.effect("records messages in the recording layer", () =>
  Effect.gen(function* recordsMessages() {
    const mailer = yield* InterestMailer;
    const recorded = yield* RecordedMail;

    expect(yield* mailer.send(mail)).toBe("sent");
    expect(yield* recorded.all).toEqual([mail]);
  }).pipe(Effect.provide(recordingMailerLayer))
);

it.effect("does not call the provider while sending is disabled", () =>
  Effect.gen(function* staysOff() {
    const client = fakeClient(200);

    const result = yield* Effect.gen(function* send() {
      const mailer = yield* InterestMailer;

      return yield* mailer.send(mail);
    }).pipe(
      Effect.provide(
        postShibaMailerLayer({ ...settings, enabled: false }).pipe(
          Layer.provide(client.layer)
        )
      )
    );

    expect(result).toBe("skipped");
    expect(client.requests).toHaveLength(0);
  })
);

it.effect("posts one message to the provider when sending is enabled", () =>
  Effect.gen(function* sendsWhenEnabled() {
    const client = fakeClient(200);

    const result = yield* Effect.gen(function* send() {
      const mailer = yield* InterestMailer;

      return yield* mailer.send(mail);
    }).pipe(
      Effect.provide(
        postShibaMailerLayer({ ...settings, enabled: true }).pipe(
          Layer.provide(client.layer)
        )
      )
    );

    expect(result).toBe("sent");
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.url).toBe(
      sendsUrl({ ...settings, enabled: true })
    );
    expect(client.requests[0]?.headers["idempotency-key"]).toBe("key-1");
  })
);

it.effect("fails with a typed error when the provider refuses", () =>
  Effect.gen(function* failsOnRefusal() {
    const client = fakeClient(403);

    const failure = yield* Effect.flip(
      Effect.gen(function* send() {
        const mailer = yield* InterestMailer;

        return yield* mailer.send(mail);
      }).pipe(
        Effect.provide(
          postShibaMailerLayer({ ...settings, enabled: true }).pipe(
            Layer.provide(client.layer)
          )
        )
      )
    );

    expect(failure.reason).toBe("http_403");
  })
);

it("escapes text and links bare URLs in the html part", () => {
  expect(plainTextToHtml("a <b>\n\nsee https://example.test/x")).toBe(
    '<p>a &lt;b&gt;</p>\n<p>see <a href="https://example.test/x">https://example.test/x</a></p>'
  );
});
