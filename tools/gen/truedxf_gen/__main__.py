"""CLI: python -m truedxf_gen [--suite S ...] [--case GLOB] [--list] [--clean] [--out DIR]
[--no-audit] [--check-determinism] [--update-questions]"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ezdxf creates some objects (e.g. LAYOUT vs ACDBPLACEHOLDER) in set-iteration order, which depends
# on str hashing. Fixed output bytes need a fixed hash seed: re-run ourselves with PYTHONHASHSEED=0.
if __name__ == "__main__" and os.environ.get("PYTHONHASHSEED") != "0":
    _env = dict(os.environ, PYTHONHASHSEED="0")
    _pkg_parent = str(Path(__file__).resolve().parents[1])
    _env["PYTHONPATH"] = os.pathsep.join(p for p in (_pkg_parent, os.environ.get("PYTHONPATH")) if p)
    sys.exit(subprocess.run([sys.executable, "-m", "truedxf_gen", *sys.argv[1:]], env=_env).returncode)

import ezdxf  # noqa: E402

from . import suites  # noqa: E402,F401  (registers all suites)
from .core import DEFAULT_OUT, REGISTRY, REPO_ROOT, build_suite, json_bytes


def _select_suites(names: list[str] | None) -> list[str]:
    if not names:
        return list(REGISTRY)
    out: list[str] = []
    for n in names:
        for part in n.split(","):
            part = part.strip()
            if not part:
                continue
            matched = [s for s in REGISTRY if fnmatch.fnmatchcase(s, part)]
            if not matched:
                raise SystemExit(f"unknown suite {part!r}; use --list")
            out.extend(m for m in matched if m not in out)
    return out


def _audit(data: bytes, encoding: str) -> tuple[list[str], list[str]]:
    doc = ezdxf.read(io.StringIO(data.decode(encoding)))
    auditor = doc.audit()
    errors = [f"{e.code}: {e.message}" for e in auditor.errors]
    fixes = [f"{e.code}: {e.message}" for e in auditor.fixes]
    return errors, fixes


def generate(
    suite_names: list[str],
    out: Path,
    case_glob: str | None,
    clean: bool,
    audit: bool,
    quiet: bool = False,
) -> int:
    failures = 0
    total = 0
    for name in suite_names:
        t0 = time.perf_counter()
        sb = build_suite(name)
        sdir = out / name
        if clean and sdir.exists():
            shutil.rmtree(sdir)
        sdir.mkdir(parents=True, exist_ok=True)
        n = 0
        for c in sb.cases:
            if case_glob and not fnmatch.fnmatchcase(c.name, case_glob):
                continue
            c.validate_meta()
            data = c.dxf_bytes()
            (sdir / f"{c.name}.dxf").write_bytes(data)
            (sdir / f"{c.name}.json").write_bytes(json_bytes(c.meta()))
            for fname, fdata in c.extra_files.items():
                (sdir / fname).write_bytes(fdata)
            if audit:
                errors, fixes = _audit(data, c.doc.output_encoding)
                if errors:
                    failures += 1
                    print(f"AUDIT ERROR {c.id}: {errors}", file=sys.stderr)
                elif fixes and not quiet:
                    print(f"audit fixes {c.id}: {fixes[:3]}", file=sys.stderr)
            n += 1
        total += n
        if not quiet:
            print(f"{name:20s} {n:5d} cases  {time.perf_counter() - t0:6.1f}s  -> {sdir}")
    if not quiet:
        print(f"total {total} cases, {failures} audit failures")
    return 1 if failures else 0


def _digest_tree(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def check_determinism(suite_names: list[str]) -> int:
    """Generate the suites twice in fresh processes and compare all output bytes."""
    digests = []
    with tempfile.TemporaryDirectory(prefix="truedxf-gen-") as tmp:
        for i in range(2):
            d = Path(tmp) / f"run{i}"
            env = dict(os.environ, PYTHONHASHSEED="0")
            args = [sys.executable, "-m", "truedxf_gen", "--no-audit", "--quiet", "--out", str(d)]
            for s in suite_names:
                args += ["--suite", s]
            subprocess.run(args, check=True, env=env, cwd=str(Path(__file__).resolve().parents[1]))
            digests.append(_digest_tree(d))
    a, b = digests
    bad = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    if bad:
        print(f"NOT deterministic: {len(bad)} files differ, e.g. {bad[:10]}")
        return 1
    print(f"deterministic: {len(a)} files identical across two runs")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="truedxf_gen", description=__doc__)
    ap.add_argument("--suite", "-s", action="append", help="suite name/glob (repeatable, or comma list)")
    ap.add_argument("--case", help="only cases whose name matches this glob")
    ap.add_argument("--list", action="store_true", help="list suites (with --verbose: cases)")
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--clean", action="store_true", help="delete the selected suite folders first")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output root (default {DEFAULT_OUT})")
    ap.add_argument("--no-audit", action="store_true", help="skip the ezdxf audit of written files")
    ap.add_argument("--quiet", "-q", action="store_true")
    ap.add_argument("--check-determinism", action="store_true", help="generate twice and compare bytes")
    ap.add_argument("--update-questions", action="store_true", help="rewrite the test column of docs/questions.md")
    args = ap.parse_args(argv)

    names = _select_suites(args.suite)
    if args.list:
        total = 0
        for n in names:
            info = REGISTRY[n]
            sb = build_suite(n)
            total += len(sb.cases)
            print(f"{n:20s} {len(sb.cases):5d}  {info.style_table:15s} {info.title}")
            if args.verbose:
                for c in sb.cases:
                    print(f"    {c.name:40s} {c.title}")
        print(f"{'total':20s} {total:5d}")
        return 0
    if args.check_determinism:
        return check_determinism(names)
    if args.update_questions:
        from .questions import update_questions

        return update_questions(REPO_ROOT / "docs" / "questions.md", list(REGISTRY))
    return generate(names, args.out, args.case, args.clean, not args.no_audit, args.quiet)


if __name__ == "__main__":
    sys.exit(main())
