# TD-206 — Server-driven taxonomy по продуктовому триггеру

**Этап:** 2 · **Оценка:** M · **Триггер:** commodity taxonomy меняется чаще релиза клиента либо разные surfaces доказанно расходятся.

## Направление

Один server-owned versioned dictionary с additive contract, bounded caching и offline fallback. UI presentation/copy остаётся client-owned. Сначала inventory всех consumers и compatibility test old/new dictionary, затем один endpoint/cache path.

## Приёмка/ловушки

Одинаковые codes/options во всех surfaces; old client безопасно игнорирует новые values; cache invalidation/version измеримы. Не превращать справочник в CMS и не переносить статичную UI-копию на сервер.
