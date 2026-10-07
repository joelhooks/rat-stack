import * as stylex from "@stylexjs/stylex";

import { reader } from "./tokens.stylex.js";

export const specStyles = stylex.create({
  card: { paddingBlock: reader.spaceSmall },
  grid: {
    display: "grid",
    gap: reader.spaceSection,
    marginBlock: reader.spaceSection,
  },
  intro: { marginBlock: reader.spaceSmall },
  link: { color: "inherit", textDecoration: "underline" },
  page: {
    fontFamily: reader.fontFamily,
    fontSize: reader.fontSize,
    lineHeight: reader.lineHeight,
  },
  tags: { marginBlock: reader.spaceTight },
  title: { marginBlock: reader.spaceSection },
});
