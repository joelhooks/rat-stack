import { CafeNewsItem, CafeNewsSort } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { NewsProfileLink } from "../cafe/model.js";

export const NewsProps = Schema.Struct({
  items: Schema.Array(CafeNewsItem),
  profiles: Schema.Array(NewsProfileLink),
  sort: CafeNewsSort,
});

export type NewsPageProps = typeof NewsProps.Type;

export const NewsHandoff = Schema.Struct({
  props: NewsProps,
  state: Schema.Record(Schema.String, Schema.Unknown),
});

export const newsRootId = "news-effect-ui";

export const newsHandoffId = "news-effect-ui-handoff";
