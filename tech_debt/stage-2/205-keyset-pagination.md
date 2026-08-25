# TD-205 — Keyset pagination по измеренному триггеру

**Этап:** 2 · **Оценка:** M · **Триггер:** `EXPLAIN (ANALYZE, BUFFERS)`/P95 показывает deep-offset degradation или объём выходит за текущие limits.

## Направление

Выбрать stable compound sort с unique tie-breaker, opaque versioned cursor и indexes только из representative query plan. Покрыть inserts/deletes между страницами, no gaps/duplicates, invalid/old cursor и backward-compatible rollout.

## Приёмка/ловушки

P95 и DB work улучшаются на representative data; cursor не раскрывает внутренние trust-sensitive fields; old client получает поддерживаемый envelope. Не заменять bounded offset «на всякий случай» и не строить generic pagination framework.
