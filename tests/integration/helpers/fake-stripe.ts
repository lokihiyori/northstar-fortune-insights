import type Stripe from "stripe";

/**
 * A Stripe boundary that counts calls.
 *
 * The properties under test — "one Customer and one Session however many
 * requests arrive", "a lost response recovers the original object" — are
 * statements about *how many times Stripe was called*, which cannot be observed
 * against the real API without spending money. This fake records every call and
 * implements the two behaviours the design depends on: idempotency-key replay
 * and Session expiry.
 *
 * It proves the application's logic. It proves nothing about Stripe itself, and
 * the report must not claim otherwise.
 */

export type FakeOptions = {
  /** Fail the next N `customers.create` calls after recording them. */
  loseCustomerResponses?: number;
  /** Fail the next N `sessions.create` calls after recording them. */
  loseSessionResponses?: number;
  /** Throw `idempotency_key_in_use` on the next `sessions.create`. */
  idempotencyInUse?: boolean;
  /** Delay (ms) applied to `subscriptions.list`, for ordering tests. */
  listDelayMs?: number;

  /** `customers.create` throws WITHOUT recording — models an aged-out key. */
  customerCreateThrows?: boolean;
  /** `sessions.create` throws WITHOUT recording — nothing exists at Stripe. */
  sessionCreateThrows?: boolean;

  /** `customers.search` throws — an outage must create nothing. */
  searchUnavailable?: boolean;
  /** `customers.search` reports more pages than it returns. */
  searchIncomplete?: boolean;
  /** `customers.create` returns an object in the wrong mode. */
  customerWrongLivemode?: boolean;

  /** `sessions.list` claims `has_more` forever, exceeding the page bound. */
  sessionListIncomplete?: boolean;
  /** `subscriptions.list` claims `has_more` forever. */
  subscriptionListIncomplete?: boolean;
  /** `sessions.expire` throws, so expiry can never be confirmed. */
  expireFails?: boolean;
  /** `sessions.expire` succeeds but the Session stays open. */
  expireDoesNotStick?: boolean;

  /** Next `sessions.create` returns an already-complete Session. */
  createReturnsComplete?: boolean;
  /** Next `sessions.create` returns an already-expired Session. */
  createReturnsExpired?: boolean;

  /** Line items for the next verified Session: none, or more than one. */
  lineItemsEmpty?: boolean;
  lineItemsMultiple?: boolean;
  /** `listLineItems` throws — verification must fail closed. */
  lineItemsUnavailable?: boolean;

  /** Awaited immediately before `subscriptions.list` returns. Ordering barrier. */
  beforeListReturns?: () => Promise<void>;
};

