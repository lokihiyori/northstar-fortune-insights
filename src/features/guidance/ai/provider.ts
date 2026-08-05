import type { EvidenceChunk } from "@/features/retrieval/repository";
import type { GuidanceInput } from "@/features/guidance/rules/types";

/**
 * The seam every AI provider sits behind (CLAUDE.md: external providers are
 * isolated behind typed adapters). Nothing above this layer knows which model
 * produced the output, and nothing below it touches the database.
 */
export type GenerationRequest = {
  input: GuidanceInput;
  evidence: readonly EvidenceChunk[];
  /** Cap enforced by the caller so a hung provider cannot stall a request. */
  timeoutMs: number;
};

export type GenerationSuccess = {
  ok: true;
  /** Unvalidated. The orchestrator must run it through validation. */
  raw: unknown;
  modelName: string;
  latencyMs: number;
};

export type GenerationFailure = {
  ok: false;
  code: "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED" | "NOT_CONFIGURED";
  message: string;
};

export type GenerationOutcome = GenerationSuccess | GenerationFailure;

export type GuidanceProvider = {
  readonly name: string;
  generate: (request: GenerationRequest) => Promise<GenerationOutcome>;
};

/** Wraps a promise in a timeout so a slow provider fails cleanly. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(onTimeout());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
