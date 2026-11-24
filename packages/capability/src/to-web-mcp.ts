import { Effect, Option, Schema } from "effect";
import type { JsonSchema } from "effect";

import { failureSchemaOf } from "./contract.js";
import type { AnyContract, PlainSchema } from "./contract.js";
import { emptyInputJsonSchema, hasNoInputFields } from "./tool-input-schema.js";

export interface WebMcpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema.JsonSchema;
  readonly outputSchema: JsonSchema.JsonSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly consequentialHint: boolean;
    readonly untrustedContentHint: boolean;
  };
  readonly execute: (
    input: Schema.JsonObject,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<Schema.Json>;
}

export interface WebMcpContext {
  readonly registerTool: (
    tool: WebMcpTool,
    options: { readonly signal: AbortSignal }
  ) => void | Promise<void>;
}

type Invokers<Contracts extends readonly AnyContract[]> = {
  readonly [C in Contracts[number] as C["name"]]: (
    input: C["input"]["Type"]
  ) => Effect.Effect<C["output"]["Type"], unknown>;
};

const jsonSchema = (schema: PlainSchema) => {
  const root = Schema.toCodecJson(schema).ast;

  const { schema: rootSchema, definitions } = Schema.toJsonSchemaDocument(
    schema,
    {
      referencePolicy: ({ ast, identifier, occurrences }) =>
        ast === root && occurrences === 1 ? undefined : identifier,
    }
  );

  const ref = rootSchema.$ref;

  const inline =
    Schema.is(Schema.String)(ref) && ref.startsWith("#/$defs/")
      ? (definitions[
          ref.slice(8).replaceAll("~1", "/").replaceAll("~0", "~")
        ] ?? rootSchema)
      : rootSchema;

  return Object.keys(definitions).length === 0
    ? inline
    : { ...inline, $defs: definitions };
};

const decodeFailureText = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String),
  })
);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This boundary checks the erased failure against the contract before exposing public text.
const publicFailure = (contract: AnyContract, failure: unknown) => {
  if (Schema.is(Schema.toType(failureSchemaOf(contract)))(failure)) {
    const text = decodeFailureText(failure);

    if (Option.isSome(text)) {
      const { message, reason } = text.value;

      return new Error(
        message !== undefined && message !== ""
          ? message
          : (reason ?? `${contract.name} failed.`)
      );
    }
  }

  return new Error(`${contract.name} failed.`);
};

const toTool = (
  contract: AnyContract,
  call: (
    input: AnyContract["input"]["Type"]
  ) => Effect.Effect<unknown, unknown>,
  pageSignal: AbortSignal
): WebMcpTool => {
  const consequential =
    contract.needsApproval ||
    contract.annotations.destructive ||
    !contract.annotations.readOnly;

  const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(contract.input));

  const encode = Schema.encodeUnknownEffect(
    Schema.toCodecJson(contract.output)
  );

  return {
    annotations: {
      consequentialHint: consequential,
      readOnlyHint: !consequential,
      untrustedContentHint: contract.annotations.openWorld,
    },
    description: contract.description,
    execute: (input, options) => {
      const signal =
        options?.signal === undefined
          ? pageSignal
          : AbortSignal.any([pageSignal, options.signal]);

      return Effect.runPromise(
        decode(input).pipe(
          Effect.flatMap((decoded) =>
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Each erased RPC error is checked against the matching contract before it reaches the browser.
            call(decoded).pipe(
              Effect.mapError((failure) => publicFailure(contract, failure))
            )
          ),
          Effect.flatMap(encode)
        ),
        { signal }
      );
    },
    inputSchema: hasNoInputFields(contract)
      ? emptyInputJsonSchema
      : jsonSchema(contract.input),
    name: contract.name,
    outputSchema: jsonSchema(contract.output),
    title: contract.annotations.title ?? contract.name,
  };
};

export const toWebMcp = <const Contracts extends readonly AnyContract[]>(
  contracts: Contracts
) => ({
  register: (
    modelContext: WebMcpContext,
    call: Invokers<Contracts>,
    { signal }: { readonly signal: AbortSignal }
  ) =>
    Effect.suspend(() => {
      if (signal.aborted) {
        return Effect.void;
      }

      // SAFETY: Every keyed invoker accepts the decoded input of the matching contract; the loop erases that correlation.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This projection recovers a keyed invoker at the same contract's decoding boundary.
      const invokers = call as Readonly<
        Record<string, Parameters<typeof toTool>[1]>
      >;

      return Effect.forEach(
        contracts,
        (contract) => {
          const invoke = invokers[contract.name];

          if (invoke === undefined) {
            return Effect.die(
              new Error(`No WebMCP invoker for ${contract.name}.`)
            );
          }

          return Effect.tryPromise(() =>
            Promise.resolve(
              modelContext.registerTool(toTool(contract, invoke, signal), {
                signal,
              })
            )
          );
        },
        { discard: true }
      );
    }),
});
