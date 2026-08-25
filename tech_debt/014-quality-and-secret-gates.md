# TD-014 — Минимальные quality/security gates

**Приоритет:** P1  
**Этап:** 1  
**Оценка:** S–M  
**Зависимости:** TD-003B делает integration signal честным.

## Проблема

Typecheck/build/tests есть, но нет автоматической проверки floating promises/import boundaries и полноценного secret scan истории. `bun audit` сейчас чист, однако upgrades выполняются без policy; TypeScript 7 major и другие обновления не должны попадать случайно. В репозитории нет CI gate, поэтому push в main автоматически публикует Pages до ручного Worker gate.

## План

1. Не добавляя сразу formatter, выбрать 3–5 high-signal правил: no floating promises, no explicit any, unused promises/imports, запрет client→server internal import и секретов. Оценить существующий шум до включения fail.
2. Добавить pinned secret scanner с allowlist по fingerprint/path/reason; выполнить redacted full-history baseline локально и в существующем release workflow. Любой найденный live secret сначала rotate/revoke, потом чистить историю отдельным решением.
3. Создать единый `quality:check`: contracts build, typecheck, unit, critical integration precondition, build, migration-link check, audit/secret scan. Не маскировать skips.
4. Ввести dependency cadence: patch/minor маленькими PR, major отдельно с changelog/compat tests. Не обновлять TypeScript 7 в рамках этой задачи.
5. После зелёного baseline включить `quality:check` в существующий `release:verify` и Cloudflare release checklist. Отдельный CI/branch protection — только как явно одобренная часть TD-207, не acceptance этой задачи.

## Критерии приёмки

- Gate ловит намеренно внесённый floating promise/test secret/schema drift.
- Full-history scan имеет reviewable allowlist и не печатает secret contents.
- Integration отсутствие — явный fail/precondition, не скрытый green.
- Tooling добавляется только с явным approval dependency и измеренным low-noise baseline.

## Проверка и ловушки

`bun run quality:check`; отдельный fixture для scanner. Не включать сотни style rules и repo-wide reformat. Git history rewrite/destructive secret cleanup — отдельное согласование.

## Вероятные файлы

`package.json`, minimal lint config, secret-scan config, release docs/automation.
