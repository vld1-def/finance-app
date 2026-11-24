-- Автоматичні платежі: Apple Pay (Команди → Scriptable) і Monobank (вебхук).
-- Лише додає колонки/функції — наявні дані не змінюються.

alter table public.expenses
  add column if not exists source   text,                  -- null = вручну, 'applepay', 'mono', 'applepay+mono'
  add column if not exists ext_id   text,                  -- id операції в Моно (для захисту від дублів)
  add column if not exists merchant text,                  -- продавець як його віддав банк / Apple Pay
  add column if not exists mcc      int,
  add column if not exists review   boolean not null default false; -- true = додано автоматично, ще не перевірено

create unique index if not exists expenses_ext_id_uq on public.expenses (ext_id) where ext_id is not null;
create index if not exists expenses_merchant_idx on public.expenses (lower(merchant)) where merchant is not null;

-- Назва категорії/підкатегорії за ключовим словом (щоб не залежати від емодзі в назвах)
create or replace function public._cat_by_word(w text) returns text
language sql stable as $$
  select name from public.categories where name ilike '%' || w || '%' and not hidden order by length(name) limit 1
$$;

-- Вгадує категорію: 1) як ти ставив цьому продавцю раніше; 2) відомі мережі; 3) MCC-код; 4) «Інше»
create or replace function public.guess_category(p_merchant text, p_mcc int default null)
returns table (categoria text, subcategory text)
language plpgsql stable as $$
#variable_conflict use_column
declare
  m text := lower(coalesce(p_merchant, ''));
  c text; s text;
begin
  if m <> '' then
    select e.categoria, e.subcategory into c, s
      from public.expenses e
     where lower(e.merchant) = m and e.categoria is not null
     order by e.review asc, e.date desc   -- перевірені/виправлені тобою записи важливіші
     limit 1;
    if c is not null then return query select c, s; return; end if;
  end if;

  -- Відомі мережі (латиниця і кирилиця)
  select x.cw, x.sw into c, s from (select v.*, row_number() over () n from (values
    ('silpo|сільпо', 'Продукти', 'Сільпо'), ('\matb\M|атб', 'Продукти', 'Атб'), ('metro', 'Продукти', 'Metro'),
    ('tavria|таврія', 'Продукти', 'Таврія'), ('sim ?23', 'Продукти', 'Sim23'), ('novus|fora|varus|auchan|ашан|фора|новус', 'Продукти', null),
    ('glovo|bolt ?food|uklon ?food|raketa', 'Кафе', 'Доставка'), ('mcdonald|kfc|puzata|пузата|aroma|lviv croissant', 'Кафе', null),
    ('uklon|bolt|uber|onTaxi', 'Транспорт', 'Таксі'), ('okko|wog|upg|socar|\mklo\M|shell|\manp\M', 'Транспорт', 'Паливо'),
    ('apteka|аптек|podorozhnyk|подорожник|d\.s\.|9-1-1|бажаємо', 'Здоров', 'Аптека'),
    ('netflix|spotify|youtube|apple\.com|icloud|google|chatgpt|openai|anthropic|claude|megogo|sweet\.tv', 'Підписки', 'Підписки'),
    ('kyivstar|київстар|vodafone|lifecell', 'Підписки', 'Звʼязок'),
    ('nova ?poshta|нова пошта|novaposhta', 'Інше', 'Нова Пошта'),
    ('rozetka|розетка|comfy|foxtrot|\mallo\M|citrus|moyo', 'Техніка', 'Техніка'),
    ('\meva\M|prostor|watsons|makeup|brocard', 'Догляд', 'Косметика'),
    ('multiplex|planeta kino|планета кіно', 'Відпочинок', 'Кіно'),
    ('zoo|masterzoo|зоо', 'Кіт', 'Корм')
  ) v(rx, cw, sw)) x
  where m ~* x.rx order by x.n limit 1;

  -- Коди MCC
  if c is null and p_mcc is not null then
    select x.cw, x.sw into c, s from (select v.*, row_number() over () n from (values
      (array[5411,5412,5422,5441,5451,5462,5499], 'Продукти', null),
      (array[5811,5812,5813,5814], 'Кафе', null),
      (array[5912,5122], 'Здоров', 'Аптека'), (array[8011,8031,8041,8042,8043,8049,8062,8071,8099], 'Здоров', 'Лікар'), (array[8021], 'Здоров', 'Стоматологія'),
      (array[5541,5542,5983,5172], 'Транспорт', 'Паливо'), (array[4121], 'Транспорт', 'Таксі'), (array[7523], 'Транспорт', 'Паркінг'),
      (array[7542], 'Транспорт', 'Мийка'), (array[7531,7534,7535,7538,5531,5532,5533], 'Транспорт', 'Ремонт'), (array[7512,7513], 'Транспорт', 'Оренда авто'),
      (array[4111,4112,4131,4784,4789,3000,4511,4582], 'Транспорт', null),
      (array[4812,4814], 'Підписки', 'Звʼязок'), (array[4899,5815,5816,5817,5818,7372], 'Підписки', 'Підписки'), (array[5045,5732,5734,5946], 'Техніка', 'Техніка'),
      (array[5611,5621,5631,5641,5651,5691,5699,5137,5139], 'Одяг', 'Одяг'), (array[5661], 'Одяг', 'Взуття'),
      (array[5977], 'Догляд', 'Косметика'), (array[7230,7297,7298], 'Догляд', 'Салон'),
      (array[7832,7841], 'Відпочинок', 'Кіно'), (array[7941,7997], 'Відпочинок', 'Зал'), (array[7994,5945], 'Відпочинок', 'Ігри'),
      (array[7011,7012,4722,7991,7996,7999], 'Відпочинок', null),
      (array[742], 'Кіт', 'Ветклініка'), (array[5995], 'Кіт', 'Корм'),
      (array[5992], 'Подарунки', 'Квіти'), (array[5947], 'Подарунки', 'Подарунок'), (array[8398,8661], 'Подарунки', 'Благодійність'),
      (array[4900], 'Житло', 'Комуналка'), (array[5200,5211,5251,5712,5714,5719,5722,5950], 'Житло', 'Для дому'),
      (array[4829,6012,6536,6537,6538,6540], 'Перекази', 'Переказ')
    ) v(codes, cw, sw)) x
    where p_mcc = any(x.codes) order by x.n limit 1;
  end if;

  if c is null then c := 'Інше'; s := null; end if;
  c := coalesce(public._cat_by_word(c), public._cat_by_word('Інше'), c);
  if s is not null and not exists (select 1 from public.subcategory sc where sc.category = c and sc.name = s) then s := null; end if;
  return query select c, s;
