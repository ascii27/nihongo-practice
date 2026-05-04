import { XMLParser } from "fast-xml-parser";

export type CardInput = {
  external_id: string;
  japanese: string;
  english: string;
};

type RawText = string | { "#text"?: string; "@_name"?: string };

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
    const japanese = c?.japanese;
    const texts: RawText[] = Array.isArray(c?.text) ? c.text : c?.text ? [c.text] : [];
    const meaning = texts.find((t) => typeof t === "object" && t["@_name"] === "Meaning");
    const english = typeof meaning === "object" ? meaning["#text"] : undefined;
    if (typeof id === "string" && typeof japanese === "string" && typeof english === "string") {
      out.push({ external_id: id, japanese: japanese.trim(), english: english.trim() });
    }
  }
  return out;
}
