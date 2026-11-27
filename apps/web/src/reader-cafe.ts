import { IsoDate } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { AllStarsProps } from "./client/all-stars-effect-ui/model.js";
import { DirectoryProps } from "./client/directory-effect-ui/model.js";
import { NewsProps } from "./client/news-effect-ui/model.js";
import { ReaderFlags } from "./client/reader/model.js";

export const CafePage = Schema.TaggedUnion({
  AllStars: AllStarsProps.fields,
  Directory: DirectoryProps.fields,
  News: { ...NewsProps.fields, rankedAt: IsoDate },
});

export const ReaderSource = ReaderFlags.pipe(
  Schema.fieldsAssign({ cafe: Schema.OptionFromOptional(CafePage) })
);

export type ReaderSourcePage = typeof ReaderSource.Type;
