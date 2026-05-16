import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";

type Tokenizer = {
  tokenize(text: string): Array<{
    surface_form: string;
    reading?: string;
    pos?: string;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_DIR = path.resolve(__dirname, "../../node_modules/kuromoji/dict");

let cached: Tokenizer | null = null;

export async function getTokenizer(): Promise<Tokenizer> {
  if (cached) return cached;
  const build = promisify((cb: (err: Error | null, t: Tokenizer | undefined) => void) => {
    kuromoji.builder({ dicPath: DICT_DIR }).build(cb);
  });
  const t = await build();
  if (!t) throw new Error("kuromoji failed to build tokenizer");
  cached = t;
  return t;
}

const KATAKANA_TO_HIRAGANA = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const HAS_KANJI = /[一-龯]/;

export async function toRubyHtml(text: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(text);
  let out = "";
  for (const t of tokens) {
    if (HAS_KANJI.test(t.surface_form) && t.reading) {
      const hira = KATAKANA_TO_HIRAGANA(t.reading);
      out += `<ruby>${escapeHtml(t.surface_form)}<rt>${escapeHtml(hira)}</rt></ruby>`;
    } else {
      out += escapeHtml(t.surface_form);
    }
  }
  return out;
}

export async function readingFor(word: string): Promise<string> {
  const tok = await getTokenizer();
  const tokens = tok.tokenize(word);
  return tokens.map((t) => t.reading ? KATAKANA_TO_HIRAGANA(t.reading) : t.surface_form).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
