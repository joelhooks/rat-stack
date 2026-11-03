import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/** Ban Reflect.apply, which bypasses ordinary typed function calls. */
export const noReflectApplyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.",
    },
    messages: {
      reflectApply:
        "`Reflect.apply` calls a function without a typed signature. Its arguments and result escape type checking. Fix: call the function directly as `fn(...args)`, and model dynamic dispatch behind a named interface.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Super" ||
          node.callee.type === "V8IntrinsicExpression"
        )
          return;
        if (
          isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply")
        ) {
          context.report({ node, messageId: "reflectApply" });
        }
      },
    };
  },
});
