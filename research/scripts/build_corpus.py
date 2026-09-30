"""Collect DXF/DWG sample files into samples/external and index them.

Sources:
  research/repos/<repo>/**                     cloned reference libraries
  research/github/downloads/<owner__repo>/**   attachments from issues/PRs (see fetch_attachments.py)

Output:
  samples/external/files/<source>/<path>   copied files (duplicates by sha256 are stored once)
  samples/external/manifest.jsonl          one record per unique file
  samples/external/COVERAGE.md             entity/version coverage statistics

Usage: python build_corpus.py
"""
import collections
import hashlib
import json
import pathlib
import re
import shutil
import sys

RESEARCH = pathlib.Path(__file__).resolve().parent.parent
PROJECT = RESEARCH.parent
OUT = PROJECT / "samples" / "external"
FILES = OUT / "files"

# license of files taken from each cloned repo (checked against the repos' LICENSE files)
REPO_LICENSES = {
    "ezdxf": "MIT", "dxf-viewer": "MPL-2.0", "dxf-viewer-example": "MIT", "dxf-parser": "MIT",
    "three-dxf": "MIT", "bjnortier-dxf": "MIT", "dxf-json": "GPL-3.0", "libdxfrw": "GPL-2.0",
    "ACadSharp": "MIT", "netDxf": "MIT", "ixmilia-dxf": "MIT", "ixmilia-dxf-rs": "MIT", "tarikjabiri-dxf": "MIT",
    "mlightcad-cad-viewer": "MIT", "mlightcad-realdwg-web": "MIT", "libredwg": "GPL-3.0",
    "LibreCAD": "GPL-2.0", "qcad": "GPL-3.0", "gdal": "MIT", "FreeCAD": "LGPL-2.1", "jscad-sample-files": "MIT",
}
EXTS = {".dxf", ".dwg", ".dxb"}
ACADVER = {
    "AC1006": "R10", "AC1009": "R12", "AC1012": "R13", "AC1014": "R14", "AC1015": "R2000",
    "AC1018": "R2004", "AC1021": "R2007", "AC1024": "R2010", "AC1027": "R2013", "AC1032": "R2018",
}
MAX_SCAN = 200 * 1024 * 1024


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tags(text):
    """Yield (code, value) pairs of an ASCII DXF, tolerant to junk."""
    lines = text.splitlines()
    i = 0
    n = len(lines) - 1
    while i < n:
        c = lines[i].strip()
        try:
            code = int(c)
        except ValueError:
            i += 1
            continue
        yield code, lines[i + 1].strip()
        i += 2


