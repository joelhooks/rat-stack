import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { DocumentQueries } from "../docs/queries.js";
import { Message } from "./message.js";
import { peekSummary, routeOfPath } from "./peek.js";

export const peekDelay = "280 millis";

export const WaitBeforePeek = Command.define("WaitBeforePeek", {
  args: { route: Schema.String },
  execute: ({ route }) =>
    Effect.sleep(peekDelay).pipe(Effect.as(Message.ElapsedPeekWait({ route }))),
  messages: [Message.ElapsedPeekWait],
});

export const ReadPeek = Command.define("ReadPeek", {
  args: { route: Schema.String },
  execute: ({ route }) =>
    DocumentQueries.use((queries) => queries.read(route)).pipe(
      Effect.match({
        onFailure: () => Message.FailedReadPeek({ route }),
        onSuccess: (document) =>
          Message.SucceededReadPeek({
            route,
            summary: peekSummary(document),
            title: document.title,
          }),
      })
    ),
  messages: [Message.SucceededReadPeek, Message.FailedReadPeek],
});

const lightLinks = (route: Option.Option<string>) => {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "main a[href^='/']"
  )) {
    link.toggleAttribute(
      "data-graph-lit",
      link.closest("sup") === null &&
        Option.contains(route, routeOfPath(link.pathname))
    );
  }
};

export const LightLinks = Command.define("LightLinks", {
  args: { route: Schema.Option(Schema.String) },
  execute: ({ route }) =>
    Effect.sync(() => {
      lightLinks(route);

      return Message.CompletedLightLinks();
    }),
  messages: [Message.CompletedLightLinks],
});
