import { Option, Schema } from "effect";
import type { JsonSchema } from "effect";
import { Tool } from "effect/ai";

import { failureSchemaOf } from "./contract.js";
import type { Annotations, AnyCapability } from "./contract.js";
import { inputJsonSchemaOf } from "./input-json-schema.js";

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly annotations: Annotations;
  readonly needsApproval: boolean;
  readonly input: JsonSchema.JsonSchema;
  readonly output: JsonSchema.JsonSchema;
  readonly failure: JsonSchema.JsonSchema;
}

export interface Catalog {
  readonly version: "1";
  readonly capabilities: readonly CatalogEntry[];
}

export const toCatalog = (capabilities: readonly AnyCapability[]): Catalog => ({
  capabilities: capabilities.map(({ contract }) => ({
    annotations: contract.annotations,
    description: contract.description,
    failure: Tool.getJsonSchemaFromSchema(failureSchemaOf(contract)),
    input: inputJsonSchemaOf(contract.input),
    name: contract.name,
    needsApproval: contract.needsApproval,
    output: Tool.getJsonSchemaFromSchema(contract.output),
  })),
  version: "1",
});

type JsonLiteral = string | number | boolean | null;

interface JsonSchemaNode {
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>;
  readonly $ref?: string;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly const?: JsonLiteral;
  readonly description?: string;
  readonly enum?: readonly JsonLiteral[];
  readonly items?: JsonSchemaNode;
  readonly not?: JsonSchemaNode;
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly type?: string | readonly string[];
}

const JsonLiteralSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);

const JsonSchemaNodeSchema: Schema.Codec<JsonSchemaNode> = Schema.Struct({
  $defs: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend(() => JsonSchemaNodeSchema)
    )
  ),
  $ref: Schema.optionalKey(Schema.String),
  anyOf: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => JsonSchemaNodeSchema))
  ),
  const: Schema.optionalKey(JsonLiteralSchema),
  description: Schema.optionalKey(Schema.String),
  enum: Schema.optionalKey(Schema.Array(JsonLiteralSchema)),
  items: Schema.optionalKey(Schema.suspend(() => JsonSchemaNodeSchema)),
  not: Schema.optionalKey(Schema.suspend(() => JsonSchemaNodeSchema)),
  oneOf: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => JsonSchemaNodeSchema))
  ),
  properties: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend(() => JsonSchemaNodeSchema)
    )
  ),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
  type: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
});

const parseNode = Schema.decodeUnknownOption(JsonSchemaNodeSchema);

const quoteKey = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/u.test(key) ? key : JSON.stringify(key);

const literal = (value: JsonLiteral): string =>
  value === null ? "null" : JSON.stringify(value);

const refName = (ref: string | undefined): string | undefined =>
  ref?.startsWith("#/$defs/") === true
    ? ref.slice("#/$defs/".length)
    : undefined;

const objectType = (node: JsonSchemaNode): string => {
  const required = new Set(node.required);

  const members = Object.entries(node.properties ?? {}).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";

    const description =
      value.description === undefined ? "" : `/** ${value.description} */ `;

    // oxlint-disable-next-line no-use-before-define -- printNode and the object/primitive printers are mutually recursive.
    return `${description}readonly ${quoteKey(key)}${optional}: ${printNode(value)}`;
  });

  return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
};

const primitive = (type: string, node: JsonSchemaNode): string => {
  switch (type) {
    case "string": {
      return node.enum === undefined
        ? "string"
        : node.enum.map(literal).join(" | ");
    }

    case "number":
    case "integer": {
      return "number";
    }

    case "boolean": {
      return "boolean";
    }

    case "null": {
      return "null";
    }

    case "array": {
      return node.items === undefined
        ? "ReadonlyArray<unknown>"
        : // oxlint-disable-next-line no-use-before-define
          `ReadonlyArray<${printNode(node.items)}>`;
    }

    case "object": {
      return objectType(node);
    }

    default: {
      return "unknown";
    }
  }
};

const printNode = (node: JsonSchemaNode): string => {
  const ref = refName(node.$ref);

  if (ref !== undefined) {
    return ref;
  }

  if (node.const !== undefined) {
    return literal(node.const);
  }

  if (node.not !== undefined && Object.keys(node.not).length === 0) {
    return "never";
  }

  const variants = node.anyOf ?? node.oneOf;

  if (variants !== undefined) {
    return [...new Set(variants.map(printNode))].join(" | ");
  }

  const types = [node.type ?? []].flat();

  if (types.length > 0) {
    return [...new Set(types.map((member) => primitive(member, node)))].join(
      " | "
    );
  }

  if (node.enum !== undefined) {
    return node.enum.map(literal).join(" | ");
  }

  return "unknown";
};

export const typeOf = (schema: JsonSchema.JsonSchema): string =>
  Option.match(parseNode(schema), {
    onNone: () => "unknown",
    onSome: printNode,
  });

const definitions = (
  schema: JsonSchema.JsonSchema
): readonly (readonly [string, JsonSchemaNode])[] =>
  Option.match(parseNode(schema), {
    onNone: () => [],
    onSome: (node) => Object.entries(node.$defs ?? {}),
  });

const docComment = (lines: readonly string[]): string =>
  ["/**", ...lines.map((line) => ` * ${line}`), " */"].join("\n");

