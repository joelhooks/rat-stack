import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

import { OperatorToken } from "../Operator.middleware.ts";
import { ItemId } from "./Item.id.ts";
import { UnseenItem } from "./UnseenItem.rejection.ts";

export class ItemKept extends Domain.Event("ItemKept", {
  why: Schema.NonEmptyString,
}) {}

export class Keep extends Domain.Command(
  "Keep",
  {
    target: ItemId,
    middleware: [OperatorToken],
    input: { why: Schema.NonEmptyString },
    events: [ItemKept],
    rejects: [UnseenItem],
  },
  { description: "Keep a previously sighted item with an operator's reason." }
) {}
