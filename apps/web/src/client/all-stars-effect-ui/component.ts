import { Html } from "@effect/ui/html";
import { Schema } from "effect";

import { view } from "../../features/all-stars-effect-ui/view.js";
import { AllStarsProps } from "./model.js";

export const AllStarsPage = Html.component({
  name: "AllStarsPage",
  props: AllStarsProps,
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) => view(h, h.props.people),
});
