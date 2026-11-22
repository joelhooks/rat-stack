import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

const propertyName = (key: ESTree.Node) => {
  if (key.type === "Identifier") {
    return key.name;
  }
  return key.type === "Literal" && typeof key.value === "string"
    ? key.value
    : undefined;
};

export const memberName = (node: ESTree.MemberExpression) =>
  node.computed && node.property.type !== "Literal"
    ? undefined
    : propertyName(node.property);

export const keyName = (node: ESTree.Node) =>
  node.type === "Property" && !node.computed
    ? propertyName(node.key)
    : undefined;

export const isCallback = (
  node: ESTree.Node | undefined | null
): node is
  | ESTree.ArrowFunctionExpression
  | (ESTree.Function & {
      type: "FunctionExpression";
      body: ESTree.FunctionBody;
    }) =>
  node?.type === "ArrowFunctionExpression" ||
  (node?.type === "FunctionExpression" && node.body !== null);

const binding = (source: SourceCode, identifier: ESTree.Node, name: string) => {
  let scope: Scope | null = source.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(name);
    if (variable) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
};

type Reference = { readonly from: string; readonly names: readonly string[] };

const alchemy = "@alchemy.run/test/Vitest";

const constInitializer = (node: ESTree.Node) =>
  node.type === "VariableDeclarator" &&
  node.parent.type === "VariableDeclaration" &&
  node.parent.kind === "const"
    ? node.init
    : undefined;

const alchemyBinding = (
  source: SourceCode,
  node: ESTree.Node,
  name: string
) => {
  const init = constInitializer(node);
  if (!init || node.type !== "VariableDeclarator") {
    return undefined;
  }
  if (
    init.type === "CallExpression" &&
    matchesImport(imported(source, init.callee, false), [alchemy], "make")
  ) {
    if (node.id.type === "Identifier") {
      return { from: alchemy, names: [] };
    }
    if (node.id.type === "ObjectPattern") {
      const field = node.id.properties.find(
        (prop) =>
          prop.type === "Property" &&
          prop.value.type === "Identifier" &&
          prop.value.name === name
      );
      const key = field && keyName(field);
      return key === undefined ? undefined : { from: alchemy, names: [key] };
    }
  }
  return undefined;
};

export function imported(
  source: SourceCode,
  node: ESTree.Node,
  followAlchemy = true
): Reference | undefined {
  if (node.type === "MemberExpression") {
    const name = memberName(node);
    if (name === undefined) {
      return undefined;
    }
    const ref = imported(source, node.object, followAlchemy);
    return ref && { from: ref.from, names: [...ref.names, name] };
  }
  if (node.type !== "Identifier") {
    return undefined;
  }
  const variable = binding(source, node, node.name);
  const definition = variable?.defs[0];
  if (definition?.type === "Variable" && followAlchemy) {
    return alchemyBinding(source, definition.node, node.name);
  }
  if (definition?.type === "Parameter" && followAlchemy) {
    const { node: callback } = definition;
    const invocation = callback.parent;
    if (
      isCallback(callback) &&
      callback.params[0] === definition.name &&
      invocation?.type === "CallExpression" &&
      invocation.callee.type === "CallExpression"
    ) {
      const layer = imported(source, invocation.callee.callee);
      if (
        matchesImport(layer, ["@effect/vitest"], "layer") ||
        matchesImport(layer, ["@effect/vitest"], "it.layer")
      ) {
        return { from: "@effect/vitest", names: ["it"] };
      }
    }
  }
  const declaration = definition?.parent;
  if (
    definition?.type !== "ImportBinding" ||
    declaration?.type !== "ImportDeclaration" ||
    declaration.importKind === "type"
  ) {
    return undefined;
  }
  const specifier = definition.node;
  if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
    const name = propertyName(specifier.imported);
    return name === undefined
      ? undefined
      : { from: declaration.source.value, names: [name] };
  }
  if (specifier.type === "ImportNamespaceSpecifier") {
    return { from: declaration.source.value, names: [] };
  }
  return undefined;
}

