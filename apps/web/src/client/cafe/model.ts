import {
  CafeLetter,
  CafeNewsItem,
  CafeProject,
  IsoDate,
} from "@rat-stack/core/contracts";
import { Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const Model = defineTaggedUnion({
  Directory: {
    projects: Schema.Array(CafeProject),
    selected: Schema.Array(CafeLetter),
  },
  News: {
    items: Schema.Array(CafeNewsItem),
    rankedAt: IsoDate,
  },
});

export type CafeModel = typeof Model.Type;

export type DirectoryModel = typeof Model.Directory.Type;

export type NewsModel = typeof Model.News.Type;
