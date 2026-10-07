import * as stylex from "@stylexjs/stylex";

import { accent } from "./tokens.stylex.js";

export const styles = stylex.create({
  brand: {
    alignItems: "center",
    borderRadius: "6px",
    color: "inherit",
    display: "flex",
    gap: "10px",
    minHeight: "42px",
    overflow: "hidden",
    padding: "5px 7px",
    textDecoration: "none",
  },
  focus: {
    outlineColor: { ":focus-visible": accent.accent, default: null },
    outlineOffset: { ":focus-visible": "3px", default: null },
    outlineStyle: { ":focus-visible": "solid", default: null },
    outlineWidth: { ":focus-visible": "2px", default: null },
  },
  header: {
    alignItems: "center",
    borderBottom: "1px solid #ccd0da",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    padding: "12px 0",
  },
  shell: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  },
});
