import * as Cloudflare from "@alchemy.run/cloudflare";
import { Random } from "alchemy";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";
import { Stage } from "alchemy/Stage";
import { Effect } from "effect";
import { identity } from "effect/Function";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { tokenId, turboCacheConfig } from "./config.js";
import { artifactHandler } from "./protocol.js";

const retainInProd =
  globalThis.__ALCHEMY_RUNTIME__ === true
    ? identity
    : retain(Stage.pipe(Effect.map((stage) => stage === "prod")));

const cacheBucket = Cloudflare.R2.Bucket("TurboCacheBucket", {
  lifecycleRules: [
    {
      deleteObjectsTransition: {
        condition: {
          maxAge: turboCacheConfig.retentionDays * 86_400,
          type: "Age",
        },
      },
      enabled: true,
      id: "expire-artifacts",
      prefix: "",
    },
  ],
}).pipe(retainInProd, Namespace.set("TurboCacheFoundation"));

export const makeCache = Effect.gen(function* makeCache() {
  const bucket = yield* cacheBucket;
  const client = yield* Cloudflare.R2.ReadWriteBucket;
  const storage = yield* client(bucket);

  const credentials = yield* Effect.all(
    turboCacheConfig.teams.map((team) =>
      Effect.gen(function* resolveCredential() {
        const resource = yield* Random(tokenId(team)).pipe(
          retainInProd,
          Namespace.set("TurboCacheFoundation")
        );

        const token = yield* resource.text;

        return { team, token };
      })
    )
  );

  const handle = artifactHandler(storage, credentials);

  return {
    fetch: Effect.gen(function* fetchArtifact() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* HttpServerRequest.toWeb(request);
      const response = yield* handle(web).pipe(Effect.orDie);

      return HttpServerResponse.fromWeb(response);
    }).pipe(Effect.orDie),
  };
});

export default class TurboCache extends Cloudflare.Worker<TurboCache>()(
  "TurboCache",
  {
    compatibility: { date: "2026-05-28", flags: ["nodejs_compat"] },
    dev: { port: 0 },
    main: import.meta.url,
    workersDev: true,
  },
  makeCache.pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding))
) {}

export const turboCache = TurboCache.pipe(retainInProd);
