import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

function unwrapExpression(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function ternaryDepth(node: ESTree.Expression): number {
  const expression = unwrapExpression(node);
  if (expression.type !== "ConditionalExpression") return 0;
  return (
    1 +
    Math.max(
      ternaryDepth(expression.test),
      ternaryDepth(expression.consequent),
      ternaryDepth(expression.alternate)
    )
  );
}

function isNestedTernary(node: ESTree.ConditionalExpression): boolean {
  let parent = node.parent;
  while (
    parent.type === "ParenthesizedExpression" ||
    parent.type === "TSAsExpression" ||
    parent.type === "TSSatisfiesExpression" ||
    parent.type === "TSTypeAssertion" ||
    parent.type === "TSNonNullExpression"
  ) {
    parent = parent.parent;
  }
  return parent.type === "ConditionalExpression";
}

export const maxTernaryDepthRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Limit ternary expression chains to a configurable depth.",
    },
    messages: {
      exceeded:
        "This ternary has depth {{depth}}, above the configured maximum of {{maxDepth}}. Nested selections obscure the decision branches. Fix: use a lookup table, `switch`, or named decision function.",
    },
    schema: [
      {
        type: "object",
        properties: { maxDepth: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ maxDepth: 2 }],
  },
  createOnce(context) {
    return {
      ConditionalExpression(node) {
        if (isNestedTernary(node)) return;
        const option = context.options?.[0];
        const maxDepth =
          typeof option === "object" &&
          option !== null &&
          !Array.isArray(option) &&
          typeof option.maxDepth === "number"
            ? option.maxDepth
            : 2;
        const depth = ternaryDepth(node);
        if (depth > maxDepth) {
          context.report({
            node,
            messageId: "exceeded",
            data: { depth, maxDepth },
          });
        }
      },
    };
  },
});
