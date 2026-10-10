import * as stylex from "@stylexjs/stylex";

import { reader } from "./tokens.stylex.js";

export const docsStyles = stylex.create({
  documentText: {
    font: "inherit",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
  form: {
    display: "flex",
    flexWrap: "wrap",
    gap: reader.spaceTight,
    marginBlock: reader.spaceSmall,
  },
  input: {
    flexGrow: 1,
    minWidth: 0,
  },
  match: {
    marginBlockEnd: reader.spaceSmall,
  },
  meta: {
    color: "#5c5f77",
    fontSize: "0.875em",
  },
  results: {
    listStyle: "none",
    paddingInlineStart: 0,
  },
});
