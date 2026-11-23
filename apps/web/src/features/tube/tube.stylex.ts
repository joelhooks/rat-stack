import * as stylex from "@stylexjs/stylex";

import { reader } from "../tokens.stylex.js";

export const tubeStyles = stylex.create({
  badge: {
    border: "1px solid var(--rule-strong)",
    borderRadius: "4px",
    display: "inline-block",
    fontWeight: 700,
    lineHeight: 1.2,
    marginInlineEnd: reader.spaceTight,
    padding: "0 0.25em",
  },
  card: {
    border: "1px solid var(--rule)",
    display: "flex",
    flexDirection: "column",
    gap: reader.spaceTight,
    padding: reader.spaceSmall,
  },
  cards: {
    display: "grid",
    gap: reader.spaceSmall,
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 18rem), 1fr))",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  frame: {
    aspectRatio: "16 / 9",
    border: "none",
    display: "block",
    width: "100%",
  },
  meta: {
    color: "var(--text-muted)",
    fontSize: "0.875em",
    margin: 0,
  },
  play: {
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    display: "block",
    padding: 0,
    position: "relative",
    width: "100%",
  },
  playLabel: {
    backgroundColor: "var(--pressed)",
    bottom: reader.spaceTight,
    color: "var(--on-pressed)",
    fontSize: "0.875em",
    left: reader.spaceTight,
    padding: "0 0.375em",
    position: "absolute",
  },
  take: {
    margin: 0,
  },
  thumbnail: {
    aspectRatio: "16 / 9",
    backgroundColor: "var(--code-highlight)",
    display: "block",
    objectFit: "cover",
    width: "100%",
  },
  title: {
    fontSize: "1em",
    margin: 0,
  },
});
