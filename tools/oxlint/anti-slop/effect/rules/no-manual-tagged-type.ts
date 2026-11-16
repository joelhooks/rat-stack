import { defineRule, type ESTree } from "@oxlint/plugins";

const isTagKey = (key: ESTree.Node): boolean =>
  (key.type === "Identifier" && key.name === "_tag") ||
  (key.type === "Literal" && key.value === "_tag");

export const noManualTaggedTypeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Derive tagged types from a tagged Schema or Data constructor instead of declaring `_tag` in a type or interface.",
    },
    messages: {
      manualTaggedType:
        "This type declares `_tag` by hand. A separate tag declaration can drift from its constructor. Fix: define a tagged Schema or Data constructor and derive the type with `typeof X.Type`.",
    },
  },
  createOnce(context) {
    return {
      TSPropertySignature(node) {
        if (isTagKey(node.key)) {
          context.report({ node, messageId: "manualTaggedType" });
        }
      },
    };
  },
});
