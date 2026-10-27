import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  FlagJournal,
  FlagFlipRefused,
  FlagScopeMismatch,
  FlagLedger as LedgerPort,
  flagPartition,
} from "@rat-stack/core/flag-control";
import type { Flag, Flags } from "@rat-stack/core/flags";
import {
  FlagStorageError,
  InvalidFlagValue,
  UnknownFlag,
} from "@rat-stack/core/flags";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { Effect, Layer, Schema } from "effect";

import { FlagLedger } from "./cloudflare-ledger.js";
import { flagsNamespace } from "./cloudflare-store.js";
import { kvFlagsLayer } from "./kv.js";
import { flagRemoteCall } from "./remote.js";

const ledgerFailure = Schema.Union([
  FlagStorageError,
  FlagScopeMismatch,
  FlagFlipRefused,
  InvalidFlagValue,
  UnknownFlag,
]);

export { FlagLedger, defineFlagLedger } from "./cloudflare-ledger.js";

export const cloudflareFlagControlLayer = (
  definition: typeof FlagLedger = FlagLedger
) =>
  Layer.unwrap(
    Effect.gen(function* bindFlagControl() {
      const namespace = yield* definition;

      const at = (name: string, scope: Schema.Json = "global") =>
        namespace.getByName(flagPartition(name, scope));

      return Layer.merge(
        Layer.succeed(LedgerPort, {
          flip: (input, actor) =>
            flagRemoteCall(
              input.name,
              "write",
              ledgerFailure,
              at(input.name, input.scope).flip(input, actor)
            ),
          read: (name, scope) =>
            flagRemoteCall(
              name,
              "read",
              ledgerFailure,
              at(name, scope).read(name, scope)
            ),
          recordEvidence: (input, actor) =>
            flagRemoteCall(
              input.name,
              "write",
              ledgerFailure,
              at(input.name, input.scope).recordEvidence(input, actor)
            ),
        }),
        Layer.succeed(FlagJournal, {
          list: (input) =>
            input.name === undefined
              ? Effect.fail(
                  new FlagStorageError({
                    cause: "Missing ledger partition",
                    fallback: null,
                    flag: "",
                    operation: "listChanges",
                    repair: "Supply the declared flag name and read scope.",
                  })
                )
              : flagRemoteCall(
                  input.name,
                  "listChanges",
                  FlagStorageError,
                  at(input.name, input.scope).list(input)
                ),
          record: (change) =>
            flagRemoteCall(
              change.name,
              "audit",
              FlagStorageError,
              at(change.name, change.scope).record(change)
            ),
        })
      );
    })
  );

export const cloudflareFlagsLayer = <E, R>(
  registry: readonly Flag<unknown>[],
  fallback: Layer.Layer<Flags, E, R>,
  deployOnly: readonly string[] = []
) =>
  Layer.unwrap(
    Effect.gen(function* declareCloudflareFlags() {
      const namespace = yield* flagsNamespace;
      const client = yield* Cloudflare.KV.ReadNamespace(namespace);

      const kv = {
        get: (key: string) =>
          client
            .get(key)
            .pipe(Effect.provide(RuntimeContext.RuntimeContext.phantom)),
      };

      return kvFlagsLayer(registry, kv, deployOnly).pipe(
        Layer.provide(fallback)
      );
    })
  ).pipe(Layer.provide(Cloudflare.KV.ReadNamespaceBinding));
