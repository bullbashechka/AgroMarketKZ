# TD-019 — Verified release descriptor и read-only preflight

**Приоритет:** P1  
**Оценка:** S  
**Зависимости:** TD-003A proxy contract, TD-012 migration source; staging не требуется.

## Проблема

Pages публикуется автоматически, Worker вручную, DB migrations отдельно. `release:verify` широк, но deploy command не доказывает, для какого commit/schema/protocol он прошёл. Ручной оператор может смешать три проверенные по отдельности, но несовместимые версии.

## План

1. Описать маленький versioned descriptor: git commit SHA, build timestamp, expected migration version/checksum, Pages↔Worker protocol version и hashes/results обязательных `release:verify` шагов.
2. Генерировать descriptor только после зелёного gate из clean/явно идентифицированного commit; не включать env values, resource secrets или machine paths.
3. Перед Worker deploy выполнить read-only preflight: current account/project/Worker, active version, Hyperdrive/Queue binding identities и DB migration ledger соответствуют expected descriptor. Любое mismatch fail closed до mutation.
4. Pages production promotion/runbook ссылается на тот же descriptor; Preview остаётся возможным. Config/infrastructure change маркируется отдельно от code-only canary.
5. Tests: tampered/stale descriptor, wrong migration/protocol/resource identity, missing gate result и happy path. Deployment в tests не выполняется.

## Критерии приёмки

- По каждому release однозначно видно совместимые commit/schema/protocol и доказанный gate.
- Deploy preflight ничего не меняет и останавливается до `wrangler deploy` при mismatch.
- Descriptor не является подписью безопасности и не хранит secrets; source/results воспроизводимы.
- Задача не требует CI, branch protection или отдельного staging — это TD-207.

## Проверка

Unit tests descriptor/preflight fixtures; dry-run на не-production fixture; ручная read-only сверка current production только с operational авторизацией. Не разрешать «override mismatch» без отдельного зафиксированного incident path.
