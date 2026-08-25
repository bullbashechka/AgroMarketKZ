# TD-017 — Read-only backup/PITR evidence и restore plan

**Приоритет:** P1; становится P0 gate для destructive migration  
**Оценка:** S  
**Зависимости:** нет; реализация нового backup pipeline остаётся TD-203.

## Проблема

Runbook требует PITR/restore guarantees, но текущий audit не подтвердил active PITR, свежий complete Storage backup или measured restore. Это неизвестность с высокой ценой, однако для её снятия не нужен новый durable workflow.

## План

1. Только read-only: инвентаризировать Supabase backup/PITR plan, retention и latest recoverable point; не включать/менять ресурсы.
2. Проверить существующий Storage backup target/binding, latest manifest/checksum/`complete=true` и failure alerts без чтения customer payload.
3. Зафиксировать владельца, текущие/целевые RPO/RTO, пошаговый изолированный restore drill, критерии data/Storage integrity и cleanup.
4. Выполнить drill только после отдельной operational авторизации и на изолированном target; записать measured duration/gaps.
5. До зелёного evidence запретить destructive/schema-rewrite release; additive migration использует отдельный risk review.

## Критерии приёмки

- Есть dated evidence текущей recoverability, а не предположение по тарифу/config.
- Restore plan copy/paste безопасен, не указывает production как target и имеет expected results.
- Unknown/failed guarantee явно отражена в `DEPLOYMENT.md` и эскалируется в TD-203.

Не активировать paid resources, не восстанавливать и не менять production в рамках read-only части без разрешения.