export const signatureOf = (entry: CatalogEntry): string => {
  const notes = [entry.description];

  if (entry.annotations.readOnly) {
    notes.push("Read-only.");
  }

  if (entry.annotations.destructive) {
    notes.push("Destructive: may irreversibly change state.");
  }

  if (entry.needsApproval) {
    notes.push("Needs approval before it runs.");
  }

  const failure = typeOf(entry.failure);

  if (failure !== "never") {
    notes.push(`@throws ${failure}`);
  }

  return `${docComment(notes)}\nreadonly ${quoteKey(entry.name)}: (input: ${typeOf(entry.input)}) => Promise<${typeOf(entry.output)}>;`;
};

export const toTypeScript = (catalog: Catalog): string => {
  const named = new Map<string, JsonSchemaNode>();

  for (const entry of catalog.capabilities) {
    for (const [name, schema] of [
      ...definitions(entry.input),
      ...definitions(entry.output),
      ...definitions(entry.failure),
    ]) {
      named.set(name, schema);
    }
  }

  const aliases = [...named].map(
    ([name, node]) => `type ${name} = ${printNode(node)};`
  );

  const members = catalog.capabilities.map((entry) =>
    signatureOf(entry)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")
  );

  return [...aliases, "declare const tools: {", ...members, "};", ""].join(
    "\n"
  );
};

export const namespaceOf = (name: string): string =>
  name.includes(".") ? (name.split(".")[0] ?? "tools") : "tools";

export const discoverCatalog = (catalog: Catalog, budget = 2000) => {
  const checkedBudget = Schema.decodeSync(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  )(budget);

  const groups = new Map<string, CatalogEntry[]>();

  for (const entry of catalog.capabilities) {
    const namespace = namespaceOf(entry.name);
    const group = groups.get(namespace) ?? [];
    group.push(entry);
    groups.set(namespace, group);
  }

  const namespaces = [...groups].toSorted(([a], [b]) => a.localeCompare(b));

  const selections = namespaces.map(([namespace, entries]) => ({
    entries,
    namespace,
    queue: entries
      .map((entry) => ({
        cost: toTypeScript({ capabilities: [entry], version: "1" }).length / 4,
        entry,
      }))
      .toSorted(
        (a, b) => a.cost - b.cost || a.entry.name.localeCompare(b.entry.name)
      ),
    shown: new Array<CatalogEntry>(),
  }));

  let used = 0;
  let active = selections;

  while (active.length > 0) {
    const nextRound: typeof active = [];

    for (const selection of active) {
      const next = selection.queue.shift();

      if (next === undefined || used + next.cost > checkedBudget) {
        continue;
      }

      used += next.cost;
      selection.shown.push(next.entry);
      nextRound.push(selection);
    }

    active = nextRound;
  }

  const selected = selections.flatMap((selection) => selection.shown);
  const complete = selected.length === catalog.capabilities.length;

  const status = complete
    ? `COMPLETE list (${selected.length} tools)`
    : `PARTIAL (${selected.length} of ${catalog.capabilities.length} shown)`;

  const summaries = selections.map(
    ({ entries, namespace, shown }) =>
      `${namespace}: ${shown.length === entries.length ? "COMPLETE" : "PARTIAL"} (${shown.length} of ${entries.length} shown)`
  );

  return {
    complete,
    declarations:
      selected.length === 0
        ? ""
        : toTypeScript({ capabilities: selected, version: "1" }),
    selected,
    summary: [status, ...summaries].join("\n"),
    used,
  };
};

const tokens = (text: string): readonly string[] =>
  text
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

export interface SearchMatch {
  readonly name: string;
  readonly description: string;
  readonly score: number;
  readonly signature: string;
}

const inputText = (node: JsonSchemaNode): string =>
  [
    node.description ?? "",
    ...Object.entries(node.properties ?? {}).flatMap(([name, property]) => [
      name,
      inputText(property),
    ]),
    ...Object.values(node.$defs ?? {}).map(inputText),
    ...(node.anyOf ?? node.oneOf ?? []).map(inputText),
    ...(node.items === undefined ? [] : [inputText(node.items)]),
  ]
    .join("\n")
    .toLowerCase();

const termForms = (term: string): readonly string[] => [
  term,
  ...(term.endsWith("es") && term.length > 3 ? [term.slice(0, -2)] : []),
  ...(term.endsWith("s") && term.length > 2 ? [term.slice(0, -1)] : []),
];

export const searchCatalog = (
  catalog: Catalog,
  query: string,
  limit = 5,
  offset = 0
): readonly SearchMatch[] => {
  const trimmed = query.trim();
  const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice(6) : trimmed;

  const exact = catalog.capabilities.find(
    (entry) =>
      entry.name === pathQuery ||
      `tools[${JSON.stringify(entry.name)}]` === trimmed
  );

  const wanted = [...new Set(tokens(query))].map(termForms);
  const candidates = exact === undefined ? catalog.capabilities : [exact];

  const scored = candidates.map((entry) => {
    const path = entry.name.toLowerCase();
    const segments = path.split(/[._-]/u);
    const description = entry.description.toLowerCase();

    const fields = Option.match(parseNode(entry.input), {
      onNone: () => "",
      onSome: inputText,
    });

    const score = wanted.reduce(
      (sum, forms) =>
        sum +
        (forms.some((form) => path === form || segments.includes(form))
          ? 20
          : 0) +
        (forms.some((form) => path.includes(form)) ? 8 : 0) +
        (forms.some((form) => description.includes(form)) ? 4 : 0) +
        (forms.some((form) => fields.includes(form)) ? 2 : 0),
      0
    );

    return {
      description: entry.description,
      name: entry.name,
      score,
      signature: signatureOf(entry),
    };
  });

  return scored
    .filter(
      (match) => exact !== undefined || wanted.length === 0 || match.score > 0
    )
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(offset, offset + limit);
};
