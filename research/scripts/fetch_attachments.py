"""Download DXF/DWG sample attachments referenced in dumped GitHub threads.

Only GitHub-hosted attachments are downloaded (github.com/<o>/<r>/files/..., github.com/user-attachments/files/...,
raw.githubusercontent.com, gist). Links to other hosts are only listed in downloads/external_links.md.
Archives (.zip/.gz) are extracted; nothing is ever executed.

Output: research/github/downloads/<owner__repo>/<kind>-<number>/<file>  + downloads/index.jsonl
Usage: python fetch_attachments.py
"""
import concurrent.futures as cf
import gzip
import json
import pathlib
import re
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent / "github"
DL = ROOT / "downloads"
KEEP_EXT = {".dxf", ".dwg", ".dxb", ".zip", ".gz", ".7z", ".rar"}
SAMPLE_EXT = {".dxf", ".dwg", ".dxb"}
GH_HOSTS = ("github.com", "raw.githubusercontent.com", "gist.githubusercontent.com", "objects.githubusercontent.com")
MAX_BYTES = 150 * 1024 * 1024


def ext_of(url):
    return pathlib.PurePosixPath(urllib.parse.urlparse(url).path).suffix.lower()


def safe_name(name):
    name = urllib.parse.unquote(name)
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)[:150] or "file"


def download(rec):
    url = rec["url"]
    target_dir = DL / rec["repo"].replace("/", "__") / f"{rec['kind']}-{rec['number']}"
    parts = urllib.parse.urlparse(url).path.split("/")
    ids = [x for x in parts if x.isdigit()]
    name = safe_name(parts[-1])
    if ids:  # attachments in one thread often share a file name (test.zip)
        name = f"{ids[-1]}_{name}"
    dest = target_dir / name
    result = {**rec, "local": f"{rec['repo'].replace('/', '__')}/{rec['kind']}-{rec['number']}/{name}"}
    if dest.exists():
        extract(dest)
        return {**result, "status": "cached"}
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "truedxf-research"})
        with urllib.request.urlopen(req, timeout=90) as r, open(dest, "wb") as f:
            total = 0
            while chunk := r.read(1 << 20):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError("too large")
                f.write(chunk)
        extract(dest)
        return {**result, "status": "ok", "bytes": dest.stat().st_size}
    except Exception as e:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        return {**result, "status": f"error: {e}"}


def looks_like_dxf(head):
    if head.startswith(b"AutoCAD Binary DXF"):
        return True
    lines = [l.strip() for l in head.removeprefix(bytes([0xEF, 0xBB, 0xBF])).splitlines()[:6]]
    return len(lines) >= 2 and ((lines[0] == b"0" and lines[1] in (b"SECTION", b"section"))
                                or (lines[0] == b"999" and b"0" in lines[2:4]))


def looks_like_dwg(head):
    return re.match(rb"AC10\d\d", head[:6]) is not None


def sniff(path):
    """Attachments are often renamed (x.dxf.txt) because GitHub rejected .dxf uploads: copy them to a .dxf."""
    head = path.read_bytes()[:512]
    for test, ext in ((looks_like_dxf, ".dxf"), (looks_like_dwg, ".dwg")):
        if test(head):
            stem = path.name[: -len(path.suffix)] if path.suffix else path.name
            target = path.parent / (stem if stem.lower().endswith(ext) else stem + ext)
            if target != path:
                shutil.copyfile(path, target)
            return


def extract(path):
    ext = path.suffix.lower()
    if ext not in (".zip", ".gz") + tuple(SAMPLE_EXT):
        sniff(path)
    out = path.parent / (path.stem + "_extracted")
    if ext == ".zip":
        try:
            with zipfile.ZipFile(path) as z:
                for m in z.infolist():
                    p = pathlib.PurePosixPath(m.filename)
                    if m.is_dir() or p.suffix.lower() not in SAMPLE_EXT or ".." in p.parts:
                        continue
                    target = out / pathlib.Path(*[safe_name(x) for x in p.parts])
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(m) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
        except zipfile.BadZipFile:
            pass
    elif ext == ".gz":
        inner = path.with_suffix("")
        try:
            with gzip.open(path) as src, open(inner, "wb") as dst:
                shutil.copyfileobj(src, dst)
        except (OSError, EOFError):
            return
        if inner.suffix.lower() not in SAMPLE_EXT:
            sniff(inner)


def main():
    records, external = [], []
    for f in sorted((ROOT / "raw").glob("*/attachments.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            rec["url"] = re.sub(r"^https://github\.com/([^/]+/[^/]+)/blob/", r"https://github.com//raw/", rec["url"])
            host = urllib.parse.urlparse(rec["url"]).netloc.lower()
            ext = ext_of(rec["url"])
            is_gh_file = "/files/" in rec["url"] and host == "github.com"
            if not (ext in KEEP_EXT or is_gh_file):
                continue
            if host.endswith(GH_HOSTS) or host in GH_HOSTS:
                records.append(rec)
            else:
                external.append(rec)
    DL.mkdir(parents=True, exist_ok=True)
    unique = {}
    for r in records:
        unique.setdefault(r["url"], r)
    records = list(unique.values())
    print(f"{len(records)} GitHub-hosted, {len(external)} external links", file=sys.stderr)
    with cf.ThreadPoolExecutor(8) as ex:
        results = list(ex.map(download, records))
    with open(DL / "index.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    lines = ["# External sample links (not downloaded)", "", "| Repo | Thread | URL |", "|---|---|---|"]
    lines += [f"| {r['repo']} | [{r['kind']} {r['number']}]({r['thread']}) | {r['url']} |" for r in external]
    (DL / "external_links.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok = sum(r["status"] in ("ok", "cached") for r in results)
    print(f"downloaded {ok}/{len(results)}", file=sys.stderr)
    for r in results:
        if not r["status"] in ("ok", "cached"):
            print(f"  {r['url']}: {r['status']}", file=sys.stderr)


if __name__ == "__main__":
    main()
