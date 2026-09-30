/**
 * Fixture (suite/case) and corpus browsers over the dev server's samples API (server/samples.ts).
 * Both are hidden when samples/ is absent.
 */
import type { FixturePlot } from "./compare.ts";
import { h, mount } from "./dom.ts";
import { fmtBytes, fmtNum } from "./format.ts";

export interface SamplesStatus {
  available: boolean;
  refs: string | null;
  suites: { name: string; cases: number; score?: { n: number; exact: number; good: number; f1?: number } }[];
  corpus: number;
}

export interface FixtureCase {
  id: string;
  name: string;
  title: string;
  tags: string[];
  plot: FixturePlot | null;
  dxf: string;
  ref: string | null;
  score: { exact?: number; f1?: number[]; source: string } | null;
}

export interface CorpusRow {
  path: string;
  size: number;
  format: string;
  version: string | null;
  producer: string | null;
  title: string | null;
  entities: number;
  types: string[];
}

export const API = "api/samples/";

export async function samplesStatus(): Promise<SamplesStatus> {
  try {
    const r = await fetch(`${API}status`);
    if (!r.ok) return { available: false, refs: null, suites: [], corpus: 0 };
    return (await r.json()) as SamplesStatus;
  } catch {
    return { available: false, refs: null, suites: [], corpus: 0 };
  }
}

/** Score badge class: exact / good (F1 at 1 px ≥ 0.99) / poor. */
function grade(s: FixtureCase["score"]): string {
  if (!s) return "none";
  if (s.exact === 0) return "exact";
  const f1 = s.f1?.[1] ?? s.f1?.[0] ?? 0;
  return f1 >= 0.99 ? "good" : f1 >= 0.9 ? "fair" : "poor";
}

export function fixtureBrowser(status: SamplesStatus, open: (c: FixtureCase) => void): HTMLElement {
  const suiteList = h("div", { class: "list" });
  const caseList = h("div", { class: "list" });
  const filter = h("input", { class: "search", type: "search", placeholder: "Filter cases…" });
  const onlyFailing = h("input", { type: "checkbox" });
  const caseHead = h("span", { class: "count" });
  let suite: string | undefined;
  let cases: FixtureCase[] = [];
  let active: string | undefined;

  const renderSuites = () =>
    mount(
      suiteList,
      status.suites.map((s) => {
        const sc = s.score;
        return h(
          "div",
          { class: `item${s.name === suite ? " active" : ""}`, onclick: () => void pick(s.name) },
          h("span", { class: "name" }, s.name),
          h(
            "span",
            {
              class: "meta",
              title: sc ? `${sc.exact} exact, ${sc.good} good of ${sc.n} scored` : "not scored",
            },
            sc ? `${sc.exact}/${sc.n}` : fmtNum(s.cases),
          ),
        );
      }),
    );

  const renderCases = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = cases.filter(
      (c) =>
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))) &&
        (!onlyFailing.checked || (c.score !== null && c.score.exact !== 0)),
    );
    caseHead.textContent = `${shown.length}/${cases.length}`;
    mount(
      caseList,
      shown.map((c) =>
        h(
          "div",
          {
            class: `item${c.id === active ? " active" : ""}`,
            title: `${c.title}\n${c.tags.join(", ")}${c.score ? `\nexact mismatch ${c.score.exact ?? "?"}, F1 ${c.score.f1?.map((x) => x.toFixed(3)).join("/") ?? "?"}` : ""}`,
            onclick: () => {
              active = c.id;
              renderCases();
              open(c);
            },
          },
          h("span", { class: `dot ${grade(c.score)}` }),
          h("span", { class: "name" }, c.name),
          h("span", { class: "meta" }, c.score?.exact !== undefined ? fmtNum(c.score.exact) : ""),
        ),
      ),
    );
  };

  async function pick(name: string): Promise<void> {
    suite = name;
    renderSuites();
    mount(caseList, h("div", { class: "hint" }, "Loading…"));
    const r = await fetch(`${API}suite/${encodeURIComponent(name)}`);
    cases = r.ok ? ((await r.json()) as { cases: FixtureCase[] }).cases : [];
    renderCases();
  }

  filter.addEventListener("input", renderCases);
  onlyFailing.addEventListener("change", renderCases);
  renderSuites();
  return h(
    "div",
    { class: "browse" },
    h(
      "div",
      { class: "section", style: "max-height: 38%" },
      h("div", { class: "section-head" }, "Suites ", h("span", { class: "count" }, status.refs ?? "no refs")),
      suiteList,
    ),
    h(
      "div",
      { class: "section grow" },
      h("div", { class: "section-head" }, "Cases ", caseHead),
      filter,
      h("label", { class: "check" }, onlyFailing, " only cases with differences"),
      caseList,
    ),
  );
}

export function corpusBrowser(open: (row: CorpusRow) => void): HTMLElement {
  const q = h("input", { class: "search", type: "search", placeholder: "Search path or title…" });
  const type = h("select", { class: "search" }, h("option", { value: "" }, "Any entity type"));
  const version = h("select", { class: "search" }, h("option", { value: "" }, "Any version"));
  const producer = h("select", { class: "search" }, h("option", { value: "" }, "Any producer"));
  const bySize = h("input", { type: "checkbox" });
  const list = h("div", { class: "list" });
  const count = h("span", { class: "count" });
  let active: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  void fetch(`${API}facets`)
    .then((r) => r.json())
    .then((f: Record<"types" | "versions" | "producers", { name: string; n: number }[]>) => {
      for (const t of f.types) type.append(h("option", { value: t.name }, `${t.name} (${t.n})`));
      for (const v of f.versions) version.append(h("option", { value: v.name }, `${v.name} (${v.n})`));
      for (const p of f.producers) producer.append(h("option", { value: p.name }, `${p.name} (${p.n})`));
    })
    .catch(() => undefined);

  const search = async () => {
    const s = ++seq;
    const p = new URLSearchParams({
      q: q.value,
      type: type.value,
      version: version.value,
      producer: producer.value,
      limit: "300",
      ...(bySize.checked ? { sort: "size" } : {}),
    });
    const r = await fetch(`${API}corpus?${p}`);
    if (s !== seq || !r.ok) return;
    const { total, rows } = (await r.json()) as { total: number; rows: CorpusRow[] };
    count.textContent = rows.length < total ? `${rows.length} of ${fmtNum(total)}` : fmtNum(total);
    const render = () =>
      mount(
        list,
        rows.map((row) =>
          h(
            "div",
            {
              class: `item two-line${row.path === active ? " active" : ""}`,
              title: `${row.path}\n${row.title ?? ""}\n${row.types.join(", ")}`,
              onclick: () => {
                active = row.path;
                render();
                open(row);
              },
            },
            h(
              "div",
              { class: "name" },
              row.path.split("/").pop() ?? row.path,
              h(
                "div",
                { class: "sub" },
                `${row.version ?? "?"} · ${row.producer ?? "unknown"} · ${fmtNum(row.entities)} ent · ${row.types.slice(0, 3).join(" ")}`,
              ),
            ),
            h("span", { class: "meta" }, fmtBytes(row.size)),
          ),
        ),
      );
    render();
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 200);
  };
  q.addEventListener("input", later);
  for (const s of [type, version, producer, bySize]) s.addEventListener("change", later);
  void search();
  return h(
    "div",
    { class: "browse" },
    h(
      "div",
      { class: "section grow" },
      h("div", { class: "section-head" }, "Corpus ", count),
      q,
      type,
      version,
      producer,
      h("label", { class: "check" }, bySize, " largest first"),
      list,
    ),
  );
}
