import OpenAI from "openai";
import { GUIDANCE_JSON_SCHEMA } from "../schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { GenerationOutcome, GenerationRequest, GuidanceProvider } from "./provider";

const DEFAULT_MODEL = "gpt-4.1-mini";

/**
 * OpenAI adapter. The only file in the project that knows OpenAI exists.
 *
 * Uses the Responses API with a strict JSON schema so malformed output is
 * rejected by the provider before it reaches our validator. The result is still
 * passed through `validateGeneratedReport` regardless — provider-side schema
 * enforcement does not cover the citation allow-list, which is the check that
 * actually matters.
 */
export function createOpenAIProvider(apiKey: string, model = DEFAULT_MODEL): GuidanceProvider {
  const client = new OpenAI({ apiKey });

  return {
    name: `openai:${model}`,
    generate: async (request: GenerationRequest): Promise<GenerationOutcome> => {
      const startedAt = Date.now();

      try {
        const response = await client.responses.create(
          {
            model,
            input: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildUserPrompt(request) },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "guidance_report",
                strict: true,
                schema: GUIDANCE_JSON_SCHEMA,
              },
            },
          },
          // Provider-side cap in addition to the orchestrator's own timeout, so
          // the socket is released rather than left hanging.
          { timeout: request.timeoutMs },
        );

        const text = response.output_text;
        if (!text) {
          return {
            ok: false,
            code: "PROVIDER_ERROR",
            message: "The provider returned an empty response.",
          };
        }

        return {
          ok: true,
          // Deliberately unvalidated here — the orchestrator owns validation.
          raw: JSON.parse(text) as unknown,
          modelName: model,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        return { ok: false, ...classify(error) };
      }
    },
  };
}

function classify(error: unknown): {
  code: "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED";
  message: string;
} {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      return { code: "RATE_LIMITED", message: "The provider is rate limiting requests." };
    }
    // The provider's message may quote our prompt or the retrieved passages,
    // so it is logged server-side but never surfaced to the user.
    return { code: "PROVIDER_ERROR", message: "The provider rejected the request." };
  }

  if (error instanceof Error && /timeout|aborted/i.test(error.message)) {
    return { code: "TIMEOUT", message: "The provider did not respond in time." };
  }

  return { code: "PROVIDER_ERROR", message: "The provider call failed." };
}
