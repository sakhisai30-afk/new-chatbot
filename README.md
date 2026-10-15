# ZuiGO Website Chatbot — Gemini + RAG prototype

React + Vite frontend and Express backend for answering natural-language questions about verified ZuiGO website content.

## Architecture

1. React sends `{ message, history, language }` to `POST /api/chat`.
2. Express validates the request and applies rate limits.
3. The backend loads snapshots in `data/website_extraction/`, splits them into retrieval chunks, and embeds them using Gemini's embedding API.
4. It retrieves up to five relevant chunks by cosine similarity.
5. Gemini generates an answer in the selected language using the retrieved evidence and recent conversation history.
6. The backend validates returned chunk IDs and constructs source links from trusted snapshot metadata.
7. React displays the answer and source-page links.

This is LLM-based natural-language answering, not keyword-based matching for each user question. Ordinary application rules remain for security, validation, fixed navigation/actions, and unsupported-answer fallbacks.

## Setup

1. Install a current Node.js LTS release.
2. Open this `zuigo-chatbot` folder in VS Code.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Create an API key in Google AI Studio and put it in `.env` as `GEMINI_API_KEY=...`.
6. Check the current Gemini API pricing and model availability before use. Defaults can be overridden using `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL`.
7. Optional: set `GEMINI_MAX_RETRIES=3` and `GEMINI_RETRY_BASE_MS=800` in `.env` to configure retries for temporary Gemini capacity/rate-limit/network failures. Defaults are 3 retries with exponential delays (800ms, 1600ms, 3200ms).
8. Run `npm run dev`.
9. Open `http://localhost:5173`.

The backend runs on `http://localhost:3001`; Vite proxies `/api` requests to it. The first chat request may take longer because it generates and caches embeddings for the verified website snapshots. The cache is stored under `data/.rag-cache/` and is excluded from Git.

## Language support

The chat UI lets users select English, German, Chinese, Korean, Japanese, Russian, Spanish, or French. The selected language is passed to Gemini. Cross-language retrieval and answer quality must be tested; language selection does not guarantee perfect translation or retrieval.

## Knowledge source and address note

Only timestamped files under `data/website_extraction/` are used as RAG source material. The extraction snapshots should be revalidated whenever the source website changes. The Runwal Platinum address is not part of the verified website snapshots and should not be represented as website-verified unless it is later added as an approved trusted source.

## Important production work still required

- Run the test suite and manual checks in an environment with a valid Gemini API key.
- Add robust relevance evaluation and tune `RAG_MIN_SIMILARITY` against a labeled question set.
- Verify cross-language retrieval for all eight languages.
- Configure HTTPS/TLS and deployment secrets.
- Configure actual lead delivery; `/api/lead` currently returns `501` rather than pretending an email was sent.
- Add malware scanning before accepting uploads in production.
- Review privacy, logging, retention, and abuse protections before deployment.

Never commit `.env` or expose `GEMINI_API_KEY` in frontend code.


## Gemini temporary-failure handling

The backend retries temporary Gemini `429`, `500`, `502`, `503`, and `504` errors, plus common transient network errors, for both embeddings and answer generation. It does not retry permanent errors such as invalid API keys. Retry attempts and the underlying error are logged in the backend terminal. A detected Gemini `503 UNAVAILABLE` is surfaced in the UI as a temporary-busy message rather than the generic safety fallback. Retries can reduce transient failures but cannot guarantee Google's service availability.

## Local embeddings (no Gemini needed for search)

Search now runs on your own computer with `Xenova/bge-small-en-v1.5` via `@huggingface/transformers`.
- First start downloads the model (~35-130 MB) from huggingface.co once, then it is cached.
- Gemini is only used to write the final answer. If Gemini fails (404, quota, busy), the chatbot shows the best-matching ZuiGO website text instead.
- If Gemini returns 404, list the models your key can use: `https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY` and put a name in `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` in `.env`.
- Search uses `Xenova/bge-small-en-v1.5` (unchanged from v6). Typed questions in other languages are answered by the model in that language.
- If good questions get "couldn't find", lower `RAG_MIN_SIMILARITY` (try 0.35).

## Answer modes
- `ANSWER_MODE=local` (in `.env`): never calls Gemini. Search runs locally and the chatbot shows the best-matching ZuiGO website text with its source link. Free, no key, fastest.
- `ANSWER_MODE=auto` (default): uses Gemini to write the answer when `GEMINI_API_KEY` is set. If Gemini fails (404, quota), it pauses Gemini for 1-10 minutes and shows website text instead.

## Using Ollama (local GPU model writes the answers)
1. Install Ollama from https://ollama.com and make sure it is running (the desktop app starts it, or run `ollama serve`).
2. Download a model once: `ollama pull llama3.2:3b` (fast, about 2 GB). Better quality if your GPU has 8 GB+ VRAM: `ollama pull qwen2.5:7b` or `ollama pull llama3.1:8b`, then set `OLLAMA_MODEL` in `.env`.
3. In `.env` set `ANSWER_MODE=ollama` (and `OLLAMA_MODEL=...`). No Gemini key is needed.
4. `npm install`, then `npm run dev`. Look for `[Ollama] model ... loaded` and `[RAG] index ready`.
Search still runs locally with bge-small. If Ollama is stopped or the model is missing, the chatbot shows the best-matching website text and the terminal prints the exact fix.


## Multilingual (8 languages)
Languages: English, German, Chinese, Korean, Japanese, Russian, Spanish, French. Pick one in the drop-down at the top of the page (or in the chat menu). The choice is remembered.

- **UI text, buttons, menu, service answers**: `i18next` + `react-i18next`. Files: `src/locales/<code>/translation.json`. Every message and button is stored as a key, so changing the language re-translates the whole conversation.
- **AI answers (typed questions)**: the chosen language is sent to `/api/chat`; the model is told to answer in that language, using the English website text as evidence.
- **Source of the translations**: `scripts/i18n/en.flat.json` (English) + `scripts/i18n/translations/<code>.json`. After editing either, run:
  - `npm run i18n:build`  - regenerates `src/locales/*`
  - `npm run i18n:validate` - checks keys, `{{placeholders}}`, line breaks, product names/address/e-mail unchanged, and that zh/ja/ko/ru actually contain that script
- Cross-check in Google Sheets: open `ZuiGO-translation-check.xlsx` in Google Sheets (see `scripts/i18n/README.md`).
- Note: Llama 3.2 officially supports de, fr, es (and others) but is weaker for zh, ja, ko, ru. If typed answers in those languages look poor, try `OLLAMA_MODEL=qwen2.5:3b` (check its licence for your use).
