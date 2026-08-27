# Isolated restore drill plan

Этот план предназначен только для отдельного operational approval. Он не создаёт project, не
восстанавливает backup и не удаляет данные сам по себе. Supabase restore выполняется через
Dashboard в **new project/clone**; source production project никогда не является target.

## Preconditions

- Есть отдельная запись `RESTORE_AUTHORIZATION_ID`, owner и согласованные target RPO/RTO.
- Source evidence содержит exact backup/PITR point и, если требуется Storage, manifest с
  `complete=true` и checksum. Retention должен быть immutable и для `snapshots/`, и для
  `manifests/`; digest manifest хранится отдельно от R2 target. Без этого manifest не является
  authority для полноты или integrity.
- До clone выполнен read-only inventory source: enabled extensions, `pg_cron` jobs, `pg_net`,
  database webhooks/wrappers, Edge Functions и external credentials/bindings. До запуска clone
  inventory должен доказать отсутствие emitters в выбранной точке восстановления **либо** наличие
  platform-supported containment, действующего до первого запуска cloned database. Post-clone
  containment не устраняет окно side effect. Если это нельзя доказать, drill не запускать.
- Не подключать к будущему target Worker, Pages, production webhook, queue consumer, bot token
  или Git integration. До clone operator обязан подтвердить, что target можно изолировать с
  первого момента доступности: project membership только у утверждённых операторов, least-privilege
  network/API/database access и отключённые real-user Auth/email flows. Если платформа не даёт
  такой границы до доступа к cloned data, clone production backup для drill не запускать. Clone
  создаёт новый project сам и сообщает его ref только после готовности.

Перед любым Dashboard действием эта проверка должна завершиться без ошибок. Она намеренно только
печатает план и отказывается от production target:

```bash
set -euo pipefail
SOURCE_PROJECT_REF="qxyieyzfdcosmmckyocm"
: "${RESTORE_AUTHORIZATION_ID:?Set the approved authorization record}"
printf 'Authorized restore drill %s: source=%s; target ref must be recorded only after clone completes.\n' \
  "$RESTORE_AUTHORIZATION_ID" "$SOURCE_PROJECT_REF"
```

## Drill

1. In Supabase Dashboard select the proven source backup/PITR point and use **Restore to a new
   project**. Record source point timestamp, operator and start time; do not select “restore this
   project”.
2. Wait until the target is available. Immediately record its actual ref and set
   `RESTORE_TARGET_REF` in the guard below; it must differ from production. Before any customer
   data query, verify the pre-approved inbound boundary: only approved project members, restrictive
   network/API/database access, and no real-user Auth/email flow. Also confirm that the pre-clone
   emitter proof or pre-start containment is still effective: no cron, webhook, function, wrapper
   or external credential can emit a production side effect. Any missing proof is a failed drill;
   do not rely on a post-clone change to make an already-running target safe.

   ```bash
   set -euo pipefail
   SOURCE_PROJECT_REF="qxyieyzfdcosmmckyocm"
   : "${RESTORE_TARGET_REF:?Record the actual target ref only after the clone is ready}"
   if [ "$RESTORE_TARGET_REF" = "$SOURCE_PROJECT_REF" ]; then
     printf '%s\n' 'Refusing production project as restore target.' >&2
     exit 1
   fi
   printf 'Contained target recorded: %s\n' "$RESTORE_TARGET_REF"
   ```
3. Record end time and calculated database restore duration; failure or missing duration is a
   failed drill, not a partial pass. Connect only to the contained target and verify migration
   ledger, row-count invariants for approved non-PII tables, critical constraints, and a synthetic
   authenticated read. Compare source point timestamp to restored state; record the observed data
   gap without copying customer payload into a ticket.
4. Storage passes only when the chosen independent manifest has `complete=true`, immutable
   retention covering both manifest and snapshot objects, and a separately retained matching
   manifest digest **and** an approved sample is restored into the isolated target Storage bucket
   under the same expected paths. Read those objects through the target Storage/API boundary and
   compare SHA-256 to the immutable manifest. Reading the source R2 object alone is evidence of
   neither recoverability nor Storage RTO; without the target restore, mark Storage as not tested
   and do not claim a full pass.
5. Confirm target has no production Worker/Pages deployment, webhook delivery, queue consumer,
   Telegram send or credentials before or after the checks.
6. Save only metadata: authorization id, source/target refs, timestamps, measured DB and Storage
   durations, migration/integrity results, gap and incident links. Treat any failed invariant as a
   failed drill.
7. After evidence retention is approved, delete the isolated target through the Dashboard. Never
   delete or pause the source project as drill cleanup.

## Expected result and escalation

A passing drill has dated proof that no emitter can run before containment, a distinct target with
the verified inbound boundary, recorded DB and Storage durations, compatible migration ledger,
expected integrity checks, immutable/digest-verified manifest, restored-and-read target Storage
when that scope is claimed, and no production side effects. Until that evidence is dated and linked from
[`backup-recoverability-evidence.md`](./backup-recoverability-evidence.md), RPO/RTO remain
unmeasured and destructive/schema-rewrite releases stay blocked. Implementing automated backups,
alerts or recurring drills is [TD-203](../tech_debt/stage-2/203-durable-maintenance-and-backup.md).