export const matchesImport = (
  ref: Reference | undefined,
  from: readonly string[],
  name: string
) =>
  ref !== undefined && from.includes(ref.from) && ref.names.join(".") === name;

export const vitest = ["vitest", "@effect/vitest"];

export const hookNames = new Set([
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);
const runnerNames = new Set(["test", "it", "describe", "suite", ...hookNames]);
const builders = new Set(["each", "extend", "for", "layer", "runIf", "skipIf"]);

const runnerCallee = (node: ESTree.Node): ESTree.Node => {
  if (node.type === "TaggedTemplateExpression") {
    return runnerCallee(node.tag);
  }
  if (node.type === "CallExpression") {
    return runnerCallee(node.callee);
  }
  return node;
};

export const runner = (source: SourceCode, call: ESTree.CallExpression) => {
  const callee = runnerCallee(call.callee);
  const last = callee.type === "MemberExpression" && memberName(callee);
  if (call.callee === callee && last && builders.has(last)) {
    return undefined;
  }
  const ref = imported(source, callee);
  const [name, ...members] = ref?.names ?? [];
  if (name === undefined || !runnerNames.has(name) || !ref) {
    return undefined;
  }
  if (
    vitest.includes(ref.from) ||
    ref.from === alchemy ||
    ref.from === "bun:test" ||
    ref.from === "node:test"
  ) {
    return {
      name,
      members,
      alchemy: ref.from === alchemy,
      live:
        (ref.from === "@effect/vitest" && members.includes("live")) ||
        (ref.from === alchemy && name === "test"),
    };
  }
  return undefined;
};

export const hasImport = (source: SourceCode, modules: readonly string[]) =>
  source.ast.body.some(
    (node) =>
      node.type === "ImportDeclaration" && modules.includes(node.source.value)
  );

export const testModules = [...vitest, alchemy, "bun:test", "node:test"];

export const effectMethod = (
  source: SourceCode,
  node: ESTree.Node,
  name: string
) => {
  const ref = imported(source, node);
  return (
    matchesImport(ref, ["effect/Effect"], name) ||
    matchesImport(ref, ["effect"], `Effect.${name}`)
  );
};

export function expressionLabel(source: SourceCode, node: ESTree.Node): string {
  if (
    node.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return String(node.value);
  }
  return source
    .getTokens(node)
    .map((token) => source.getText(token))
    .join(" ");
}

export function inlineValue(
  source: SourceCode,
  node: ESTree.Node | undefined
): ESTree.Node | undefined {
  if (node?.type === "Identifier") {
    const definition = binding(source, node, node.name)?.defs[0];
    if (
      definition?.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier"
    ) {
      return constInitializer(definition.node) ?? node;
    }
  }
  if (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression"
  ) {
    return node.expression;
  }
  return node;
}

export function budgetLabel(source: SourceCode, node: ESTree.Node): string {
  return expressionLabel(source, inlineValue(source, node) ?? node);
}

export function testOwner(source: SourceCode, call: ESTree.CallExpression) {
  const owners: string[] = [];
  let current: ESTree.Node | null = call;
  while (current) {
    if (current.type === "CallExpression") {
      const title = current.arguments[0];
      const test = runner(source, current);
      if (
        title &&
        test &&
        (current === call ||
          test.name === "describe" ||
          test.name === "suite" ||
          test.members.includes("layer"))
      ) {
        if (!isCallback(title)) {
          owners.unshift(expressionLabel(source, title));
        }
      }
    }
    current = current.parent;
  }
  return owners;
}

export const returnExpressions = (
  node: ESTree.Node | undefined
): ESTree.Node[] => {
  if (!node) {
    return [];
  }
  if (!isCallback(node)) {
    return [node];
  }
  if (node.body.type !== "BlockStatement") {
    return [node.body];
  }
  return node.body.body.flatMap((statement) =>
    statement.type === "ReturnStatement" && statement.argument
      ? [statement.argument]
      : []
  );
};
