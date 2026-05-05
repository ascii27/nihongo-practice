import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export type CardInput = {
  external_id: string;
  japanese: string;
  english: string;
};

type RawText = string | { "#text"?: string; "@_name"?: string };
type RawJapanese = string | { "#text"?: string };

function textOf(v: RawText | RawJapanese | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v["#text"] === "string") return v["#text"];
  return undefined;
}

export function parseDeckXml(xml: string): CardInput[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "card" || name === "text",
  });
  const doc = parser.parse(xml);
  if (!doc?.deck || !doc?.deck?.cards) {
    throw new Error("malformed deck: missing deck or cards element");
  }
  const rawCards = doc?.deck?.cards?.card ?? [];
  if (!Array.isArray(rawCards)) {
    throw new Error("malformed deck: expected cards array");
  }
  const out: CardInput[] = [];
  for (const c of rawCards) {
    const id = c?.["@_id"];
    const japanese = textOf(c?.japanese);
    const texts: RawText[] = Array.isArray(c?.text) ? c.text : c?.text ? [c.text] : [];
    const meaning = texts.find((t) => typeof t === "object" && t["@_name"] === "Meaning");
    const english = textOf(meaning);
    if (typeof japanese === "string" && typeof english === "string") {
      const trimmed = japanese.trim();
      const external_id =
        typeof id === "string"
          ? id
          : `seed-${createHash("sha1").update(trimmed).digest("hex").slice(0, 12)}`;
      out.push({ external_id, japanese: trimmed, english: english.trim() });
    }
  }
  return out;
}
