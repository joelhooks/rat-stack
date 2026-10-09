import { DateTime, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  CafeEngagement,
  CafeLetter,
  CafeProject,
  CafeStory,
  CafeSignal,
  IsoDate,
} from "../src/contracts.js";
import type { CafeEngagementValue } from "../src/contracts.js";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum })));

const pick = <const A extends readonly [string, ...string[]]>(values: A) =>
  Arbitrary.schema(Schema.Literals(values));

const epoch = DateTime.makeUnsafe("2026-01-01T00:00:00Z");

export const isoDateAfter = (base: string, days: number) =>
  Schema.decodeSync(IsoDate)(
    DateTime.formatIsoDateUtc(
      DateTime.add(DateTime.makeUnsafe(`${base}T00:00:00Z`), { days })
    )
  );

export const isoDate = int(0, 400).pipe(
  Arbitrary.map((days) =>
    Schema.decodeSync(IsoDate)(
      DateTime.formatIsoDateUtc(DateTime.add(epoch, { days }))
    )
  )
);

export const handle = pick(["ada", "bo", "cy", "di", "eve", "fox"]);

export const domain = pick([
  "github.com",
  "x.com",
  "effect.website",
  "alchemy.run",
  "youtube.com",
]);

const maybe = <A>(value: Arbitrary.Arbitrary<A>) =>
  Arbitrary.all({ present: Arbitrary.schema(Schema.Boolean), value }).pipe(
    Arbitrary.map((generated) =>
      generated.present ? Option.some(generated.value) : Option.none()
    )
  );

export const engagement = Arbitrary.all({
  likes: maybe(int(0, 1_000_000)),
  participants: maybe(int(0, 1_000_000)),
  pushedAt: maybe(isoDate),
  replies: maybe(int(0, 1_000_000)),
  seen: maybe(int(0, 1_000_000)),
  stars: maybe(int(0, 1_000_000)),
  views: maybe(int(0, 1_000_000)),
}).pipe(
  Arbitrary.map((generated): CafeEngagementValue =>
    Schema.decodeUnknownSync(CafeEngagement)(
      Object.fromEntries(
        Object.entries(generated).flatMap(([key, value]) => {
          const signal: Option.Option<unknown> = value;

          return Option.match(signal, {
            onNone: () => [],
            onSome: (present) => [[key, present]],
          });
        })
      )
    )
  )
);

const storyInput = Arbitrary.all({
  author: handle,
  date: isoDate,
  domain,
  engagement,
  kind: pick(["release", "post", "video", "launch"]),
  slug: int(0, 1_000_000),
});

export const story = storyInput.pipe(
  Arbitrary.map((generated) =>
    Schema.decodeSync(CafeStory)({
      author: { github: generated.author, x: generated.author },
      date: generated.date,
      engagement: generated.engagement,
      kind: generated.kind,
      repo: null,
      source: `https://${generated.domain}/source`,
      summary: "A generated summary.",
      title: "A generated title",
      url: `https://${generated.domain}/item/${generated.slug}`,
    })
  )
);

export const uniqueByUrl = <A extends { readonly url: string }>(
  items: readonly A[]
): readonly A[] =>
  items.filter(
    (item, index) =>
      items.findIndex((candidate) => candidate.url === item.url) === index
  );

export const stories = Arbitrary.array(story, { maxLength: 24 }).pipe(
  Arbitrary.map(uniqueByUrl)
);

export const quietStories = Arbitrary.array(
  Arbitrary.all({
    author: handle,
    day: pick(["2026-10-01", "2026-10-02", "2026-10-03"]),
    domain,
    slug: int(0, 50),
  }),
  { maxLength: 24 }
).pipe(
  Arbitrary.map((generated) =>
    uniqueByUrl(
      generated.map((entry) =>
        Schema.decodeSync(CafeStory)({
          author: { github: null, x: entry.author },
          date: entry.day,
          kind: "post",
          repo: null,
          source: `https://${entry.domain}/source`,
          summary: "A quiet summary.",
          title: "A quiet title",
          url: `https://${entry.domain}/quiet/${entry.slug}`,
        })
      )
    )
  )
);

export const signal = Arbitrary.schema(CafeSignal);

export const letters = Arbitrary.array(Arbitrary.schema(CafeLetter), {
  maxLength: 4,
});

const evidence = Arbitrary.all({
  present: Arbitrary.schema(Schema.Boolean),
  value: pick(["package.json depends on it", "alchemy.run.ts declares it"]),
}).pipe(
  Arbitrary.map((generated) => (generated.present ? generated.value : null))
);

export const project = Arbitrary.all({
  alchemy: evidence,
  cloudflare: evidence,
  date: isoDate,
  effect: evidence,
  foldkit: evidence,
  owner: handle,
  slug: int(0, 1_000_000),
  stars: Arbitrary.all({
    present: Arbitrary.schema(Schema.Boolean),
    value: int(0, 50_000),
  }),
}).pipe(
  Arbitrary.map((generated) =>
    Schema.decodeSync(CafeProject)({
      author: { github: generated.owner, x: null },
      date: generated.date,
      repo: `${generated.owner}/p${generated.slug}`,
      source: `https://github.com/${generated.owner}/p${generated.slug}`,
      stack: {
        alchemy: generated.alchemy,
        cloudflare: generated.cloudflare,
        effect: generated.effect,
        foldkit: generated.foldkit,
      },
      stars: generated.stars.present ? generated.stars.value : null,
      summary: "A generated project.",
      title: `p${generated.slug}`,
      url: `https://github.com/${generated.owner}/p${generated.slug}`,
    })
  )
);

export const projects = Arbitrary.array(project, { maxLength: 24 }).pipe(
  Arbitrary.map(uniqueByUrl)
);
