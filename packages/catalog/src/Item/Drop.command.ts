import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { OperatorToken } from "../Operator.middleware.ts";
import { ItemId } from "./Item.id.ts";
import { UnseenItem } from "./UnseenItem.rejection.ts";

export class ItemDropped extends Domain.Event("ItemDropped", {
  why: Schema.NonEmptyString,
}) {}

export class Drop extends Domain.Command(
  "Drop",
  {
    target: ItemId,
    middleware: [OperatorToken],
    input: { why: Schema.NonEmptyString },
    events: [ItemDropped],
    rejects: [UnseenItem],
  },
  { description: "Drop a previously sighted item with an operator's reason." }
) {}
