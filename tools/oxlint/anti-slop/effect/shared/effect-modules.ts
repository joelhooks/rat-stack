import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

export function resolveIdentifier(
  sourceCode: SourceCode,
  identifier: ESTree.Node & { readonly name: string }
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

export type EffectModule = "Context" | "Effect" | "Layer" | "ManagedRuntime";

const effectModules: ReadonlySet<string> = new Set<EffectModule>([
  "Context",
  "Effect",
  "Layer",
  "ManagedRuntime",
]);

export type EffectModuleNames = ReadonlyMap<EffectModule, ReadonlySet<string>>;

const isEffectModule = (name: string): name is EffectModule =>
  effectModules.has(name);

const importedName = (specifier: ESTree.ImportSpecifier): string =>
  specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;

export function collectEffectModuleNames(
  program: ESTree.Program
): EffectModuleNames {
  const names = new Map<EffectModule, Set<string>>();
  const add = (module: EffectModule, local: string) => {
    const existing = names.get(module) ?? new Set<string>();
    existing.add(local);
    names.set(module, existing);
  };

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = statement.source.value;
    if (source === "effect") {
      for (const specifier of statement.specifiers) {
        if (specifier.type !== "ImportSpecifier") continue;
        const name = importedName(specifier);
        if (isEffectModule(name)) add(name, specifier.local.name);
      }
      continue;
    }
    const module = source.startsWith("effect/")
      ? source.slice("effect/".length)
      : "";
    if (!isEffectModule(module)) continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      ) {
        add(module, specifier.local.name);
      }
    }
  }

  return names;
}

export function unwrapExpression(
  expression: ESTree.Expression
): ESTree.Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSInstantiationExpression"
  ) {
    current = current.expression;
  }
  return current;
}

export function unwrapNode(node: ESTree.Node): ESTree.Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSInstantiationExpression"
  ) {
    current = current.expression;
  }
  return current;
}

export function moduleMemberName(
  node: ESTree.Node | null | undefined,
  names: EffectModuleNames,
  module: EffectModule
): string | null {
  if (node === null || node === undefined) return null;
  const expression =
    node.type === "TSInstantiationExpression" ? node.expression : node;
  if (
    expression.type !== "MemberExpression" ||
    expression.computed ||
    expression.object.type !== "Identifier" ||
    !(names.get(module)?.has(expression.object.name) ?? false) ||
    expression.property.type !== "Identifier"
  ) {
    return null;
  }
  return expression.property.name;
}

export function moduleCallName(
  node: ESTree.Node | null | undefined,
  names: EffectModuleNames,
  module: EffectModule
): string | null {
  return node?.type === "CallExpression"
    ? moduleMemberName(unwrapExpression(node.callee), names, module)
    : null;
}

export interface ServiceClass {
  readonly node: ESTree.Class;
  readonly name: string | null;
  readonly options: ESTree.ObjectExpression | null;
}

export function serviceClass(
  node: ESTree.Class,
  names: EffectModuleNames
): ServiceClass | null {
  if (node.superClass === null) return null;
  const superClass = unwrapExpression(node.superClass);
  if (superClass.type !== "CallExpression") return null;
  const factory = unwrapExpression(superClass.callee);
  if (
    factory.type !== "CallExpression" ||
    moduleMemberName(unwrapExpression(factory.callee), names, "Context") !==
      "Service"
  ) {
    return null;
  }
  const optionsArgument = superClass.arguments[1];
  const options =
    optionsArgument !== undefined && optionsArgument.type !== "SpreadElement"
      ? unwrapExpression(optionsArgument)
      : null;
  return {
    node,
    name: node.id?.name ?? null,
    options: options?.type === "ObjectExpression" ? options : null,
  };
}

export function enclosingClass(node: ESTree.Node): ESTree.Class | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (current.type === "ClassBody")
      return current.parent.type === "ClassDeclaration" ||
        current.parent.type === "ClassExpression"
        ? current.parent
        : null;
    current = current.parent;
  }
  return null;
}

function isClassReference(
  node: ESTree.Node | null | undefined,
  service: ServiceClass
): boolean {
  if (node === null || node === undefined) return false;
  const expression = unwrapNode(node);
  if (expression.type === "ThisExpression") return true;
  return (
    expression.type === "Identifier" &&
    service.name !== null &&
    expression.name === service.name
  );
}

export function classMemberName(
  node: ESTree.Node | null | undefined,
  service: ServiceClass
): string | null {
  if (node === null || node === undefined) return null;
  const expression = unwrapNode(node);
  if (
    expression.type !== "MemberExpression" ||
    expression.computed ||
    expression.property.type !== "Identifier" ||
    !isClassReference(expression.object, service)
  ) {
    return null;
  }
  return expression.property.name;
}

