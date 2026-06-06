// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { intervalsClient } from "../src/core/intervals-client.js";

function stubAbortAwareFetch(): { getSignal: () => AbortSignal | undefined } {
  let capturedSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          "abort",
          () => {
            reject(new Error("mock fetch aborted"));
          },
          { once: true },
        );
      });
    }),
  );
  return { getSignal: () => capturedSignal };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("intervalsClient request cancellation", () => {
  it("aborts a hanging fetch after the hard timeout", async () => {
    vi.useFakeTimers();
    const { getSignal } = stubAbortAwareFetch();

    const pending = intervalsClient.getActivityDetail("i12345678", { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toThrow("timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(getSignal()?.aborted).toBe(true);
  });

  it("propagates a caller AbortSignal into fetch", async () => {
    const { getSignal } = stubAbortAwareFetch();
    const controller = new AbortController();

    const pending = intervalsClient.getActivityDetail("i12345678", {
      signal: controller.signal,
      timeoutMs: 0,
    });
    const assertion = expect(pending).rejects.toThrow("client cancelled");
    controller.abort("client cancelled");

    await assertion;
    expect(getSignal()?.aborted).toBe(true);
  });
});
