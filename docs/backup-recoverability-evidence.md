# Backup/PITR recoverability evidence

**Дата инвентаризации:** 2026-08-31
**Метод:** read-only проверка versioned repository/configuration и действующего runbook, плюс
`2026-08-27` GET metadata production Supabase Storage bucket (HTTP 200) и `2026-08-31` CLI queries
к Supabase Management API/Cloudflare. Список Storage objects и customer payload не читались. Ни
Dashboard Supabase, ни Cloudflare, ни production database/storage не изменялись.

**Статус TD-017:** external read-only inventory завершён; он подтвердил failed recoverability state,
а не гарантию. Это dated evidence текущего состояния и P0 gate для destructive/schema-rewrite
release до исправления в TD-203.

| Контур | Проверенное evidence | Текущий статус | RPO / RTO |
| --- | --- | --- | --- |
| PostgreSQL PITR и daily backup | `supabase backups list --project-ref qxyieyzfdcosmmckyocm --output json` (2026-08-31, CLI 2.95.4) вернул `pitr_enabled=false`, `backups=[]`, `physical_backup_data={}` и `walg_enabled=true`. | **Не включён; recoverable point отсутствует** | Нет RPO / нет RTO |
| Независимый Storage backup | Live metadata source Storage bucket доступны (HTTP 200; `public=true`, file-size/MIME policies configured), но это не independent backup. `backend/wrangler.toml` не включает `STORAGE_BACKUP`. Authenticated `wrangler r2 bucket info agromarketkz-storage-backup-prod` вернул Cloudflare API `10042`: R2 не enabled на account, поэтому bucket/lock не существуют. | **Не сконфигурирован; R2 не активирован** | Нет независимой точки / нет RTO |
| Storage manifest и checksum | При неактивном R2 target manifest/complete/checksum отсутствуют; `storageBackup` не имеет active binding. | **Не существует — не recoverable evidence** | Нет RPO / нет RTO |
| Restore drill | В tracked repository нет dated записи успешного restore в изолированный target с duration, migration state и Storage integrity. | **Unknown — не подтверждён** | Не измерены / не утверждены |
| Failure alerts | Нет dated read-only evidence действующего alert на stale/failed backup. | **Unknown** | Неприменимо |

Это подтверждённый **failed** state, а не отсутствие проверки: PITR/physical backup и independent
Storage recovery в production сейчас отсутствуют. Cloudflare R2 нельзя включить Wrangler command —
платформенный API требует сначала enable R2 через Dashboard (API `10042`); Supabase CLI не имеет
команды включения PITR для существующего project. До remediation в TD-203 нельзя заявлять RPO/RTO
или разрешать destructive/schema-rewrite release. Additive migration возможна только с отдельным
risk review.

## Ownership и закрытие gap

Владелец сбора evidence и отдельной operational авторизации — production owner,
идентифицируемый через `ADMIN_OWNER_TELEGRAM_ID`; он фиксирует ссылку на Dashboard evidence без
секретов. Target RPO/RTO также пока не утверждены: их нельзя выбирать из repository assumptions,
поскольку они определяют retention, стоимость и допустимую недоступность.

Чтобы перевести failed state в гарантию, owner выполняет remediation TD-203 и прикладывает dated
evidence:

1. Supabase project ref, active backup/PITR plan, retention и latest recoverable point;
2. private R2 target без public access, immutable Bucket Lock rules для `snapshots/` **и**
   `manifests/`, separately retained manifest digest и latest manifest с `complete=true`/checksum
   без customer payload;
3. alert history для failed/stale backup;
4. отдельную authorization и measured isolated restore drill по
   [`restore-drill-plan.md`](./restore-drill-plan.md).

Активация backup pipeline, включение R2/PITR, периодические drills, freshness gate и утверждённые
RPO/RTO остаются в [TD-203](../tech_debt/stage-2/203-durable-maintenance-and-backup.md). Никакой
production restore, history rewrite, платный ресурс или изменение retention не являются частью
TD-017.
