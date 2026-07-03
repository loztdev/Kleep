import { withFetchTimeout } from "../fetchTimeout";

describe("withFetchTimeout", () => {
  it("resolves with fn's result when fn succeeds", async () => {
    const result = await withFetchTimeout(async () => "ok");
    expect(result).toBe("ok");
  });

  it("propagates fn's rejection", async () => {
    await expect(
      withFetchTimeout(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("passes a signal to fn that aborts when an external signal aborts", async () => {
    const external = new AbortController();
    let observedAborted = false;
    const promise = withFetchTimeout(async (signal) => {
      external.abort();
      observedAborted = signal.aborted;
      return "done";
    }, external.signal);
    await promise;
    expect(observedAborted).toBe(true);
  });

  it("passes an already-aborted signal to fn when external is aborted before the call", async () => {
    const external = new AbortController();
    external.abort();
    let observedAborted = false;
    await withFetchTimeout(async (signal) => {
      observedAborted = signal.aborted;
      return "done";
    }, external.signal);
    expect(observedAborted).toBe(true);
  });
});
