// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- See to-toolkit.ts: a projection over a heterogeneous list erases error and requirement types at the boundary and recovers them for callers.
import type { Layer } from "effect";
import { Effect, Match, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { discoverCatalog, toCatalog, toTypeScript } from "./catalog-model.js";
import type { Catalog } from "./catalog-model.js";
import { defineContract, failureSchemaOf } from "./contract.js";
import type {
  AnyCapability,
  ApprovalRequirement,
  ContractOf,
  FailureSchemaOf,
} from "./contract.js";
import { implement } from "./implement.js";
import { SandboxDiagnostic } from "./sandbox-diagnostic-schema.js";
import { SandboxError } from "./sandbox-error.js";
import { resolveLimits } from "./sandbox-limits-schema.js";
import { Sandbox } from "./sandbox-port.js";
import type {
  Invoke,
  InvokeOutcome,
  SandboxLimits,
} from "./sandbox-service.js";
import type { RequirementsOf } from "./to-toolkit.js";

export const SearchMatch = Schema.Struct({
  description: Schema.String,
  name: Schema.String,
  score: Schema.Finite,
  signature: Schema.String,
});

export const SearchResult = Schema.Struct({
  matches: Schema.Array(SearchMatch),
  next: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ offset: Schema.Int }))
  ),
  offset: Schema.optionalKey(Schema.Int),
  remaining: Schema.optionalKey(Schema.Int),
  total: Schema.Int,
});

export const ExecuteInput = Schema.Struct({
  code: Schema.String,
});

export const ExecuteResult = Schema.Struct({
  diagnostic: Schema.optionalKey(Schema.NullOr(SandboxDiagnostic)),
  logs: Schema.Array(Schema.String),
  result: Schema.Json,
  toolCalls: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
});

const SearchInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  offset: Schema.optional(Schema.Natural),
  query: Schema.String,
});

