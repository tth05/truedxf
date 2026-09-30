# Samples (local only)

Everything in this directory except this README is gitignored and must never be committed.

- `external/`: DXF/DWG files collected from reference repos and GitHub issue attachments (~3 GB,
  mixed or unknown licenses). `external/manifest.jsonl` records source, license, sha256, version,
  entity counts; `external/COVERAGE.md` summarises coverage.
  Rebuild: `bash research/scripts/clone_repos.sh && bash research/scripts/dump_all.sh`.
- `generated/`: feature fixtures from `tools/gen` (reproducible from generator + seed).
- `refs/`: AutoCAD reference outputs from `tools/acad` (PNG/PDF/DXF/log per case and AutoCAD build).
