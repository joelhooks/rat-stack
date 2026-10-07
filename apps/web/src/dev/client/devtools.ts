import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { devtoolsContracts } from "@rat-stack/devtools/contracts";
import { Effect, Layer, Match, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Command } from "foldkit";

import { Message } from "./model.js";

const { group } = toRpcGroup(devtoolsContracts);

const protocol = RpcClient.layerProtocolHttp({ url: "/__rat/rpc" }).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
);

const json = Effect.map(Schema.decodeUnknownSync(Schema.Json));

const TestPerson = Schema.Struct({
  result: Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({ personId: Schema.String }),
  }),
});

export const Inspect = Command.define("Inspect", {
  args: {
    capability: Schema.String,
    from: Schema.String,
    generation: Schema.Finite,
    input: Schema.String,
    operation: Schema.Literals([
      "calls",
      "contracts",
      "machines",
      "describe",
      "get",
      "run",
      "replay",
      "diff",
      "person",
    ]),
    person: Schema.NullOr(Schema.String),
    personName: Schema.String,
    to: Schema.String,
  },
  execute: (args) =>
    RpcClient.make(group).pipe(
      Effect.flatMap((client) =>
        Match.value(args.operation).pipe(
          Match.when("calls", () =>
            client.rat_list_calls({ fromEnd: true, limit: 25 }).pipe(json)
          ),
          Match.when("contracts", () =>
            client.rat_list_contracts({}).pipe(json)
          ),
          Match.when("machines", () => client.rat_list_actors({}).pipe(json)),
          Match.when("get", () =>
            Schema.decodeEffect(Schema.FiniteFromString)(args.from).pipe(
              Effect.flatMap((index) =>
                client.rat_get_call({ expand: true, index })
              ),
              json
            )
          ),
          Match.when("describe", () =>
            client.rat_describe_contract({ name: args.capability }).pipe(json)
          ),
          Match.when("run", () =>
            Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(
              args.input
            ).pipe(
              Effect.flatMap((input) =>
                client.rat_call(
                  args.person === null
                    ? { capability: args.capability, input }
                    : { as: args.person, capability: args.capability, input }
                )
              ),
              json
            )
          ),
          Match.when("replay", () =>
            Schema.decodeEffect(Schema.FiniteFromString)(args.from).pipe(
              Effect.flatMap((index) => client.rat_replay_call({ index })),
              json
            )
          ),
          Match.when("diff", () =>
            Effect.all([
              Schema.decodeEffect(Schema.FiniteFromString)(args.from),
              Schema.decodeEffect(Schema.FiniteFromString)(args.to),
            ]).pipe(
              Effect.flatMap(([from, to]) =>
                client.rat_diff_calls({ from, to })
              ),
              json
            )
          ),
          Match.when("person", () =>
            client
              .rat_call({
                capability: "rat_test_person",
                input: { name: args.personName },
              })
              .pipe(json)
          ),
          Match.exhaustive
        )
      ),
      Effect.flatMap((value) =>
        Effect.gen(function* toInspectorMessage() {
          if (args.operation === "person") {
            const result = yield* Schema.decodeUnknownEffect(TestPerson)(value);

            return Message.CreatedPerson({
              generation: args.generation,
              personId: result.result.value.personId,
            });
          }

          return Message.Loaded({ generation: args.generation, value });
        })
      ),
      Effect.orElseSucceed(() =>
        Message.Failed({
          generation: args.generation,
          message: "The request failed. Check the input and refresh.",
        })
      ),
      Effect.provide(protocol),
      Effect.scoped
    ),
  messages: [Message.Loaded, Message.CreatedPerson, Message.Failed],
});
