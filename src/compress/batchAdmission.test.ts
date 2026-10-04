import { describe, expect, it, vi } from "vitest";
import {
  createBatchAdmissionController,
  runSequentialAdmit,
} from "./batchAdmission";

describe("createBatchAdmissionController", () => {
  it("keeps begin() token current until abort()", () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    expect(gate.isCurrent(token)).toBe(true);
    gate.abort();
    expect(gate.isCurrent(token)).toBe(false);
  });

  it("lets a new begin() after abort() proceed independently", () => {
    const gate = createBatchAdmissionController();
    const stale = gate.begin();
    gate.abort();
    const next = gate.begin();
    expect(gate.isCurrent(stale)).toBe(false);
    expect(gate.isCurrent(next)).toBe(true);
  });
});

describe("runSequentialAdmit", () => {
  it("stops starting further files after the gate is aborted mid-batch", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    const started: string[] = [];
    const start = vi.fn(async (file: string) => {
      started.push(file);
      if (file === "a") gate.abort();
      return { id: `job-${file}` };
    });
    const onAdmitted = vi.fn();
    const onLateAdmit = vi.fn();

    await runSequentialAdmit(["a", "b", "c"], {
      isCurrent: () => gate.isCurrent(token),
      start,
      onAdmitted,
      onLateAdmit,
    });

    expect(started).toEqual(["a"]);
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(onLateAdmit).toHaveBeenCalledWith({ id: "job-a" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("admits all files when never aborted", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    const admitted: string[] = [];

    await runSequentialAdmit(["a", "b"], {
      isCurrent: () => gate.isCurrent(token),
      start: async (file) => ({ id: `job-${file}` }),
      onAdmitted: (job) => admitted.push(job.id),
      onLateAdmit: () => {
        throw new Error("should not late-admit");
      },
    });

    expect(admitted).toEqual(["job-a", "job-b"]);
  });

  it("does not call start when already aborted before the first file", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    gate.abort();
    const start = vi.fn(async (file: string) => ({ id: file }));

    await runSequentialAdmit(["a"], {
      isCurrent: () => gate.isCurrent(token),
      start,
      onAdmitted: () => undefined,
      onLateAdmit: () => undefined,
    });

    expect(start).not.toHaveBeenCalled();
  });

  it("cancels a job when abort races after the post-start current check", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    const onLateAdmit = vi.fn();

    await runSequentialAdmit(["a", "b"], {
      isCurrent: () => gate.isCurrent(token),
      start: async (file) => ({ id: `job-${file}` }),
      onAdmitted: () => {
        // Abort after the post-start isCurrent() passed but once the job is
        // visible to the UI — the classic cancel-all TOCTOU window.
        gate.abort();
      },
      onLateAdmit,
    });

    expect(onLateAdmit).toHaveBeenCalledWith({ id: "job-a" });
  });

  it("records per-file start failures and keeps admitting remaining files", async () => {
    const gate = createBatchAdmissionController();
    const token = gate.begin();
    const admitted: string[] = [];
    const startErrors: Array<{ file: string; message: string }> = [];

    await runSequentialAdmit(["a", "b", "c"], {
      isCurrent: () => gate.isCurrent(token),
      start: async (file) => {
        if (file === "b") throw new Error("start failed for b");
        return { id: `job-${file}` };
      },
      onAdmitted: (job) => admitted.push(job.id),
      onLateAdmit: () => {
        throw new Error("should not late-admit");
      },
      onStartError: (file, err) => {
        startErrors.push({
          file,
          message: err instanceof Error ? err.message : String(err),
        });
      },
    });

    expect(startErrors).toEqual([
      { file: "b", message: "start failed for b" },
    ]);
    expect(admitted).toEqual(["job-a", "job-c"]);
  });
});
