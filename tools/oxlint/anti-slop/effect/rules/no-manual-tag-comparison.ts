import { defineRule } from "@oxlint/plugins";

import {
  isInsideBroadEffectHandler,
  isTagMember,
  tagMemberFromComparison,
} from "../shared/tagged-values.ts";

export const noManualTagComparisonRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Effect Match or Predicate helpers instead of manually branching on `_tag`.",
    },
    messages: {
      manualComparison:
        "This compares `_tag` by hand. A manual comparison skips the narrowing and exhaustiveness Match provides. Fix: use `Match.tag` or `Match.tags` for tagged-value branching, or `Predicate.isTagged` for a simple reusable predicate.",
      manualSwitch:
        "This switches on `_tag`. A switch skips the exhaustiveness check Match provides. Fix: use `Match.value(value).pipe(Match.tagsExhaustive({ ... }))` or the tagged enum's `$match` helper.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (
          tagMemberFromComparison(node) === undefined ||
          isInsideBroadEffectHandler(node)
        ) {
          return;
        }
        context.report({ node, messageId: "manualComparison" });
      },
      SwitchStatement(node) {
        if (
          !isTagMember(node.discriminant) ||
          isInsideBroadEffectHandler(node)
        ) {
          return;
        }
        context.report({ node, messageId: "manualSwitch" });
      },
    };
  },
});
