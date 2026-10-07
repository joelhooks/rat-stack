import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { readContract, searchContract } from "@rat-stack/core/contracts";
import { Console, Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import { RpcClient, RpcSerialization } from "effect/rpc";

class PreviewSmokeError extends Schema.TaggedError<PreviewSmokeError>()(
  "PreviewSmokeError",
  { reason: Schema.String }
) {}

const argumentsSchema = Schema.Struct({
  commit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  origin: Schema.String.check(
    Schema.isPattern(/^https:\/\/pr-[1-9][0-9]*\.ratstack\.sh$/u)
  ),
});

const { group } = toRpcGroup([searchContract, readContract]);

const program = Effect.gen(function* previewContentSmoke() {
  const { commit, origin } = yield* Schema.decodeUnknownEffect(argumentsSchema)(
    {
      commit: process.argv[3],
      origin: process.argv[2],
    }
  );

  const client = yield* RpcClient.make(group).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${origin}/rpc` }).pipe(
        Layer.provide(RpcSerialization.layerJson)
      )
    )
  );

  const result = yield* client.search({ limit: 1, query: "capability" });
  const match = result.matches.at(0);

  if (match === undefined) {
    return yield* new PreviewSmokeError({
      reason: "search returned no content",
    });
  }

  const document = yield* client.read({ id: match.id });

  if (document.id !== match.id || document.text.length === 0) {
    return yield* new PreviewSmokeError({
      reason: "read returned invalid content",
    });
  }

  yield* Console.log(
    `Preview content smoke passed: search + read; commit ${commit}`
  );

  return document.id;
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
);

NodeRuntime.runMain(program);
