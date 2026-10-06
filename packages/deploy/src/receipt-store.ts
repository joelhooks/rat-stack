import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";

import { ApplyReceiptSchema, DeployStepError } from "./contracts.js";
import type { ApplyReceipt } from "./contracts.js";
import { RollbackReceiptSchema } from "./rollback-contracts.js";
import type { RollbackReceipt } from "./rollback-contracts.js";
import { RollbackRefused } from "./rollback-refused.js";

export class ReceiptStore extends Context.Service<
  ReceiptStore,
  {
    readonly readApply: (
      profile: string,
      path?: string
    ) => Effect.Effect<
      { readonly path: string; readonly receipt: ApplyReceipt },
      RollbackRefused
    >;
    readonly saveApply: (
      profile: string,
      receipt: ApplyReceipt
    ) => Effect.Effect<string, DeployStepError>;
    readonly saveRollback: (
      receipt: RollbackReceipt
    ) => Effect.Effect<string, DeployStepError>;
  }
>()("@rat-stack/deploy/ReceiptStore") {
  static layer = (directory = "../../.rat/deploy") =>
    Layer.effect(
      ReceiptStore,
      Effect.gen(function* makeReceiptStore() {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;

        const folder = (profile: string) =>
          `${directory}/${encodeURIComponent(profile)}`;

        const write = Effect.fn("ReceiptStore.write")(
          function* write(path: string, text: string) {
            yield* fs.makeDirectory(path.slice(0, path.lastIndexOf("/")), {
              recursive: true,
            });

            const temporary = yield* fs.makeTempFile({
              directory: path.slice(0, path.lastIndexOf("/")),
            });

            yield* fs.writeFileString(temporary, text, { mode: 0o600 });
            yield* fs.rename(temporary, path);

            return path;
          },
          Effect.mapError(
            () =>
              new DeployStepError({
                keys: [],
                reason: "receipt-write-refused",
                step: "apply",
              })
          )
        );

        const readApply = Effect.fn("ReceiptStore.readApply")(
          function* readApply(profile: string, requested?: string) {
            let path = `${folder(profile)}/last-apply.json`;

            if (requested !== undefined) {
              path = paths.isAbsolute(requested)
                ? requested
                : paths.resolve("../..", requested);
            }

            const stat = yield* fs.stat(path);

            if (stat.size > 1_048_576) {
              return yield* new RollbackRefused({
                reason: "recovery-receipt-too-large",
              });
            }

            const receipt = yield* fs
              .readFileString(path)
              .pipe(
                Effect.flatMap(
                  Schema.decodeEffect(Schema.fromJsonString(ApplyReceiptSchema))
                )
              );

            if (
              receipt.profile !== profile ||
              Object.keys(receipt.previousVersions ?? {}).length === 0
            ) {
              return yield* new RollbackRefused({
                reason: "recovery-receipt-profile-or-targets-invalid",
              });
            }

            return {
              path,
              receipt: {
                ...receipt,
                previousVersions: yield* Schema.decodeUnknownEffect(
                  Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString)
                )(receipt.previousVersions),
              },
            };
          },
          Effect.mapError((failure) =>
            Schema.is(RollbackRefused)(failure)
              ? failure
              : new RollbackRefused({
                  reason: "recovery-receipt-unavailable-or-invalid",
                })
          )
        );

        return ReceiptStore.of({
          readApply,
          saveApply: (profile, receipt) =>
            Schema.encodeEffect(Schema.fromJsonString(ApplyReceiptSchema))({
              ...receipt,
              profile,
            }).pipe(
              Effect.mapError(
                () =>
                  new DeployStepError({
                    keys: [],
                    reason: "receipt-encoding-refused",
                    step: "apply",
                  })
              ),
              Effect.flatMap((text) =>
                write(`${folder(profile)}/last-apply.json`, text)
              )
            ),
          saveRollback: (receipt) =>
            Effect.gen(function* saveRollback() {
              const time = yield* Clock.currentTimeMillis;

              const text = yield* Schema.encodeEffect(
                Schema.fromJsonString(RollbackReceiptSchema)
              )(receipt).pipe(
                Effect.mapError(
                  () =>
                    new DeployStepError({
                      keys: [],
                      reason: "receipt-encoding-refused",
                      step: "apply",
                    })
                )
              );

              yield* write(
                `${folder(receipt.profile)}/rollback-${time}.json`,
                text
              );

              return yield* write(
                `${folder(receipt.profile)}/last-rollback.json`,
                text
              );
            }),
        });
      })
    );
}
