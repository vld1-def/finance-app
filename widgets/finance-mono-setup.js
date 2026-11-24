// «Фінанси Моно» — одноразове підключення monobank (додаток Scriptable).
// Після цього кожна оплата карткою Моно сама потрапляє на сайт (через вебхук на Supabase).
// Токен береться на https://api.monobank.ua (вхід через QR у застосунку Моно).
// Токен ніде не зберігається — потрібен лише щоб один раз зареєструвати вебхук.

const HOOK = 'https://xezhbqcteaihrlrykbkr.supabase.co/functions/v1/mono-webhook';
const USERS = ['Влад', 'Таня'];
const WHO_KEY = 'finance_who';

async function ask(title, message, actions) {
  const a = new Alert(); a.title = title; a.message = message;
  actions.forEach(x => a.addAction(x)); a.addCancelAction('Скасувати');
  return a.presentAlert();
}

async function main() {
  // Чий це Моно (за замовчуванням — хто користується телефоном)
  const def = Keychain.contains(WHO_KEY) ? Keychain.get(WHO_KEY) : '';
  const wi = await ask('Чия картка monobank?', 'Витрати з цієї картки записуватимуться на цю людину.', USERS.map(u => u === def ? `${u} ✓` : u));
  if (wi === -1) return;
  const who = USERS[wi];

  const t = new Alert();
  t.title = 'Токен monobank';
  t.message = 'Відкрий api.monobank.ua → увійди через QR у застосунку Моно → скопіюй токен і встав сюди.';
  t.addTextField('Токен', Pasteboard.paste() || '');
  t.addAction('Підключити');
  t.addAction('Відкрити api.monobank.ua');
  t.addCancelAction('Скасувати');
  const ti = await t.presentAlert();
  if (ti === -1) return;
  if (ti === 1) { Safari.open('https://api.monobank.ua/'); return; }
  const token = t.textFieldValue(0).trim();
  if (token.length < 20) throw new Error('Схоже, це не токен');

  const url = HOOK + '?who=' + encodeURIComponent(who);
  const r = new Request('https://api.monobank.ua/personal/webhook');
  r.method = 'POST';
  r.headers = { 'X-Token': token, 'Content-Type': 'application/json' };
  r.body = JSON.stringify({ webHookUrl: url });
  const res = await r.loadString();
  if (r.response.statusCode >= 300) throw new Error('Моно відповів: ' + res);

  // Перевіряємо, що вебхук зберігся
  const c = new Request('https://api.monobank.ua/personal/client-info');
  c.headers = { 'X-Token': token };
  const info = await c.loadJSON();
  const okHook = info && info.webHookUrl === url;

  const d = new Alert();
  d.title = okHook ? '✓ monobank підключено' : 'Майже готово';
  d.message = okHook
    ? `${info.name || ''}: усі оплати карткою тепер автоматично записуються на «${who}». Категорія підбирається сама — перевір її на сайті (позначка ⚡).`
    : 'Вебхук відправлено, але Моно ще не підтвердив. Спробуй ще раз за хвилину (Моно дозволяє запит раз на 60 с).';
  d.addAction('OK');
  await d.presentAlert();
}

try { await main(); }
catch (e) { const a = new Alert(); a.title = 'Не вдалось підключити'; a.message = String(e.message || e); a.addAction('OK'); await a.presentAlert(); }
Script.complete();
