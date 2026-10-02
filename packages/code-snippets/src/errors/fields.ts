import { Schema } from "effect";

export const errorFields = {
  actualLength: Schema.NullOr(Schema.Finite),
  commit: Schema.String,
  fix: Schema.String,
  line: Schema.Finite,
  path: Schema.String,
  ranges: Schema.String,
  repo: Schema.String,
  sourcePath: Schema.String,
};
