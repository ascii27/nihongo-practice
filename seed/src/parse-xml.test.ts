import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseDeckXml } from "./parse-xml.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseDeckXml", () => {
  it("extracts cards from the fixture deck", () => {
    const xml = readFileSync(path.join(__dirname, "fixtures/deck.xml"), "utf8");
    const cards = parseDeckXml(xml);
    expect(cards).toEqual([
      { external_id: "card-001", japanese: "食べる", english: "to eat" },
      { external_id: "card-002", japanese: "水", english: "water" },
      { external_id: "card-003", japanese: "美味しい", english: "delicious" },
    ]);
  });

  it("throws on malformed XML", () => {
    expect(() => parseDeckXml("<not valid")).toThrow();
  });

  it("skips cards missing required fields", () => {
    const xml = `<?xml version="1.0"?>
<deck>
  <cards>
    <card id="ok"><japanese>本</japanese><text name="Meaning">book</text></card>
    <card id="no-japanese"><text name="Meaning">missing</text></card>
    <card id="no-meaning"><japanese>無</japanese></card>
  </cards>
</deck>`;
    const cards = parseDeckXml(xml);
    expect(cards.map((c) => c.external_id)).toEqual(["ok"]);
  });
});