const search = Tool.make("search", {
  description:
    "Find capabilities by intent. Returns each match's TypeScript signature for the `tools` object available to `execute`. Call this before `execute` when unsure what exists.",
  parameters: SearchInput,
  success: SearchResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const searchPage = Effect.fnUntraced(function* searchCatalogPage(
  catalog: Catalog,
  query: string,
  limit: number,
  offset: number
) {
  const loaded = import("./catalog-search.js");

  const { searchCatalog } = yield* Effect.promise(
    loaded.finally.bind(loaded, undefined)
  );

  const all = searchCatalog(catalog, query, Number.MAX_SAFE_INTEGER);
  const matches = all.slice(offset, offset + limit);
  const remaining = Math.max(0, all.length - offset - matches.length);

  return {
    matches,
    next: remaining > 0 ? { offset: offset + matches.length } : null,
    offset,
    remaining,
    total: catalog.capabilities.length,
  };
});

const executeIntro =
  "Run a JavaScript program against the capabilities. The program is the body of an async function with `tools` in scope; `return` a JSON value to get it back, and `console.log` is captured into `logs`. Each `tools.<name>(input)` call is validated against that capability's input schema, runs on the host, and resolves with its output or rejects with its declared failure. Execution problems return a typed `diagnostic`; inspect it before using `result`. `toolCalls` lists admitted calls in order. `truncated` marks output cuts. At most 8 tool calls run concurrently. Only host cancellation interrupts execution.";

const executeDescription = (
  discovery: ReturnType<typeof discoverCatalog>
): string =>
  [
    executeIntro,
    "",
    discovery.summary,
    ...(discovery.complete
      ? []
      : [
          "Call `search` first, or call `tools.$codemode.search({ query })` inside the program, to get full signatures for missing capabilities. Repeat the same query with `offset: next.offset` until `next` is null.",
        ]),
    ...(discovery.declarations === ""
      ? []
      : [
          "",
          "The `tools` object:",
          "",
          "```ts",
          discovery.declarations.trimEnd(),
          "```",
        ]),
  ].join("\n");

export type DeclarationPlacement = "inline" | "search";

export interface ExecuteOptions extends SandboxLimits {
  readonly declarations?: DeclarationPlacement | undefined;
  readonly catalogBudget?: number | undefined;
}

export interface CodeModeOptions extends ExecuteOptions {
  readonly searchLimit?: number | undefined;
}

type NeedsApprovalOf<Caps extends readonly AnyCapability[]> =
  true extends ContractOf<Caps[number]>["needsApproval"] ? true : false;

export interface CodeModeProjection<Caps extends readonly AnyCapability[]> {
  readonly catalog: Catalog;
  readonly declarations: string;
  readonly toolkit: Toolkit.Toolkit<{
    readonly search: typeof search;
    readonly execute: Tool.Tool<
      "execute",
      {
        readonly parameters: Schema.Struct<{ readonly code: Schema.String }>;
        readonly success: typeof ExecuteResult;
        readonly failure: FailureSchemaOf<
          typeof SandboxError,
          NeedsApprovalOf<Caps>
        >;
        readonly failureMode: "error";
      }
    >;
  }>;
  readonly layer: Layer.Layer<
    Tool.HandlersFor<CodeModeProjection<Caps>["toolkit"]["tools"]>,
    never,
    RequirementsOf<Caps> | ApprovalRequirement<NeedsApprovalOf<Caps>> | Sandbox
  >;
}

export const invokerFor = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): Effect.Effect<Invoke, never, RequirementsOf<Caps>> =>
  Effect.gen(function* buildInvoker() {
    const diagnostics = import("./sandbox-diagnostic.js");

    const { toolDiagnostic } = yield* Effect.promise(
      diagnostics.finally.bind(diagnostics, undefined)
    );

    const invocation = import("./sandbox-invoke.js");

    const { invokeFailure } = yield* Effect.promise(
      invocation.finally.bind(invocation, undefined)
    );

    const context = yield* Effect.context<RequirementsOf<Caps>>();

    const byName = new Map(
      capabilities.map(
        (capability) => [capability.contract.name, capability] as const
      )
    );

    const invoke: Invoke = (name, input) => {
      const item = byName.get(name);

      if (item === undefined) {
        return Effect.succeed(
          invokeFailure("UnknownCapability", `No capability named ${name}`)
        );
      }

      // SAFETY: `AnyCapability` erased this capability's requirements to `unknown`; they are a subset of `RequirementsOf<Caps>`, which `context` carries. The input is decoded by its schema first.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const run = item.handler as (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        input: unknown
      ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

      const encodeOutput = Schema.encodeUnknownEffect(item.contract.output);

      const encodeFailure = Schema.encodeUnknownEffect(
        failureSchemaOf(item.contract)
      );

      return Schema.decodeUnknownEffect(item.contract.input)(input).pipe(
        Effect.matchEffect({
          onFailure: () =>
            Effect.succeed(
              invokeFailure(
                "InvalidInput",
                "Capability input does not match its schema"
              )
            ),
          onSuccess: (decoded) =>
            run(decoded).pipe(
              Effect.provideContext(context),
              Effect.matchEffect({
                onFailure: (error) =>
                  encodeFailure(error).pipe(
                    Effect.map((encoded): InvokeOutcome => ({
                      diagnostic: toolDiagnostic(encoded),
                      error: encoded,
                      ok: false,
                    })),
                    Effect.orElseSucceed(() =>
                      invokeFailure(
                        "UnencodableFailure",
                        "Capability failure does not match its declared schema"
                      )
                    )
                  ),
                onSuccess: (output) =>
                  encodeOutput(output).pipe(
                    Effect.map((value): InvokeOutcome => ({
                      ok: true,
                      value,
                    })),
                    Effect.orElseSucceed(() =>
                      invokeFailure(
                        "UnencodableOutput",
                        "Capability output does not match its declared schema"
                      )
                    )
                  ),
              })
            ),
        })
      );
    };

    return invoke;
  });

export const toExecuteCapability = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: ExecuteOptions
) => {
  const limits = resolveLimits(options ?? {});

  const catalog = toCatalog(capabilities);
  const declarations = toTypeScript(catalog);

  const discovery = discoverCatalog(
    catalog,
    options?.catalogBudget ??
      Match.value(options?.declarations).pipe(
        Match.when("inline", () => Number.MAX_SAFE_INTEGER),
        Match.when("search", () => 0),
        Match.orElse(() => 2000)
      )
  );

  const discoverySearch = implement(
    defineContract("$codemode.search", {
      description: "Search available code-mode capability signatures",
      failure: Schema.Never,
      input: SearchInput,
      output: SearchResult,
    }),
    ({ limit, offset, query }) =>
      searchPage(catalog, query, limit ?? 5, offset ?? 0)
  );

  const hasApproval = capabilities.some((item) => item.contract.needsApproval);
  // SAFETY: Caps preserves the literal approval flag for the generated capability, and `some` over the same array computes exactly that flag.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const needsApproval = hasApproval as NeedsApprovalOf<Caps>;

  const executeContract = defineContract("execute", {
    annotations: {
      destructive: capabilities.some(
        (item) => item.contract.annotations.destructive
      ),
      openWorld: capabilities.some(
        (item) => item.contract.annotations.openWorld
      ),
      readOnly: capabilities.every(
        (item) => item.contract.annotations.readOnly
      ),
    },
    description: executeDescription(discovery),
    failure: SandboxError,
    input: ExecuteInput,
    needsApproval,
    output: ExecuteResult,
  });

  const capability = implement(
    executeContract,
    Effect.fn("CodeMode.execute")(function* execute({ code }) {
      const runtime = import("./sandbox-result.js");

      const { sandboxRunner } = yield* Effect.promise(
        runtime.finally.bind(runtime, undefined)
      );

      const invoke = yield* invokerFor([...capabilities, discoverySearch]);

      const sandbox = yield* Sandbox;

      const run = yield* sandboxRunner(sandbox.run, limits)(
        code,
        invoke,
        catalog.capabilities.map((entry) => entry.name)
      );

      return {
        diagnostic: run.diagnostic ?? null,
        logs: run.logs,
        // SAFETY: every Sandbox implementation must JSON-round-trip a successful result before crossing this boundary.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        result: run.result as typeof ExecuteResult.Type.result,
        toolCalls: run.toolCalls ?? [],
        truncated: run.truncated ?? false,
      };
    })
  );

  return { capability, catalog, declarations } as const;
};

