"""Dump issues, pull requests and discussions (with comments) of GitHub repos via `gh api graphql`.

Output per repo (research/github/raw/<owner>__<repo>/):
  threads.jsonl   one JSON object per issue / PR / discussion
  threads/<kind>-<number>.md   readable markdown rendering (for grepping)
  attachments.jsonl  every attachment-like URL (.dxf/.dwg/.zip/...) found in the threads

Usage: python dump_github.py owner/repo [owner/repo?search-terms ...]
(with ?terms only issues/PRs matching the GitHub search are dumped, max 1000)
"""
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent / "github"
RAW = ROOT / "raw"

ATTACH_RE = re.compile(
    r"https?://[^\s\)\]\"'<>]+?\.(?:dxf|dwg|zip|7z|rar|gz|dxb|dwf|shx|shp|lin|pat|ctb|stb|ttf|pdf)(?=[\s\)\]\"'<>]|$)",
    re.IGNORECASE,
)
# GitHub attachment links without a usable extension in the path
GH_FILE_RE = re.compile(r"https://github\.com/(?:user-attachments/files|[\w.-]+/[\w.-]+/files)/\d+/[^\s\)\]\"'<>]+")

COMMENTS = "comments(first: 100) { totalCount nodes { author { login } createdAt body } }"
ISSUE_Q = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 40, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url state createdAt author { login } labels(first: 10) { nodes { name } } body %s }
    }
  }
}""" % COMMENTS
PR_Q = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 30, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url state createdAt author { login } body %s
        reviewThreads(first: 30) { nodes { path comments(first: 20) { nodes { author { login } body } } } } }
    }
  }
}""" % COMMENTS
DISC_Q = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 30, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url createdAt author { login } category { name } body
        answer { author { login } body }
        comments(first: 60) { totalCount nodes { author { login } createdAt body
          replies(first: 40) { nodes { author { login } createdAt body } } } } }
    }
  }
}"""


TOKEN = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()


def gql(query, **variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    err = None
    for attempt in range(6):
        req = urllib.request.Request("https://api.github.com/graphql", data=body,
                                     headers={"Authorization": f"bearer {TOKEN}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read().decode("utf-8"))
            if "errors" not in data:
                return data["data"]
            err = data["errors"]
        except Exception as e:  # network errors, 502s on big pages
            err = e
        print(f"  retry {attempt}: {str(err)[:300]}", file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(err)


def author(n):
    return (n.get("author") or {}).get("login", "ghost")


def fetch(owner, name, query, key):
    cursor, out = None, []
    while True:
        conn = gql(query, owner=owner, name=name, cursor=cursor)["repository"][key]
        out += conn["nodes"]
        print(f"  {key}: {len(out)}", file=sys.stderr)
        if not conn["pageInfo"]["hasNextPage"]:
            return out
        cursor = conn["pageInfo"]["endCursor"]


SEARCH_Q = """
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 40, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { __typename
      ... on Issue { number title url state createdAt author { login } body %s }
      ... on PullRequest { number title url state createdAt author { login } body %s }
    }
  }
}""" % (COMMENTS, COMMENTS)


def search(q):
    cursor, out = None, []
    while True:
        conn = gql(SEARCH_Q, q=q, cursor=cursor)["search"]
        out += conn["nodes"]
        print(f"  search: {len(out)}", file=sys.stderr)
        if not conn["pageInfo"]["hasNextPage"] or len(out) >= 1000:
            return out
        cursor = conn["pageInfo"]["endCursor"]


def render(kind, t):
    lines = [f"# [{kind} #{t['number']}] {t['title']}", "", f"{t['url']} | {author(t)} | {t['createdAt']}"]
    if t.get("labels"):
        lines.append("labels: " + ", ".join(l["name"] for l in t["labels"]["nodes"]))
    lines += ["", t.get("body") or ""]
    if t.get("answer"):
        lines += ["", f"## ANSWER ({author(t['answer'])})", "", t["answer"]["body"]]
    for c in t.get("comments", {}).get("nodes", []):
        lines += ["", f"## {author(c)} ({c.get('createdAt', '')})", "", c["body"]]
        for r in c.get("replies", {}).get("nodes", []):
            lines += ["", f"### reply {author(r)}", "", r["body"]]
    for th in (t.get("reviewThreads") or {}).get("nodes", []):
        for c in th["comments"]["nodes"]:
            lines += ["", f"## review on {th['path']} ({author(c)})", "", c["body"]]
    return "\n".join(lines)


def all_text(t):
    parts = [t.get("body") or ""]
    if t.get("answer"):
        parts.append(t["answer"]["body"])
    for c in t.get("comments", {}).get("nodes", []):
        parts.append(c["body"])
        parts += [r["body"] for r in c.get("replies", {}).get("nodes", [])]
    return "\n".join(parts)


def main(repos):
    for full in repos:
        full, _, query = full.partition("?")
        owner, name = full.split("/")
        d = RAW / f"{owner}__{name}"
        (d / "threads").mkdir(parents=True, exist_ok=True)
        print(f"== {full}", file=sys.stderr)
        threads = []
        if query:
            for t in search(f"repo:{full} {query}"):
                t["kind"] = "issue" if t.pop("__typename") == "Issue" else "pr"
                threads.append(t)
        for kind, q, key in () if query else (("issue", ISSUE_Q, "issues"), ("pr", PR_Q, "pullRequests"), ("discussion", DISC_Q, "discussions")):
            try:
                items = fetch(owner, name, q, key)
            except RuntimeError as e:
                print(f"  skip {key}: {e}", file=sys.stderr)
                continue
            for t in items:
                t["kind"] = kind
                threads.append(t)
        with open(d / "threads.jsonl", "w", encoding="utf-8") as f:
            for t in threads:
                f.write(json.dumps(t, ensure_ascii=False) + "\n")
                (d / "threads" / f"{t['kind']}-{t['number']:05d}.md").write_text(render(t["kind"], t), encoding="utf-8")
        seen = set()
        with open(d / "attachments.jsonl", "w", encoding="utf-8") as f:
            for t in threads:
                text = all_text(t)
                for url in set(ATTACH_RE.findall(text)) | set(GH_FILE_RE.findall(text)):
                    url = url.rstrip(".,;")
                    if url in seen:
                        continue
                    seen.add(url)
                    f.write(json.dumps({"repo": full, "kind": t["kind"], "number": t["number"], "title": t["title"], "thread": t["url"], "url": url}) + "\n")
        print(f"  {len(threads)} threads, {len(seen)} attachment urls", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])
