import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { DocumentQueries } from "../docs/queries.js";
import { Message } from "./message.js";
import { peekSummary } from "./peek.js";

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
