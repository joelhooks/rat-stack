import { defineRule } from "@oxlint/plugins";

import {
  isInsideBroadEffectHandler,
  isReasonTagMember,
  isTagMember,
  tagMemberFromComparison,
} from "../shared/tagged-values.ts";

export const noManualEffectErrorTagRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Effect tagged error handlers instead of manually branching on `_tag` in a catch handler.",
    },
    messages: {
      tag: "This broad Effect catch handler discriminates a tagged error by hand. A manual `_tag` check leaves the handled error in the error channel type. Fix: use `Effect.catchTag` or `Effect.catchTags`.",
      reason:
        "This broad Effect catch handler discriminates a tagged `reason` by hand. A manual check leaves the handled reason in the error channel type. Fix: use `Effect.catchReason` or `Effect.catchReasons`.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        const tagMember = tagMemberFromComparison(node);
        if (tagMember === undefined || !isInsideBroadEffectHandler(node)) {
          return;
        }
        context.report({
          node,
          messageId: isReasonTagMember(tagMember) ? "reason" : "tag",
        });
      },
      SwitchStatement(node) {
        if (
          !isTagMember(node.discriminant) ||
          !isInsideBroadEffectHandler(node)
        ) {
          return;
        }
        context.report({
          node,
          messageId: isReasonTagMember(node.discriminant) ? "reason" : "tag",
        });
      },
    };
  },
});
