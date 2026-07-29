import { XMLParser } from "fast-xml-parser";

// ---- KanjiVG (stroke paths) ------------------------------------------------
//
// KanjiVG ships one <kanji id="kvg:kanji_<hex>"> per glyph, containing nested
// <g> groups whose <path> leaves are the strokes. Stroke ORDER is encoded in
// each path id suffix `-s<N>` (kvg:04e00-s1, -s2, …), so we collect every path
// recursively and sort by that number — robust even though the XML parser
// groups <g>/<path> siblings by tag name and loses their interleaved order.

export type KanjiVgEntry = { strokes: string[]; radical: string | null };

type PathNode = { "@_d"?: string; "@_id"?: string };
type GNode = {
  "@_kvg:element"?: string;
  "@_kvg:radical"?: string;
  path?: PathNode | PathNode[];
  g?: GNode | GNode[];
};

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Depth-first collect all <path> nodes and the radical element (first <g> that
// declares kvg:radical), regardless of nesting depth.
function walk(g: GNode, paths: PathNode[], radical: { value: string | null }): void {
  if (radical.value == null && typeof g["@_kvg:radical"] === "string" && g["@_kvg:element"]) {
    radical.value = g["@_kvg:element"] ?? null;
  }
  for (const p of asArray(g.path)) paths.push(p);
  for (const child of asArray(g.g)) walk(child, paths, radical);
}

function strokeNumber(id: string | undefined): number {
  const m = id?.match(/-s(\d+)\b/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function charFromKanjiId(id: string | undefined): string | null {
  // id looks like "kvg:kanji_04e00" (optionally with a "-Variant" suffix).
  const m = id?.match(/kvg:kanji_([0-9a-fA-F]+)/);
  if (!m) return null;
  const cp = parseInt(m[1], 16);
  if (!Number.isFinite(cp)) return null;
  return String.fromCodePoint(cp);
}

export function parseKanjiVg(xml: string): Map<string, KanjiVgEntry> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "kanji" || name === "g" || name === "path",
  });
  const doc = parser.parse(xml);
  const root = doc?.kanjivg ?? doc?.svg ?? doc;
  const kanjiNodes = asArray<{ "@_id"?: string; g?: GNode | GNode[] }>(root?.kanji);
  const out = new Map<string, KanjiVgEntry>();
  for (const node of kanjiNodes) {
    const id = node["@_id"];
    // Skip variant glyphs (e.g. -Kaisho, -VarJP); keep only the base entry.
    if (id && /kvg:kanji_[0-9a-fA-F]+-/.test(id)) continue;
    const character = charFromKanjiId(id);
    if (!character) continue;
    const paths: PathNode[] = [];
    const radical = { value: null as string | null };
    for (const g of asArray(node.g)) walk(g, paths, radical);
    const strokes = paths
      .filter((p) => typeof p["@_d"] === "string")
      .sort((a, b) => strokeNumber(a["@_id"]) - strokeNumber(b["@_id"]))
      .map((p) => p["@_d"] as string);
    if (strokes.length === 0) continue;
    out.set(character, { strokes, radical: radical.value });
  }
  return out;
}

// ---- KANJIDIC2 (meanings + readings + grade) -------------------------------

export type KanjiDicEntry = {
  meanings: string[];
  on: string[];
  kun: string[];
  grade: number | null;
};

type Reading = string | { "#text"?: string; "@_r_type"?: string };
type Meaning = string | { "#text"?: string; "@_m_lang"?: string };
type RmGroup = { reading?: Reading | Reading[]; meaning?: Meaning | Meaning[] };
type CharacterNode = {
  literal?: string;
  misc?: { grade?: number | string };
  reading_meaning?: { rmgroup?: RmGroup | RmGroup[] };
};

function readingText(r: Reading): { text: string; type: string | undefined } {
  if (typeof r === "string") return { text: r, type: undefined };
  return { text: r["#text"] ?? "", type: r["@_r_type"] };
}

// English meanings only: plain strings, or objects without an m_lang attribute.
function englishMeaning(m: Meaning): string | null {
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && m["@_m_lang"] == null) return m["#text"] ?? null;
  return null;
}

export function parseKanjiDic(xml: string): Map<string, KanjiDicEntry> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "character" || name === "rmgroup" || name === "reading" || name === "meaning",
  });
  const doc = parser.parse(xml);
  const chars = asArray<CharacterNode>(doc?.kanjidic2?.character);
  const out = new Map<string, KanjiDicEntry>();
  for (const c of chars) {
    const character = c.literal;
    if (typeof character !== "string") continue;
    const gradeRaw = c.misc?.grade;
    const grade = gradeRaw == null ? null : Number(gradeRaw);
    const on: string[] = [];
    const kun: string[] = [];
    const meanings: string[] = [];
    for (const rm of asArray(c.reading_meaning?.rmgroup)) {
      for (const r of asArray(rm.reading)) {
        const { text, type } = readingText(r);
        if (!text) continue;
        if (type === "ja_on") on.push(text);
        else if (type === "ja_kun") kun.push(text);
      }
      for (const m of asArray(rm.meaning)) {
        const en = englishMeaning(m);
        if (en) meanings.push(en);
      }
    }
    out.set(character, { meanings, on, kun, grade: Number.isFinite(grade) ? grade : null });
  }
  return out;
}
