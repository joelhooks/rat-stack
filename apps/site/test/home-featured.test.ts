import { describe, expect, it } from "@effect/vitest";
import { DateTime, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { TubeTier } from "../../web/src/client/tube/data.ts";
import {
  featuredCount,
  featuredTiers,
  featuredVideos,
} from "../scripts/home-featured.ts";

const epoch = DateTime.makeUnsafe("2024-01-01T00:00:00Z");

const published = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 900, minimum: 0 }))
).pipe(
  Arbitrary.map((days) =>
    DateTime.formatIsoDateUtc(DateTime.add(epoch, { days }))
  )
);

const videos = Arbitrary.array(
  Arbitrary.all({ published, tier: Arbitrary.schema(TubeTier) }),
  { maxLength: 30 }
);

describe("featuredVideos", () => {
  it.prop(
    "picks only top tiers, as many as exist up to the count, newest first",
    { all: videos },
    ({ all }) => {
      const picked = featuredVideos(all);

      const eligible = all.filter((video) =>
        featuredTiers.includes(video.tier)
      );

      expect(picked.every((video) => featuredTiers.includes(video.tier))).toBe(
        true
      );
      expect(picked).toHaveLength(Math.min(featuredCount, eligible.length));

      const oldestPicked = picked.at(-1)?.published ?? "";
      const left = eligible.filter((video) => !picked.includes(video));

      expect(left.every((video) => video.published <= oldestPicked)).toBe(true);
    }
  );
});
