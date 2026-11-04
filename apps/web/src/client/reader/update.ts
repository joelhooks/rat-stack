import { Option, Record } from "effect";
import { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import { update as updateDocs } from "../../features/app.js";
import * as Cafe from "../cafe/index.js";
import type { AppMessage as DocsMessage } from "../docs/message.js";
import type { AppModel as DocsModel } from "../docs/model.js";
import type { DocumentQueries } from "../docs/queries.js";
import * as MotionDemo from "../motion/index.js";
import {
  CopyReaderText,
  RevealOutlineRow,
  WaitBeforeCopyReset,
} from "./command.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import {
  ClipboardAccess,
  copyStatusOf,
  CopyStatus,
  findCopyPrompt,
  Menu,
  SettingsPanel,
} from "./model.js";
import type { ReaderModel } from "./model.js";
import { LightLinks, ReadPeek, WaitBeforePeek } from "./peek-command.js";
import { Peek, PeekCard } from "./peek.js";
import type { PeekAnchorValue } from "./peek.js";
import { SaveSettings } from "./settings-command.js";

const withCopyStatus = (
  model: ReaderModel,
  id: string,
  status: typeof CopyStatus.Type
) => modifyFields(model, { copyStatuses: Record.set(id, status) });

const isCopyInFlight = CopyStatus.isAnyOf(["Copying", "Copied"]);

const copyablePrompt = (model: ReaderModel, id: string) =>
  ClipboardAccess.guards.Available(model.clipboardAccess) &&
  !isCopyInFlight(copyStatusOf(model, id))
    ? findCopyPrompt(model, id)
    : Option.none();

const peekRoute = (peek: typeof Peek.Type) =>
  Peek.match({
    Hidden: () => Option.none<string>(),
    Open: ({ route }) => Option.some(route),
    Waiting: ({ route }) => Option.some(route),
  })(peek);

const showPeek = (
  model: ReaderModel,
  route: string,
  anchor: PeekAnchorValue,
  wait: boolean
) => {
  const fetch = !Record.has(model.peekCards, route);

  return {
    commands: [
      ...(wait ? [WaitBeforePeek({ route })] : []),
      ...(fetch ? [ReadPeek({ route })] : []),
    ],
    model: modifyFields(model, {
      peek: () =>
        wait ? Peek.Waiting({ anchor, route }) : Peek.Open({ anchor, route }),
      peekCards: (cards) =>
        fetch ? Record.set(cards, route, PeekCard.Loading()) : cards,
    }),
  };
};

const foldCafe = Update.foldChild({
  read: (model: ReaderModel) => model.cafe,
  toParentMessage: (message: Cafe.CafeMessage) =>
    Message.GotCafeMessage({ message }),
  update: Cafe.update,
  write: (model: ReaderModel, cafe: Cafe.CafeModel) =>
    modifyFields(model, { cafe: () => Option.some(cafe) }),
});

const foldDocs = Update.foldChild({
  read: (model: ReaderModel) => model.docs,
  toParentMessage: (message: DocsMessage) =>
    Message.GotDocsMessage({ message }),
  update: updateDocs,
  write: (model: ReaderModel, docs: DocsModel) =>
    modifyFields(model, { docs: () => Option.some(docs) }),
});

const foldMotion = Update.foldChild({
  read: (model: ReaderModel) => model.motion,
  toParentMessage: (message: MotionDemo.MotionDemoMessage) =>
    Message.GotMotionMessage({ message }),
  update: MotionDemo.update,
  write: (model: ReaderModel, motion: MotionDemo.MotionDemoModel) =>
    modifyFields(model, { motion: () => Option.some(motion) }),
});

