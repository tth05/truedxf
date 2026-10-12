export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
    severity: Severity;
    /** Stable machine-readable id, e.g. `invalid-group-code`. */
    code: string;
    message: string;
    /** Byte offset in the source, if known. */
    offset?: number;
    /** Tag index in the TagStore, if known. */
    tag?: number;
}

export class Diagnostics {
    readonly items: Diagnostic[] = [];
    /** Maximum number of stored items per diagnostic code; further ones are only counted. */
    readonly limitPerCode: number;
    private readonly counts = new Map<string, number>();

    constructor(limitPerCode = 100) {
        this.limitPerCode = limitPerCode;
    }

    add(d: Diagnostic): void {
        const n = (this.counts.get(d.code) ?? 0) + 1;
        this.counts.set(d.code, n);
        if (n <= this.limitPerCode) this.items.push(d);
    }

    error(code: string, message: string, extra?: Partial<Diagnostic>): void {
        this.add({ severity: "error", code, message, ...extra });
    }

    warn(code: string, message: string, extra?: Partial<Diagnostic>): void {
        this.add({ severity: "warning", code, message, ...extra });
    }

    info(code: string, message: string, extra?: Partial<Diagnostic>): void {
        this.add({ severity: "info", code, message, ...extra });
    }

    /** Occurrences per code, including ones dropped by the limit. */
    summary(): Record<string, number> {
        return Object.fromEntries(this.counts);
    }

    get hasErrors(): boolean {
        return this.items.some((d) => d.severity === "error");
    }
}
