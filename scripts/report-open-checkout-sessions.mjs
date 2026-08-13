#!/usr/bin/env node
/**
 * Read-only inventory of open Stripe Checkout Sessions.
 *
 * Run before deploying the billing concurrency fix. Pre-existing open Sessions
 * carry no `attemptId` metadata, so they are invisible to the new attempt table
 * and can still be completed by a browser tab — creating exactly the duplicate
 * subscription this fix exists to prevent.
 *
 * **This script mutates nothing.** It lists, classifies, and counts. Expiring a
 * Session is an operator decision and needs its own authorization.
 *
 * Prints no secret, no Checkout URL, and no customer email. Session and customer
 * identifiers are shortened, because a full Checkout URL is bearer-like and even
 * a full id is more than a triage summary needs.
 */

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PLUS_PRICE_ID;

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}
if (!priceId) {
  console.error("STRIPE_PLUS_PRICE_ID is not set.");
  process.exit(1);
}

// Mode comes from the key, never from NODE_ENV.
const mode = key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : "live";

if (mode === "live") {
  console.error("Refusing to run against live mode. This inventory is a test-mode tool.");
  process.exit(1);
}

console.log(`Stripe mode: ${mode}`);
console.log(`Server-owned Price: ${short(priceId)}`);
console.log("");

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

function short(id) {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const summary = {
  total: 0,
  matching: 0,
  withAttemptId: 0,
  legacy: 0,
  byCustomer: new Map(),
  detail: [],
};

let startingAfter;
let pages = 0;

while (pages < 20) {
  pages += 1;

  const batch = await stripe.checkout.sessions.list({
    status: "open",
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  });

  for (const session of batch.data) {
    summary.total += 1;

    if (session.mode !== "subscription") continue;
    if (session.livemode !== false) continue;

    // Line items are not included in list responses.
    let items;
    try {
      items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
    } catch {
      continue;
    }

    if (items.data.length !== 1) continue;
    if (items.data[0]?.price?.id !== priceId) continue;

    summary.matching += 1;

    const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (customer) {
      summary.byCustomer.set(customer, (summary.byCustomer.get(customer) ?? 0) + 1);
    }

    if (session.metadata?.attemptId) summary.withAttemptId += 1;
    else summary.legacy += 1;

    // Sanitized triage detail. The Session id is safe to show — it is not a
    // bearer token — but the URL is, so it is never printed.
    summary.detail.push({
      id: session.id,
      livemode: session.livemode,
      status: session.status,
      created: new Date(session.created * 1000).toISOString(),
      expires: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : "none",
      customer: customer ? short(customer) : "none",
      subscriptionIsNull: session.subscription === null || session.subscription === undefined,
      priceMatches: true,
      hasUserMetadata: Boolean(session.metadata?.userId),
      hasAttemptMetadata: Boolean(session.metadata?.attemptId),
    });
  }

  if (!batch.has_more) break;
  startingAfter = batch.data.at(-1)?.id;
  if (!startingAfter) break;
}

console.log(`Open Sessions scanned:            ${summary.total}`);
console.log(`Matching this product's Price:    ${summary.matching}`);
console.log(`  carrying an attemptId:          ${summary.withAttemptId}`);
console.log(`  legacy (no attemptId):          ${summary.legacy}`);
console.log("");

if (summary.detail.length > 0) {
  console.log("Matching open Sessions (sanitized; URL deliberately omitted):");
  for (const d of summary.detail) {
    console.log(`  id                 ${d.id}`);
    console.log(`  livemode           ${String(d.livemode)}`);
    console.log(`  status             ${d.status}`);
    console.log(`  created            ${d.created}`);
    console.log(`  expires            ${d.expires}`);
    console.log(`  customer           ${d.customer}`);
    console.log(`  subscription null  ${String(d.subscriptionIsNull)}`);
    console.log(`  price matches      ${String(d.priceMatches)}`);
    console.log(`  userId metadata    ${d.hasUserMetadata ? "present" : "ABSENT"}`);
    console.log(`  attemptId metadata ${d.hasAttemptMetadata ? "present" : "ABSENT"}`);
    console.log("");
  }
}

const multi = [...summary.byCustomer.entries()].filter(([, count]) => count > 1);

if (summary.legacy === 0 && multi.length === 0) {
  console.log("No pre-fix open Sessions found. Nothing to remediate.");
  process.exit(0);
}

if (multi.length > 0) {
  console.log("Customers with more than one matching open Session:");
  for (const [customer, count] of multi) console.log(`  ${short(customer)}  ${count} sessions`);
  console.log("");
}

console.log("Pre-fix open Sessions exist.");
console.log("STOP: remediation is not automatic and was not performed.");
console.log("Expiring a Session is an operator decision requiring explicit authorization.");
process.exit(2);
