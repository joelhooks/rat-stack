import * as Domain from "@alchemy.run/domain";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

import type { Operator } from "./Operator.context.ts";

export class Unauthorized extends Domain.Rejection(
  "Unauthorized",
  {},
  {
    httpApiStatus: 401,
    description: "Supply the catalog operator bearer token.",
  }
) {}

export class OperatorToken extends RpcMiddleware.Service<
  OperatorToken,
  { provides: Operator }
>()("Catalog/OperatorToken", { error: Unauthorized }) {}
