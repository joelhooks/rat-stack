import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class Operator extends Domain.RequestContext<Operator>()(
  "Catalog/Operator",
  Schema.Struct({ authenticated: Schema.Literal(true) })
) {}
