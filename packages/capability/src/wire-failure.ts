import { Effect, Predicate, Schema, SchemaAST, SchemaGetter } from "effect";

const publicAst = (ast: SchemaAST.AST): SchemaAST.AST => {
  if (SchemaAST.isUnion(ast)) {
    return new SchemaAST.Union(
      ast.types.map(publicAst),
      ast.options,
      ast.annotations
    );
  }

  if (SchemaAST.isObjects(ast)) {
    return new SchemaAST.Objects(
      ast.propertySignatures.filter((field) => field.name !== "cause"),
      ast.indexSignatures,
      ast.annotations
    );
  }

  return ast;
};

const hasCause = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isUnion(ast)
    ? ast.types.some(hasCause)
    : (SchemaAST.isObjects(ast) &&
        (ast.indexSignatures.length > 0 ||
          ast.propertySignatures.some((field) => field.name === "cause"))) ||
      SchemaAST.isUnknown(ast) ||
      SchemaAST.isAny(ast) ||
      SchemaAST.isDeclaration(ast) ||
      SchemaAST.isSuspend(ast);

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Shared projection boundary: the contract encoder validates the heterogeneous value before this transform and the public schema validates its result.
const withoutCause = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "cause")
  );
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Shared projection boundary: the public decoder validates its heterogeneous input and the contract decoder validates the restored placeholder.
const restoreRequiredCause = (ast: SchemaAST.AST, value: unknown): unknown => {
  if (SchemaAST.isUnion(ast)) {
    const member = ast.types.find((type) =>
      Schema.is(Schema.make<Schema.Codec<unknown>>(publicAst(type)))(value)
    );

    return member === undefined ? value : restoreRequiredCause(member, value);
  }

  if (SchemaAST.isObjects(ast) && Predicate.isObject(value)) {
    const field = ast.propertySignatures.find(
      (property) => property.name === "cause"
    );

    if (field !== undefined && !SchemaAST.isOptional(field.type)) {
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- The unknown encoded type belongs to each supplied contract, not to this single object branch of the heterogeneous projection.
      return { ...value, cause: null };
    }
  }

  return value;
};

export const wireFailureSchema = <S extends Schema.Top>(failure: S) => {
  const encoded = SchemaAST.toEncoded(failure.ast);

  if (!hasCause(encoded)) {
    return failure;
  }

  const wire = Schema.make<Schema.Codec<unknown>>(publicAst(encoded));

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
      decode: SchemaGetter.transform((value) =>
        restoreRequiredCause(encoded, value)
      ),
      encode: SchemaGetter.transform(withoutCause),
    })
  );
};
