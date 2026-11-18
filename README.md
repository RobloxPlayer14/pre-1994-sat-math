# Pre-1994 SAT Mathematics

A free practice platform built around **authentic questions from released pre-1994 SATs**:
topic practice, timed section simulations scored with the original formula and
conversion tables, an explanation for every question, and performance analytics.

It is a static site (HTML + CSS + JavaScript modules, no build step), hosted for free
on GitHub Pages. Progress is stored in the visitor's browser.

## How authentic questions are shown

The released tests are copyrighted by the College Board / ETS, so this repository does
**not** contain their printed pages or question text. It contains only:

| File | What it holds |
| --- | --- |
| `data/tests/form-*.json` | answer key, topic tags, estimated difficulty, explanations written for this site, the official raw→scaled conversion table, and a **page map** (where each question, figure and shared stem sits on each page) |
| `data/catalog.json` | the list of supported forms and the SHA-256 fingerprint of each booklet scan |
| `data/original.json` | original practice questions written for this site — always labelled *Original practice*, never presented as SAT questions |

A student loads their own scanned PDF of a booklet on the **Booklets** page. It is kept
in the browser's IndexedDB (never uploaded), and PDF.js crops each question straight
from the scan using the page map — so questions appear exactly as printed, with no OCR
transcription errors.

Currently supported: **Forms 4I, 5D, 5E and 5X** (Tests 2–5 of the same released series),
2 math sections each (25 + 35 questions) = **240 authentic questions**.

## Features

- Practice: quick sets, unseen questions, mistake review, weakest-topic drill, 20 topic sets,
  and a custom builder (source, topics, format, difficulty, status, count, order, feedback, timer)
- Exams: full 60-minute math simulation (both sections) or a single 30-minute section,
  original directions shown from the booklet, navigation grid, flags, auto-submit at time-up
- Scoring: 1980s formula scoring (right − ¼ wrong for 5-choice, − ⅓ wrong for quantitative
  comparison, omits = 0, round half up) converted with each form's printed table
- Review: every question with your answer, the key, time spent and the explanation
- Analytics: accuracy by topic / area / difficulty / format, focus areas, mistake notebook,
  per-session trend, exam score history, activity heat-map, pacing, projected SAT-M
- Question bank browser with filters; single-question practice
- Export / import progress (JSON), light / dark theme, keyboard shortcuts

## Run locally

```bash
python -m http.server 8094
```

Then open <http://localhost:8094>. (Opening `index.html` from disk does not work because
browsers block module and JSON loading from `file://`.)

## Tests

```bash
npm test
```

Runs the unit tests (scoring, selection, analytics, sessions, formatter) and validates every
data file: 25/35 questions per section, valid answer letters for each format, page regions
within bounds, known topics, monotonic conversion tables reaching 800 at the maximum raw score,
an explanation for every authentic question, and no stray control characters.

## Adding more tests (the pipeline)

Everything runs offline and free (Python 3, `pip install pymupdf rapidocr_onnxruntime pillow numpy`).

1. **OCR** — `python pipeline/ocr_pdf.py <booklet.pdf>`
   Reads the header strip of every page to find the 25- and 35-question math sections, the
   answer-key page and the conversion table, then OCRs those pages fully. Results are cached
   in `pipeline/work/<sha>/` (git-ignored: it contains test text).
2. **Segment** — `python pipeline/segment.py <booklet.pdf>`
   Finds each page's columns, the directions boxes, every question number (OCR, a gutter
   re-read, and a shape-based fallback, kept consistent with a longest-increasing-sequence
   check), figures that sit "above" a question, and shared stems ("Questions 8–9 refer to…").
   Writes `geometry.json` plus `overlay-pXX.png` images — **look at every overlay**.
3. **Metadata** — create `pipeline/meta/form-<code>.json` with the answer key and conversion
   table transcribed from the booklet (see the existing files), and add topic tags and
   explanations with `python pipeline/merge_meta.py <code> <fragment.json>`.
   A region can be corrected by hand by giving a question a `"regions"` override.
4. **Build** — `python pipeline/build_tests.py` writes `data/tests/form-<code>.json` and
   `data/catalog.json`. Then run `npm test`.

Answers always come from the official key; if a worked solution disagrees with the key,
add `"flags": ["answer-check"]` to the question instead of changing the answer.

## Deploying

The site is plain static files. GitHub Pages serves the repository root from the `main`
branch (Settings → Pages → Deploy from a branch → `main` / root).

## Credits

- PDF rendering: [PDF.js](https://github.com/mozilla/pdf.js) 6.5.438 (Apache-2.0), vendored in `vendor/pdfjs/`
- OCR (pipeline only): [RapidOCR](https://github.com/RapidAI/RapidOCR) (Apache-2.0)
- SAT is a registered trademark of the College Board, which is not affiliated with this site.
