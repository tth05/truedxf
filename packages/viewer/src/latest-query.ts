/** One request in flight, with only the newest pending input retained. */
export class LatestQuery<T, V> {
    private running = false;
    private revision = 0;
    private pending: { input: T; revision: number } | undefined;
    private readonly request: (input: T) => Promise<V>;
    private readonly accept: (value: V, input: T) => void;
    private readonly fail: (error: unknown) => void;

    constructor(
        request: (input: T) => Promise<V>,
        accept: (value: V, input: T) => void,
        fail: (error: unknown) => void,
    ) {
        this.request = request;
        this.accept = accept;
        this.fail = fail;
    }

    push(input: T): void {
        this.pending = { input, revision: ++this.revision };
        if (!this.running) void this.drain();
    }

    cancel(): void {
        this.revision++;
        this.pending = undefined;
    }

    private async drain(): Promise<void> {
        this.running = true;
        try {
            while (this.pending) {
                const { input, revision } = this.pending;
                this.pending = undefined;
                try {
                    const value = await this.request(input);
                    if (revision === this.revision) this.accept(value, input);
                } catch (error) {
                    if (revision === this.revision) this.fail(error);
                }
            }
        } finally {
            this.running = false;
        }
    }
}
