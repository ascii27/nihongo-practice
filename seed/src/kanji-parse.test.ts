import { describe, it, expect } from "vitest";
import { parseKanjiVg, parseKanjiDic } from "./kanji-parse.js";

// 一 (U+4E00) = 0x4e00. Two paths given out of order to prove we sort by the
// `-s<N>` stroke number, not document order.
const KANJIVG = `<?xml version="1.0" encoding="UTF-8"?>
<kanjivg>
  <kanji id="kvg:kanji_04e00">
    <g id="kvg:04e00" kvg:element="一" kvg:radical="general">
      <path id="kvg:04e00-s2" kvg:type="㇐" d="SECOND"/>
      <path id="kvg:04e00-s1" kvg:type="㇐" d="FIRST"/>
    </g>
  </kanji>
  <kanji id="kvg:kanji_04e00-Kaisho">
    <g id="kvg:04e00-Kaisho"><path id="kvg:04e00-Kaisho-s1" d="VARIANT"/></g>
  </kanji>
  <kanji id="kvg:kanji_098df">
    <g id="kvg:098df" kvg:element="食">
      <g id="kvg:098df-g1" kvg:element="人" kvg:radical="general">
        <path id="kvg:098df-s1" d="A"/>
        <path id="kvg:098df-s2" d="B"/>
      </g>
      <g id="kvg:098df-g2">
        <path id="kvg:098df-s3" d="C"/>
      </g>
    </g>
  </kanji>
</kanjivg>`;

const KANJIDIC = `<?xml version="1.0" encoding="UTF-8"?>
<kanjidic2>
  <character>
    <literal>一</literal>
    <misc><grade>1</grade><stroke_count>1</stroke_count></misc>
    <reading_meaning><rmgroup>
      <reading r_type="pinyin">yi1</reading>
      <reading r_type="ja_on">イチ</reading>
      <reading r_type="ja_on">イツ</reading>
      <reading r_type="ja_kun">ひと</reading>
      <meaning>one</meaning>
      <meaning m_lang="fr">un</meaning>
    </rmgroup></reading_meaning>
  </character>
  <character>
    <literal>食</literal>
    <misc><grade>2</grade></misc>
    <reading_meaning><rmgroup>
      <reading r_type="ja_on">ショク</reading>
      <reading r_type="ja_kun">た.べる</reading>
      <meaning>eat</meaning>
      <meaning>food</meaning>
    </rmgroup></reading_meaning>
  </character>
  <character>
    <literal>々</literal>
    <misc><stroke_count>3</stroke_count></misc>
  </character>
</kanjidic2>`;

describe("parseKanjiVg", () => {
  const vg = parseKanjiVg(KANJIVG);

  it("keys entries by the character decoded from the kanji id hex", () => {
    expect([...vg.keys()].sort()).toEqual(["一", "食"]);
  });

  it("orders strokes by the -s<N> id suffix, not document order", () => {
    expect(vg.get("一")!.strokes).toEqual(["FIRST", "SECOND"]);
  });

  it("collects nested-group strokes in stroke order", () => {
    expect(vg.get("食")!.strokes).toEqual(["A", "B", "C"]);
  });

  it("ignores variant glyphs (id with a suffix)", () => {
    expect(vg.get("一")!.strokes).not.toContain("VARIANT");
  });

  it("extracts the radical element", () => {
    expect(vg.get("一")!.radical).toBe("一");
    expect(vg.get("食")!.radical).toBe("人");
  });
});

describe("parseKanjiDic", () => {
  const dic = parseKanjiDic(KANJIDIC);

  it("splits on'yomi and kun'yomi readings", () => {
    expect(dic.get("一")!.on).toEqual(["イチ", "イツ"]);
    expect(dic.get("一")!.kun).toEqual(["ひと"]);
  });

  it("keeps only English meanings (drops m_lang-tagged)", () => {
    expect(dic.get("一")!.meanings).toEqual(["one"]);
    expect(dic.get("食")!.meanings).toEqual(["eat", "food"]);
  });

  it("parses grade as a number, null when absent", () => {
    expect(dic.get("食")!.grade).toBe(2);
    expect(dic.get("々")!.grade).toBeNull();
  });
});