def analyze_dxf(path, info):
    data = path.read_bytes()
    if data.startswith(b"AutoCAD Binary DXF"):
        info["format"] = "binary-dxf"
        m = re.search(rb"\$ACADVER.{0,8}?(AC10\d\d)", data[:4096], re.S)
        if m:
            info["acadver"] = m.group(1).decode()
        return
    info["format"] = "ascii-dxf"
    if data.startswith(b"\xef\xbb\xbf"):
        info["bom"] = True
    if len(data) > MAX_SCAN:
        info["skipped_scan"] = True
        return
    text = data.decode("latin-1")
    section = None
    prev = None
    header_var = None
    entities = collections.Counter()
    block_entities = collections.Counter()
    objects = collections.Counter()
    tables = collections.Counter()
    appids, comments, classes = [], [], []
    header = {}
    in_table = None
    for code, value in tags(text):
        if code == 999 and len(comments) < 5:
            comments.append(value[:200])
        if code == 0:
            if value == "SECTION":
                section = "?"
            elif value == "ENDSEC":
                section = None
            elif section == "ENTITIES":
                entities[value] += 1
            elif section == "BLOCKS" and value not in ("BLOCK", "ENDBLK"):
                block_entities[value] += 1
            elif section == "OBJECTS":
                objects[value] += 1
            elif section == "TABLES":
                if value == "TABLE":
                    in_table = "?"
                elif value == "ENDTAB":
                    in_table = None
                elif in_table:
                    tables[value] += 1
        elif code == 2 and section == "?":
            section = value.upper()
        elif section == "HEADER" and code == 9:
            header_var = value
        elif section == "HEADER" and header_var and header_var not in header:
            if header_var in ("$ACADVER", "$DWGCODEPAGE", "$INSUNITS", "$MEASUREMENT", "$ACADMAINTVER"):
                header[header_var] = value
        elif section == "TABLES" and prev == (0, "APPID") and code == 2:
            appids.append(value)
        elif section == "CLASSES" and code == 1:
            classes.append(value)
        if code == 0 or (code == 2 and prev and prev[0] == 0):
            prev = (code, value)
        elif code == 5 and prev and prev == (0, "APPID"):
            pass  # keep prev until the name (code 2) arrives
    info["acadver"] = header.get("$ACADVER")
    info["version"] = ACADVER.get(header.get("$ACADVER", ""), header.get("$ACADVER"))
    for k in ("$DWGCODEPAGE", "$INSUNITS", "$MEASUREMENT", "$ACADMAINTVER"):
        if k in header:
            info[k[1:].lower()] = header[k]
    info["entities"] = dict(entities.most_common())
    info["block_entities"] = dict(block_entities.most_common())
    info["objects"] = dict(objects.most_common())
    info["tables"] = dict(tables.most_common())
    info["appids"] = appids
    if classes:
        info["classes"] = classes
    if comments:
        info["comments"] = comments
    info["producer"] = guess_producer(info, text[:20000])


def guess_producer(info, head):
    ids = {a.upper() for a in info.get("appids", [])}
    comments = " ".join(info.get("comments", [])).lower()
    for needle, name in (("ezdxf", "ezdxf"), ("librecad", "LibreCAD"), ("qcad", "QCAD"), ("netdxf", "netDxf"),
                         ("acadsharp", "ACadSharp"), ("libredwg", "LibreDWG"), ("teigha", "ODA/Teigha"),
                         ("oda", "ODA"), ("inkscape", "Inkscape"), ("gdal", "GDAL"), ("freecad", "FreeCAD"),
                         ("solidworks", "SolidWorks"), ("inventor", "Inventor"), ("dxfwrite", "dxfwrite"),
                         ("draftsight", "DraftSight"), ("bricscad", "BricsCAD")):
        if needle in comments:
            return name
    if "LIBRECAD" in ids:
        return "LibreCAD"
    if "QCAD" in ids:
        return "QCAD"
    if "EZDXF" in ids:
        return "ezdxf"
    if "BRICSCAD" in ids or any(a.startswith("BRX") for a in ids):
        return "BricsCAD"
    if {"ACAD_PSEXT", "ACADANNOTATIVE"} & ids or "ACAD_MLEADERVER" in ids:
        return "AutoCAD-like"
    return None


def analyze_dwg(path, info):
    head = path.read_bytes()[:6]
    info["format"] = "dwg"
    ver = head.decode("latin-1", "replace")
    info["acadver"] = ver
    info["version"] = ACADVER.get(ver, ver)


def is_junk(f):
    """macOS resource forks from zips, and HTML pages saved instead of the attachment."""
    if "__MACOSX" in f.parts or f.name.startswith("._"):
        return True
    head = f.read_bytes()[:512].lstrip().lower()
    return head.startswith((b"<!doctype html", b"<html"))


