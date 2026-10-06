import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import {
  readContract,
  ResourceNotFound,
  searchContract,
} from "@rat-stack/core/contracts";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Command } from "foldkit";
import { load, pushUrl } from "foldkit/navigation";

import { Message } from "./model.js";

const { group } = toRpcGroup([searchContract, readContract]);

const protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
);

export const SearchDocs = Command.define("SearchDocs", {
  args: { generation: Schema.Finite, query: Schema.String },
  execute: ({ query, generation }) =>
    RpcClient.make(group).pipe(
      Effect.flatMap((client) => client.search({ limit: 10, query })),
      Effect.map((result) => Message.SucceededSearch({ generation, result })),
      Effect.orElseSucceed(() => Message.FailedSearch({ generation })),
      Effect.provide(protocol),
      Effect.scoped
    ),
  messages: [Message.SucceededSearch, Message.FailedSearch],
});

export const ReadDoc = Command.define("ReadDoc", {
  args: { generation: Schema.Finite, id: Schema.String },
  execute: ({ id, generation }) =>
    RpcClient.make(group).pipe(
      Effect.flatMap((client) => client.read({ id })),
      Effect.match({
        onFailure: (error) =>
          Message.FailedRead({
            generation,
            message: Schema.is(ResourceNotFound)(error)
              ? error.message
              : "The document could not be loaded. Try again in a moment.",
            notFound: Schema.is(ResourceNotFound)(error),
          }),
        onSuccess: (document) =>
          Message.SucceededRead({ document, generation }),
      }),
      Effect.provide(protocol),
      Effect.scoped
    ),
  messages: [Message.SucceededRead, Message.FailedRead],
});

export const Navigate = Command.define("Navigate", {
  args: { url: Schema.String },
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
  messages: [Message.CompletedNavigate],
});

export const LoadExternal = Command.define("LoadExternal", {
  args: { href: Schema.String },
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
  messages: [Message.CompletedLoadExternal],
});
