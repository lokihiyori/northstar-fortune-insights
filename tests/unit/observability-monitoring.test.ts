import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeMonitoringAdapterName,
  captureException,
  captureMessage,
  resetMonitoringAdapter,
  setMonitoringAdapter,
  type MonitoringAdapter,
  type MonitoringContext,
} from "@/lib/observability/monitoring";

/**
 * The monitoring boundary.
 *
 * Two properties matter more than what any adapter does with a report: an
 * adapter can never break a request, and an adapter can never receive anything
 * the log allow-list would have refused.
 */

afterEach(() => {
  resetMonitoringAdapter();
  vi.restoreAllMocks();
});

function recordingAdapter(): { adapter: MonitoringAdapter; seen: MonitoringContext[] } {
  const seen: MonitoringContext[] = [];
  return {
    seen,
    adapter: {
      name: "recording",
      captureException: (_error, context) => {
        seen.push(context);
      },
      captureMessage: (_message, _severity, context) => {
        seen.push(context);
      },
    },
  };
}

describe("default adapter", () => {
  it("is the structured-log adapter, not a silent no-op", () => {
    // A capture that vanishes is indistinguishable from one that was never
    // wired up — exactly the confusion to avoid when a vendor is first added.
    expect(activeMonitoringAdapterName()).toBe("structured-log");
  });

  it("writes a capture rather than discarding it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    captureException(new Error("boom"), { category: "internal" });

    expect(
      error.mock.calls.length + warn.mock.calls.length + info.mock.calls.length,
    ).toBeGreaterThan(0);
  });
});

describe("failure isolation", () => {
  it("does not throw when the adapter throws", () => {
    setMonitoringAdapter({
      name: "exploding",
      captureException: () => {
        throw new Error("vendor SDK exploded");
      },
      captureMessage: () => {
        throw new Error("vendor SDK exploded");
      },
    });

    // A vendor SDK failing is not a reason to turn a working response into 500.
    expect(() => {
      captureException(new Error("original"));
    }).not.toThrow();
    expect(() => {
      captureMessage("something happened");
    }).not.toThrow();
  });

  it("does not throw when both the adapter and the logger fail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("stdout is gone");
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stdout is gone");
    });

    setMonitoringAdapter({
      name: "exploding",
      captureException: () => {
        throw new Error("vendor SDK exploded");
      },
      captureMessage: () => {
        throw new Error("vendor SDK exploded");
      },
    });

    // There is nowhere left to report to; the request must still survive.
    expect(() => {
      captureException(new Error("original"));
    }).not.toThrow();
  });
});

describe("context sanitization", () => {
  it("never passes secrets or private content to an adapter", () => {
    const { adapter, seen } = recordingAdapter();
    setMonitoringAdapter(adapter);

    captureException(new Error("boom"), {
      category: "internal",
      fields: {
        password: "e2e-test-passphrase",
        DATABASE_URL: "postgresql://user:pw@host:5432/db",
        authorization: "Bearer abc.def.ghi",
        cookie: "authjs.session-token=abc",
        email: "someone@example.com",
        question: "Should I retrain as a paramedic?",
        sourceContent: "Bridge training programs...",
        sourceId: "src_123",
        durationMs: 12,
      },
    });

    const context = seen[0];
    expect(context).toBeDefined();

    const serialized = JSON.stringify(context);
    for (const leak of [
      "e2e-test-passphrase",
      "postgresql://",
      "Bearer",
      "authjs.session-token",
      "someone@example.com",
      "paramedic",
      "Bridge training",
    ]) {
      expect(serialized, leak).not.toContain(leak);
    }

    // The safe fields survive, so the report is still useful.
    expect(context?.extra).toEqual({ sourceId: "src_123", durationMs: 12 });
    expect(context?.errorCategory).toBe("internal");
  });

  it("passes no request frame outside a request", () => {
    const { adapter, seen } = recordingAdapter();
    setMonitoringAdapter(adapter);

    captureMessage("startup notice");

    expect(seen[0]?.requestId).toBeUndefined();
    expect(seen[0]?.route).toBeUndefined();
    expect(seen[0]?.actorId).toBeUndefined();
  });

  it("never hands the adapter the raw error object's message", () => {
    // The adapter receives the error itself — a vendor needs the stack — but
    // the *context* it is given must not restate the message as a field.
    const { adapter, seen } = recordingAdapter();
    setMonitoringAdapter(adapter);

    captureException(new Error("connect ECONNREFUSED 127.0.0.1:56379"));

    expect(JSON.stringify(seen[0])).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(seen[0])).not.toContain("127.0.0.1");
  });
});

describe("adapter installation", () => {
  it("routes to an installed vendor adapter and can be restored", () => {
    const { adapter, seen } = recordingAdapter();

    setMonitoringAdapter(adapter);
    expect(activeMonitoringAdapterName()).toBe("recording");

    captureException(new Error("boom"));
    expect(seen).toHaveLength(1);

    resetMonitoringAdapter();
    expect(activeMonitoringAdapterName()).toBe("structured-log");
  });
});
