import type { CreateRule } from "@oxlint/plugins";

import createPaddingLineRule from "../vendor/eslint-stylistic/padding-line-between-statements.ts";

const paddingRule = createPaddingLineRule([
  { blankLine: "always", prev: "import", next: "*" },
  {
    blankLine: "always",
    prev: "*",
    next: { selector: "Program > :not(ImportDeclaration)" },
  },
  {
    blankLine: "always",
    prev: { selector: "Program > :not(ImportDeclaration)" },
    next: "*",
  },
  {
    blankLine: "always",
    prev: "*",
    next: ["function", "class", "interface", "type"],
  },
  {
    blankLine: "always",
    prev: ["function", "class", "interface", "type"],
    next: "*",
  },
  {
    blankLine: "always",
    prev: "*",
    next: [
      "multiline-const",
      "multiline-let",
      "multiline-var",
      "multiline-using",
    ],
  },
  {
    blankLine: "always",
    prev: [
      "multiline-const",
      "multiline-let",
      "multiline-var",
      "multiline-using",
    ],
    next: "*",
  },
  {
    blankLine: "always",
    prev: "*",
    next: ["return", "if", "switch", "try", "for", "while", "do"],
  },
  { blankLine: "always", prev: "block-like", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  {
    blankLine: "any",
    prev: {
      selector:
        ':matches(TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"])',
    },
    next: {
      selector:
        ':matches(TSDeclareFunction, FunctionDeclaration, ExportNamedDeclaration[declaration.type="TSDeclareFunction"], ExportNamedDeclaration[declaration.type="FunctionDeclaration"])',
    },
  },
]);

/** Restore structural blank lines with whitespace-only fixes; keep local short bindings and overloads grouped. */
export const requireReadableSpacingRule: CreateRule = {
  ...paddingRule,
  meta: {
    ...paddingRule.meta,
    docs: {
      description:
        "Require readable spacing between declarations and logical statement groups.",
    },
    messages: {
      expectedBlankLine:
        "Expected blank line before this statement. Blank lines separate declarations and logical statement groups, so a reader can see where one step ends. Fix: insert a blank line, or run `pnpm fix`.",
      unexpectedBlankLine:
        "Unexpected blank line before this statement. Short bindings and overloads stay grouped, and a stray blank line splits the group. Fix: delete the blank line, or run `pnpm fix`.",
    },
    schema: [],
  },
};
