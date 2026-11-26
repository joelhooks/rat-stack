import { Html } from "@effect/ui/html";
import { CafeNewsSort } from "@rat-stack/core/contracts";
import { Schema } from "effect";

import { view } from "../../features/news-effect-ui/view.js";
import { NewsProps } from "./model.js";

export const NewsPage = Html.component({
  name: "NewsPage",
  props: NewsProps,
  model: CafeNewsSort,
  message: Schema.Never,
}).make({
  init: ({ props }) => props.sort,
  update: ($) => $.model,
  view: (h, sort) => view(h, h.props, sort),
});
