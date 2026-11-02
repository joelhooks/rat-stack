import { StateStoreError } from "alchemy/State/State";
import type { StateService } from "alchemy/State/State";
import { syncState } from "alchemy/State/Sync";
import { Effect, Schema } from "effect";

export const defaultStateStoreName = "alchemy-state-store";

export const StageCensusSchema = Schema.Struct({
  output: Schema.Boolean,
  records: Schema.Int,
  stack: Schema.String,
  stage: Schema.String,
});

export type StageCensus = typeof StageCensusSchema.Type;

export const StateCopyReportSchema = Schema.Struct({
  destination: Schema.Array(StageCensusSchema),
  fqnSetsEqual: Schema.optionalKey(Schema.Boolean),
  from: Schema.String,
  mode: Schema.Literals(["dry-run", "copied"]),
  source: Schema.Array(StageCensusSchema),
  stacks: Schema.Array(Schema.String),
  to: Schema.String,
});

export type StateCopyReport = typeof StateCopyReportSchema.Type;

export const StateCopyRefusalSchema = Schema.Literals([
  "empty-allowlist",
  "same-store",
  "source-missing-stack",
  "destination-holds-stack",
  "store-unavailable",
  "provisioning-refused",
  "copy-mismatch",
]);

export type StateCopyRefusal = typeof StateCopyRefusalSchema.Type;

const fixes: Record<StateCopyRefusal, string> = {
  "copy-mismatch":
    "The source is untouched. Inspect the destination with `alchemy state list --backend cloudflare --name <to>`, then copy into a fresh store.",
  "destination-holds-stack":
    "Copy only into a store that holds none of the listed stacks; syncState deletes destination records the source lacks.",
  "empty-allowlist": "Pass --stacks with at least one exact stack name.",
  "provisioning-refused":
    "Alchemy tried to deploy, resume or upgrade a state store, which state copy never does. Bootstrap or upgrade the named store with `alchemy state bootstrap`, then copy again.",
  "same-store": "Pass different --from and --to stores.",
  "source-missing-stack":
    "Check the names with `alchemy state list --backend cloudflare`; every listed stack must exist in the source.",
  "store-unavailable":
    "Bootstrap or upgrade the named store first; state copy never provisions a store.",
};

export class StateCopyRefused extends Schema.TaggedError<
  StateCopyRefused,
  { readonly brand: unique symbol }
>()("StateCopyRefused", {
  detail: Schema.String,
  fix: Schema.String,
  reason: StateCopyRefusalSchema,
  stacks: Schema.Array(Schema.String),
}) {
  override get message() {
    return `state copy refused (${this.reason}${this.stacks.length > 0 ? `: ${this.stacks.join(", ")}` : ""}). ${this.fix}`;
  }
}

export const refuse = (
  reason: StateCopyRefusal,
  stacks: readonly string[] = [],
  detail = ""
) => new StateCopyRefused({ detail, fix: fixes[reason], reason, stacks });

const refusedWrite = (operation: string, label: string) =>
  Effect.fail(
    new StateStoreError({
      message: `state copy refuses ${operation} on the ${label} store`,
    })
  );

const outsideAllowlist = (stack: string, label: string) =>
  Effect.fail(
    new StateStoreError({
      message: `state copy refuses stack '${stack}' on the ${label} store: it is not on the allowlist`,
    })
  );

export const allowlistedView = (
  store: StateService,
  stacks: ReadonlySet<string>,
  access: { readonly label: string; readonly writes: boolean }
): StateService => {
  const within = <A>(
    stack: string,
    operation: Effect.Effect<A, StateStoreError>
  ) => (stacks.has(stack) ? operation : outsideAllowlist(stack, access.label));

  return {
    delete: () => refusedWrite("delete", access.label),
    deleteStack: () => refusedWrite("deleteStack", access.label),
    get: (request) => within(request.stack, store.get(request)),
    getOutput: (request) => within(request.stack, store.getOutput(request)),
    getReplacedResources: (request) =>
      within(request.stack, store.getReplacedResources(request)),
    getVersion: () => store.getVersion(),
    id: store.id,
    list: (request) => within(request.stack, store.list(request)),
    listStacks: () =>
      store
        .listStacks()
        .pipe(Effect.map((all) => all.filter((stack) => stacks.has(stack)))),
    listStages: (stack) => within(stack, store.listStages(stack)),
    set: (request) =>
      access.writes
        ? within(request.stack, store.set(request))
        : refusedWrite("set", access.label),
    setOutput: (request) =>
      access.writes
        ? within(request.stack, store.setOutput(request))
        : refusedWrite("setOutput", access.label),
  };
};

interface StageRecords {
  readonly fqns: readonly string[];
  readonly output: unknown;
  readonly stack: string;
  readonly stage: string;
}

