// ATS configuration (data/ats/*.yaml): weights, penalties, thresholds and the parser's word lists.
// The hash is over the parsed values with keys sorted, so reformatting a file leaves it unchanged
// and any changed number changes it.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export const ATS_CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/ats");

/** JSON with object keys sorted at every level: equal values always serialize identically. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

export function loadAtsConfig(dir = ATS_CONFIG_DIR) {
  const read = (name) => yaml.load(fs.readFileSync(path.join(dir, name), "utf8")) || {};
  return withHash({ scoring: read("scoring.yaml"), sections: read("sections.yaml") });
}

/** Attach (or refresh) the hash for a config object built or modified in code. */
export function withHash(config) {
  const { hash: _drop, ...values } = config;
  return { ...values, hash: sha256(canonicalJson(values)).slice(0, 16) };
}
