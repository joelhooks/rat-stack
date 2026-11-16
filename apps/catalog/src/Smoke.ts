import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export const smokeDeadline = Context.Reference<Duration.Input>(
  "@rat-stack/catalog-server/SmokeDeadline",
  {
    defaultValue: () => "30 seconds",
  }
);

const Phase = Schema.Literals([
  "unauthenticated",
  "authenticated",
  "configuration-or-transport",
]);

const messages = {
  unauthenticated:
    "Unauthenticated catalog smoke read succeeded. The target did not enforce the expected Api boundary. Fix: verify the deployed Worker and rerun `pnpm --filter @rat-stack/catalog-server smoke <url>`.",
  authenticated:
    "Catalog smoke rejected the configured token. The target did not authorize the authenticated read. Fix: provision the matching deployment secret and rerun `pnpm --filter @rat-stack/catalog-server smoke <url>`.",
  "configuration-or-transport":
    "Catalog smoke could not complete safely. The target or credentials could not be verified. Fix: check the URL and securely supplied `CATALOG_OPERATOR_TOKEN`, then rerun `pnpm --filter @rat-stack/catalog-server smoke <url>`.",
};

export class CatalogSmokeFailed extends Schema.TaggedError<
  CatalogSmokeFailed,
  { readonly brand: unique symbol }
>()("CatalogSmokeFailed", { phase: Phase, message: Schema.String }) {
  static forPhase(phase: typeof Phase.Type) {
    return new CatalogSmokeFailed({ phase, message: messages[phase] });
  }
}

export const smokeTarget = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      url.username === "" &&
      url.password === ""
  )
);

const missingItemTags: ReadonlySet<string> = new Set(["NotFound"]);

const smokeItem = ItemId.make("https://example.test/catalog-smoke");

export const smokeCatalog = Effect.fn("smokeCatalog")(
  function* smokeCatalog(url: string, token: Redacted.Redacted) {
    if (Redacted.value(token).length === 0) {
      return yield* CatalogSmokeFailed.forPhase("configuration-or-transport");
    }

    const target = yield* Schema.decodeEffect(smokeTarget)(url).pipe(
      Effect.mapError(() =>
        CatalogSmokeFailed.forPhase("configuration-or-transport")
      )
    );

    const api = yield* OperatorApi.clientHttp(target.toString());

    yield* api.ItemHistory.get(smokeItem).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Predicate.isTagged(error, "Unauthorized")
            ? Effect.void
            : Effect.fail(
                CatalogSmokeFailed.forPhase("configuration-or-transport")
              ),
        onSuccess: () =>
          Effect.fail(CatalogSmokeFailed.forPhase("unauthenticated")),
      })
    );

    yield* api.ItemHistory.get(smokeItem, {
      headers: { authorization: `Bearer ${Redacted.value(token)}` },
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) => {
          if (missingItemTags.has(error._tag)) {
            return Effect.void;
          }

          return Effect.fail(
            CatalogSmokeFailed.forPhase(
              Predicate.isTagged(error, "Unauthorized")
                ? "authenticated"
                : "configuration-or-transport"
            )
          );
        },
        onSuccess: () => Effect.void,
      })
    );

    return { unauthenticated: "Unauthorized", authenticated: "accepted" };
  },
  Effect.scoped,
  (effect) =>
    smokeDeadline.pipe(
      Effect.flatMap((deadline) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () =>
              Effect.fail(
                CatalogSmokeFailed.forPhase("configuration-or-transport")
              ),
          })
        )
      )
    ),
  Effect.catchDefect(() =>
    Effect.fail(CatalogSmokeFailed.forPhase("configuration-or-transport"))
  )
);
