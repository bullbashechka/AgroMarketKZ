# TD-207 — Staging, compatibility matrix и управляемый rollout

**Этап:** 2 · **Оценка:** L · **Решение до старта:** TD-019 внедрён, команда принимает стоимость отдельного production-like контура.

## Проблема

Pages auto-deploy, Worker manual deploy и DB migrations образуют release-time distributed monolith. Runbook описывает правильный порядок/canary, но команды не требуют verified gate, commit SHA, migration state или совместимость units. Queue config также обновляется не тем же способом, что gradual code deploy.

## Реализация

Отдельный staging Supabase/Storage/Queues, preview Pages+Worker, compatibility matrix `old/new UI × old/new API × schema`, ручная production promotion и branch protection. Code-only canary отделить от infrastructure rollout.

## Приёмка/ловушки

Нельзя опубликовать Pages/Worker/schema из разных непроверенных commits; rollback кода и forward-recovery данных отрепетированы. Не строить собственную deployment platform; stopping point после descriptor допустим, если он закрывает текущий риск.
