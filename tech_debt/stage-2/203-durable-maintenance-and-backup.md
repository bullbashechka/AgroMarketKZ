# TD-203 — Durable maintenance, backup и restore

**Этап:** 2 · **Оценка:** L · **Решение до старта:** TD-017 дал evidence/gap и утверждены RPO/RTO, R2 cost/ownership.

## Почему отдельное решение

Worker cron подходит для bounded cleanup, но не доказывает durable backup/restore. Storage backup binding закомментирован, restore drill/PITR не подтверждены, а длинные jobs рискуют выйти за execution budget.

## Направление

Использовать утверждённые RPO/RTO, data inventory и restore gaps из TD-017; активировать private immutable backup target; manifest/checksum/`complete=true`; chunked resumable jobs с lease/checkpoint; restore в изолированную среду; периодический measured drill и alerts на stale backup. Для destructive migration preflight должен проверять свежий backup/PITR.

## Приёмка/ловушки

Успех — не «файл создан», а восстановленная выборка/Storage с проверенными checksum и временем ≤ RTO. Не считать копию в том же failure domain полноценным backup; не писать bespoke workflow engine, если Cloudflare/Supabase managed mechanism покрывает требования.
