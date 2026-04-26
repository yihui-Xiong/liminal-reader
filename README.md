# Liminal Reader

A distraction-free reading extension for Chrome. Transform any article into a clean, focused reading experience with customizable modes, a structured Study mode, and built-in note-taking.

---

## Features

- **Full mode**  distraction-free overlay with font, line height, and theme controls
- **Paragraph mode**  one paragraph at a time with progress tracking
- **Sentence mode**  sentence-by-sentence navigation for dense material
- **Study mode**  two-phase reading (Skim to Thorough) with a check-in on exit
- **Notes panel**  floating notes linked to paragraphs, exportable as .txt
- Works on articles, Wikipedia, blogs, academic pages, and most readable web content

---

## Setup

1. Clone or download this repo
2. Open Chrome and go to chrome://extensions
3. Enable Developer mode (top-right toggle)
4. Click Load unpacked and select this folder
5. Navigate to any article and click the Liminal Reader icon in the toolbar

---

## File structure

liminal-reader/
  manifest.json
  background.js       - service worker, session logging, script injection
  content_script.js   - Readability extraction, shadow DOM setup
  reader.js           - overlay UI, toolbar, settings panel
  modes.js            - Full, Paragraph, Sentence, Study mode logic
  phases.js           - Skim/Thorough phase switching within Study mode
  logger.js           - event tracking, notes export
  reader.css          - base styles loaded into shadow DOM
  Readability.js      - Mozilla Readability (article extraction)
  icons/
    icon16.png
    icon48.png
    icon128.png

---

## Privacy
Liminal Reader collects no user data. All preferences are stored locally 
via Chrome's synced storage and never transmitted anywhere.

- Google Docs, Sheets, Slides, and Figma are not supported (canvas-based rendering)
- Readability.js is from Mozilla's open source library: https://github.com/mozilla/readability
