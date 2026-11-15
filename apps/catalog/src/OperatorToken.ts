import { Operator } from "@rat-stack/catalog/Operator.context";
import {
  OperatorToken,
  Unauthorized,
} from "@rat-stack/catalog/Operator.middleware";
import * as Config from "effect/Config";
import * as Mac from "effect/crypto/Mac";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

export const operatorTokenLayer = (token: Option.Option<Redacted.Redacted>) =>
  Layer.succeed(OperatorToken, (effect, { headers }) => {
    const { authorization } = headers;

    if (Option.isNone(token) || authorization === undefined) {
      return Effect.fail(new Unauthorized());
    }

    const expected = Redacted.value(token.value);
    const encoder = new TextEncoder();

    if (
      expected.length === 0 ||
      !Mac.timingSafeEqual(
        encoder.encode(authorization),
        encoder.encode(`Bearer ${expected}`)
      )
    ) {
      return Effect.fail(new Unauthorized());
    }

    return Effect.provideService(effect, Operator, { authenticated: true });
  });

export const OperatorTokenLive = Layer.unwrap(
  Config.option(Config.Redacted("CATALOG_OPERATOR_TOKEN")).pipe(
    Effect.map(operatorTokenLayer)
  )
);