export function keyName(key: ESTree.Node): string | null {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier")
    return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function objectProperty(
  object: ESTree.ObjectExpression,
  name: string
): ESTree.ObjectProperty | null {
  for (const property of object.properties) {
    if (
      property.type === "Property" &&
      !property.computed &&
      keyName(property.key) === name
    )
      return property;
  }
  return null;
}

export interface StaticMember {
  readonly name: string;
  readonly node: ESTree.PropertyDefinition | ESTree.MethodDefinition;

  readonly value: ESTree.Expression | null;
}

export function staticMembers(node: ESTree.Class): readonly StaticMember[] {
  const members: StaticMember[] = [];
  for (const element of node.body.body) {
    if (
      (element.type !== "PropertyDefinition" &&
        element.type !== "MethodDefinition") ||
      !element.static ||
      element.computed
    )
      continue;
    const name = keyName(element.key);
    if (name === null) continue;
    members.push({ name, node: element, value: element.value });
  }
  return members;
}

export function serviceMakes(
  service: ServiceClass
): readonly ESTree.Expression[] {
  const makes: ESTree.Expression[] = [];
  const optionsMake =
    service.options === null ? null : objectProperty(service.options, "make");
  if (optionsMake !== null) makes.push(optionsMake.value);
  for (const member of staticMembers(service.node)) {
    if (member.name === "make" && member.value !== null)
      makes.push(member.value);
  }
  return makes;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

export const isTestFile = (filename: string): boolean =>
  TEST_FILE.test(filename.replaceAll("\\", "/"));

const skippedKeys: ReadonlySet<string> = new Set([
  "parent",
  "loc",
  "range",
  "start",
  "end",
]);

const isNode = (value: unknown): value is ESTree.Node =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string";

export function walk(
  node: ESTree.Node,
  visit: (node: ESTree.Node) => boolean
): void {
  if (!visit(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (skippedKeys.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit);
      }
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

export function contains(
  node: ESTree.Node,
  predicate: (node: ESTree.Node) => boolean
): boolean {
  let found = false;
  walk(node, (current) => {
    if (found) return false;
    if (predicate(current)) found = true;
    return !found;
  });
  return found;
}

export type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

export const isFunction = (
  node: ESTree.Node | null | undefined
): node is FunctionNode =>
  node?.type === "ArrowFunctionExpression" ||
  node?.type === "FunctionExpression" ||
  node?.type === "FunctionDeclaration";

export function ownReturns(
  body: ESTree.Node
): readonly ESTree.ReturnStatement[] {
  const returns: ESTree.ReturnStatement[] = [];
  walk(body, (node) => {
    if (node !== body && isFunction(node)) return false;
    if (node.type === "ReturnStatement") returns.push(node);
    return true;
  });
  return returns;
}

export function returnedExpressions(
  fn: FunctionNode
): readonly ESTree.Expression[] {
  if (fn.body === null) return [];
  if (fn.body.type !== "BlockStatement") return [fn.body];
  return ownReturns(fn.body).flatMap((statement) =>
    statement.argument === null ? [] : [statement.argument]
  );
}

const isPipeMember = (node: ESTree.Node): node is ESTree.MemberExpression =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier" &&
  node.property.name === "pipe";

export function pipeReceiver(node: ESTree.Node): ESTree.Expression | null {
  if (node.type !== "CallExpression") return null;
  const callee = unwrapExpression(node.callee);
  return isPipeMember(callee) ? unwrapExpression(callee.object) : null;
}

export function precedingSteps(call: ESTree.Node): readonly ESTree.Node[] {
  const parent = call.parent;
  if (parent?.type !== "CallExpression") return [];
  const index = parent.arguments.findIndex((argument) => argument === call);
  if (index < 0) return [];
  const steps: ESTree.Node[] = [];
  let receiver = pipeReceiver(parent);
  while (receiver !== null) {
    steps.push(receiver);
    if (receiver.type === "CallExpression") steps.push(...receiver.arguments);
    receiver = pipeReceiver(receiver);
  }
  steps.push(...parent.arguments.slice(0, index));
  return steps;
}

export function resolveInitializer(
  sourceCode: SourceCode,
  identifier: ESTree.Node & { readonly name: string }
): ESTree.Expression | ESTree.Function | null {
  const variable = resolveIdentifier(sourceCode, identifier);
  if (variable === null || variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  if (definition === undefined) return null;
  if (
    definition.type === "FunctionName" &&
    definition.node.type === "FunctionDeclaration"
  )
    return definition.node;
  if (
    definition.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator"
  )
    return null;
  return definition.node.init ?? null;
}

export function genFunction(
  node: ESTree.Node,
  names: EffectModuleNames
): ESTree.Function | null {
  if (
    moduleCallName(node, names, "Effect") !== "gen" ||
    node.type !== "CallExpression"
  )
    return null;
  const body = node.arguments.at(-1);
  return body?.type === "FunctionExpression" ? body : null;
}

export function makeGenerator(
  make: ESTree.Expression,
  names: EffectModuleNames
): ESTree.Function | null {
  let expression = unwrapExpression(make);
  if (
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "FunctionExpression"
  ) {
    const [returned] = returnedExpressions(expression);
    if (returned === undefined) return null;
    expression = unwrapExpression(returned);
  }
  let receiver = pipeReceiver(expression);
  while (receiver !== null) {
    expression = receiver;
    receiver = pipeReceiver(expression);
  }
  return genFunction(expression, names);
}
