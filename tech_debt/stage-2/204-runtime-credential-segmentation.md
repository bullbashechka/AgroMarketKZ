# TD-204 — Сегментация runtime credentials

**Этап:** 2 · **Оценка:** L · **Решение до старта:** TD-018 подтвердил excess capabilities; согласованы threat model и operational стоимость.

## Почему отдельное решение

Worker соединяется ролью с широкими DB-привилегиями/BYPASSRLS и имеет Storage service credential. Компрометация одного runtime расширяет blast radius, но разделение credentials меняет connection/config/migration/incident workflows.

## Направление

Использовать утверждённые grants/capability gaps и negative-test baseline из TD-018. Начать с наиболее опасных background/admin операций: отдельные least-privilege DB roles/Storage scopes, explicit grants и credential rotation drill. Public request scope выводить только из verified server identity; не полагаться на client network/user IDs.

## Приёмка/ловушки

Украденный credential одного boundary не читает/меняет несвязанные данные; revoke/rotation проверены. Не создавать отдельный service ради каждого route и не менять production grants без staged verification/rollback.
