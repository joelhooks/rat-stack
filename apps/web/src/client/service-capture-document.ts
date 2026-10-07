import { ReaderBlock, ReaderInline } from "./reader-document.js";
import type { ReaderInlineValue } from "./reader-document.js";

const text = (value: string) => ReaderInline.Text({ value });

const code = (value: string) => ReaderInline.Code({ value });

const link = (href: string, value: string) =>
  ReaderInline.Link({ href, value });

const paragraph = (...content: readonly ReaderInlineValue[]) =>
  ReaderBlock.Paragraph({ content });

const heading = (id: string, title: string) =>
  ReaderBlock.Heading({ id, title });

const snippet = (lines: string) =>
  ReaderBlock.Snippet({
    at: "65e9465f38092e24486392f22c08f45d61230c20",
    lines,
    path: "packages/core/src/file-inspector.ts",
    repo: "rat-stack",
  });

export const serviceCaptureDocument = [
  paragraph(
    text(
      "Build a service once with the dependencies its implementation needs. Return methods that use those captured values.\nCallers then require only the service."
    )
  ),
  heading(
    "name-the-job-before-the-implementation",
    "Name the job before the implementation"
  ),
  paragraph(
    code("Context.Service"),
    text(" names a service and describes its interface.\n"),
    code("Effect.Effect<FileStats, FileStatsError>"),
    text(
      " declares the method's success and expected failure. Its omitted requirement parameter is "
    ),
    code("never"),
    text(".")
  ),
  snippet("6-15"),
  paragraph(
    code("make"),
    text(" describes service construction as an Effect.\n"),
    code("Layer.effect"),
    text(" runs that construction when the service graph is built.")
  ),
  heading("compose-work-inside-the-method", "Compose work inside the method"),
  paragraph(
    text("Use "),
    code("Effect.gen"),
    text(" for inline composition. Use "),
    code('Effect.fn("name")'),
    text(" for reusable functions that need a tracing boundary.\nUse "),
    code("Effect.fnUntraced"),
    text(
      " when tracing is not useful.\nDo not create a function that only returns another "
    ),
    code("Effect.gen"),
    text(" wrapper.")
  ),
  snippet("17-35"),
  paragraph(
    code("inspect"),
    text(
      " closes over the filesystem value. It keeps read failures typed and returns a domain result."
    )
  ),
  paragraph(
    text(
      "The service method composes Effects. It does not run an imperative runtime inside the computation."
    )
  ),
  heading(
    "construction-dependencies-are-not-request-identity",
    "Construction dependencies are not request identity"
  ),
  paragraph(
    text(
      "Methods can retain contextual requirements when the job needs them.\nA filesystem implementation usually belongs to construction. A current person may belong to a single request."
    )
  ),
  paragraph(
    text(
      "Pass request data explicitly, or keep that requirement visible at the request boundary.\nDo not capture one request's identity in a service shared by later requests."
    )
  ),
  paragraph(
    link(
      "https://github.com/kitlangton/effect-solutions/issues/24",
      "Issue #24"
    ),
    text(
      " records the risk of treating dependency-free methods as universal law."
    )
  ),
  heading("common-wrong-approach", "Common wrong approach"),
  paragraph(
    text("Resolving the filesystem inside every "),
    code("inspect"),
    text(" call leaves "),
    code("FileSystem"),
    text(
      " in that method's requirements.\nThe caller must now know the implementation dependency. Capturing it during construction removes that requirement from the method."
    )
  ),
  paragraph(
    text(
      "Rebuilding the service inside every call also loses the intended construction lifetime.\nSupply its Layer at the "
    ),
    link("/lore/layers-make-dependencies-explicit", "composition root"),
    text(".")
  ),
  heading("effect-idiom-and-house-rule", "Effect idiom and house rule"),
  ReaderBlock.List({
    items: [
      [
        text(
          "Services describe behavior. Layers supply implementations and resolve construction requirements."
        ),
      ],
      [
        text("In rat-stack, keep "),
        code("make"),
        text(" and "),
        code("static layer"),
        text(
          " beside the service. Core owns job-shaped ports; adapters own provider code."
        ),
      ],
      [
        text("rat-stack also uses capability projections, "),
        link("/lore/cartridges", "cartridge"),
        text(" packages, and a no-comments rule."),
      ],
    ],
  }),
  paragraph(
    text("See also: "),
    link("/lore/structure-effect-by-domain", "domain structure"),
    text(", "),
    link("/lore/layers-make-dependencies-explicit", "Layer composition"),
    text(", "),
    link("/lore/layer-constructor-pattern", "the Layer constructor pattern"),
    text(", and "),
    link("/lore/tests-that-earn-their-place", "testing through services"),
    text(".")
  ),
];
