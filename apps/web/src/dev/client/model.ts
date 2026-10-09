import { Schema } from "effect";

export const Tab = Schema.Literals([
  "calls",
  "contracts",
  "machines",
  "session",
]);

export type InspectorTab = typeof Tab.Type;

export const Model = Schema.Struct({
  capability: Schema.String,
  error: Schema.String,
  from: Schema.String,
  generation: Schema.Finite,
  input: Schema.String,
  open: Schema.Boolean,
  pending: Schema.Boolean,
  person: Schema.Option(Schema.String),
  personName: Schema.String,
  tab: Tab,
  to: Schema.String,
  value: Schema.Json,
});

export type InspectorModel = typeof Model.Type;
