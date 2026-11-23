import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

import { budgetMessage } from "../finding.ts";
import {
  expressionLabel,
  hasImport,
  imported,
  isCallback,
  matchesImport,
  memberName,
  runner,
  testModules,
  testOwner,
  vitest,
} from "../syntax.ts";

const replacements = new Set([
  "mockImplementation",
  "mockImplementationOnce",
  "mockReturnValue",
  "mockReturnValueOnce",
  "mockResolvedValue",
  "mockResolvedValueOnce",
  "mockRejectedValue",
  "mockRejectedValueOnce",
  "mockReturnThis",
  "withImplementation",
]);

const frameworkReplacements = new Set([
  "stubGlobal",
  "mockObject",
  "importMock",
]);

const replacementGlobals = new Set([
  "AbortController",
  "AbortSignal",
  "fetch",
  "document",
  "CSS",
  "scrollTo",
  "scrollBy",
  "visualViewport",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "CompressionStream",
  "DecompressionStream",
  "Worker",
  "SharedWorker",
  "WebSocket",
  "XMLHttpRequest",
  "ResizeObserver",
  "IntersectionObserver",
  "MutationObserver",
  "requestIdleCallback",
  "cancelIdleCallback",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  "navigator",
  "Notification",
  "matchMedia",
  "open",
  "performance",
  "screen",
  "crypto",
  "Date",
  "FileReader",
  "BroadcastChannel",
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
]);

const documentReplacements = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "createElement",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "visibilityState",
  "hidden",
  "hasFocus",
]);

const navigatorReplacements = new Set([
  "clipboard",
  "permissions",
  "storage",
  "serviceWorker",
  "gpu",
  "credentials",
  "userAgent",
  "userAgentData",
  "webdriver",
  "platform",
  "onLine",
]);

const storageReplacements = new Set([
  "getItem",
  "setItem",
  "removeItem",
  "clear",
  "key",
  "length",
]);

const nestedReplacements = new Map<string, ReadonlySet<string>>([
  ["document", documentReplacements],
  ["Document.prototype", documentReplacements],
  ["navigator", navigatorReplacements],
  ["Navigator.prototype", navigatorReplacements],
  ["AbortSignal", new Set(["abort", "any", "timeout"])],
  ["Date", new Set(["now"])],
  ["Math", new Set(["random"])],
  ["performance", new Set(["now"])],
  ["crypto", new Set(["randomUUID", "getRandomValues"])],
  ["history", new Set(["pushState", "replaceState", "go", "back", "forward"])],
  ["Storage.prototype", storageReplacements],
  ["localStorage", storageReplacements],
  ["sessionStorage", storageReplacements],
  ["navigator.clipboard", new Set(["read", "readText", "write", "writeText"])],
  [
    "navigator.credentials",
    new Set(["get", "create", "store", "preventSilentAccess"]),
  ],
  ["navigator.permissions", new Set(["query"])],
  [
    "navigator.storage",
    new Set(["estimate", "persist", "persisted", "getDirectory"]),
  ],
  ["navigator.userAgentData", new Set(["getHighEntropyValues", "toJSON"])],
]);

const globalObjects = new Set(["globalThis", "window", "global", "self"]);

const keyMutations = new Set([
  "Object.defineProperty",
  "Reflect.defineProperty",
  "Reflect.set",
  "Reflect.deleteProperty",
]);

const testPath =
  /(?:^|\/)(?:__tests__|tests?|testing|test-utils)(?:\/|$)|(?:^|[/.])(?:test|spec|fixture|mock|setup)(?:\.[^/]*)?$/u;

function unshadowed(
  source: SourceCode,
  node: ESTree.Node & { readonly name: string }
) {
  let scope: Scope | null = source.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable && variable.defs.length > 0) {
      return false;
    }
    scope = scope.upper;
  }
  return true;
}

const literalKey = (node: ESTree.Node | null | undefined) =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;

function globalPath(
  source: SourceCode,
  node: ESTree.Node
): string[] | undefined {
  if (node.type === "Identifier") {
    if (!unshadowed(source, node)) {
      return undefined;
    }
    return globalObjects.has(node.name) ? [] : [node.name];
  }
  if (node.type !== "MemberExpression") {
    return undefined;
  }
  const name = memberName(node);
  const path = name === undefined ? undefined : globalPath(source, node.object);
  return path && name !== undefined ? [...path, name] : undefined;
}

function protectedKeys(source: SourceCode, target: ESTree.Node) {
  const path = globalPath(source, target);
  if (path === undefined) {
    return undefined;
  }
  if (path.length === 0) {
    return replacementGlobals;
  }
  return nestedReplacements.get(path.join("."));
}

function memberPath(node: ESTree.Node): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type !== "MemberExpression") {
    return undefined;
  }
  const name = memberName(node);
  const object = memberPath(node.object);
  return name === undefined || object === undefined
    ? undefined
    : `${object}.${name}`;
}

const isPrototype = (node: ESTree.Node) =>
  node.type === "MemberExpression" && memberName(node) === "prototype";

function replacesKey(
  source: SourceCode,
  target: ESTree.Node,
  key: string | undefined
) {
  if (key === undefined) {
    return false;
  }
  return (
    isPrototype(target) || protectedKeys(source, target)?.has(key) === true
  );
}

