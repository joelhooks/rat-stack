import { expect, it } from "@effect/vitest";
import { CafeLetter, cafeLetters } from "@rat-stack/core/contracts";
import type { CafeLetterValue } from "@rat-stack/core/contracts";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { given, message, model, story } from "foldkit/story";

import { Message } from "../src/client/cafe/message.js";
import { Model } from "../src/client/cafe/model.js";
import { update } from "../src/client/cafe/update.js";
import { directoryHome } from "./cafe-fixture.js";

const histories = Arbitrary.schema(
  Schema.Array(
    Schema.Union([
      Schema.Struct({ letter: CafeLetter, step: Schema.Literal("toggle") }),
      Schema.Struct({ step: Schema.Literal("clear") }),
    ])
  ).check(Schema.isMaxLength(40))
);

const expectedSelection = (
  history: typeof histories extends Arbitrary.Arbitrary<infer A> ? A : never
): readonly CafeLetterValue[] => {
  const chosen = new Set<CafeLetterValue>();

  for (const step of history) {
    if (step.step === "clear") {
      chosen.clear();
    } else if (chosen.has(step.letter)) {
      chosen.delete(step.letter);
    } else {
      chosen.add(step.letter);
    }
  }

  return cafeLetters.filter((letter) => chosen.has(letter));
};

it.prop(
  "directory filter histories select each toggled letter once, in C, A, F, E order",
  { history: histories },
  ({ history }) => {
    story(
      update,
      given(directoryHome),
      ...history.map((step) =>
        message(
          step.step === "clear"
            ? Message.ClearedStackLetters()
            : Message.ToggledStackLetter({ letter: step.letter })
        )
      ),
      model((current) => {
        expect(current).toStrictEqual(
          Model.Directory({
            projects: directoryHome.projects,
            selected: expectedSelection(history),
          })
        );
      })
    );
  }
);

it.prop(
  "news pages ignore directory filter messages",
  { history: histories },
  ({ history }) => {
    const news = Model.News({
      items: [],
      rankedAt: Schema.decodeSync(Schema.String.pipe(Schema.brand("IsoDate")))(
        "2026-10-08"
      ),
    });

    story(
      update,
      given(news),
      ...history.map((step) =>
        message(
          step.step === "clear"
            ? Message.ClearedStackLetters()
            : Message.ToggledStackLetter({ letter: step.letter })
        )
      ),
      model((current) => {
        expect(current).toStrictEqual(news);
      })
    );
  }
);
