/**
 * 移動手段ごとの「通れる道」の判定。
 * 災害時を想定しているので、既定でトンネル・地下道は除外する（浸水・崩落のリスクが高いため）。
 */

export type OsmTags = Record<string, string>;
export type ProfileId = "foot" | "car";

export interface Profile {
  id: ProfileId;
  label: string;
  /** 平地での想定速度 [km/h]。 */
  speedKmh: number;
  /** 一方通行を守るか。徒歩は守らない。 */
  respectOneway: boolean;
  /** この道を使ってよいか。 */
  allows: (tags: OsmTags) => boolean;
}

/** 道路としてそもそも扱わないもの。 */
const NEVER = new Set([
  "proposed",
  "construction",
  "raceway",
  "bus_guideway",
  "escape",
  "planned",
]);

const CAR_OK = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);

const FOOT_NG = new Set(["motorway", "motorway_link"]);

export const PROFILES: Record<ProfileId, Profile> = {
  foot: {
    id: "foot",
    label: "徒歩",
    speedKmh: 4.5,
    respectOneway: false,
    allows: (t) => {
      const hw = t.highway;
      if (!hw || NEVER.has(hw)) return false;
      if (FOOT_NG.has(hw)) return false;
      if (t.foot === "no" || t.access === "private" || t.access === "no") return false;
      return true;
    },
  },
  car: {
    id: "car",
    label: "車",
    speedKmh: 25,
    respectOneway: true,
    allows: (t) => {
      const hw = t.highway;
      if (!hw || NEVER.has(hw)) return false;
      if (!CAR_OK.has(hw)) return false;
      if (t.access === "private" || t.access === "no") return false;
      if (t.motor_vehicle === "no") return false;
      return true;
    },
  },
};

/** トンネル・地下道・屋内通路など、避難時に避けたい構造か。 */
export function isUnderground(tags: OsmTags): boolean {
  if (tags.tunnel && tags.tunnel !== "no") return true;
  if (tags.covered === "yes") return true;
  if (tags.location === "underground") return true;
  const layer = Number(tags.layer);
  return Number.isFinite(layer) && layer < 0;
}

/** 階段。車は通れないし、徒歩でも要配慮者には負担なので区別できるようにしておく。 */
export function isSteps(tags: OsmTags): boolean {
  return tags.highway === "steps";
}
