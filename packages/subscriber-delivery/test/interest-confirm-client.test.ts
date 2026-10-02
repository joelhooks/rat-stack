import { expect, it } from "@effect/vitest";
import { SubscriberConfirm } from "@rat-stack/core/interest";
import type { ConfirmState } from "@rat-stack/core/interest";
import { Effect, Layer, Option, Predicate, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  CONFIRM_PATH,
  TOKEN_STATE_PATH,
  drovrConfirmLayer,
} from "../src/drovr-confirm.js";

interface Seen {
  readonly auth: string | undefined;
  readonly body: string;
  readonly url: string;
}

const fakeApi = (status: number, body: string) => {
  const seen: Seen[] = [];

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const raw = request.body;

      seen.push({
        auth: request.headers.authorization,
        body: Predicate.isTagged(raw, "Uint8Array")
          ? new TextDecoder().decode(raw.body)
          : "",
        url: request.url,
      });

      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(body, { status }))
      );
    })
  );

  return { layer, seen };
};

const dead = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die(new Error("network down")))
);

const configured = {
  base: Option.some("https://drovr.test/api/"),
  credential: Option.some(Redacted.make("secret")),
};

const run = <A>(
  client: Layer.Layer<HttpClient.HttpClient>,
  use: (confirm: SubscriberConfirm["Service"]) => Effect.Effect<A>,
  settings: Parameters<typeof drovrConfirmLayer>[0] = configured
) =>
  SubscriberConfirm.use(use).pipe(
    Effect.provide(drovrConfirmLayer(settings).pipe(Layer.provide(client)))
  );

const stateBody = (state: string) => JSON.stringify({ state });

it.effect("reads each token state without confirming", () =>
  Effect.gen(function* reads() {
    for (const state of [
      "pending",
      "confirmed",
      "expired",
      "invalid",
    ] as const) {
      const api = fakeApi(200, stateBody(state));

      const result = yield* run(api.layer, (confirm) => confirm.state("tok"));

      expect(result).toBe(state);
      expect(api.seen).toHaveLength(1);
      expect(api.seen[0]?.url).toBe(
        `https://drovr.test/api${TOKEN_STATE_PATH}`
      );
      expect(api.seen[0]?.auth).toBe("Bearer secret");
      expect(JSON.parse(api.seen[0]?.body ?? "")).toEqual({ token: "tok" });
    }
  })
);

it.effect("confirms with the confirm path and never answers pending", () =>
  Effect.gen(function* confirms() {
    for (const state of ["confirmed", "expired", "invalid"] as const) {
      const api = fakeApi(200, stateBody(state));

      expect(yield* run(api.layer, (confirm) => confirm.confirm("tok"))).toBe(
        state
      );
      expect(api.seen[0]?.url).toBe(`https://drovr.test/api${CONFIRM_PATH}`);
    }

    const pending = fakeApi(200, stateBody("pending"));

    expect(yield* run(pending.layer, (confirm) => confirm.confirm("tok"))).toBe(
      "invalid"
    );
  })
);

it.effect("fails closed to invalid on every failure kind, for both calls", () =>
  Effect.gen(function* failsClosed() {
    const failures: Layer.Layer<HttpClient.HttpClient>[] = [
      fakeApi(500, stateBody("confirmed")).layer,
      fakeApi(404, stateBody("confirmed")).layer,
      fakeApi(202, stateBody("confirmed")).layer,
      fakeApi(200, "not json").layer,
      fakeApi(200, JSON.stringify({ state: "maybe" })).layer,
      fakeApi(200, "{}").layer,
      dead,
    ];

    for (const client of failures) {
      const results: ConfirmState[] = [
        yield* run(client, (confirm) => confirm.state("tok")),
        yield* run(client, (confirm) => confirm.confirm("tok")),
      ];

      expect(results).toEqual(["invalid", "invalid"]);
    }
  })
);

it.effect("makes no call and answers invalid when a binding is missing", () =>
  Effect.gen(function* missing() {
    const api = fakeApi(200, stateBody("confirmed"));

    for (const settings of [
      { base: configured.base, credential: Option.none() },
      { base: Option.none(), credential: configured.credential },
      { base: Option.none(), credential: Option.none() },
    ]) {
      expect(
        yield* run(api.layer, (confirm) => confirm.state("tok"), settings)
      ).toBe("invalid");
      expect(
        yield* run(api.layer, (confirm) => confirm.confirm("tok"), settings)
      ).toBe("invalid");
    }

    expect(api.seen).toEqual([]);
  })
);
