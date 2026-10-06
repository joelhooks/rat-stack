import * as stylex from "@stylexjs/stylex";

import { accent } from "./tokens.stylex.js";

export const specStyles = stylex.create({
  callout: {
    borderLeftColor: accent.accent,
    borderLeftStyle: "solid",
    borderLeftWidth: "3px",
    marginTop: "48px",
    padding: "4px 0 4px 20px",
  },
  card: {
    backgroundColor: "#fff",
    border: "1px solid #d5d5d5",
    borderRadius: "16px",
    padding: "28px",
  },
  grid: {
    display: "grid",
    gap: "24px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
    marginTop: "40px",
  },
  intro: { color: "#555", fontSize: "20px", maxWidth: "42ch" },
  link: { color: "inherit", fontSize: "28px", fontWeight: 700 },
  page: { margin: "0 auto", maxWidth: "1040px", padding: "64px 24px" },
  tags: { color: "#555", fontSize: "14px" },
  title: {
    fontSize: "clamp(36px, 6vw, 64px)",
    letterSpacing: "-0.04em",
    lineHeight: 1.05,
  },
});