export const update = (
  model: ReaderModel,
  message: ReaderMessage
): Update.Return<ReaderModel, ReaderMessage, DocumentQueries> =>
  Message.match<Update.Return<ReaderModel, ReaderMessage, DocumentQueries>>(
    message,
    {
      ChoseSettings: ({ settings }) => ({
        commands: [SaveSettings({ settings })],
        model: modifyFields(model, { settings: () => settings }),
      }),
      ClickedCopy: ({ id }) =>
        Option.match(copyablePrompt(model, id), {
          onNone: () => ({ model }),
          onSome: ({ text }) => ({
            commands: [CopyReaderText({ id, text })],
            model: withCopyStatus(model, id, CopyStatus.Copying()),
          }),
        }),
      ClickedMenu: () => ({
        model: modifyFields(model, {
          menu: Menu.match({
            Closed: () => Menu.Open(),
            Open: () => Menu.Closed(),
            Unavailable: () => Menu.Unavailable(),
          }),
        }),
      }),
      ClickedPhoneOutlineLink: () => ({
        model: modifyFields(model, { phoneOutlineOpen: () => false }),
      }),
      ClickedSettings: () => ({
        model: modifyFields(model, {
          settingsPanel: SettingsPanel.match({
            Closed: () => SettingsPanel.Open(),
            Open: () => SettingsPanel.Closed(),
            Unavailable: () => SettingsPanel.Unavailable(),
          }),
        }),
      }),
      CompletedDetectClipboard: ({ access }) => ({
        model: modifyFields(model, { clipboardAccess: () => access }),
      }),
      CompletedLightLinks: () => ({ model }),
      CompletedRevealOutlineRow: () => ({ model }),
      CompletedSaveSettings: () => ({ model }),
      CompletedWaitBeforeCopyReset: ({ id }) => ({
        model: CopyStatus.guards.Copied(copyStatusOf(model, id))
          ? withCopyStatus(model, id, CopyStatus.Idle())
          : model,
      }),
      ElapsedPeekWait: ({ route }) => ({
        model: modifyFields(model, {
          peek: (peek) =>
            Peek.guards.Waiting(peek) && peek.route === route
              ? Peek.Open({ anchor: peek.anchor, route })
              : peek,
        }),
      }),
      FailedCopyReaderText: ({ id }) => ({
        model: CopyStatus.guards.Copying(copyStatusOf(model, id))
          ? withCopyStatus(model, id, CopyStatus.Failed())
          : model,
      }),
      FailedReadPeek: ({ route }) => ({
        model: modifyFields(model, {
          peekCards: Record.set(route, PeekCard.Missing()),
        }),
      }),
      FocusedLink: ({ anchor, route }) => showPeek(model, route, anchor, false),
      GotCafeMessage: ({ message: cafeMessage }) =>
        foldCafe(model, cafeMessage),
      GotDocsMessage: ({ message: docsMessage }) =>
        foldDocs(model, docsMessage),
      GotMotionMessage: ({ message: motionMessage }) =>
        foldMotion(model, motionMessage),
      HoveredGraphNode: ({ route }) => ({
        commands: [LightLinks({ route: Option.some(route) })],
        model,
      }),
      LeftGraphNode: () => ({
        commands: [LightLinks({ route: Option.none() })],
        model,
      }),
      LeftLink: () => ({
        model: modifyFields(model, { peek: () => Peek.Hidden() }),
      }),
      LoadedSettings: ({ settings }) => ({
        model: modifyFields(model, { settings: () => settings }),
      }),
      PointedAtLink: ({ anchor, route }) =>
        Option.contains(peekRoute(model.peek), route)
          ? { model }
          : showPeek(model, route, anchor, true),
      PressedEscape: () => ({
        model: modifyFields(model, {
          menu: (menu) => (Menu.guards.Open(menu) ? Menu.Closed() : menu),
          peek: () => Peek.Hidden(),
          settingsPanel: (panel) =>
            SettingsPanel.guards.Open(panel) ? SettingsPanel.Closed() : panel,
        }),
      }),
      ScrolledOutline: ({ range }) => ({
        commands: [RevealOutlineRow({ id: range.current })],
        model: modifyFields(model, { outlineRange: () => Option.some(range) }),
      }),
      SucceededCopyReaderText: ({ id }) =>
        CopyStatus.guards.Copying(copyStatusOf(model, id))
          ? {
              commands: [WaitBeforeCopyReset({ id })],
              model: withCopyStatus(model, id, CopyStatus.Copied()),
            }
          : { model },
      SucceededReadPeek: ({ route, summary, title }) => ({
        model: modifyFields(model, {
          peekCards: Record.set(route, PeekCard.Loaded({ summary, title })),
        }),
      }),
      ToggledPhoneOutline: ({ open }) => ({
        model: modifyFields(model, { phoneOutlineOpen: () => open }),
      }),
    }
  );
