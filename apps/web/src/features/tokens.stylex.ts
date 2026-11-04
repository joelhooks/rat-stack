import * as stylex from "@stylexjs/stylex";

const DARK = "@media (prefers-color-scheme: dark)";

export const accent = stylex.defineVars({
  accent: "#ff1493",
  accentText: { default: "#c8006e", [DARK]: "#ff4fa8" },
});

export const reader = stylex.defineVars({
  codeHighlight: { default: "#e6e9ef", [DARK]: "#3a3a3c" },
  codeInk: { default: "#4c4f69", [DARK]: "#c6d0f5" },
  codeKeyword: { default: "#303446", [DARK]: "#e5e5ea" },
  codeLiteral: { default: "#5c5f77", [DARK]: "#b5bfe2" },
  codeMuted: { default: "#6c6f85", [DARK]: "#98989d" },
  contentWidth: "68ch",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  fontSize: "17px",
  lineHeight: "1.6",
  monoFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
  spaceSection: "2rem",
  spaceSmall: "0.75rem",
  spaceTight: "0.375rem",
});
