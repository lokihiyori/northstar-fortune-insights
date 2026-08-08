import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { newRequestId } from "./request-id";

/**
 * Request-scoped context.
 *
 * `AsyncLocalStorage` rather than a module-level variable: a module variable is
 * shared by every in-flight request in the same process, so under any
 * concurrency at all one request would stamp another's id onto its logs. The
 * store gives each async call tree its own value with no plumbing through every
 * function signature.
 *
 * **Node-only.** This module carries `server-only` and is imported exclusively
 * from Node route handlers, server actions, and services. `src/proxy.ts` runs on
 * Edge and must never reach it — see ADR 0009.
 */

export type RequestContext = {
  requestId: string;
  /** Route template, never a raw URL with its query string. */
  route: string;
  method: string;
  /** Opaque user id, set once a guard has resolved one. Never an email. */
  actorId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with a context every nested call can read. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The current request id, or `null` outside a request.
 *
 * `null` rather than a generated value, so callers can tell "no request" from
 * "a request whose id I forgot to propagate".
 */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/**
 * Attaches the actor to the current context after a guard resolves it.
 *
 * Mutating the store object is safe in a way a module variable is not: the
 * object belongs to exactly one async call tree. A no-op outside a request.
 */
export function setContextActor(actorId: string): void {
  const context = storage.getStore();
  if (context) context.actorId = actorId;
}

/**
 * Context for a Server Action.
 *
 * Server Actions do not pass through the Route Handler wrapper, so they cannot
 * inherit its context and are given their own explicitly. There is no incoming
 * header to honour — the action is invoked by React, not by a client HTTP call
 * we control — so the id is always generated. `method` records `ACTION` so a
 * log consumer can tell the two apart at a glance.
 */
export function runWithActionContext<T>(actionName: string, fn: () => T): T {
  return storage.run({ requestId: newRequestId(), route: actionName, method: "ACTION" }, fn);
}
