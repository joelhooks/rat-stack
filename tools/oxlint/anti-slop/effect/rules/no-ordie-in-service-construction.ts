import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  collectEffectModuleNames,
  isFunction,
  isTestFile,
  keyName,
  moduleCallName,
  moduleMemberName,
  serviceClass,
  type EffectModuleNames,
} from "../shared/effect-modules.ts";

const orDieMembers: ReadonlySet<string> = new Set(["orDie", "orDieWith"]);

const transparentThunks: ReadonlySet<string> = new Set(["suspend", "sync"]);

const operationConstructors: ReadonlySet<string> = new Set([
  "fn",
  "fnUntraced",
]);
const isLayerMemberName = (name: string): boolean =>
  name === "layer" || /^layer[A-Z0-9_]/u.test(name);
const isLayerConstructor = (name: string | null): boolean =>
  name === "effect" ||
  name === "scoped" ||
  (name?.startsWith("unwrap") ?? false);

function isServiceClassNode(
  node: ESTree.Node | null,
  names: EffectModuleNames
): boolean {
  return (
    (node?.type === "ClassDeclaration" || node?.type === "ClassExpression") &&
    serviceClass(node, names) !== null
  );
}

function isConstructionRoot(
  node: ESTree.Node,
  child: ESTree.Node,
  names: EffectModuleNames
): boolean {
  if (
    (node.type === "PropertyDefinition" || node.type === "MethodDefinition") &&
    node.static &&
    !node.computed
  ) {
    const name = keyName(node.key);
    return (
      node.value === child &&
      name !== null &&
      (name === "make" || isLayerMemberName(name)) &&
      isServiceClassNode(node.parent.parent, names)
    );
  }
  if (
    node.type === "Property" &&
    !node.computed &&
    node.value === child &&
    keyName(node.key) === "make"
  ) {
    const options = node.parent;
    const superCall = options.parent;
    return (
      options.type === "ObjectExpression" &&
      superCall?.type === "CallExpression" &&
      isServiceClassNode(superCall.parent, names)
    );
  }
  if (
    node.type === "CallExpression" &&
    node.arguments.some((argument) => argument === child)
  ) {
    return isLayerConstructor(moduleCallName(node, names, "Layer"));
  }
  return false;
}

function effectConstructorOf(
  fn: ESTree.Node,
  names: EffectModuleNames
): string | null {
  const parent = fn.parent;
  if (
    parent?.type !== "CallExpression" ||
    !parent.arguments.some((argument) => argument === fn)
  )
    return null;
  return moduleCallName(parent, names, "Effect");
}

function isOperationDefinition(
  node: ESTree.Node,
  names: EffectModuleNames
): boolean {
  if (node.type !== "CallExpression") return false;
  const direct = moduleCallName(node, names, "Effect");
  if (direct !== null && operationConstructors.has(direct)) return true;
  const curried = moduleCallName(node.callee, names, "Effect");
  return curried !== null && operationConstructors.has(curried);
}

function isInServiceConstruction(
  node: ESTree.Node,
  names: EffectModuleNames
): boolean {
  let child: ESTree.Node = node;
  let current: ESTree.Node | null = node.parent;
  let yielded = false;
  while (current !== null) {
    if (isFunction(current)) {
      if (
        current.parent !== null &&
        isConstructionRoot(current.parent, current, names)
      )
        return true;
      const constructor = effectConstructorOf(current, names);
      if (constructor === "gen") {
        if (!yielded) return false;
        yielded = false;
      } else if (constructor === null || !transparentThunks.has(constructor)) {
        return false;
      }
    } else if (isConstructionRoot(current, child, names)) {
      return true;
    } else if (
      current.type === "Property" ||
      isOperationDefinition(current, names)
    ) {
      return false;
    } else if (current.type === "YieldExpression" && current.delegate) {
      yielded = true;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

export const noOrDieInServiceConstructionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `Effect.orDie` while constructing a service (its make, its static layers, or Layer.effect/unwrap arguments) and `Layer.orDie` anywhere.",
    },
    messages: {
      constructionOrDie:
        "`Effect.{{member}}` turns a service construction failure into a defect. Callers lose the typed failure needed for recovery. Fix: keep a `Schema.TaggedError` in the layer error channel or handle it with `Effect.catchTag`.",
      layerOrDie:
        "`Layer.orDie` hides construction failures as defects. Callers cannot recover through the typed error channel. Fix: keep `Schema.TaggedError` failures in the layer and handle them at runtime composition.",
    },
  },
  create(context) {
    if (isTestFile(context.filename)) return {};
    const names = collectEffectModuleNames(context.sourceCode.ast);

    return {
      MemberExpression(node) {
        if (moduleMemberName(node, names, "Layer") === "orDie") {
          context.report({ node, messageId: "layerOrDie" });
          return;
        }
        const member = moduleMemberName(node, names, "Effect");
        if (
          member === null ||
          !orDieMembers.has(member) ||
          !isInServiceConstruction(node, names)
        )
          return;
        context.report({
          node,
          messageId: "constructionOrDie",
          data: { member },
        });
      },
    };
  },
});
