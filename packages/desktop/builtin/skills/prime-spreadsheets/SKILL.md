---
name: prime-spreadsheets
description: Create, analyze or edit Excel workbooks, formulas, tables, financial models and charts.
---

# 스프레드시트

1. Inspect sheets, headers, formulas, named ranges and styles. Identify the authoritative input cells, units and period; preserve an original copy.
2. Load prime-artifacts and use openpyxl. Keep formulas as formulas, use number/date formats, freeze panes, meaningful column widths and clear input/output styles.
3. Validate formulas against independently computed sample cases. openpyxl does not calculate formulas: recalculate with an available spreadsheet engine, or explicitly report that cached results are not recalculated.
4. Check row counts, totals, duplicates, missing values, boundary cases and exported ranges. Guard CSV strings beginning with formula characters when exporting untrusted text.
5. Reopen the final workbook and inspect representative sheets. Link the workbook, state assumptions and identify values requiring refreshed source data.
