/**
 * Small linear-algebra helpers: a banded linear solver (Gaussian elimination with partial
 * pivoting in band storage) for the global B-spline interpolation systems of note 03 §3.8.6.
 *
 * The fit-point collocation matrix is banded (each row touches at most p + 1 = 4 consecutive
 * unknowns; the derivative rows 2–3), so the solve is O(n) instead of O(n³) and fit splines
 * with thousands of points stay cheap.
 */

export class BandedMatrix {
  readonly n: number;
  readonly lower: number;
  readonly upper: number;
  /** Row stride: room for the lower band, the diagonal, the upper band and pivoting fill-in. */
  private readonly width: number;
  private readonly a: Float64Array;

  /** `n × n` matrix with `lower` sub-diagonals and `upper` super-diagonals. */
  constructor(n: number, lower: number, upper: number) {
    this.n = n;
    this.lower = lower;
    this.upper = upper;
    this.width = 2 * lower + upper + 1;
    this.a = new Float64Array(n * this.width);
  }

  private index(i: number, j: number): number {
    const o = j - i + this.lower;
    if (o < 0 || o >= this.width) throw new RangeError(`(${i}, ${j}) outside the band`);
    return i * this.width + o;
  }

  set(i: number, j: number, v: number): void {
    this.a[this.index(i, j)] = v;
  }

  get(i: number, j: number): number {
    const o = j - i + this.lower;
    return o < 0 || o >= this.width ? 0 : this.a[i * this.width + o]!;
  }

  /**
   * Solve `A · X = B` for `nrhs` right-hand sides stored row-major in `b` (`n · nrhs` values).
   * Destroys the matrix. Returns the solution (row-major, same shape), or `undefined` when the
   * matrix is singular.
   */
  solve(b: Float64Array, nrhs: number): Float64Array | undefined {
    const { n, lower: l, upper: u, a, width: w } = this;
    const x = Float64Array.from(b);
    const at = (i: number, j: number) => i * w + (j - i + l);
    for (let k = 0; k < n; k++) {
      const rEnd = Math.min(n - 1, k + l);
      const cEnd = Math.min(n - 1, k + l + u);
      let p = k;
      let best = Math.abs(a[at(k, k)]!);
      for (let r = k + 1; r <= rEnd; r++) {
        const v = Math.abs(a[at(r, k)]!);
        if (v > best) {
          best = v;
          p = r;
        }
      }
      if (best === 0) return undefined;
      if (p !== k) {
        for (let j = k; j <= cEnd; j++) {
          const t = a[at(k, j)]!;
          a[at(k, j)] = a[at(p, j)]!;
          a[at(p, j)] = t;
        }
        for (let c = 0; c < nrhs; c++) {
          const t = x[k * nrhs + c]!;
          x[k * nrhs + c] = x[p * nrhs + c]!;
          x[p * nrhs + c] = t;
        }
      }
      const piv = a[at(k, k)]!;
      for (let r = k + 1; r <= rEnd; r++) {
        const f = a[at(r, k)]! / piv;
        if (f === 0) continue;
        a[at(r, k)] = 0;
        for (let j = k + 1; j <= cEnd; j++) a[at(r, j)] = a[at(r, j)]! - f * a[at(k, j)]!;
        for (let c = 0; c < nrhs; c++) x[r * nrhs + c] = x[r * nrhs + c]! - f * x[k * nrhs + c]!;
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const cEnd = Math.min(n - 1, k + l + u);
      const piv = a[at(k, k)]!;
      for (let c = 0; c < nrhs; c++) {
        let s = x[k * nrhs + c]!;
        for (let j = k + 1; j <= cEnd; j++) s -= a[at(k, j)]! * x[j * nrhs + c]!;
        x[k * nrhs + c] = s / piv;
      }
    }
    return x;
  }
}
