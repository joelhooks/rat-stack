import { defineRule } from "@oxlint/plugins";

import {
  isMatchPatternObject,
  isStringLiteral,
  propertyName,
} from "../shared/tagged-values.ts";

export const noManualTaggedConstructionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Construct tagged values with their existing Effect constructor instead of writing `_tag` manually.",
    },
    messages: {
      manualConstruction:
        "This object literal writes `_tag` by hand. A literal skips the constructor's schema and can drift from the type. Fix: use the existing Schema tagged `.make`, the tagged class or error constructor, or the `Data.taggedEnum` variant constructor.",
    },
  },
  createOnce(context) {
    return {
      ObjectExpression(node) {
        if (isMatchPatternObject(node)) return;
        const tag = node.properties.find(
          (property) =>
            property.type === "Property" &&
            propertyName(property) === "_tag" &&
            isStringLiteral(property.value)
        );
        if (tag !== undefined) {
          context.report({ node: tag, messageId: "manualConstruction" });
        }
      },
    };
  },
});
