import * as stylex from "@stylexjs/stylex";

import { reader } from "../tokens.stylex.js";

export const motionStyles = stylex.create({
  caption: {
    fontSize: "0.75em",
    overflowWrap: "anywhere",
    textAlign: "center",
  },
  curve: {
    fill: "none",
    stroke: reader.codeInk,
    strokeWidth: 2,
  },
  dot: {
    fill: reader.codeInk,
  },
  figure: {
    border: "1px solid #ccd0da",
    margin: 0,
    padding: reader.spaceTight,
  },
  gallery: {
    display: "grid",
    gap: reader.spaceSmall,
    gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  guide: {
    stroke: "#ccd0da",
    strokeDasharray: "3 3",
    strokeWidth: 1,
  },
  legend: {
    display: "flex",
    gap: reader.spaceSmall,
    marginBlock: reader.spaceTight,
  },
  marker: {
    fill: "none",
    stroke: "#9ca0b0",
    strokeWidth: 1,
  },
  plot: {
    display: "block",
    height: "auto",
    width: "100%",
  },
  section: {
    marginBlock: reader.spaceSection,
  },
  spring: {
    fill: reader.codeKeyword,
  },
  stage: {
    border: "1px solid #ccd0da",
    display: "block",
    height: "auto",
    maxWidth: "36rem",
    width: "100%",
  },
  targets: {
    border: "none",
    display: "grid",
    gap: reader.spaceTight,
    gridTemplateColumns: "repeat(3, minmax(0, 12rem))",
    margin: 0,
    padding: 0,
  },
  tween: {
    fill: "none",
    stroke: reader.codeMuted,
    strokeWidth: 3,
  },
});
