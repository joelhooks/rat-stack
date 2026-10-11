import { Schema } from "effect";

export const migrationIslands = {
  AgentOnly: Schema.Struct({}),
  AgentPointer: Schema.Struct({}),
  CopyPrompt: Schema.Struct({
    audience: Schema.optionalKey(Schema.Literal("agent")),
    id: Schema.String,
    variant: Schema.optionalKey(Schema.Literals(["primary", "text"])),
  }),
  Diagram: Schema.Struct({ alt: Schema.String }),
  HumanOnly: Schema.Struct({}),
  PeerPins: Schema.Struct({}),
  PeerRoster: Schema.Struct({}),
  PeerSources: Schema.Struct({}),
  PeersAlsoSeen: Schema.Struct({}),
  Ref: Schema.Struct({ id: Schema.String, page: Schema.String }),
  Sources: Schema.Struct({}),
};

export const migrationIslandNames = Object.keys(migrationIslands);
