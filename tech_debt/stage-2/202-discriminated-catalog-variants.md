# TD-202 — Discriminated catalog variants

**Этап:** 2 · **Оценка:** L · **Решение до старта:** планируется новый card kind/крупное изменение commodity rules.

## Почему не сейчас

Одна wide nullable модель product/service/commodity порождает много условных веток, но текущие три варианта ещё управляемы. Немедленная нормализация даст дорогую schema/API/UI migration без ближайшей отдачи.

## Направление

После TD-005/006 собрать usage/data matrix и выбрать минимальную discriminated модель (`kind` + variant payload/table) с shared identity/lifecycle. Сначала additive read model и dual-read, затем backfill с mismatch report, затем writes/new contracts и только после наблюдаемого окна cleanup. Publication rules остаются pure policy; DB constraints защищают каждый variant.

## Приёмка/ловушки

Невозможные комбинации не представимы на boundary/DB; старые clients читают additive response; migration восстанавливаема. Не вводить class hierarchy, state-machine framework или polymorphic repository.
