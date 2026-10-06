import {
  ActionBindingSchema,
  DynamicValueSchema,
  defineCatalog,
  validateSpec,
  VisibilityConditionStrictSchema,
} from "@json-render/core";
import type { Spec, SpecIssue } from "@json-render/core";
// oxlint-disable-next-line rat-stack-boundaries/no-core-adapters -- The signed catalog boundary uses the renderer's schema DSL, not a provider adapter.
import { schema } from "@rat-stack/json-render-foldkit/schema";
// oxlint-disable-next-line rat-stack-boundaries/no-core-adapters -- Zod is restricted to this signed json-render catalog boundary.
import { z } from "zod";

// oxlint-disable-next-line no-control-regex -- Foldkit cannot serialize NUL or lone surrogate code units.
const Text = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u);

const SiteProps = z.strictObject({
  author: Text,
  description: Text,
  name: Text,
  screenshotAlt: Text.optional(),
  stack: z.array(Text),
  url: Text.regex(/^https:\/\//u),
});

export const pageCatalog = defineCatalog(schema, {
  actions: {
    toggleNote: {
      description: "Toggle the page note through a Foldkit Message.",
      params: z.strictObject({}),
    },
  },
  components: {
    Callout: {
      description: "One highlighted note. Use at most one per page.",
      example: { text: "A short note.", title: "Worth knowing" },
      props: z.strictObject({ text: Text, title: Text }),
      slots: ["default"],
    },
    Grid: {
      description: "A responsive grid of child cards.",
      example: {},
      props: z.strictObject({}),
      slots: ["default"],
    },
    Page: {
      description: "The page heading, introduction and child content.",
      events: ["toggleNote"],
      example: { intro: "Good things people build.", title: "Featured sites" },
      props: z.strictObject({ intro: Text, title: Text }),
      slots: ["default"],
    },
    SiteCard: {
      description: "A linked site with its author and stack tags.",
      example: {
        author: "A maker",
        description: "A useful site.",
        name: "A site",
        stack: [],
        url: "https://example.com",
      },
      props: SiteProps,
      slots: ["default"],
    },
  },
});

export const pageCatalogMetadata = {
  actions: Object.fromEntries(
    Object.entries(pageCatalog.data.actions).map(([name, definition]) => [
      name,
      {
        description: definition.description,
        params: z.toJSONSchema(definition.params),
      },
    ])
  ),
  components: Object.fromEntries(
    Object.entries(pageCatalog.data.components).map(([name, definition]) => [
      name,
      {
        description: definition.description,
        events: "events" in definition ? definition.events : [],
        props: z.toJSONSchema(definition.props),
      },
    ])
  ),
};

const Reference = z.union([
  z.strictObject({ $state: z.string().startsWith("/") }),
  z.strictObject({ $item: z.string() }),
  z.strictObject({ $index: z.literal(true) }),
  z.strictObject({ $bindState: z.string().startsWith("/") }),
  z.strictObject({ $bindItem: z.string() }),
]);

const DiagnosticIndex = z.looseObject({
  elements: z.record(
    z.string(),
    z.looseObject({
      props: z.record(z.string(), z.unknown()),
      type: z.string(),
    })
  ),
});

const ScopedActionBinding = ActionBindingSchema.extend({
  params: z
    .record(z.string(), z.union([DynamicValueSchema, Reference]))
    .optional(),
});

const Extensions = z.object({
  on: z
    .record(
      z.string(),
      z.union([ScopedActionBinding, z.array(ScopedActionBinding)])
    )
    .optional(),
  repeat: z
    .object({
      key: z.string().optional(),
      statePath: z.union([z.string(), z.object({ $item: z.string() })]),
    })
    .optional(),
  visible: VisibilityConditionStrictSchema.optional(),
});

export interface PageIssue {
  readonly kind:
    | "UnknownComponent"
    | "InvalidProps"
    | "MissingChild"
    | "Cycle"
    | "Orphan"
    | "MultipleCallouts"
    | "InvalidSpec";
  readonly message: string;
  readonly path: string;
}

export interface PageInspection {
  readonly issues: readonly PageIssue[];
  readonly spec?: Spec;
}

const issuePath = (segments: readonly PropertyKey[]) =>
  segments.map(String).join(".");

type IndexedPage = z.infer<typeof DiagnosticIndex>;

const propsIssues = (indexed: IndexedPage): PageIssue[] =>
  Object.entries(indexed.elements).flatMap(([id, element]) => {
    const entry = Object.entries(pageCatalog.data.components).find(
      ([name]) => name === element.type
    )?.[1];

    if (entry === undefined) {
      return [];
    }

    const example = z.record(z.string(), z.unknown()).parse(entry.example);

    const literalProps = Object.fromEntries(
      Object.entries(element.props).map(([key, value]) => [
        key,
        Reference.safeParse(value).success ? example[key] : value,
      ])
    );

    const props = entry.props.safeParse(literalProps);

    return props.success
      ? []
      : props.error.issues.map((issue) => ({
          kind: "InvalidProps",
          message: issue.message,
          path: issuePath(["elements", id, "props", ...issue.path]),
        }));
  });

type NativeExtensions = z.infer<typeof Extensions>;

const actionIssues = (
  id: string,
  type: string,
  extensions: NativeExtensions
): PageIssue[] => {
  const component = Object.entries(pageCatalog.data.components).find(
    ([name]) => name === type
  )?.[1];

  const events =
    component !== undefined && "events" in component ? component.events : [];

  return Object.entries(extensions.on ?? {}).flatMap(([event, binding]) => {
    const path = `elements.${id}.on.${event}`;

    if (!events.includes(event)) {
      return [
        {
          kind: "InvalidSpec",
          message: `Use a declared event for ${type}.`,
          path,
        },
      ];
    }

    return (Array.isArray(binding) ? binding : [binding]).flatMap((action) => {
      const definition = Object.entries(pageCatalog.data.actions).find(
        ([name]) => name === action.action
      )?.[1];

      if (definition === undefined) {
        return [
          {
            kind: "InvalidSpec",
            message: `Use a catalog action instead of ${action.action}.`,
            path: `${path}.action`,
          },
        ];
      }

      const params = definition.params.safeParse(action.params ?? {});

      return params.success
        ? []
        : params.error.issues.map((issue) => ({
            kind: "InvalidSpec",
            message: issue.message,
            path: `${path}.params.${issuePath(issue.path)}`,
          }));
    });
  });
};

const structuralKind = (code: SpecIssue["code"]): PageIssue["kind"] => {
  if (code === "orphaned_element") {
    return "Orphan";
  }

  return ["missing_child", "missing_root", "root_not_found"].includes(code)
    ? "MissingChild"
    : "InvalidSpec";
};

const accentIssues = (spec: Spec): PageIssue[] => {
  const issues: PageIssue[] = [];
  let count = 0;

  const visit = (
    id: string,
    repeated: boolean,
    ancestors: ReadonlySet<string>
  ): void => {
    const element = Object.hasOwn(spec.elements, id)
      ? spec.elements[id]
      : undefined;

    if (element === undefined || ancestors.has(id)) {
      return;
    }

    if (element.type === "Callout") {
      count += 1;

      if (repeated || count > 1) {
        issues.push({
          kind: "MultipleCallouts",
          message:
            "Keep one Callout outside repeat scopes. Do not reference it twice.",
          path: `elements.${id}`,
        });
      }
    }

    const next = new Set([...ancestors, id]);

    for (const child of element.children ?? []) {
      visit(child, repeated || element.repeat !== undefined, next);
    }
  };

  visit(spec.root, false, new Set());

  return issues;
};

const ownKeyIssues = (
  spec: Spec,
  existing: readonly PageIssue[]
): PageIssue[] => {
  const issues: PageIssue[] = [];

  if (
    !Object.hasOwn(spec.elements, spec.root) &&
    !existing.some((issue) => issue.path === "root")
  ) {
    issues.push({
      kind: "MissingChild",
      message: "Add the root element.",
      path: "root",
    });
  }

  for (const [id, element] of Object.entries(spec.elements)) {
    for (const [index, child] of (element.children ?? []).entries()) {
      const path = `elements.${id}.children.${index}`;

      if (
        !Object.hasOwn(spec.elements, child) &&
        !existing.some(
          (issue) => issue.kind === "MissingChild" && issue.path === path
        )
      ) {
        issues.push({
          kind: "MissingChild",
          message: `Add the child element ${child}.`,
          path,
        });
      }
    }
  }

  return issues;
};

const treeIssues = (spec: Spec): PageIssue[] => {
  const issues: PageIssue[] = validateSpec(spec, {
    checkOrphans: true,
  }).issues.map((issue) => {
    const key = issue.elementKey;

    const childIndex =
      key === undefined
        ? -1
        : (spec.elements[key]?.children?.findIndex((child) =>
            issue.message.includes(`references child "${child}"`)
          ) ?? -1);

    const path =
      key === undefined
        ? "root"
        : `elements.${key}${issue.code === "missing_child" ? `.children.${Math.max(childIndex, 0)}` : ""}`;

    return { kind: structuralKind(issue.code), message: issue.message, path };
  });

  issues.push(...ownKeyIssues(spec, issues));

  const active = new Set<string>();
  const finished = new Set<string>();

  const visit = (id: string): void => {
    if (active.has(id)) {
      issues.push({
        kind: "Cycle",
        message: `Remove the cycle through ${id}.`,
        path: `elements.${id}.children`,
      });

      return;
    }

    if (finished.has(id)) {
      return;
    }

    active.add(id);

    for (const child of spec.elements[id]?.children ?? []) {
      visit(child);
    }

    active.delete(id);
    finished.add(id);
  };

  for (const id of Object.keys(spec.elements)) {
    visit(id);
  }

  issues.push(...accentIssues(spec));

  return issues;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the signed json-render catalog ingress; upstream validation parses the submitted spec.
export const inspectCatalogPage = (input: unknown): PageInspection => {
  const json = z.json().safeParse(input);

  if (!json.success) {
    return {
      issues: json.error.issues.map((issue) => ({
        kind: "InvalidSpec",
        message: issue.message,
        path: issuePath(issue.path),
      })),
    };
  }

  const decoded = pageCatalog.validate(json.data);
  const indexed = DiagnosticIndex.safeParse(input);
  const issues = indexed.success ? propsIssues(indexed.data) : [];

  if (decoded.data === undefined) {
    for (const issue of decoded.error?.issues ?? []) {
      const unknownComponent = issue.path.at(-1) === "type";
      issues.push({
        kind: unknownComponent ? "UnknownComponent" : "InvalidSpec",
        message: issue.message,
        path: issuePath(
          unknownComponent ? issue.path.slice(0, -1) : issue.path
        ),
      });
    }
  }

  const diagnosticSpec =
    decoded.data === undefined && indexed.success
      ? pageCatalog.validate({
          ...indexed.data,
          elements: Object.fromEntries(
            Object.entries(indexed.data.elements).map(([id, element]) => [
              id,
              {
                ...element,
                type: pageCatalog.componentNames.includes(element.type)
                  ? element.type
                  : "Grid",
              },
            ])
          ),
        }).data
      : undefined;

  const data = decoded.data ?? diagnosticSpec;

  if (data === undefined) {
    return { issues };
  }

  for (const [id, element] of Object.entries(data.elements)) {
    const extension = Extensions.safeParse(element);

    if (extension.success) {
      issues.push(...actionIssues(id, element.type, extension.data));
    } else {
      for (const issue of extension.error.issues) {
        issues.push({
          kind: "InvalidSpec",
          message: issue.message,
          path: issuePath(["elements", id, ...issue.path]),
        });
      }
    }
  }

  if (issues.some((issue) => issue.kind === "InvalidSpec")) {
    return { issues };
  }

  // SAFETY: catalog.validate checks the envelope; Extensions checks native action, repeat and visibility syntax; propsIssues checks the selected component's Zod props.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Restore the upstream Spec type after its catalog and extension parsers succeed.
  const spec = data as Spec;

  issues.push(...treeIssues(spec));

  return decoded.data === undefined || issues.length > 0
    ? { issues }
    : { issues, spec };
};
