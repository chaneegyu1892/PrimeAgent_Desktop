---
name: prime-pdf
description: Read, extract, merge or generate PDF documents and inspect page layout.
---

# PDF 읽기·제작

1. Load prime-artifacts. Inspect metadata, page count, rotation and whether text is selectable. Use pypdf for extraction/merge and reportlab for authored pages.
2. For scans, use an installed OCR engine and label uncertain text; extraction without OCR is not a reliable read of a scanned page. Inspect images/tables visually when needed.
3. When generating, use explicit page geometry, margins, embedded fonts covering the output language, line wrapping and page breaks. Avoid fonts lacking Korean glyphs.
4. Reopen the saved PDF, verify pages and required text, render with an available PDF renderer and inspect each page. Never claim visual QA if rendering was not done.
5. Provide the actual PDF and state any OCR, form-field or rendering limitations.
