import { DatabaseSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";

import { Effect, FileSystem, Option, Schema } from "effect";

const localRoot = ".alchemy/local";

const kvRoot = `${localRoot}/kv/cloudflare-runtime-KVNamespaceObject`;

export class LocalStorageMissing extends Schema.TaggedError<
  LocalStorageMissing,
  { readonly brand: unique symbol }
>()("LocalStorageMissing", { key: Schema.String, repair: Schema.String }) {}

const KeyRow = Schema.Struct({ key: Schema.String });

const ValueRow = Schema.Struct({ value: Schema.Uint8Array });

const entries = (directory: string) =>
  FileSystem.FileSystem.use((fs) => fs.readDirectory(directory)).pipe(
    Effect.map((names) => names.map((name) => `${directory}/${name}`)),
    Effect.orDie
  );

const databases = (directory: string) =>
  entries(directory).pipe(
    Effect.map((paths) =>
      paths.filter(
        (path) => path.endsWith(".sqlite") && !path.endsWith("/metadata.sqlite")
      )
    )
  );

const holding = (table: string, key: string) => (path: string) => {
  const database = new DatabaseSync(path, { readOnly: true });

  try {
    return (
      database
        .prepare(`select name from sqlite_master where name = ?`)
        .get(table) !== undefined &&
      database.prepare(`select 1 from ${table} where key = ?`).get(key) !==
        undefined
    );
  } finally {
    database.close();
  }
};

const openHolding = (
  directories: Effect.Effect<readonly string[], never, FileSystem.FileSystem>,
  table: string,
  key: string
) =>
  Effect.acquireRelease(
    directories.pipe(
      Effect.flatMap(Effect.forEach(databases)),
      Effect.flatMap((paths) =>
        Effect.sync(() =>
          Option.fromUndefinedOr(paths.flat().find(holding(table, key)))
        )
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new LocalStorageMissing({
                key,
                repair:
                  "Write the key through the runtime before inspecting local storage.",
              })
            ),
          onSome: (path) => Effect.sync(() => new DatabaseSync(path)),
        })
      )
    ),
    (database) =>
      Effect.sync(() => {
        database.close();
      })
  );

const rejectingWrites = (database: DatabaseSync, table: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      database.exec(
        `create trigger planted_insert_fault before insert on ${table} begin select raise(abort, 'planted storage fault'); end;
         create trigger planted_update_fault before update on ${table} begin select raise(abort, 'planted storage fault'); end;`
      );
    }),
    () =>
      Effect.sync(() => {
        database.exec(
          "drop trigger planted_insert_fault; drop trigger planted_update_fault;"
        );
      })
  );

export const durableObjectStorage = (className: string, key: string) =>
  openHolding(
    entries(localRoot).pipe(
      Effect.map((paths) =>
        paths.filter((path) => path.endsWith(`-${className}`))
      )
    ),
    "_cf_KV",
    key
  ).pipe(
    Effect.map((database) => ({
      alarmPending: Effect.sync(() =>
        database
          .prepare(
            "select 1 from _cf_METADATA where key = 1 and value is not null"
          )
          .get()
      ).pipe(Effect.map((row) => row !== undefined)),
      keys: (prefix: string) =>
        Effect.sync(() =>
          database
            .prepare(
              "select key from _cf_KV where substr(key, 1, ?) = ? order by key"
            )
            .all(prefix.length, prefix)
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(KeyRow))),
          Effect.map((rows) => rows.map((row) => row.key)),
          Effect.orDie
        ),
      read: (entry: string) =>
        Effect.sync(() =>
          database.prepare("select value from _cf_KV where key = ?").get(entry)
        ).pipe(
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.succeedNone
              : Schema.decodeUnknownEffect(ValueRow)(row).pipe(
                  Effect.flatMap((decoded) =>
                    Schema.decodeUnknownEffect(Schema.String)(
                      deserialize(decoded.value)
                    )
                  ),
                  Effect.asSome
                )
          ),
          Effect.orDie
        ),
      rejectCommits: rejectingWrites(database, "_cf_METADATA"),
      rejectReads: Effect.acquireRelease(
        Effect.sync(() => {
          database.exec("alter table _cf_KV rename to _cf_unavailable");
        }),
        () =>
          Effect.sync(() => {
            database.exec("alter table _cf_unavailable rename to _cf_KV");
          })
      ),
      rejectWrites: rejectingWrites(database, "_cf_KV"),
      write: (entry: string, text: string) =>
        Effect.sync(() => {
          database
            .prepare(
              "insert into _cf_KV (key, value) values (?, ?) on conflict (key) do update set value = excluded.value"
            )
            .run(entry, serialize(text));
        }),
    }))
  );

export const kvStorage = (key: string) =>
  openHolding(Effect.succeed([kvRoot]), "_mf_entries", key).pipe(
    Effect.map((database) => ({
      rejectReads: Effect.acquireRelease(
        Effect.sync(() => {
          database.exec("alter table _mf_entries rename to _mf_unavailable");
        }),
        () =>
          Effect.sync(() => {
            database.exec("alter table _mf_unavailable rename to _mf_entries");
          })
      ),
      rejectWrites: rejectingWrites(database, "_mf_entries"),
    }))
  );