def sources():
    repos = RESEARCH / "repos"
    for repo in sorted(p for p in repos.iterdir() if p.is_dir()):
        for f in repo.rglob("*"):
            if f.suffix.lower() in EXTS and f.is_file() and ".git" not in f.parts and not is_junk(f):
                yield f"repos/{repo.name}", f, f.relative_to(repo), {"license": REPO_LICENSES.get(repo.name, "unknown")}
    downloads = RESEARCH / "github" / "downloads"
    meta_file = downloads / "index.jsonl"
    meta = {}
    if meta_file.exists():
        for line in meta_file.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            meta[str(pathlib.PurePosixPath(r["local"]).parent)] = r  # per thread
    if downloads.exists():
        for f in downloads.rglob("*"):
            if f.suffix.lower() in EXTS and f.is_file() and not is_junk(f):
                rel = f.relative_to(downloads)
                top = rel.parts[0]
                m = meta.get(str(pathlib.PurePosixPath(*rel.parts[:2]))) or {}
                extra = {"license": "unknown (GitHub attachment, internal testing only)"}
                for k in ("thread", "title"):
                    if k in m:
                        extra[k] = m[k]
                yield f"github/{top}", f, pathlib.Path(*rel.parts[1:]), extra


def main():
    FILES.mkdir(parents=True, exist_ok=True)
    by_hash = {}
    for src, f, rel, extra in sources():
        h = sha256(f)
        origin = f"{src}/{rel.as_posix()}"
        if h in by_hash:
            by_hash[h].setdefault("duplicates", []).append(origin)
            continue
        dest = FILES / src / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
        info = {"path": dest.relative_to(OUT).as_posix(), "source": src, "origin": origin, "sha256": h,
                "size": f.stat().st_size, **extra}
        try:
            if f.suffix.lower() == ".dwg":
                analyze_dwg(f, info)
            else:
                analyze_dxf(f, info)
        except Exception as e:  # keep the file, note the problem
            info["error"] = repr(e)
        by_hash[h] = info
    records = sorted(by_hash.values(), key=lambda r: r["path"])
    with open(OUT / "manifest.jsonl", "w", encoding="utf-8") as fo:
        for r in records:
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")
    write_coverage(records)
    print(f"{len(records)} unique files", file=sys.stderr)


def write_coverage(records):
    fmt = collections.Counter(r.get("format") for r in records)
    ver = collections.Counter(r.get("version") or "?" for r in records)
    prod = collections.Counter(r.get("producer") or "?" for r in records if r.get("format") == "ascii-dxf")
    src = collections.Counter(r["source"] for r in records)
    ent_files = collections.Counter()
    ent_total = collections.Counter()
    obj_files = collections.Counter()
    for r in records:
        seen = collections.Counter(r.get("entities", {})) + collections.Counter(r.get("block_entities", {}))
        for e, n in seen.items():
            ent_files[e] += 1
            ent_total[e] += n
        for o in r.get("objects", {}):
            obj_files[o] += 1
    size = sum(r["size"] for r in records)
    out = ["# External sample corpus: coverage", "",
           "Generated by `research/scripts/build_corpus.py`. Files live in `files/` (gitignored, mixed licenses:",
           "see `license` in `manifest.jsonl`; GitHub attachments are for internal testing only).", "",
           f"**{len(records)} unique files, {size / 1e6:.1f} MB**", "",
           "## Formats", "", *(f"- {k}: {v}" for k, v in fmt.most_common()), "",
           "## Versions", "", *(f"- {k}: {v}" for k, v in ver.most_common()), "",
           "## Producer guess (ASCII DXF)", "", *(f"- {k}: {v}" for k, v in prod.most_common()), "",
           "## Sources", "", *(f"- {k}: {v}" for k, v in src.most_common()), "",
           "## Entity types (files containing / total count, ENTITIES + BLOCKS)", "",
           "| Entity | Files | Count |", "|---|---:|---:|",
           *(f"| {e} | {ent_files[e]} | {ent_total[e]} |" for e, _ in ent_files.most_common()), "",
           "## Object types (files containing)", "", "| Object | Files |", "|---|---:|",
           *(f"| {o} | {n} |" for o, n in obj_files.most_common())]
    (OUT / "COVERAGE.md").write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
