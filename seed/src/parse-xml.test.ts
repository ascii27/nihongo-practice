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

  it("handles Migaku-style decks with no card ids and attributed japanese", () => {
    const xml = `<deck name="Personal study"><fields><japanese name='Japanese' sides='11'/></fields><cards><card><japanese name='Japanese'>尊敬語</japanese><text name='Meaning'>honorific language</text></card><card><japanese name='Japanese'>潰れて</japanese><text name='Meaning'>Collapsed</text></card></cards></deck>`;
    const cards = parseDeckXml(xml);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ japanese: "尊敬語", english: "honorific language" });
    expect(cards[1]).toMatchObject({ japanese: "潰れて", english: "Collapsed" });
    expect(cards[0].external_id).toMatch(/^seed-[0-9a-f]{12}$/);
    expect(cards[0].external_id).not.toEqual(cards[1].external_id);
    expect(parseDeckXml(xml)[0].external_id).toEqual(cards[0].external_id);
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
