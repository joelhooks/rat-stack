import { cafeLetters } from "@rat-stack/core/contracts";
import type { CafeLetterValue } from "@rat-stack/core/contracts";
import type { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import { Message } from "./message.js";
import type { CafeMessage } from "./message.js";
import { Model } from "./model.js";
import type { CafeModel, DirectoryModel } from "./model.js";

type UpdateReturn = Update.Return<CafeModel, CafeMessage>;

const toggleLetter =
  (letter: CafeLetterValue) =>
  (selected: readonly CafeLetterValue[]): readonly CafeLetterValue[] =>
    cafeLetters.filter((candidate) =>
      candidate === letter
        ? !selected.includes(candidate)
        : selected.includes(candidate)
    );

const updateDirectory = (
  model: CafeModel,
  change: (directory: DirectoryModel) => DirectoryModel
): UpdateReturn => ({
  model: Model.match<CafeModel>(model, {
    Directory: change,
    News: (news) => news,
  }),
});

export const update = (model: CafeModel, message: CafeMessage): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClearedStackLetters: () =>
      updateDirectory(model, modifyFields({ selected: () => [] })),
    ToggledStackLetter: ({ letter }) =>
      updateDirectory(model, modifyFields({ selected: toggleLetter(letter) })),
  });