/** A promise that another task can resolve, for deterministic ordering. */
export function barrier(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

export class FakeStripe {
  customerCreateCalls = 0;
  sessionCreateCalls = 0;
  listCalls = 0;

  private customers = new Map<string, Stripe.Customer>();
  private customerByIdemKey = new Map<string, string>();
  private sessions = new Map<string, Stripe.Checkout.Session>();
  private sessionByIdemKey = new Map<string, string>();
  private subscriptions: Stripe.Subscription[] = [];
  private seq = 0;

  constructor(private options: FakeOptions = {}) {}

  setOptions(options: FakeOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Globally unique across fake instances.
   *
   * `Subscription.stripeCustomerId` is `@unique`, so a per-instance counter
   * would collide between tests and surface as a constraint violation that has
   * nothing to do with the behaviour under test.
   */
  private readonly nonce = Math.random().toString(36).slice(2, 10);

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_fake${this.nonce}${String(this.seq).padStart(4, "0")}`;
  }

  /** Seeds a subscription as though Stripe already had one. */
  addSubscription(input: {
    id?: string;
    customer: string;
    status: string;
    priceId: string;
    userId?: string;
    created?: number;
    cancelAtPeriodEnd?: boolean;
  }): Stripe.Subscription {
    const subscription = {
      id: input.id ?? this.id("sub"),
      object: "subscription",
      customer: input.customer,
      status: input.status,
      livemode: false,
      created: input.created ?? 1_000,
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
      metadata: input.userId ? { userId: input.userId } : {},
      items: {
        object: "list",
        data: [
          {
            id: this.id("si"),
            price: { id: input.priceId, type: "recurring", recurring: { interval: "month" } },
            current_period_end: 1_800_000_000,
          },
        ],
        has_more: false,
      },
    } as unknown as Stripe.Subscription;

    this.subscriptions.push(subscription);
    return subscription;
  }

  /**
   * Seeds an open Session that this application has no row for.
   *
   * Covers the cases a retrieve-by-stored-id design cannot see: an orphan whose
   * id was never persisted, a pre-fix Session with no `attemptId`, and a Session
   * belonging to a different attempt.
   */
  seedOpenSession(input: {
    customer: string;
    priceId: string;
    userId?: string;
    attemptId?: string;
    expiresInSeconds?: number;
    subscription?: string | null;
    mode?: string;
    livemode?: boolean;
  }): Stripe.Checkout.Session {
    const id = this.id("cs");
    const metadata: Record<string, string> = {};
    if (input.userId) metadata["userId"] = input.userId;
    if (input.attemptId) metadata["attemptId"] = input.attemptId;

    const session = {
      id,
      object: "checkout.session",
      status: "open",
      livemode: input.livemode ?? false,
      mode: input.mode ?? "subscription",
      customer: input.customer,
      subscription: input.subscription ?? null,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      expires_at: Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 1800),
      metadata,
    } as unknown as Stripe.Checkout.Session;

    this.sessions.set(id, session);
    this.sessionPriceIds.set(id, input.priceId);
    return session;
  }

  /** Seeds a Customer as though Stripe already had one. */
  seedCustomer(input: { userId?: string; livemode?: boolean }): Stripe.Customer {
    const id = this.id("cus");
    const customer = {
      id,
      object: "customer",
      livemode: input.livemode ?? false,
      metadata: input.userId ? { userId: input.userId } : {},
    } as unknown as Stripe.Customer;
    this.customers.set(id, customer);
    return customer;
  }

  sessionStatus(id: string): string | undefined {
    return this.sessions.get(id)?.status ?? undefined;
  }

  setSubscriptionStatus(id: string, status: string): void {
    const found = this.subscriptions.find((s) => s.id === id);
    if (found) (found as { status: string }).status = status;
  }

  get client(): Stripe {
    // The returned literal mimics the Stripe SDK's shape, whose methods are
    // plain functions, so the fake captures the instance to count calls.
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

    return {
      customers: {
        async create(
          params: Stripe.CustomerCreateParams,
          options?: { idempotencyKey?: string },
        ): Promise<Stripe.Customer> {
          self.customerCreateCalls += 1;

          if (self.options.customerCreateThrows) {
            self.options.customerCreateThrows = false;
            throw new Error("create failed; nothing recorded");
          }

          const key = options?.idempotencyKey;
          if (key) {
            const existing = self.customerByIdemKey.get(key);
            // Replay under the same key returns the original object, exactly as
            // Stripe does inside its retention window.
            if (existing) return self.customers.get(existing)!;
          }

          if ((self.options.loseCustomerResponses ?? 0) > 0) {
            self.options.loseCustomerResponses! -= 1;
            // Record it first: the object exists at Stripe even though the
            // caller never learns its id. That is the case recovery must handle.
            const id = self.id("cus");
            const customer = {
              id,
              object: "customer",
              livemode: false,
              metadata: params.metadata ?? {},
            } as unknown as Stripe.Customer;
            self.customers.set(id, customer);
            if (key) self.customerByIdemKey.set(key, id);
            throw new Error("network error: response lost");
          }

          const id = self.id("cus");
          const customer = {
            id,
            object: "customer",
            livemode: self.options.customerWrongLivemode === true,
            metadata: params.metadata ?? {},
          } as unknown as Stripe.Customer;
          self.customers.set(id, customer);
          if (key) self.customerByIdemKey.set(key, id);
          return customer;
        },

        async search(
          params: Stripe.CustomerSearchParams,
        ): Promise<Stripe.ApiSearchResult<Stripe.Customer>> {
          if (self.options.searchUnavailable) throw new Error("search unavailable");

          const match = /metadata\['userId'\]:'([^']+)'/.exec(params.query);
          const userId = match?.[1];
          const data = [...self.customers.values()].filter(
            (c) => c.metadata?.["userId"] === userId,
          );
          // `has_more` with no usable cursor: the caller must treat a partial
          // search as failure, because "zero results" from a truncated search is
          // indistinguishable from "no Customer exists".
          if (self.options.searchIncomplete) {
            return {
              object: "search_result",
              data: [],
              has_more: true,
              next_page: null,
            } as unknown as Stripe.ApiSearchResult<Stripe.Customer>;
          }

          return {
            object: "search_result",
            data,
            has_more: false,
            next_page: null,
          } as unknown as Stripe.ApiSearchResult<Stripe.Customer>;
        },
      },

      checkout: {
        sessions: {
          async create(
            params: Stripe.Checkout.SessionCreateParams,
            options?: { idempotencyKey?: string },
          ): Promise<Stripe.Checkout.Session> {
            self.sessionCreateCalls += 1;

            if (self.options.sessionCreateThrows) {
              self.options.sessionCreateThrows = false;
              throw new Error("create failed; nothing recorded");
            }

            const key = options?.idempotencyKey;
            if (key) {
              const existing = self.sessionByIdemKey.get(key);
              if (existing) return self.sessions.get(existing)!;
            }

            if (self.options.idempotencyInUse) {
              self.options.idempotencyInUse = false;
              const error = new Error("idempotency key in use") as Error & { code: string };
              error.code = "idempotency_key_in_use";
              throw error;
            }

            const id = self.id("cs");
            const forcedStatus = self.options.createReturnsComplete
              ? "complete"
              : self.options.createReturnsExpired
                ? "expired"
                : "open";
            self.options.createReturnsComplete = false;
            self.options.createReturnsExpired = false;

            const session = {
              id,
              object: "checkout.session",
              status: forcedStatus,
              livemode: false,
              mode: params.mode,
              customer: params.customer,
              subscription: null,
              url: `https://checkout.stripe.com/c/pay/${id}`,
              expires_at: params.expires_at ?? Math.floor(Date.now() / 1000) + 1800,
              metadata: params.metadata ?? {},
            } as unknown as Stripe.Checkout.Session;

            self.sessions.set(id, session);
            if (key) self.sessionByIdemKey.set(key, id);

            // Record the Price actually requested, so `listLineItems` reports
            // the truth rather than a default that would silently pass or fail
            // the verification under test.
            const requested = params.line_items?.[0]?.price;
            if (typeof requested === "string") self.sessionPriceIds.set(id, requested);

            if ((self.options.loseSessionResponses ?? 0) > 0) {
              self.options.loseSessionResponses! -= 1;
              throw new Error("network error: response lost");
            }

            return session;
          },

          async retrieve(id: string): Promise<Stripe.Checkout.Session> {
            const session = self.sessions.get(id);
            if (!session) throw new Error("No such checkout session");
            return session;
          },

          async list(params: {
            customer?: string;
            status?: string;
          }): Promise<Stripe.ApiList<Stripe.Checkout.Session>> {
            const data = [...self.sessions.values()].filter(
              (s) =>
                (params.customer === undefined || s.customer === params.customer) &&
                (params.status === undefined || s.status === params.status),
            );
            // `has_more` with an unadvanceable cursor: the caller must treat a
            // truncated enumeration as failure rather than as "nothing else".
            if (self.options.sessionListIncomplete) {
              return {
                object: "list",
                data,
                has_more: true,
              } as Stripe.ApiList<Stripe.Checkout.Session>;
            }
            return {
              object: "list",
              data,
              has_more: false,
            } as Stripe.ApiList<Stripe.Checkout.Session>;
          },

          async listLineItems(id: string): Promise<Stripe.ApiList<Stripe.LineItem>> {
            if (self.options.lineItemsUnavailable) throw new Error("line items unavailable");

            const session = self.sessions.get(id);
            if (!session) throw new Error("No such checkout session");
            const priceId = self.sessionPriceIds.get(id) ?? "price_plus";

            if (self.options.lineItemsEmpty) {
              return {
                object: "list",
                data: [],
                has_more: false,
              } as unknown as Stripe.ApiList<Stripe.LineItem>;
            }
            if (self.options.lineItemsMultiple) {
              return {
                object: "list",
                data: [
                  { id: "li_1", price: { id: priceId } },
                  { id: "li_2", price: { id: priceId } },
                ],
                has_more: false,
              } as unknown as Stripe.ApiList<Stripe.LineItem>;
            }

            return {
              object: "list",
              data: [{ id: "li_1", price: { id: priceId } }],
              has_more: false,
            } as unknown as Stripe.ApiList<Stripe.LineItem>;
          },

          async expire(id: string): Promise<Stripe.Checkout.Session> {
            if (self.options.expireFails) throw new Error("expire failed");

            const session = self.sessions.get(id);
            if (!session) throw new Error("No such checkout session");
            if (session.status !== "open") throw new Error("Session is not open");

            // Succeeds but the Session stays open: `expire` returning without
            // throwing is not proof, which is why the caller re-retrieves.
            if (self.options.expireDoesNotStick) return session;

            (session as { status: string }).status = "expired";
            return session;
          },
        },
      },

      subscriptions: {
        async list(params: { customer?: string }): Promise<Stripe.ApiList<Stripe.Subscription>> {
          self.listCalls += 1;
          if (self.options.listDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, self.options.listDelayMs));
          }
          // Deep-copied at read time. The real API returns a JSON snapshot, so a
          // later mutation must not retroactively change an already-taken read —
          // otherwise a "stale snapshot" test silently observes current state
          // and proves nothing.
          const data = self.subscriptions
            .filter((s) => params.customer === undefined || s.customer === params.customer)
            .map((s) => structuredClone(s) as Stripe.Subscription);

          if (self.options.beforeListReturns) await self.options.beforeListReturns();
          if (self.options.subscriptionListIncomplete) {
            return { object: "list", data, has_more: true } as Stripe.ApiList<Stripe.Subscription>;
          }
          return { object: "list", data, has_more: false } as Stripe.ApiList<Stripe.Subscription>;
        },
      },
    } as unknown as Stripe;
  }

  /** Line-item price per session, so a wrong-Price session can be simulated. */
  sessionPriceIds = new Map<string, string>();
}
