import { Schema } from "effect";

export const effectUiHandoff = <Props extends Schema.Constraint>(
  props: Props
) =>
  Schema.Struct({
    props,
    state: Schema.Record(Schema.String, Schema.Unknown),
  });
