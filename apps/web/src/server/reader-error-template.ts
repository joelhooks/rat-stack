import { Schema } from "effect";

import { ReaderNodeSchema } from "../client/reader-node.js";
import { ReaderFlags } from "../client/reader/model.js";

export const ReaderErrorTemplate = Schema.Struct({
  actions: Schema.Array(ReaderNodeSchema),
  noVerifyDetails: Schema.Array(ReaderNodeSchema),
  page: ReaderFlags,
  suggestion: Schema.Array(ReaderNodeSchema),
});
