# Runtime capability audit (TD-018)

## Repeatable collection

Run `bun run --cwd backend audit:runtime-capabilities` only with an authenticated Supabase CLI
profile linked to the intended project. The SQL starts `READ ONLY`, has a 10-second timeout, and
reads only PostgreSQL catalogs: role attributes/memberships, effective database/schema/relation/
column/sequence/function grants, RLS, ownership and default ACLs. It emits neither DSN, credential
nor application rows. Relations include tables, partitioned tables, views, materialized views and
foreign tables. The function result includes every non-temporary schema where `agromarket_runtime`
has effective EXECUTE or ownership, including inherited `PUBLIC` PostgreSQL built-ins; this makes the
raw operational result intentionally large.

The command's `runtime_role` must show a non-superuser, non-create-role, non-create-db runtime
role. Any missing role, unexpected membership, `create=true`, unrelated table privilege, or
unexpected function execution is a TD-204 remediation gap; do not issue `GRANT`/`REVOKE` from this
audit command.

## Required capability map

| Execution path | Required DB capability | Other runtime capability |
| --- | --- | --- |
| `GET /catalog/{categories,territories,cards,cards/:id}` | SELECT public catalog, card-image/spec/territory joins and public `platform_settings` | — |
| `POST /auth/{telegram,widget,widget/exchange}` | SELECT/INSERT/UPDATE public `users`; SELECT/INSERT/UPDATE `app_private.user_sessions`, `widget_auth_proofs`, `telegram_auth_cutoffs` | KV auth cache |
| `POST /auth/{logout,logout-all}` | UPDATE `app_private.user_sessions` | KV auth cache delete |
| `GET|POST|PUT|DELETE /profile` | SELECT/INSERT/UPDATE public `users`; SELECT/INSERT/UPDATE/DELETE `app_private.user_sessions`, `telegram_auth_cutoffs`, `privacy_holds`; INSERT `admin_audit_events` | KV auth cache delete |
| `GET|POST|DELETE /favorites` | SELECT/INSERT/DELETE public `favorites`; SELECT card/catalog joins | — |
| `POST /requests` and `POST /feedback` | SELECT/INSERT public request/feedback and referenced catalog/user rows; INSERT `notification_outbox` | Telegram Queue enqueue |
| `GET|PATCH /admin/{requests,settings,users}` | SELECT/UPDATE public request/settings/users; INSERT `admin_audit_events` and `admin_audit_outbox` | Telegram Queue enqueue |
| `GET|POST|PATCH|DELETE /admin/categories` | SELECT/INSERT/UPDATE/DELETE public `categories`; INSERT audit intent/outbox | Telegram Queue enqueue |
| `GET|POST|PUT|DELETE /admin/cards` | SELECT/INSERT/UPDATE/DELETE public cards, images, specs, service territories and update mutations; INSERT audit intent/outbox | Supabase Storage object cleanup; Telegram Queue enqueue |
| `POST /admin/uploads{,/complete}` | SELECT/INSERT/UPDATE/DELETE `card_image_upload_claims`; INSERT/UPDATE public card images | Supabase Storage signed upload/read/delete scoped by app-owned path |
| Notification Queue | `notification_outbox`: SELECT/UPDATE; public `requests`, `feedback_messages`, `users`, `platform_settings`, territories: SELECT | Telegram Bot API |
| Telegram-update Queue | `telegram_updates`: INSERT/SELECT/UPDATE; public `platform_settings`: SELECT/UPDATE. It does not require `telegram_updates.DELETE` or any `telegram_start_cooldowns` privilege. | Telegram Queue and Bot API |
| Five-minute cron | `widget_auth_proofs`: DELETE; `admin_audit_outbox` and `notification_outbox`: SELECT/UPDATE; `maintenance_checkpoints`: SELECT/INSERT/UPDATE | Analytics Engine/Telegram best effort |
| Daily cron | `user_sessions` and `telegram_auth_cutoffs`: DELETE; privacy/maintenance reads and writes; Storage cleanup only uses declared app data | Supabase Storage; optional R2 backup only when `STORAGE_BACKUP` is bound |

