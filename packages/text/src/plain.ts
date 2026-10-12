/**
 * Plain text of TEXT / MTEXT contents, for search and copying: what a reader sees, without
 * formatting codes. Paragraphs and columns become "\n", tabs and non-breaking spaces " ", stacks
 * "upper/lower"; %%d, %%p, %%c become °, ±, ⌀.
 */
import { defaultContext, type MTextChar, parseMText } from "./mtext-parser.ts";
import { decodeTextString, type SpecialSymbol } from "./specials.ts";

const SYMBOLS: Record<SpecialSymbol, string> = { degree: "°", plusminus: "±", diameter: "⌀" };

function char(c: { cp: number; symbol?: SpecialSymbol | undefined; control?: boolean }): string {
    if (c.symbol) return SYMBOLS[c.symbol];
    if ("control" in c && c.control) return "";
    return String.fromCodePoint(c.cp);
}

/** Plain text of a TEXT / ATTRIB / ATTDEF value (group 1). */
export function plainText(raw: string): string {
    let s = "";
    for (const c of decodeTextString(raw)) s += c.numeric ? String.fromCodePoint(c.cp) : char(c);
    return s;
}

/** Plain text of MTEXT contents (groups 3 + 1). */
export function plainMText(content: string, dimension = false): string {
    let s = "";
    const chars = (cs: readonly MTextChar[]) => cs.map(char).join("");
    for (const t of parseMText(content, defaultContext(1), dimension)) {
        switch (t.t) {
            case "char":
                s += char(t.ch);
                break;
            case "space":
            case "nbsp":
            case "tab":
                s += " ";
                break;
            case "paragraph":
            case "column":
            case "dimwrap":
                s += "\n";
                break;
            case "stack":
                s += t.kind === "" ? chars(t.upper) + chars(t.lower) : `${chars(t.upper)}/${chars(t.lower)}`;
                break;
        }
    }
    return s;
}
