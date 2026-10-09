import * as stylex from "@stylexjs/stylex";

import { reader } from "../tokens.stylex.js";

export const cafeStyles = stylex.create({
  badge: {
    border: "1px solid #6c6f85",
    borderRadius: "4px",
    display: "inline-block",
    fontWeight: 700,
    lineHeight: 1.2,
    minWidth: "1.5em",
    padding: "0 0.25em",
    textAlign: "center",
    textDecoration: "none",
  },
  badges: {
    display: "inline-flex",
    gap: reader.spaceTight,
    marginInlineStart: reader.spaceTight,
  },
  filter: {
    border: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: reader.spaceTight,
    margin: 0,
    padding: 0,
  },
  item: {
    marginBlockEnd: reader.spaceSmall,
  },
  list: {
    paddingInlineStart: "2.5em",
  },
  meta: {
    color: "#5c5f77",
    fontSize: "0.875em",
  },
  pressed: {
    backgroundColor: "#4c4f69",
    color: "#ffffff",
  },
  replies: {
    fontSize: "0.875em",
  },
  tag: {
    color: "#5c5f77",
    marginInlineEnd: reader.spaceTight,
  },
});
