# TD-018 — Effective grants и runtime capability audit

**Приоритет:** P1  
**Оценка:** S  
**Зависимости:** нет; дорогая credential segmentation остаётся TD-204.

## Проблема

Worker использует DB/Storage credentials с потенциально широким blast radius. До изменения ролей нужно знать effective, а не declared privileges и доказать, какие capabilities реально требуются route/queue/cron paths.

## План

1. Read-only SQL: roles/memberships, table/sequence/function/schema privileges, RLS/BYPASSRLS, default privileges и ownership. Результат редактировать: без DSN, tokens и customer rows.
2. Составить route/job → read/write/delete/storage capability matrix по коду и runtime tests.
3. Negative integration tests текущей runtime role: доступ к явно несвязанным schema/table/object path должен быть запрещён либо задокументирован как подтверждённый gap.
4. Ранжировать gaps по impact/reachability; предложить минимальные REVOKE/GRANT scopes и rollback SQL, но не применять без отдельной production авторизации.

## Критерии приёмки

- Effective grants воспроизводимо сняты и сопоставлены с реальными use cases.
- Каждый excess privilege имеет owner, risk и минимальный remediation candidate.
- Tests не полагаются на Supabase dashboard labels и не выводят secrets/data.

Не создавать микросервис/роль на каждый route и не менять production privileges в audit-задаче.
