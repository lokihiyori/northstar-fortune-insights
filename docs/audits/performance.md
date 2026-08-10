# Performance audit

Phase 8F. Closes two gaps that had never been measured: **bundle size** and **vector retrieval
performance beyond the small seeded corpus**.

> **What this proves.** Real numbers, from the committed production build and from the retrieval
> service running against real PostgreSQL 17 + pgvector and real Redis, at corpus sizes up to 10,008
> passages.
>
> **What it does not prove.** Nothing here predicts production. Every figure comes from one Windows
> workstation with the database, cache and application on the same machine — no network latency, no
> concurrent load, no cold container, no shared CPU. **No production performance or scalability claim
> is made.**

## Method

|               |                                                                     |
| ------------- | ------------------------------------------------------------------- |
| Next.js       | 16.3.0 (Turbopack)                                                  |
| Node.js       | 22.16.0                                                             |
| Build command | `pnpm build`                                                        |
| Lighthouse    | 12.8.2, mobile form factor, `simulate` throttling, 3 runs per route |
| PostgreSQL    | 17.10 with pgvector 0.8.6 (`pgvector/pgvector:pg17`)                |
| Redis         | 7-alpine                                                            |
| Embeddings    | deterministic, 1536-dim; `OPENAI_API_KEY` unset throughout          |

**No performance threshold was set, and none is asserted.** Inventing a target after seeing results
would make the number meaningless. These are a baseline to compare future changes against.

## Lighthouse metrics

Median of 3 runs; individual accessibility scores in [accessibility.md](accessibility.md).

| Route      | Mode            | Perf (3 runs) | Median | FCP     | LCP     | CLS       | TBT     | Speed Index |
| ---------- | --------------- | ------------- | ------ | ------- | ------- | --------- | ------- | ----------- |
| `/`        | production      | 87 / 95 / 94  | **94** | 1422 ms | 2809 ms | **0.000** | 130 ms  | 1422 ms     |
| `/pricing` | production      | 96 / 96 / 91  | **96** | 1242 ms | 2647 ms | **0.000** | 47 ms   | 1242 ms     |
| `/app`     | **development** | 68 / 69 / 64  | **68** | 790 ms  | 2998 ms | **0.000** | 1697 ms | 958 ms      |
| `/admin`   | **development** | 72 / 67 / 64  | **67** | 755 ms  | 2942 ms | **0.000** | 2085 ms | 1362 ms     |

Reading these honestly:

- **Public routes are measured against the production build** and are the only figures worth
  tracking over time. 94 and 96 on simulated mobile throttling.
- **CLS is 0.000 everywhere** — no layout shift on any audited route.
- **`/app` and `/admin` are development-server numbers and are not comparable.** Their TBT (1.7–2.1 s)
  is dominated by unminified bundles and the HMR runtime, not by application code. They cannot be
  measured against production because production forces `Secure` cookies that a browser will not
  store over http (ADR 0007, confirmed in Phase 8D). **Do not quote 68 and 67 as production numbers.**
- The spread on `/` (87–95) shows single-run variance on a workstation; this is why three runs are
  taken and the median reported.

## Client bundle baseline

From `.next/static/**` of the committed production build — the bytes a browser actually downloads.
The whole `.next` directory is several times larger because it also contains server output and build
caches; reporting that as "bundle size" would be wrong.

| Measure                            | Value                                             |
| ---------------------------------- | ------------------------------------------------- |
| Client JavaScript files            | 28                                                |
| **Raw**                            | **1017.7 KB**                                     |
| **Gzip**                           | **299.7 KB**                                      |
| **Brotli**                         | **254.0 KB**                                      |
| CSS                                | 1 file, 37.7 KB raw / 7.7 KB gzip                 |
| Source maps                        | **0** — none emitted, none included in any figure |
| Server output (**not** downloaded) | 255 files, 6640.3 KB raw                          |

### Largest client chunks

