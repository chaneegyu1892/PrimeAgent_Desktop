---
name: prime-data
description: Analyze CSV, JSON, tables or datasets, clean data and create reproducible plots.
---

# 데이터 분석

1. Inspect schema, size, provenance, time range, units and missing/duplicate values before calculating. Keep source data immutable.
2. Load prime-artifacts. Use pandas for data work and matplotlib for reproducible plots. Define each metric's numerator, denominator, filters and timezone.
3. Validate aggregates against small hand-checked samples and row counts. Separate correlation from causation; identify unmeasured populations and uncertainty.
4. Make legible charts with labeled axes, units, source/time coverage and accessible colors. Save data, calculations and figures to the output directory.
5. Rerun the calculation from saved inputs and inspect the exported artifacts. Report supported conclusions with specific caveats, not unsupported business claims.