export const toCodeMode = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: CodeModeOptions
): CodeModeProjection<Caps> => {
  const executeProjection = toExecuteCapability(capabilities, options);
  const { catalog, declarations } = executeProjection;
  const searchLimit = options?.searchLimit ?? 5;

  const execute = Tool.make("execute", {
    description: executeProjection.capability.contract.description,
    failure: failureSchemaOf(executeProjection.capability.contract),
    needsApproval: executeProjection.capability.contract.needsApproval,
    parameters: ExecuteInput,
    success: ExecuteResult,
  })
    .annotate(
      Tool.Readonly,
      capabilities.every(
        (capability) => capability.contract.annotations.readOnly
      )
    )
    .annotate(
      Tool.Destructive,
      capabilities.some(
        (capability) => capability.contract.annotations.destructive
      )
    )
    .annotate(
      Tool.OpenWorld,
      capabilities.some(
        (capability) => capability.contract.annotations.openWorld
      )
    );

  const toolkit = Toolkit.make(search, execute);

  const layer = toolkit.toLayer(
    Effect.gen(function* buildCodeModeHandlers() {
      const context = yield* Effect.context<
        RequirementsOf<Caps> | ApprovalRequirement<NeedsApprovalOf<Caps>>
      >();

      const sandbox = yield* Sandbox;

      return toolkit.of({
        execute: (input) =>
          executeProjection.capability
            .handler(input)
            .pipe(
              Effect.provideService(Sandbox, sandbox),
              Effect.provideContext(context)
            ),
        search: ({ limit, offset, query }) =>
          searchPage(catalog, query, limit ?? searchLimit, offset ?? 0),
      });
    })
  );

  return { catalog, declarations, layer, toolkit };
};
