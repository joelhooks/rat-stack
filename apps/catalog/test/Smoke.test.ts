import * as Domain from "@alchemy.run/domain";
import { it } from "@effect/vitest";
import { Catalog, CatalogHandlers } from "@rat-stack/catalog/Catalog.model";
import { CatalogMemory } from "@rat-stack/catalog/Catalog/CatalogMemory";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { expect } from "vitest";

import { OperatorTokenLive } from "../src/OperatorToken.ts";
import { smokeCatalog, smokeDeadline } from "../src/Smoke.ts";

const token = "synthetic-secret-that-must-not-appear";

const redacted = Redacted.make(token);

const world = (configured: string | undefined) =>
  OperatorTokenLive.pipe(
    Layer.provideMerge(
      Catalog.layer(CatalogHandlers.pipe(Layer.provide(CatalogMemory)))
    ),
    Layer.provide(
      Layer.mergeAll(
        Domain.InMemory,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown(
            configured === undefined
              ? {}
              : { CATALOG_OPERATOR_TOKEN: configured }
          )
        )
      )
    )
  );

const nativeHttp = Effect.gen(function* nativeHttp() {
  const api = yield* OperatorApi;
  const scope = yield* Effect.scope;

  return HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.flatMap((web) =>
        api.fetch.pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(web)
          )
        )
      ),
      Effect.map((response) =>
        HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(response))
      ),
      Scope.provide(scope),
      Effect.orDie
    )
  );
});

it.live(
  "smoke uses native NDJSON calls and accepts an authenticated missing Item",
  () =>
    Effect.gen(function* smokeNativeHttp() {
      const http = yield* nativeHttp;

      const result = yield* smokeCatalog(
        "https://example.test/catalog",
        redacted
      ).pipe(Effect.provideService(HttpClient.HttpClient, http));

      expect(result).toEqual({
        unauthenticated: "Unauthorized",
        authenticated: "accepted",
      });
    }).pipe(Effect.scoped, Effect.provide(world(token)))
);

for (const { configured, label } of [
  { configured: undefined, label: "missing" },
  { configured: "", label: "empty" },
  { configured: "synthetic-wrong-token", label: "wrong" },
]) {
  it.live(`smoke fails safely with ${label} runtime configuration`, () =>
    Effect.gen(function* refuseUnconfiguredSmoke() {
      const http = yield* nativeHttp;

      const failure = yield* smokeCatalog(
        "https://example.test/catalog",
        redacted
      ).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.flip);

      expect(failure._tag).toBe("CatalogSmokeFailed");
      expect(failure.phase).toBe("authenticated");
      expect(Cause.pretty(Cause.fail(failure))).not.toContain(token);
    }).pipe(Effect.scoped, Effect.provide(world(configured)))
  );
}

it.live(
  "smoke strips transport defects that contain the token before they can reach CLI error logging",
  () =>
    Effect.gen(function* hideTransportSecrets() {
      const actual = yield* nativeHttp;
      const calls = yield* Ref.make(0);

      const http = HttpClient.make((request) =>
        Ref.getAndUpdate(calls, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0 ? actual.execute(request) : Effect.die(new Error(token))
          )
        )
      );

      const failure = yield* smokeCatalog(
        "https://example.test/catalog",
        redacted
      ).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.flip);

      expect(failure._tag).toBe("CatalogSmokeFailed");
      expect(Cause.pretty(Cause.fail(failure))).not.toContain(token);
    }).pipe(Effect.scoped, Effect.provide(world(token)))
);

it.live(
  "smoke bounds an unresponsive transport without reporting it as an authorization result",
  () =>
    Effect.gen(function* boundSmokeTransport() {
      const http = HttpClient.make(() => Effect.never);

      const failure = yield* smokeCatalog(
        "https://example.test/catalog",
        redacted
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(smokeDeadline, "5 millis"),
        Effect.flip
      );

      expect(failure.phase).toBe("configuration-or-transport");
      expect(Cause.pretty(Cause.fail(failure))).not.toContain(token);
    })
);
