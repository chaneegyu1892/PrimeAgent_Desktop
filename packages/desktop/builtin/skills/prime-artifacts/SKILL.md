---
name: prime-artifacts
description: Access the managed Python libraries for Word, Excel, PowerPoint, PDF, images and data; verify exported artifact structure and toolkit readiness.
---

# Artifact toolkit

The Prime kernel installs this Python-backed Skill's pinned dependencies into its managed environment on first kernel setup. With a custom PRIME_AGENT_KERNEL_PYTHON, dependencies must already be present. Call `prime_artifacts.status()` to inspect installed versions and available renderers. A missing dependency is setup required, never a successful export.

Use these public libraries in ipython: `docx`, `openpyxl`, `pptx`, `pypdf`, `reportlab`, `pandas`, `matplotlib`, `PIL`. Load the task-specific prime-documents, prime-spreadsheets, prime-presentations, prime-pdf or prime-data Skill for its workflow. Use `/skill:prime-artifacts` to request toolkit setup or diagnostics explicitly.

Call `prime_artifacts.inspect_file('/absolute/output/path')` after writing a DOCX, XLSX, PPTX, PDF, CSV or image. It reopens the actual artifact and reports structural information. This is structural validation, not a rendered preview. Inspect rendered output with an available renderer/browser before claiming visual verification. Korean PDFs require an installed font covering Hangul.

Write artifacts into the selected project or an explicit user output directory. Preserve originals when editing supplied documents. Link actual generated files in the final answer.
