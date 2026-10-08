import { Console, Effect } from "effect";

interface Connection {
  readonly close: Effect.Effect<void>;
  readonly query: (sql: string) => Effect.Effect<string>;
}

const connection = Effect.acquireRelease(
  Effect.sync((): Connection => ({
    close: Console.log("connection closed"),
    query: (sql) => Effect.succeed(`ran ${sql}`),
  })),
  (open) => open.close
);

export const migrate = Effect.scoped(
  Effect.gen(function* runMigrations() {
    const open = yield* connection;
    yield* open.query("create table runs");

    return yield* open.query("insert into runs default values");
  })
);
