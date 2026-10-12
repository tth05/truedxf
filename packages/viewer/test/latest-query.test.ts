import { expect, it } from "vitest";
import { LatestQuery } from "../src/latest-query.ts";

it("keeps one hover request in flight, sends only the newest point, and discards old answers", async () => {
    const sent: number[] = [];
    const accepted: number[] = [];
    const replies: ((n: number) => void)[] = [];
    const query = new LatestQuery<number, number>(
        (n) => {
            sent.push(n);
            return new Promise((resolve) => replies.push(resolve));
        },
        (n) => accepted.push(n),
        () => {
            throw new Error("unexpected rejection");
        },
    );
    query.push(1);
    query.push(2);
    query.push(3);
    expect(sent).toEqual([1]);
    replies[0]!(1);
    await Promise.resolve();
    expect(sent).toEqual([1, 3]);
    expect(accepted).toEqual([]);
    replies[1]!(3);
    await Promise.resolve();
    expect(accepted).toEqual([3]);
    query.push(4);
    query.push(5);
    query.cancel();
    replies[2]!(4);
    await Promise.resolve();
    expect(sent).toEqual([1, 3, 4]);
    expect(accepted).toEqual([3]);
    query.push(6);
    replies[3]!(6);
    await Promise.resolve();
    expect(accepted).toEqual([3, 6]);
});

it("continues with the latest query after an obsolete request fails", async () => {
    let reject!: (e: Error) => void;
    const accepted: number[] = [];
    const errors: unknown[] = [];
    const query = new LatestQuery<number, number>(
        (n) =>
            n === 1
                ? new Promise((_resolve, fail) => {
                      reject = fail;
                  })
                : Promise.resolve(n),
        (n) => accepted.push(n),
        (e) => errors.push(e),
    );
    query.push(1);
    query.push(2);
    reject(new Error("old"));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([]);
    expect(accepted).toEqual([2]);
});
