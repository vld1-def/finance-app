-- Вхід для Команд iPhone (без Scriptable): автоматизація «Гаманець» шле суму як текст
-- («₴1 234,56», «UAH 1,234.56», «$12.50»), продавця і назву картки.
-- POST /rest/v1/rpc/apple_pay  {"who":"Влад","amount":"₴412,50","merchant":"Сільпо","card":"Mono"}
create or replace function public.apple_pay(who text, amount text, merchant text default null, card text default null)
returns json
language plpgsql volatile as $$
declare
  raw text := coalesce(amount, '');
  v text := regexp_replace(coalesce(amount, ''), '[^0-9.,]', '', 'g');
  lc int; ld int; s numeric; cur text := null; r record; m text := nullif(trim(merchant), '');
begin
  if who not in ('Влад', 'Таня') then return json_build_object('ok', false, 'msg', 'Невідомий користувач: ' || coalesce(who, '')); end if;

  if raw ~* '\$|usd' then cur := 'USD'; elsif raw ~* '€|eur' then cur := 'EUR';
  elsif raw ~* '£|gbp' then cur := 'GBP'; elsif raw ~* 'pln|zł' then cur := 'PLN'; end if;

  lc := length(v) - strpos(reverse(v), ',') + 1; if strpos(v, ',') = 0 then lc := 0; end if;
  ld := length(v) - strpos(reverse(v), '.') + 1; if strpos(v, '.') = 0 then ld := 0; end if;
  if lc > 0 and ld > 0 then
    v := case when lc > ld then replace(replace(v, '.', ''), ',', '.') else replace(v, ',', '') end;
  elsif lc > 0 then
    v := case when v ~ ',\d{1,2}$' then replace(v, ',', '.') else replace(v, ',', '') end;
  end if;
  begin s := round(v::numeric, 2); exception when others then s := null; end;
  if s is null or s <= 0 then return json_build_object('ok', false, 'msg', 'Не вдалось прочитати суму: ' || raw); end if;

  select * into r from public.auto_expense(
    who, s, m, 'applepay', null, null, now(),
    nullif(concat_ws(' · ', m, case when cur is not null then '⚠ ' || s || ' ' || cur || ' — перевір суму в ₴' end), '')
  );
  return json_build_object(
    'ok', true, 'id', r.id, 'duplicate', r.duplicate,
    'msg', '₴' || replace(r.sum::text, '.', ',') || ' · ' || coalesce(m, 'Apple Pay') || ' → '
           || r.categoria || coalesce(' › ' || r.subcategory, '') || case when r.duplicate then ' (вже є з Моно)' else '' end
  );
end $$;

grant execute on function public.apple_pay(text, text, text, text) to anon, authenticated;
