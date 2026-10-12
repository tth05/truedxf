"""Keep the `test` column of docs/questions.md in sync with the cases' `questions` fields.

The table rows look like ``| Q-0001 | topic | question | source | test | status |``. Only the test
column is rewritten; every other byte of the file is preserved. A case claims a question by
listing its id in ``s.case(..., questions=[...])``.
"""

from __future__ import annotations

import re
from pathlib import Path

from .core import build_suite

ROW_RE = re.compile(r"^\|\s*(Q-\d{4})\s*\|")
CELL_SPLIT = re.compile(r"(?<!\\)\|")
MAX_IDS = 4


def _case_map(suite_names: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for name in suite_names:
        for c in build_suite(name).cases:
            for q in c.questions:
                out.setdefault(q, []).append(c.id)
    return out


def _fmt(ids: list[str], planned: str) -> str:
    if not ids:
        return planned
    # collapse numbered variants: suite/foo-0001, suite/foo-0002 -> suite/foo-*
    groups: dict[str, int] = {}
    for i in ids:
        key = re.sub(r"-\d{4}$", "-*", i)
        groups[key] = groups.get(key, 0) + 1
    keys = list(groups)
    shown = ", ".join(f"`{k}`" for k in keys[:MAX_IDS])
    if len(keys) > MAX_IDS:
        shown += f" (+{len(keys) - MAX_IDS} more)"
    return shown


def known_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if m:
            ids.add(m.group(1))
    return ids


def duplicate_ids(path: Path) -> list[str]:
    seen: set[str] = set()
    dups: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if m:
            (dups if m.group(1) in seen else seen).add(m.group(1))
    return sorted(dups)


def _hand_written(cell: str, suite_names: list[str]) -> bool:
    """True if the cell names cases outside the registry (standalone probe scripts, corpus
    references) or is free text, so it cannot be regenerated."""
    if cell in ("", "—"):
        return False
    ids = re.findall(r"`([^`]*)`", cell)
    return not ids or any(i.split("/", 1)[0] not in suite_names for i in ids)


def update_questions(path: Path, suite_names: list[str]) -> int:
    # A case claims a question by id, so a duplicated id would write its cases into both rows.
    dups = duplicate_ids(path)
    if dups:
        print(f"duplicate question ids, renumber them first: {dups}")
        return 1
    cmap = _case_map(suite_names)
    text = path.read_text(encoding="utf-8")
    ids = known_ids(path)
    unknown = sorted(q for q in cmap if q not in ids)
    if unknown:
        print(f"cases reference unknown question ids: {unknown}")
    lines = text.split("\n")
    covered = 0
    for i, line in enumerate(lines):
        m = ROW_RE.match(line)
        if not m:
            continue
        cells = CELL_SPLIT.split(line)  # escaped pipes (\|) stay inside cells
        # ['', ' Q-0001 ', ' topic ', ' question ', ' source ', ' test ', ' status ', '']
        if len(cells) < 8:
            continue
        test_cell = cells[-3].strip()
        # Questions without registry cases keep a hand-written cell: a "plan:" note (e.g.
        # "plan: needs custom CTB") or references to probe-script / corpus cases. A cell that
        # only lists registry cases is stale and regenerated.
        keep = test_cell.startswith("plan:") or _hand_written(test_cell, suite_names)
        planned = test_cell if keep else "—"
        q = m.group(1)
        new = _fmt(cmap.get(q, []), planned)
        if cmap.get(q):
            covered += 1
        cells[-3] = f" {new} "
        lines[i] = "|".join(cells)
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"{covered}/{len(ids)} questions have at least one case")
    return 1 if unknown else 0