const records = Effect.fn("stateCopy.records")(function* records(
  store: StateService,
  stacks: readonly string[]
) {
  const rows: StageRecords[] = [];

  for (const stack of stacks) {
    const stages = [...(yield* store.listStages(stack))].toSorted();

    for (const stage of stages) {
      const fqns = [...(yield* store.list({ stack, stage }))].toSorted();
      const output = yield* store.getOutput({ stack, stage });

      rows.push({ fqns, output, stack, stage });
    }
  }

  return rows;
});

const recordsAt = Effect.fn("stateCopy.recordsAt")(function* recordsAt(
  store: StateService,
  keys: readonly { readonly stack: string; readonly stage: string }[]
) {
  const rows: StageRecords[] = [];

  for (const key of keys) {
    const fqns = [...(yield* store.list(key))].toSorted();
    const output = yield* store.getOutput(key);

    rows.push({ ...key, fqns, output });
  }

  return rows;
});

const keysOf = (rows: readonly StageRecords[]) =>
  rows.map((row) => `${row.stack}\u0000${row.stage}`);

const census = (rows: readonly StageRecords[]): StageCensus[] =>
  rows.map((row) => ({
    output: row.output !== undefined,
    records: row.fqns.length,
    stack: row.stack,
    stage: row.stage,
  }));

const fingerprint = (rows: readonly StageRecords[]) =>
  JSON.stringify(
    rows
      .flatMap((row) =>
        row.fqns.length > 0 || row.output !== undefined
          ? [
              {
                fqns: row.fqns,
                key: `${row.stack}/${row.stage}`,
                output: row.output !== undefined,
              },
            ]
          : []
      )
      .toSorted((left, right) => left.key.localeCompare(right.key))
  );

export const preflight = Effect.fn("stateCopy.preflight")(
  function* preflight(request: {
    readonly from: string;
    readonly stacks: readonly string[];
    readonly to: string;
  }) {
    const stacks = [...new Set(request.stacks)].toSorted();

    if (stacks.length === 0) {
      return yield* refuse("empty-allowlist");
    }

    if (request.from === request.to) {
      return yield* refuse("same-store", stacks);
    }

    return stacks;
  }
);

const unavailable = (stacks: readonly string[]) => (error: StateStoreError) =>
  refuse("store-unavailable", stacks, error.message);

export const copyStacks = Effect.fn("stateCopy.copyStacks")(
  function* copyStacks(
    stores: {
      readonly destination: StateService;
      readonly source: StateService;
    },
    request: {
      readonly dryRun: boolean;
      readonly from: string;
      readonly stacks: readonly string[];
      readonly to: string;
    }
  ) {
    const stacks = yield* preflight(request);
    const allowlist = new Set(stacks);

    const source = allowlistedView(stores.source, allowlist, {
      label: "source",
      writes: false,
    });

    const destination = allowlistedView(stores.destination, allowlist, {
      label: "destination",
      writes: true,
    });

    const present = new Set(
      yield* source.listStacks().pipe(Effect.mapError(unavailable(stacks)))
    );

    const missing = stacks.filter((stack) => !present.has(stack));

    if (missing.length > 0) {
      return yield* refuse("source-missing-stack", missing);
    }

    const held = yield* destination
      .listStacks()
      .pipe(Effect.mapError(unavailable(stacks)));

    if (held.length > 0) {
      return yield* refuse("destination-holds-stack", held);
    }

    const before = yield* records(source, stacks).pipe(
      Effect.mapError(unavailable(stacks))
    );

    if (request.dryRun) {
      return {
        destination: [],
        from: request.from,
        mode: "dry-run",
        source: census(before),
        stacks,
        to: request.to,
      } satisfies StateCopyReport;
    }

    yield* syncState(source, destination, {
      concurrency: 8,
      stacks,
    }).pipe(Effect.mapError(unavailable(stacks)));

    yield* Effect.forEach(
      before.filter((row) => row.output !== undefined),
      (row) =>
        destination.setOutput({
          stack: row.stack,
          stage: row.stage,
          value: row.output,
        }),
      { discard: true }
    ).pipe(Effect.mapError(unavailable(stacks)));

    const listed = yield* records(destination, stacks).pipe(
      Effect.mapError(unavailable(stacks))
    );

    const known = new Set(keysOf(listed));

    const after = [
      ...listed,
      ...(yield* recordsAt(
        destination,
        before
          .filter((row) => !known.has(`${row.stack}\u0000${row.stage}`))
          .map(({ stack, stage }) => ({ stack, stage }))
      ).pipe(Effect.mapError(unavailable(stacks)))),
    ];

    const fqnSetsEqual = fingerprint(before) === fingerprint(after);

    if (!fqnSetsEqual) {
      return yield* refuse(
        "copy-mismatch",
        stacks,
        JSON.stringify({ destination: census(after), source: census(before) })
      );
    }

    return {
      destination: census(after),
      fqnSetsEqual,
      from: request.from,
      mode: "copied",
      source: census(before),
      stacks,
      to: request.to,
    } satisfies StateCopyReport;
  }
);

export const parseStackList = (value: string) =>
  value
    .split(",")
    .map((stack) => stack.trim())
    .filter((stack) => stack.length > 0);
