import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { Tab } from "./model.js";

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
