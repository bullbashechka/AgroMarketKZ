-- Фиксирует search_path у триггерной функции set_updated_at() (Security Advisor:
-- function_search_path_mutable). Триггеры ссылаются на объект функции по OID и не
-- требуют пересоздания.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
