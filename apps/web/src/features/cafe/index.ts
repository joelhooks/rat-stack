import { Submodel } from "foldkit";
import type { Html } from "foldkit/html";

import type { CafeMessage } from "../../client/cafe/message.js";
import { Model } from "../../client/cafe/model.js";
import type { CafeModel } from "../../client/cafe/model.js";
import * as Directory from "./directory.js";
import * as News from "./news.js";

export { directoryRouter, newsFeedRouter, newsRouter } from "../site-route.js";

export const view = Submodel.defineView<CafeModel, CafeMessage>((model, h) =>
  Model.match<Html>(model, {
    Directory: (directory) => Directory.view(directory, h),
    News: (news) => News.view(news, h),
  })
);
