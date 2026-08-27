# Backup/PITR recoverability evidence

**Дата инвентаризации:** 2026-08-27  
**Метод:** read-only проверка versioned repository/configuration и действующего runbook, плюс
`2026-08-27` GET metadata production Supabase Storage bucket (HTTP 200). Список объектов и payload
не читались. Ни Dashboard Supabase, ни Cloudflare, ни production database/storage не изменялись.

**Статус TD-017:** подготовлена только repository/runbook часть. External read-only inventory из
самой задачи не выполнен, поэтому этот документ не является dated evidence recoverability и задача
остаётся открытой.

| Контур | Проверенное evidence | Текущий статус | RPO / RTO |
| --- | --- | --- | --- |
| PostgreSQL PITR и daily backup | В репозитории нет dated Dashboard/API evidence о плане, retention или latest recoverable point. Тариф сам по себе не является доказательством. | **Unknown — не гарантия** | Не измерены / не утверждены |
| Независимый Storage backup | Live metadata source Storage bucket доступны (HTTP 200; `public=true`, file-size/MIME policies configured), но это не independent backup. `backend/wrangler.toml` не включает `STORAGE_BACKUP`: R2 binding намеренно закомментирован до создания private bucket и Bucket Lock. | **Не сконфигурирован по tracked config; R2 не подтверждён** | Нет независимой точки / нет RTO |
| Storage manifest и checksum | В tracked repository нет location/latest manifest с `complete=true` и нет его dated проверки. | **Unknown — не recoverable evidence** | Не измерены / не утверждены |
| Restore drill | В tracked repository нет dated записи успешного restore в изолированный target с duration, migration state и Storage integrity. | **Unknown — не подтверждён** | Не измерены / не утверждены |
| Failure alerts | Нет dated read-only evidence действующего alert на stale/failed backup. | **Unknown** | Неприменимо |

Это не доказывает, что внешний backup отсутствует: это доказывает отсутствие проверяемого
evidence на указанную дату. Service-role key не даёт доказательства Supabase plan/PITR, а в
локальной operational configuration нет Cloudflare API token для read-only R2 inventory. До
получения evidence нельзя заявлять RPO/RTO или разрешать
destructive/schema-rewrite release. Additive migration возможна только с отдельным risk review.

## Ownership и закрытие gap

Владелец сбора evidence и отдельной operational авторизации — production owner,
идентифицируемый через `ADMIN_OWNER_TELEGRAM_ID`; он фиксирует ссылку на Dashboard evidence без
секретов. Target RPO/RTO также пока не утверждены: их нельзя выбирать из repository assumptions,
поскольку они определяют retention, стоимость и допустимую недоступность.

Чтобы перевести любой пункт из `Unknown` в гарантию, owner должен приложить dated evidence:

1. Supabase project ref, active backup/PITR plan, retention и latest recoverable point;
2. private R2 target без public access, immutable Bucket Lock rules для `snapshots/` **и**
   `manifests/`, separately retained manifest digest и latest manifest с `complete=true`/checksum
   без customer payload;
3. alert history для failed/stale backup;
4. отдельную authorization и measured isolated restore drill по
   [`restore-drill-plan.md`](./restore-drill-plan.md).

Активация backup pipeline, периодические drills, freshness gate и утверждённые RPO/RTO остаются
в [TD-203](../tech_debt/stage-2/203-durable-maintenance-and-backup.md). Никакой production
restore, history rewrite, платный ресурс или изменение retention не являются частью TD-017.
