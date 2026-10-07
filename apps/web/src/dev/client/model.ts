import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

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
  person: Schema.NullOr(Schema.String),
  personName: Schema.String,
  tab: Tab,
  to: Schema.String,
  value: Schema.Json,
});

export type InspectorModel = typeof Model.Type;

export const Message = defineMessageUnion({
  ChangedCapability: { value: Schema.String },
  ChangedFrom: { value: Schema.String },
  ChangedInput: { value: Schema.String },
  ChangedPersonName: { value: Schema.String },
  ChangedTo: { value: Schema.String },
  Closed: {},
  Compared: {},
  CreatedPerson: { generation: Schema.Finite, personId: Schema.String },
  Described: {},
  Failed: { generation: Schema.Finite, message: Schema.String },
  Loaded: { generation: Schema.Finite, value: Schema.Json },
  ReadRecorded: {},
  Refreshed: {},
  Replayed: {},
  SelectedContract: { name: Schema.String },
  SelectedTab: { tab: Tab },
  SignedIn: {},
  Submitted: {},
  Toggled: {},
  UsedDefaultPerson: {},
});

export type InspectorMessage = typeof Message.Type;
