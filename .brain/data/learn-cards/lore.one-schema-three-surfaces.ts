import * as Capability from "@rat-stack/capability";
import { Effect, Schema } from "effect";

export const shoutContract = Capability.defineContract("shout", {
  annotations: { idempotent: true, readOnly: true },
  description: "Return the text in capitals.",
  failure: Schema.Never,
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ text: Schema.String }),
});

export const shout = Capability.implement(shoutContract, ({ text }) =>
  Effect.succeed({ text: text.toUpperCase() })
);

export const cli = Capability.toCommand(shout);

export const http = Capability.toHttpApi("Shout", [shout]);

export const mcp = Capability.toToolkit([shout]);
