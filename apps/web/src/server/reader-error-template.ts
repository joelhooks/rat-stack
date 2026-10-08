import { Schema } from "effect";

import { ReaderFlags } from "../client/reader-model.js";
import { ReaderNodeSchema } from "../client/reader-node.js";

export const ReaderErrorTemplate = Schema.Struct({
  actions: Schema.Array(ReaderNodeSchema),
  noVerifyDetails: Schema.Array(ReaderNodeSchema),
  page: ReaderFlags,
  suggestion: Schema.Array(ReaderNodeSchema),
});
