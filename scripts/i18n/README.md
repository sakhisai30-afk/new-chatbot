# Translation workflow (8 languages)

Languages: en, de, zh, ko, ja, ru, es, fr.

| File | Purpose |
|---|---|
| `en.flat.json` | English source - 108 keys |
| `translations/<code>.json` | One file per language, same 108 keys |
| `build-locales.mjs` | Writes `src/locales/<code>/translation.json` (what the app loads) |
| `validate-i18n.mjs` | Automatic checks (keys, placeholders, names, script, up-to-date) |
| `make-workbook.py` | Creates `ZuiGO-translation-check.xlsx` for Google Sheets cross-checking |

## Change or add text
1. Edit `en.flat.json` (new/changed English) and the matching line in every `translations/<code>.json`.
2. `npm run i18n:build`
3. `npm run i18n:validate`  - must print "All languages passed".
4. Optional: `python3 scripts/i18n/make-workbook.py`, upload to Google Sheets, compare columns C, D, E.

## Honest status
The translations were written by an AI (Claude), not by a native speaker, and not by Google Translate.
They pass the automatic checks, but a native speaker should read the chat-facing answers before production use.

## Not translated on purpose
Company/product names, technology names, the e-mail address, the street address and URLs stay as written.
Free-typed questions are answered by the AI model in the chosen language (quality depends on the model).
