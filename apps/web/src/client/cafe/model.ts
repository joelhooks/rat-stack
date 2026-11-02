import {
  CafeLetter,
  CafeNewsItem,
  CafePersonSummary,
  CafeProject,
  IsoDate,
} from "@rat-stack/core/contracts";
import { Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const NewsProfileLink = Schema.Struct({
  name: Schema.String,
  route: Schema.String,
  url: Schema.String,
});

export const Model = defineTaggedUnion({
  AllStars: {
    people: Schema.Array(CafePersonSummary),
  },
  Directory: {
    projects: Schema.Array(CafeProject),
    selected: Schema.Array(CafeLetter),
  },
  News: {
    items: Schema.Array(CafeNewsItem),
    profiles: Schema.Array(NewsProfileLink),
    rankedAt: IsoDate,
  },
});

export type CafeModel = typeof Model.Type;

export type DirectoryModel = typeof Model.Directory.Type;

export type NewsModel = typeof Model.News.Type;

export type AllStarsModel = typeof Model.AllStars.Type;
