import * as stylex from "@stylexjs/stylex";

export const accent = stylex.defineVars({
  accent: "var(--accent)",
  accentText: "var(--accent-text)",
});

export const reader = stylex.defineVars({
  codeHighlight: "var(--code-highlight)",
  codeInk: "var(--code-ink)",
  codeKeyword: "var(--code-keyword)",
  codeLiteral: "var(--code-literal)",
  codeMuted: "var(--code-muted)",
  contentWidth: "var(--measure)",
  fontFamily: "var(--prose-font)",
  fontSize: "var(--text-size)",
  lineHeight: "1.6",
  monoFamily: "var(--mono)",
  spaceSection: "var(--space-section)",
  spaceSmall: "var(--space-small)",
  spaceTight: "var(--space-tight)",
});
