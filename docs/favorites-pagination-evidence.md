# Favorites pagination evidence (TD-015)

**Дата измерения:** 2026-08-31  
**Метод:** read-only aggregate query through the linked Supabase CLI project. Query returned only
counts and percentiles; it did not select user identifiers or card data.

## Page-size decision

| Metric | Value |
| --- | ---: |
| Users with favorites | 0 |
| Total favorites | 0 |
| P50 favorites per user | 0 |
| P95 favorites per user | 0 |
| Maximum favorites per user | 0 |

There is no representative non-empty production traversal yet. TD-015 therefore keeps the existing
shared conservative bounds: default `20`, maximum `50`. The cursor endpoint is opt-in
(`pagination=cursor`) so legacy clients retain their unbounded array response during rollout; the
current webapp always opts in.

## Index decision

The production distribution contains no non-empty favorite list, so an `EXPLAIN (ANALYZE, BUFFERS)`
would not represent the intended keyset path. No migration is added. The existing
`favorites_user_id_created_at_idx` remains in place. Before a favorites-specific index is proposed,
repeat the aggregate measurement after real usage and run `EXPLAIN (ANALYZE, BUFFERS)` against a
representative non-empty list, comparing the existing index with the exact
`user_id, created_at DESC, card_id DESC` keyset predicate.