function replacedKeys(
  source: SourceCode,
  target: ESTree.Node,
  properties: ESTree.Node | undefined
) {
  if (properties?.type !== "ObjectExpression") {
    return [];
  }
  return properties.properties.flatMap((property) => {
    if (property.type !== "Property") {
      return [];
    }
    const key = property.computed
      ? literalKey(property.key)
      : property.key.type === "Identifier"
        ? property.key.name
        : literalKey(property.key);
    return key !== undefined && replacesKey(source, target, key) ? [key] : [];
  });
}

function globalMutation(source: SourceCode, callee: ESTree.Node) {
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    (callee.object.name !== "Object" && callee.object.name !== "Reflect") ||
    !unshadowed(source, callee.object)
  ) {
    return undefined;
  }
  return memberPath(callee);
}

function mutatedKeys(
  source: SourceCode,
  mutation: string,
  args: readonly ESTree.Node[]
) {
  const [target, second] = args;
  if (target === undefined) {
    return [];
  }
  if (keyMutations.has(mutation)) {
    const key = literalKey(second);
    return key !== undefined && replacesKey(source, target, key) ? [key] : [];
  }
  if (mutation === "Object.defineProperties") {
    return replacedKeys(source, target, second);
  }
  return mutation === "Object.assign"
    ? args.slice(1).flatMap((value) => replacedKeys(source, target, value))
    : [];
}

function vitestCall(source: SourceCode, callee: ESTree.Node) {
  const ref = imported(source, callee, false);
  if (!ref || !vitest.includes(ref.from)) {
    return undefined;
  }
  const [framework, method, ...rest] = ref.names;
  return (framework === "vi" || framework === "vitest") &&
    method !== undefined &&
    rest.length === 0
    ? method
    : undefined;
}

function layerMock(source: SourceCode, callee: ESTree.Node) {
  const ref = imported(source, callee, false);
  return (
    matchesImport(ref, ["effect"], "Layer.mock") ||
    matchesImport(ref, ["effect/Layer"], "mock")
  );
}

function owner(source: SourceCode, node: ESTree.Node) {
  let current: ESTree.Node | null = node.parent;
  while (current) {
    if (
      current.type === "CallExpression" &&
      runner(source, current) &&
      current.arguments.some(
        (argument) =>
          isCallback(argument) &&
          argument.range[0] <= node.range[0] &&
          node.range[1] <= argument.range[1]
      )
    ) {
      return testOwner(source, current);
    }
    current = current.parent;
  }
  return [];
}

function implementationLabel(node: ESTree.Node | undefined) {
  if (node === undefined) {
    return "none";
  }
  return node.type === "Identifier" ? node.name : "inline";
}

export const noTestDoubles = defineRule({
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description:
        "Disallow test doubles that replace real behaviour: implemented vi.fn, mock implementations, stubbed globals and prototypes, and Layer.mock.",
    },
    messages: {
      double: budgetMessage(
        "This test replaces real behaviour with a test double",
        "A canned stand-in keeps passing when the code it replaces breaks",
        "provide the real implementation or a shared in-memory adapter `Layer`, and keep `vi.fn()` and `vi.spyOn` observation-only"
      ),
    },
  },
  create(context) {
    const source = context.sourceCode;
    const testCode =
      testPath.test(context.filename.replaceAll("\\", "/")) ||
      hasImport(source, testModules);

    function report(node: ESTree.Node, api: string, label: string) {
      const signature = JSON.stringify([
        "double",
        owner(source, node),
        api,
        label,
      ]);
      context.report({ node, messageId: "double", data: { signature } });
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        const [first, second] = node.arguments;
        const method = vitestCall(source, callee);
        if (
          method === "fn" &&
          first !== undefined &&
          !(first.type === "Identifier" && first.name === "undefined")
        ) {
          report(node, "vi.fn", implementationLabel(first));
          return;
        }
        if (method !== undefined && frameworkReplacements.has(method)) {
          report(
            node,
            `vi.${method}`,
            literalKey(first) ?? implementationLabel(first)
          );
          return;
        }
        if (layerMock(source, callee)) {
          report(
            node,
            "Layer.mock",
            first ? expressionLabel(source, first) : "none"
          );
          return;
        }
        if (callee.type === "MemberExpression") {
          const name = memberName(callee);
          if (name !== undefined && replacements.has(name)) {
            report(node, name, expressionLabel(source, callee.object));
            return;
          }
        }
        const mutation = testCode ? globalMutation(source, callee) : undefined;
        if (mutation === undefined || first === undefined) {
          return;
        }
        const target = memberPath(first) ?? "object";
        for (const key of mutatedKeys(source, mutation, node.arguments)) {
          report(node, mutation, `${target}.${key}`);
        }
      },
      AssignmentExpression(node) {
        if (!testCode) {
          return;
        }
        const { left } = node;
        if (
          left.type === "Identifier" &&
          replacementGlobals.has(left.name) &&
          unshadowed(source, left)
        ) {
          report(node, "global", left.name);
          return;
        }
        if (
          left.type === "MemberExpression" &&
          replacesKey(source, left.object, memberName(left))
        ) {
          report(node, "global", memberPath(left) ?? "member");
        }
      },
      UnaryExpression(node) {
        if (
          testCode &&
          node.operator === "delete" &&
          node.argument.type === "MemberExpression" &&
          replacesKey(source, node.argument.object, memberName(node.argument))
        ) {
          report(node, "delete", memberPath(node.argument) ?? "member");
        }
      },
    };
  },
});
