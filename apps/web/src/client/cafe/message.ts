import { CafeLetter } from "@rat-stack/core/contracts";
import { defineMessageUnion } from "foldkit/message";

export const Message = defineMessageUnion({
  ClearedStackLetters: {},
  ToggledStackLetter: { letter: CafeLetter },
});

export type CafeMessage = typeof Message.Type;
