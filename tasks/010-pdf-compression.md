---
title: Offline PDF compression with multiple size alternatives
labels: [enhancement]
depends_on: [005, 006]
---

## Agent Brief

**Category:** enhancement  
**Summary:** Compress PDFs offline with several size/quality alternatives; write results into `_compressed`.

**Current behavior:**  
Job IPC and path rules exist; no PDF pipeline.

**Desired behavior:**  
Accept `.pdf` inputs. Alternatives trade image DPI / quality inside the PDF (e.g. print / ebook / screen). Use local libraries or bundled tools only. Encrypted/password PDFs fail with a clear error unless a password API is explicitly added (do not add password UI in this task — just fail clearly).

**Key interfaces:**
- Preset registry entries with `kind: "pdf"`
- PDF pipeline behind the job runner
- Output remains a valid PDF openable by common readers

**Acceptance criteria:**
- [ ] At least three PDF alternatives exist
- [ ] Output written under `_compressed`
- [ ] Works offline
- [ ] Invalid/encrypted PDFs fail without crashing
- [ ] Typical image-heavy PDFs shrink under “small” vs “high” presets (document exceptions)

**Out of scope:**
- PDF merging/splitting UI
- OCR
- Password entry UI
