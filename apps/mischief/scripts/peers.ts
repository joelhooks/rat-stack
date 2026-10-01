import { Schema } from "effect";

export const PeerTier = Schema.Literals(["S", "A", "B", "C", "D", "E", "F"]);

export const PeerVersions = Schema.Struct({
  alchemy: Schema.String,
  effect: Schema.String,
  xstate: Schema.String,
  xstateEffect: Schema.String,
});

export const PeerRow = Schema.Struct({
  branch: Schema.String,
  checked: Schema.String,
  commit: Schema.String,
  firstSeen: Schema.String,
  reason: Schema.String,
  repo: Schema.String,
  sources: Schema.Array(
    Schema.Struct({ label: Schema.String, path: Schema.String })
  ),
  studied: Schema.String,
  tier: PeerTier,
  versions: PeerVersions,
});

export const PeerRows = Schema.Array(PeerRow);

type Peer = typeof PeerRow.Type;

type Pins = typeof PeerVersions.Type;

const tierOrder = ["S", "A", "B", "C", "D", "E", "F"];

export const partitionPeers = (peers: readonly Peer[]) => {
  const sorted = peers.toSorted(
    (left, right) =>
      tierOrder.indexOf(left.tier) - tierOrder.indexOf(right.tier) ||
      left.repo.localeCompare(right.repo)
  );

  return {
    alsoSeen: sorted.filter((peer) => tierOrder.indexOf(peer.tier) > 2),
    tailing: sorted.filter((peer) => tierOrder.indexOf(peer.tier) <= 2),
  };
};

const Manifest = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const manifestPin = (text: string, name: string) => {
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
    text
  );

  return Schema.decodeUnknownSync(Schema.String)(
    manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]
  );
};

export const peerPins = (root: string, infra: string, core: string): Pins => ({
  alchemy: manifestPin(infra, "alchemy"),
  effect: manifestPin(root, "effect"),
  xstate: manifestPin(core, "xstate"),
  xstateEffect: manifestPin(core, "@xstate/effect"),
});

const cell = (value: string) =>
  value.replaceAll("|", "&#124;").replaceAll("\n", " ");

const versionCell = (value: string, pin: string) => {
  if (value === "—") {
    return value;
  }

  const versions = value.match(/\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?/gu) ?? [];

  const matches =
    versions.length > 0 && versions.every((version) => version === pin);

  return `${cell(value)} ${matches ? "=" : "≠"}`;
};

const peerTable = (peers: readonly Peer[], pins: Pins) =>
  [
    "| Tier | Repo | Why this tier | Effect | Alchemy | XState | @xstate/effect | Checked | First seen | Studied |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...peers.map(
      (peer) =>
        `| ${[
          peer.tier,
          `[${peer.repo}](https://github.com/${peer.repo})`,
          cell(peer.reason),
          versionCell(peer.versions.effect, pins.effect),
          versionCell(peer.versions.alchemy, pins.alchemy),
          versionCell(peer.versions.xstate, pins.xstate),
          versionCell(peer.versions.xstateEffect, pins.xstateEffect),
          peer.checked,
          peer.firstSeen,
          peer.studied,
        ].join(" | ")} |`
    ),
  ].join("\n");

export const renderPeers = (
  template: string,
  peers: readonly Peer[],
  pins: Pins
) => {
  const { tailing, alsoSeen } = partitionPeers(peers);

  const pinTable = [
    "| Effect | Alchemy | XState | @xstate/effect |",
    "| --- | --- | --- | --- |",
    `| ${pins.effect} | ${pins.alchemy} | ${pins.xstate} | ${pins.xstateEffect} |`,
  ].join("\n");

  const sources = [...tailing, ...alsoSeen]
    .map(
      (peer) =>
        `- **${peer.repo}**, \`${peer.branch}\`, checked ${peer.checked}: ${peer.sources
          .map(
            (source) =>
              `[${source.label}](https://github.com/${peer.repo}/blob/${peer.commit}/${source.path})`
          )
          .join(", ")}.`
    )
    .join("\n");

  return template
    .replace("<PeerPins />", pinTable)
    .replace("<PeerRoster />", peerTable(tailing, pins))
    .replace(
      "<PeersAlsoSeen />",
      `<details>\n<summary>Also seen: C–F (${alsoSeen.length} peers)</summary>\n\n${peerTable(alsoSeen, pins)}\n\n</details>`
    )
    .replace("<PeerSources />", sources);
};
