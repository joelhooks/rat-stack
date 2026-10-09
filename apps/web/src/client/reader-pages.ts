import { Schema } from "effect";
import { readerPages } from "virtual:reader-pages";

import { ReaderFlags } from "./reader/model.js";

export const pages = Schema.decodeUnknownSync(Schema.Array(ReaderFlags))(
  readerPages
);
