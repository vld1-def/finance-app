// Вебхук monobank → автоматична витрата в expenses.
// URL: https://<project>.supabase.co/functions/v1/mono-webhook?who=Влад
// Моно спершу робить GET (перевірка, що URL живий), далі POST на кожну операцію:
// { type: "StatementItem", data: { account, statementItem: { id, time, description, mcc, amount, operationAmount, currencyCode, comment, ... } } }

const USERS = ['Влад', 'Таня'];
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

// Поповнення/зняття з «Банок» і перекази між своїми рахунками — це не витрати
const SKIP = /(на банку|з банки|поповнення банки|на свою картку|між своїми|з білої картки|з чорної картки|на білу картку|на чорну картку)/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok(); // перевірка від Моно

  const who = new URL(req.url).searchParams.get('who') || '';
  if (!USERS.includes(who)) return ok({ ok: false, reason: 'unknown who' });

  let body: any;
  try { body = await req.json(); } catch { return ok({ ok: false, reason: 'bad json' }); }
  if (body?.type !== 'StatementItem') return ok({ ok: true, skipped: 'type' });

  const it = body.data?.statementItem;
  if (!it?.id) return ok({ ok: false, reason: 'no item' });

  // amount — у валюті рахунку, operationAmount — у валюті операції (копійки, мінус = списання)
  const kop = it.currencyCode === 980 ? it.operationAmount : it.amount;
  if (!(kop < 0)) return ok({ ok: true, skipped: 'income' });
  if (SKIP.test(it.description || '')) return ok({ ok: true, skipped: 'own transfer' });

  const comm = [it.description, it.currencyCode !== 980 ? `${Math.abs(it.operationAmount) / 100} ${it.currencyCode}` : '', it.comment]
    .filter(Boolean).join(' · ') || null;

  const r = await fetch(`${SB_URL}/rest/v1/rpc/auto_expense`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_who: who,
      p_sum: Math.abs(kop) / 100,
      p_merchant: it.description || null,
      p_source: 'mono',
      p_ext_id: 'mono:' + it.id,
      p_mcc: it.mcc || null,
      p_date: new Date(it.time * 1000).toISOString(),
      p_comm: comm,
    }),
  });
  const res = await r.json().catch(() => null);
  if (!r.ok) console.error('auto_expense', r.status, res);
  // Завжди 200 — інакше Моно після кількох помилок вимикає вебхук
  return ok({ ok: r.ok, res });
});
