import { Effect, Predicate, Schema, SchemaAST, SchemaGetter } from "effect";

interface PublicFailure {
  readonly ast: SchemaAST.AST;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Projection boundary: the contract validates inputs and the public schema validates outputs.
  readonly encode: (value: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Projection boundary: the public schema validates inputs and the contract validates outputs.
  readonly decode: (value: unknown) => unknown;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Opaque schema boundary: only a top-level cause is knowable without a declared child schema.
const omitCause = (value: unknown): unknown =>
  Predicate.isObject(value) &&
  !Array.isArray(value) &&
  Predicate.hasProperty(value, "cause")
    ? Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "cause")
      )
    : value;

const publicFailure = (
  ast: SchemaAST.AST,
  suspended = new WeakMap<SchemaAST.AST, PublicFailure>()
): PublicFailure => {
  const cached = suspended.get(ast);

  if (cached !== undefined) {
    return cached;
  }

  if (SchemaAST.isSuspend(ast)) {
    const child = () => publicFailure(ast.thunk(), suspended);

    const result: PublicFailure = {
      ast: new SchemaAST.Suspend(
        () => child().ast,
        ast.annotations,
        undefined,
        undefined,
        ast.context
      ),
      encode: (value) => child().encode(value),
      decode: (value) => child().decode(value),
    };

    suspended.set(ast, result);

    return result;
  }

  if (SchemaAST.isUnion(ast)) {
    const children = ast.types.map((type) => publicFailure(type, suspended));

    return {
      ast: new SchemaAST.Union(
        children.map((child) => child.ast),
        ast.options,
        ast.annotations,
        undefined,
        undefined,
        ast.context
      ),
      encode: (value) => {
        const index = ast.types.findIndex((type) =>
          Schema.is(Schema.make<Schema.Codec<unknown>>(type))(value)
        );

        return children[index]?.encode(value) ?? value;
      },
      decode: (value) =>
        children
          .find((child) =>
            Schema.is(Schema.make<Schema.Codec<unknown>>(child.ast))(value)
          )
          ?.decode(value) ?? value,
    };
  }

  if (SchemaAST.isArrays(ast)) {
    const elements = ast.elements.map((type) => publicFailure(type, suspended));
    const rest = ast.rest.map((type) => publicFailure(type, suspended));

    const at = (index: number, length: number) => {
      if (index < elements.length) {
        return elements[index];
      }

      if (index < length - Math.max(0, rest.length - 1)) {
        return rest[0];
      }

      return rest[index - length + rest.length];
    };

    return {
      ast: new SchemaAST.Arrays(
        ast.isMutable,
        elements.map((child) => child.ast),
        rest.map((child) => child.ast),
        ast.annotations,
        undefined,
        undefined,
        ast.context
      ),
      encode: (value) =>
        Schema.is(Schema.Array(Schema.Unknown))(value)
          ? value.map(
              (item, index) => at(index, value.length)?.encode(item) ?? item
            )
          : value,
      decode: (value) =>
        Schema.is(Schema.Array(Schema.Unknown))(value)
          ? value.map(
              (item, index) => at(index, value.length)?.decode(item) ?? item
            )
          : value,
    };
  }

  if (SchemaAST.isObjects(ast)) {
    const fields = ast.propertySignatures
      .filter((field) => field.name !== "cause")
      .map((field) => ({
        name: field.name,
        child: publicFailure(field.type, suspended),
      }));

    const indices = ast.indexSignatures.map((field) => ({
      parameter: field.parameter,
      child: publicFailure(field.type, suspended),
    }));

    const required = ast.propertySignatures.some(
      (field) => field.name === "cause" && !SchemaAST.isOptional(field.type)
    );

    const transform =
      (direction: "encode" | "decode"): PublicFailure["encode"] =>
      (value): ReturnType<PublicFailure["encode"]> => {
        if (!Predicate.isObject(value)) {
          return value;
        }

        const entries = Object.entries(value)
          .filter(([key]) => key !== "cause")
          .map(([key, item]) => {
            const child =
              fields.find((field) => field.name === key)?.child ??
              indices.find((field) =>
                Schema.is(Schema.make<Schema.Codec<unknown>>(field.parameter))(
                  key
                )
              )?.child;

            return [key, child === undefined ? item : child[direction](item)];
          });

        return Object.fromEntries(
          direction === "decode" && required
            ? [...entries, ["cause", null]]
            : entries
        );
      };

    return {
      ast: new SchemaAST.Objects(
        fields.map(
          (field) =>
            new SchemaAST.PropertySignature(field.name, field.child.ast)
        ),
        indices.map(
          (field) =>
            new SchemaAST.IndexSignature(field.parameter, field.child.ast)
        ),
        ast.annotations,
        undefined,
        undefined,
        ast.context
      ),
      encode: transform("encode"),
      decode: transform("decode"),
    };
  }

  return { ast, encode: omitCause, decode: (value) => value };
};

export const wireFailureSchema = <S extends Schema.Top>(failure: S) => {
  if (SchemaAST.isNever(failure.ast)) {
    return failure;
  }

  const projection = publicFailure(SchemaAST.toEncoded(failure.ast));
  const wire = Schema.make<Schema.Codec<unknown>>(projection.ast);

  return failure.pipe(
    Schema.decode<S>({
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.transformEffect((value) =>
        Predicate.hasProperty(value, "cause") && value.cause !== undefined
          ? Effect.as(
              Effect.logError("Capability failure cause", value.cause),
              value
            )
          : Effect.succeed(value)
      ),
    }),
    Schema.encodeTo(wire, {
      decode: SchemaGetter.transform(projection.decode),
      encode: SchemaGetter.transform(projection.encode),
    })
  );
};