| Gzip    | Raw      | Chunk                               |
| ------- | -------- | ----------------------------------- |
| 69.9 KB | 223.7 KB | `chunks/2d1omw-o--48p.js`           |
| 63.1 KB | 276.8 KB | `chunks/2_37zc2ofnfqb.js`           |
| 43.6 KB | 160.5 KB | `chunks/3vwy0axs98ia4.js`           |
| 38.7 KB | 110.0 KB | `chunks/0cz1d0mv5g_q7.js`           |
| 9.0 KB  | 26.5 KB  | `chunks/42g1uu0-x27ed.js`           |
| 8.4 KB  | 26.7 KB  | `chunks/27ep-nqiiqbdg.js`           |
| 7.5 KB  | 28.3 KB  | `chunks/0o31vqknnz3lk.js`           |
| 5.4 KB  | 14.8 KB  | `chunks/37uxvmb6miac_.js`           |
| 4.9 KB  | 17.5 KB  | `chunks/1qiv4p-zgqj71.js`           |
| 4.2 KB  | 10.6 KB  | `chunks/turbopack-18oijxts7cqrb.js` |

The four largest chunks are the React and Next runtime plus the shared application shell. Turbopack
emits content-hashed names with no readable module attribution, so a chunk cannot be mapped back to a
dependency without an analyzer — deliberately not added.

### Per-route client JavaScript

**Next 16 with Turbopack emits neither `app-build-manifest.json` nor a size column in the build
table**, so per-route attribution cannot be read from a manifest. It was measured instead from real
page loads with the browser cache disabled — decompressed bytes over the wire.

| Route      | Mode        | JS files | JS transferred | CSS     |
| ---------- | ----------- | -------- | -------------- | ------- |
| `/`        | production  | 10       | 522.6 KB       | 37.7 KB |
| `/pricing` | production  | 10       | 522.6 KB       | 37.7 KB |
| `/app`     | development | 16       | 3753.2 KB      | —       |
| `/admin`   | development | 15       | 3715.6 KB      | —       |

The two public routes load the same 10 chunks — the shared shell dominates, and neither pulls a
route-specific bundle of any size. The development figures are ~7× larger because dev bundles are
unminified and carry HMR; **they are not a production measurement** and exist only because those
routes cannot be served by the production build over http.

### Regression check

No obvious avoidable regression or oversized client-only import was found: no analytics SDK, no
charting library, no moment/lodash-scale dependency in client code. `openai` and `stripe` are
server-only and appear in the server output, not the client bundle. **No bundle fix was made,
because none was warranted** — and replacing libraries purely to lower this number was out of scope.

## Vector retrieval benchmark

### Methodology

Measured through **`retrieveEvidence`** — the same function the guidance pipeline calls — so the
Redis cache lookup, the Prisma round trip and row mapping are all included. A hand-written SQL timing
would exclude all three and flatter the result.

- Disposable database `northstar_retrieval_benchmark_<timestamp>`, guarded before every create and
  drop (rejects empty names, `postgres`, `template0`, `template1`, the development database, any name
  lacking the required prefix, and any name containing an unexpanded variable). Each refusal was
  demonstrated.
- Schema applied with `prisma migrate deploy`; verified with `pnpm db:verify`.
- The **development database was never a target** — confirmed afterwards: 0 benchmark rows in it.
- Deterministic embeddings at 1536 dimensions; `OPENAI_API_KEY` unset.
- 30 warm samples per checkpoint. Setup time measured separately and excluded from every query figure.
- Cold = generation counter bumped **and** the retrieval keyspace cleared, so it is genuinely uncached.

### Results

| Passages    | Cold (uncached) | Results | Warm p50    | Warm p95    | Samples | Cache keys | Setup (excluded) |
| ----------- | --------------- | ------- | ----------- | ----------- | ------- | ---------- | ---------------- |
| 28 (seeded) | 7.2 ms          | 1       | 1.01 ms     | 1.25 ms     | 30      | 1          | —                |
| 1,008       | 9.2 ms          | 8       | 0.86 ms     | 1.13 ms     | 30      | 1          | 0.4 s            |
| 5,008       | 27.1 ms         | 8       | 1.05 ms     | 1.81 ms     | 30      | 1          | 1.5 s            |
| **10,008**  | **51.4 ms**     | 8       | **0.87 ms** | **1.34 ms** | 30      | 1          | 2.5 s            |

