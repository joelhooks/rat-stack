import { ResourceNotFound } from "@rat-stack/core/contracts";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import { load, pushUrl } from "foldkit/navigation";

import { Message } from "./model.js";
import { DocumentQueries } from "./queries.js";

export const SearchDocs = Command.define("SearchDocs", {
  args: { generation: Schema.Finite, query: Schema.String },
  execute: ({ query, generation }) =>
    DocumentQueries.use((queries) => queries.search(query)).pipe(
      Effect.map((result) => Message.SucceededSearch({ generation, result })),
      Effect.orElseSucceed(() => Message.FailedSearch({ generation }))
    ),
  messages: [Message.SucceededSearch, Message.FailedSearch],
});

export const ReadDoc = Command.define("ReadDoc", {
  args: { generation: Schema.Finite, id: Schema.String },
  execute: ({ id, generation }) =>
    DocumentQueries.use((queries) => queries.read(id)).pipe(
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
      })
    ),
  messages: [Message.SucceededRead, Message.FailedRead],
});

export const Navigate = Command.define("Navigate", {
  args: { url: Schema.String },
  execute: ({ url }) =>
    pushUrl(url).pipe(
      Effect.andThen(
        Effect.sync(() => {
          window.scrollTo(0, 0);
        })
      ),
      Effect.as(Message.CompletedNavigate())
    ),
  messages: [Message.CompletedNavigate],
});

export const LoadExternal = Command.define("LoadExternal", {
  args: { href: Schema.String },
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
  messages: [Message.CompletedLoadExternal],
});
