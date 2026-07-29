# Kanji seed data

The kanji importer merges two openly-licensed datasets (see the repo-root
`NOTICE` for licenses/attribution). The raw source files are **not committed**
here — download them, then run the importer, which parses them into the `kanji`
reference table + `kanji`-skill items.

## 1. Download the sources

```sh
cd seed/data

# KanjiVG — ordered stroke paths (CC BY-SA 3.0)
curl -L -o kanjivg.xml.gz \
  https://github.com/KanjiVG/kanjivg/releases/latest/download/kanjivg.xml.gz

# KANJIDIC2 — meanings + readings + grade (EDRDG / CC BY-SA 4.0)
curl -L -o kanjidic2.xml.gz http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
```

## 2. (Optional) JLPT level mapping

The importer scopes to the jōyō set (KANJIDIC2 grade 1–8, ~2,136 kanji). To
populate the `jlpt` column, provide a CSV of `character,level` rows
(`食,N4`) — e.g. `seed/data/jlpt-kanji.csv`. Without it, `jlpt` stays null and
kanji are still fully usable (browse/practice by grade).

## 3. Import (idempotent — safe to re-run)

```sh
npm --workspace seed run import:kanji \
  seed/data/kanjivg.xml.gz seed/data/kanjidic2.xml.gz seed/data/jlpt-kanji.csv
```

Requires `DATABASE_URL`. Unlike the vocab importer, no `ANTHROPIC_API_KEY` is
needed — kanji content comes entirely from the datasets.