### Cold versus warm

The Redis cache is doing the work it exists for. At 10,008 passages a cold query costs **51.4 ms**
and a warm one **0.87 ms** — roughly **59× faster**. Warm latency is flat across every corpus size,
which is expected: a cache hit does not touch the corpus at all.

Cold latency scales close to linearly with corpus size — 7 → 9 → 27 → 51 ms — which is exactly what
an exact scan should do.

### EXPLAIN ANALYZE (supplementary diagnostic only)

```
Limit  (cost=765.32..765.34 rows=8) (actual time=31.433..31.436 rows=8 loops=1)
  ->  Sort  (cost=765.32..790.15 rows=9934) (actual time=31.432..31.434 rows=8 loops=1)
        Sort Method: top-N heapsort  Memory: 25kB
        ->  Hash Join  (actual time=0.115..30.240 rows=10008 loops=1)
              ->  Seq Scan on source_chunks c  (actual time=0.005..1.202 rows=10008 loops=1)
                    Filter: (embedding IS NOT NULL)
              ->  Seq Scan on sources s  (actual time=0.003..0.059 rows=511 loops=1)
                    Filter: (("deletedAt" IS NULL) AND (status = 'PUBLISHED'))
Planning Time: 0.185 ms
Execution Time: 31.454 ms
```

This is **supplementary** — the service timings above are the benchmark. It confirms the shape:
a sequential scan over all embedded chunks, a top-N heapsort for the 8 nearest, and no index scan.

### No ANN index — by design

The plan shows a `Seq Scan` because **there is deliberately no approximate-nearest-neighbour index**.
An HNSW index was added in migration `20260805050000` and removed in `20260805064500`: Prisma 7 has
no `Hnsw` index type, so an index it cannot represent is permanent drift, and every `migrate dev`
regenerated a `DROP INDEX` for it (ADR 0003). Retrieval uses exact cosine distance.

This was **not** lost during any benchmark or restore — it is the recorded design.

### When to revisit indexing

Concrete thresholds, so the decision is evidence-driven rather than a feeling:

| Signal                          | Threshold         | Action                                                         |
| ------------------------------- | ----------------- | -------------------------------------------------------------- |
| Cold p95 on production hardware | > 200 ms          | Investigate; users notice this inside a generation             |
| Cold p95                        | > 500 ms          | Add an ANN index as a managed operational step outside Prisma  |
| Corpus size                     | > 50,000 passages | Re-benchmark before it becomes urgent                          |
| Cache hit rate                  | < 50%             | The cache is not absorbing the load the current design assumes |

Extrapolating the linear trend, ~50,000 passages would put a cold query near 250 ms on _this_
hardware. That is an extrapolation from four points on a workstation, not a prediction — the real
trigger is measuring it on production hardware.

An ANN index, when added, would be an operational step outside Prisma's managed schema, with the
migration workflow pinned accordingly (ADR 0003), and it trades exact results for approximate ones.

## Cleanup

- Benchmark database dropped; `0` remaining, only `northstar` and `postgres` on the instance.
- Retrieval cache keys removed; `0` remaining; `0` keys containing `bench`.
- Temporary benchmark test deleted; no generated benchmark data committed.
- Development database verified untouched: `sources=14`, `benchmark_rows=0`.

## Limitations

1. **Local workstation only.** One machine, everything co-located, no network latency, no concurrent
   load, no cold start. Production numbers will differ, probably substantially.
2. **Synthetic corpus.** Benchmark passages are near-identical generated text with deterministic
   embeddings, so vector _distribution_ is unrealistic. Real embeddings cluster differently, which
   affects sort behaviour.
3. **Single query shape.** One query, one topic, no region filter, `LIMIT 8`.
4. **Single concurrency.** Sequential requests only; no contention measured.
5. **Authenticated Lighthouse figures are development-mode** and not comparable to production.
6. **Per-route bundle sizes are transfer measurements**, not manifest attribution, because Next 16
   with Turbopack does not expose the latter.
7. **No production deployment exists**, so no real-user metrics are available at all.
