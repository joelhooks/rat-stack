import * as stylex from "@stylexjs/stylex";

import { reader } from "../tokens.stylex.js";

export const cafeStyles = stylex.create({
  avatar: {
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    display: "block",
    flexShrink: 0,
    height: "4rem",
    width: "4rem",
  },
  badge: {
    border: "1px solid var(--rule-strong)",
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
  card: {
    alignItems: "flex-start",
    border: "1px solid var(--rule)",
    display: "flex",
    gap: reader.spaceSmall,
    padding: reader.spaceSmall,
  },
  cards: {
    display: "grid",
    gap: reader.spaceSmall,
    listStyle: "none",
    margin: 0,
    padding: 0,
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
    color: "var(--text-muted)",
    fontSize: "0.875em",
  },
  pressed: {
    backgroundColor: "var(--pressed)",
    color: "var(--on-pressed)",
  },
  replies: {
    fontSize: "0.875em",
  },
  tag: {
    color: "var(--text-muted)",
    marginInlineEnd: reader.spaceTight,
  },
});
