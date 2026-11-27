import { Component } from "@effect/ui";
import { Html, HtmlCommand } from "@effect/ui/html";

import { view } from "../../features/directory-effect-ui/view.js";
import {
  DirectoryProps,
  DirectoryMessage,
  SelectedLetters,
  firstLetterToggle,
  toggleLetter,
} from "./model.js";

export const DirectoryPage = Html.component({
  name: "DirectoryPage",
  props: DirectoryProps,
  model: SelectedLetters,
  message: DirectoryMessage,
}).make({
  init: ({ props }) => props.selected,
  update: {
    ClearedStackLetters: ($) =>
      $.set([]).run(HtmlCommand.focus(firstLetterToggle, () => Component.noop)),
    ToggledStackLetter: ({ model }, { letter }) => toggleLetter(model, letter),
  },
  view: (h, selected) => view(h, h.props.projects, selected),
});
