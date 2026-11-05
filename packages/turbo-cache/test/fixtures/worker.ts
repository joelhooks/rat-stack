import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Redacted } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { artifactHandler } from "../../src/protocol.js";

const forbiddenStorage = () =>
  Effect.die("Unauthorized request reached storage");

export default class CacheFixture extends Cloudflare.Worker<CacheFixture>()(
  "CacheFixture",
  {
    compatibility: { date: "2026-05-28", flags: ["nodejs_compat"] },
    dev: { port: 0 },
    main: import.meta.url,
  },
  Effect.gen(function* fixture() {
    const bucket = yield* Cloudflare.R2.Bucket("CacheFixtureBucket");
    const bind = yield* Cloudflare.R2.ReadWriteBucket;
    const storage = yield* bind(bucket);

    const credentials = [
      {
        team: "alpha",
        token: Effect.succeed(Redacted.make("test-only-alpha")),
      },
      { team: "beta", token: Effect.succeed(Redacted.make("test-only-beta")) },
    ];

    const handle = artifactHandler(storage, credentials);

    const proveAuth = artifactHandler(
      { get: forbiddenStorage, head: forbiddenStorage, put: forbiddenStorage },
      credentials
    );

    return {
      fetch: Effect.gen(function* fixtureFetch() {
        const incoming = yield* HttpServerRequest.HttpServerRequest;
        const request = yield* HttpServerRequest.toWeb(incoming);
        const url = new URL(request.url);
        const authProof = url.pathname.startsWith("/auth-proof/");
        url.pathname = url.pathname.replace("/auth-proof", "");

        const response = yield* authProof
          ? proveAuth(new Request(url, request))
          : handle(request);

        return HttpServerResponse.fromWeb(response);
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding))
) {}
