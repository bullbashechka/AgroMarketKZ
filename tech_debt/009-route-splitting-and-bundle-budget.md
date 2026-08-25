# TD-009 — Route splitting и бюджет стартового bundle

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** S  
**Зависимости:** нет.

## Проблема

Router eagerly импортирует экраны, поэтому обычный пользователь каталога загружает editor/admin/request код. Production build даёт main chunk 532.68 kB minified / 151.75 kB gzip и Vite warning >500 kB. Для Telegram Mini App это ухудшает cold start на слабой сети.

## План

1. Зафиксировать baseline `dist` и загрузку главных путей; не обещать LCP без реального browser измерения.
2. **Red/fitness:** baseline-step записывает список initial manifest entries и их точную сумму raw+gzip. После первого extraction зафиксировать конкретный cap в `bundle:check` не выше полученного значения; script печатает largest chunks.
3. Перевести editor, admin, requests/profile secondary routes на `React.lazy`/router lazy. Оставить catalog shell и частые зависимости в initial path.
4. Дать общий accessible loading/error fallback с retry; prefetch делать только по намерению/после idle и только если измерение полезно.
5. Повторить build и локальный navigation smoke с прямыми deep links/back.

## Критерии приёмки

- Admin/editor code отсутствует в initial catalog chunk.
- `bundle:check` проходит при зафиксированном manifest-based cap, а catalog initial dependency graph не содержит admin/editor modules.
- Lazy failure восстанавливается; deep links, auth guards и Telegram BackButton работают.
- Нет ручного `manualChunks` лабиринта до доказанной необходимости.

## Проверка

```sh
bun run build
bun run typecheck
bun run test:e2e
```

Проверить build manifest и DevTools throttling. Не считать gzip единственным сигналом: важны parse/execute и число critical requests.

## Вероятные файлы

`webapp/src/router.tsx`/route composition, loading boundary, `webapp/vite.config.ts`, небольшой bundle-budget script.