`app_private.admin_audit_events` is intentionally insert-only. `maintenance_checkpoints` is an
explicit runtime capability introduced by migration 0022 and must appear in each future production
audit. The isolated test creates `agromarket_runtime` before migrations, grants the production-required
schema `USAGE`, and proves a required outbox read plus denial of unrelated table reads, audit-event
deletion, unrelated-schema reads and schema creation. The migration-only missing `USAGE` remains an environment-drift gap.
TD-204 owns the explicit minimum-grant remediation and rollback SQL.

## 2026-08-31 production evidence

`bun run --cwd backend audit:runtime-capabilities` ran against the linked production project on
2026-08-31. The redacted catalog result established: `agromarket_runtime` exists, has no memberships,
is non-superuser/non-create-role/non-create-db, has `BYPASSRLS`, and has `USAGE=true`/`CREATE=false`
for `public` and `app_private`. No DSN, token, object key or customer row was read or stored. The
audited record is the command's structured JSON result; this document records the classified,
non-sensitive findings and exact follow-up candidates.

| Priority | Confirmed gap | Owner / impact | Minimal remediation candidate and rollback |
| --- | --- | --- | --- |
| P1 | Broad CRUD exists on all public tables, and public-table default ACLs grant SELECT/INSERT/UPDATE/DELETE to this role for future tables. | TD-204; a compromised Worker can modify unrelated current or future data. | For each public table that is not in the operation map, issue a separate reviewed `REVOKE <verb> ON public.<table> FROM agromarket_runtime;`; rollback is the exact inverse `GRANT <verb> ON public.<table> TO agromarket_runtime;`. After the current objects are reduced, remove the future blast radius with `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM agromarket_runtime;`; rollback restores only verified needed verbs. |
| P1 | Private-object excesses: `notification_outbox.DELETE`, `telegram_updates.DELETE`, and all `telegram_start_cooldowns` privileges are not in the operation map. | TD-204; unrelated queue state can be removed or forged. | `REVOKE DELETE ON app_private.notification_outbox, app_private.telegram_updates FROM agromarket_runtime; REVOKE ALL ON app_private.telegram_start_cooldowns FROM agromarket_runtime;`. Rollback: `GRANT DELETE ON app_private.notification_outbox, app_private.telegram_updates TO agromarket_runtime; GRANT SELECT, INSERT, UPDATE ON app_private.telegram_start_cooldowns TO agromarket_runtime;` only if a validated consumer is restored. |
| P1 | Migrations 0020–0022 are not in production, so `telegram_auth_cutoffs`, `admin_audit_outbox` and `maintenance_checkpoints` have no effective runtime capability. The deployed auth reader/writer and daily auth-cutoff retention will fail, as will the newer outbox/checkpoint paths. | Release owner; authentication, retention and scheduled recovery cannot be assumed runnable. | Apply the ordered migration workflow, re-run this audit, and recover only through documented forward migrations. |
| P1 | `user_sessions.DELETE=false`, while the daily privacy-retention job deletes expired/revoked sessions. | Release owner; stale session records accumulate and the job can fail before later retention stages. | Authorize a forward migration with `GRANT DELETE ON app_private.user_sessions TO agromarket_runtime;`; rollback is `REVOKE DELETE ON app_private.user_sessions FROM agromarket_runtime;` after disabling or changing that job. |
| P1 | `SUPABASE_SERVICE_ROLE_KEY` allows Storage read/list/delete for the entire project bucket; no path-level negative test is possible for this credential. | TD-204; credential compromise reaches unrelated object paths. | Split privileged Storage work into a narrowly scoped boundary before removing the service role; rollback restores the prior Worker secret/binding only after validation. |
| P2 | Fresh migration baseline lacks `USAGE` on `app_private` despite table-level grants. Production has the manual grant, so a new environment can silently differ. | TD-204; causes deployment drift rather than current outage. | Add explicit `GRANT USAGE ON SCHEMA app_private TO agromarket_runtime` in an authorized migration; rollback revokes only schema usage after dependent table grants are removed. |
| P2 | Database `TEMPORARY=true` is effective, but no execution path needs temp tables. | TD-204; compromised SQL can allocate transient objects. | `REVOKE TEMPORARY ON DATABASE postgres FROM agromarket_runtime;` (substitute the audited database name). Rollback: `GRANT TEMPORARY ON DATABASE postgres TO agromarket_runtime;` only if a tested consumer requires it. |

The full command output is deliberately not committed: it is dated operational evidence. Re-run it
before proposing any privilege change; a changed result supersedes this snapshot.
