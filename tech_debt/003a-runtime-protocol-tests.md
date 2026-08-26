# TD-003A — Contract tests для Pages, Worker и scheduled runtime

**Приоритет:** P0 · **Оценка:** S–M · **Зависимости:** нет.
**Статус:** ✅ Выполнено (2026-08-26; финальный независимый Sol high review: 9.5/10, замечаний нет).

## Фактическое выполнение

- Pages proxy получил небольшую pure policy/fetch seam: fail-closed для отсутствующих secrets,
  same-origin JSON mutation, запрет клиентских internal proxy headers и сохранение пути/query.
- Добавлен additive Pages↔Worker protocol `X-Agromarket-Proxy-Version: 1`; Worker временно
  принимает legacy-запросы без version или version `1`, но отклоняет несовместимые версии.
- Queue dispatch теперь опирается на точное имя очереди и strict Zod envelope, а каждая message
  получает собственный `ack`/`retry`; ошибка одной message не прерывает batch.
- Scheduled runtime сопоставляет только два известных cron, регистрирует один fully-tracked
  `waitUntil` и ждёт outcome всех запущенных jobs; неизвестный cron не запускает fallback jobs.
- Добавлены injected contract tests для Pages и Worker, включая паритет Queue/cron с
  `backend/wrangler.toml`; Pages proxy test включён в `release:verify`.

## Проверка выполнения

- `bun test backend/tests/worker.test.ts webapp/functions/api/proxy.test.ts` — 12 pass.
- `bun test backend/tests packages/contracts/tests webapp/tests webapp/functions/api/proxy.test.ts` — проходит; DB integration tests пропускаются без тестовой БД.
- `bun run typecheck` — успешно.
- `bun run build` — успешно; Wrangler dry-run не может записать sandbox debug-log, а Vite сохраняет известное предупреждение о chunk >500 kB.

## Проблема

`webapp/functions/api/[[path]].js` — production security boundary без прямых tests/runtime schema. `backend/src/worker.ts` dispatches разные Queue payload и cron jobs, но не имеет отдельного regression suite. Ошибка здесь меняет CSRF/trust boundary, ack/retry или вообще отправляет событие не тому handler.

## TDD-план

1. **Pages proxy Red:** same-origin mutation проходит; wrong/missing Origin, non-JSON и client-supplied internal headers отклоняются; path/query сохраняются; missing origin/secret fail closed.
2. Вынести pure forward-request policy/builder, а не новый proxy framework. Зафиксировать additive Pages↔Worker header-version contract.
3. **Queue Red:** notification/update/invalid payload, queue identity, batch continuation, thrown error и retry/ack. Dispatch опирается на queue name + validated envelope, не только на shape.
4. **Scheduled Red:** точный cron routing, `waitUntil`, независимый outcome jobs и отсутствие floating promises.
5. Test harness использует injected handlers/fetch и не требует production credentials/network.

## Критерии приёмки

- Production entrypoints имеют прямые executable contract tests.
- Клиент не может подделать trusted proxy headers; protocol совместим во время раздельного Pages/Worker rollout.
- Queue/cron dispatch и retry propagation определены тестами.
- Изменение не затрагивает outbox/audit/privacy DB behavior — это TD-003B.

## Проверка

```sh
bun test backend/tests/worker.test.ts webapp/functions/api/proxy.test.ts
bun run typecheck
bun run build
```

Не вводить Workers emulator до доказанной нехватки Bun injection seam; новый dev dependency требует отдельного одобрения.