end $$;

-- Єдина точка входу для автоматичних витрат.
-- Якщо та сама покупка вже прийшла з іншого джерела (Apple Pay ↔ Моно) — не дублює, а доповнює запис.
create or replace function public.auto_expense(
  p_who text, p_sum numeric, p_merchant text, p_source text,
  p_ext_id text default null, p_mcc int default null, p_date timestamptz default now(), p_comm text default null
) returns table (id bigint, categoria text, subcategory text, sum numeric, merchant text, duplicate boolean)
language plpgsql volatile as $$
#variable_conflict use_column
declare
  r public.expenses%rowtype;
  g record;
begin
  if p_sum is null or p_sum <= 0 then raise exception 'sum must be > 0'; end if;
  p_merchant := nullif(trim(p_merchant), '');

  if p_ext_id is not null then
    select * into r from public.expenses e where e.ext_id = p_ext_id;
    if found then return query select r.id, r.categoria, r.subcategory, r.sum, r.merchant, true; return; end if;
  end if;

  -- Та сама сума, та сама людина, ±20 хв, з іншого автоматичного джерела
  select * into r from public.expenses e
   where e.who = p_who and e.sum = round(p_sum, 2)
     and e.source in ('applepay', 'mono') and e.source <> p_source
     and abs(extract(epoch from (e.date - p_date))) < 1200
   order by abs(extract(epoch from (e.date - p_date))) limit 1;
  if found then
    update public.expenses e set
      source   = 'applepay+mono',
      ext_id   = coalesce(e.ext_id, p_ext_id),
      mcc      = coalesce(e.mcc, p_mcc),
      merchant = case when p_source = 'applepay' then coalesce(p_merchant, e.merchant) else coalesce(e.merchant, p_merchant) end
     where e.id = r.id returning * into r;
    return query select r.id, r.categoria, r.subcategory, r.sum, r.merchant, true; return;
  end if;

  select * into g from public.guess_category(p_merchant, p_mcc);
  insert into public.expenses (date, who, categoria, subcategory, sum, metod, comm, source, ext_id, merchant, mcc, review)
  values (p_date, p_who, g.categoria, g.subcategory, round(p_sum, 2), '💳 Карта', coalesce(p_comm, p_merchant), p_source, p_ext_id, p_merchant, p_mcc, true)
  returning * into r;
  return query select r.id, r.categoria, r.subcategory, r.sum, r.merchant, false;
end $$;

grant execute on function public.guess_category(text, int) to anon, authenticated;
grant execute on function public.auto_expense(text, numeric, text, text, text, int, timestamptz, text) to anon, authenticated;
