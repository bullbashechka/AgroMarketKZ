# TD-201 — Sunset legacy location и прекращение dual-write

**Этап:** 2 · **Оценка:** M · **Решение до старта:** подтверждённый production data audit.

## Почему не сейчас

Новая territory/location-модель сосуществует с legacy `location`; dual-read/write снижает риск миграции, но размножает conditionals и не даёт новой пользовательской ценности. Удалять её вслепую опаснее, чем временно сохранить.

## Триггер и план

Начать после read-only отчёта: доля rows без canonical territory, расхождения dual fields, последние legacy clients/writes. Затем: backfill dry-run → repair exceptions → метрика legacy reads/writes = 0 за согласованное окно → backend прекращает fallback → additive contract deprecation → schema removal отдельной migration.

## Приёмка/ловушки

Все cards/requests сохраняют отображаемую географию; rollback возможен между фазами; migration не переписывает применённую историю. Не удалять legacy column в одном релизе с прекращением fallback и не гадать по dev данным.
