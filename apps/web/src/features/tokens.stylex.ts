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
  contentWidth: "80ch",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "16px",
  lineHeight: "1.5",
  spaceSection: "2rem",
  spaceSmall: "0.75rem",
  spaceTight: "0.375rem",
});
