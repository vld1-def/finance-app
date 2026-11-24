// «Фінанси Apple Pay» — автоматичний запис оплат Apple Pay (додаток Scriptable).
// Запускається автоматизацією Команд «Транзакція» (Wallet): Команди передають словник
// { amount, merchant, card } → скрипт записує витрату, сам підбирає категорію і шле пуш.
// Тап по пушу → відкриває цей же скрипт з ?fix=<id> і дає змінити категорію.
//
// Налаштування — див. widgets/SHORTCUTS.md

const SUPABASE_URL = 'https://xezhbqcteaihrlrykbkr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qNcUyFxMlWAWAry3uSHndg_ADVMCE3a';
const WHO_KEY = 'finance_who';
const SCRIPT_NAME = Script.name();

const fm = FileManager.local();
const docs = fm.documentsDirectory();
const queuePath = fm.joinPath(docs, 'finance-queue.json');
const catsPath = fm.joinPath(docs, 'finance-cats.json');
const money = v => '₴' + (+v).toLocaleString('uk-UA', { maximumFractionDigits: 2 }).replace(/,(?=\d{3})/g, ' ');
const headers = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, ...extra });

async function req(path, method = 'GET', body) {
  const r = new Request(SUPABASE_URL + '/rest/v1/' + path);
  r.method = method;
  r.headers = headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' });
  if (body) r.body = JSON.stringify(body);
  r.timeoutInterval = 12;
  const d = await r.loadJSON();
  if (r.response.statusCode >= 300) throw new Error((d && d.message) || 'Помилка бази ' + r.response.statusCode);
  return d;
}

// «₴1 234,56» / «UAH 1,234.56» / «1234.56 ₴» → { sum, cur }
function parseAmount(raw) {
  const s = String(raw ?? '');
  let cur = 'UAH';
  if (/\$|usd/i.test(s)) cur = 'USD'; else if (/€|eur/i.test(s)) cur = 'EUR'; else if (/£|gbp/i.test(s)) cur = 'GBP'; else if (/pln|zł/i.test(s)) cur = 'PLN';
  let v = s.replace(/[^\d.,]/g, '');
  const lc = v.lastIndexOf(','), ld = v.lastIndexOf('.');
  if (lc > -1 && ld > -1) v = lc > ld ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (lc > -1) v = /,\d{1,2}$/.test(v) ? v.replace(',', '.') : v.replace(/,/g, '');
  return { sum: Math.round(parseFloat(v) * 100) / 100, cur };
}

async function notify(title, body, id) {
  const n = new Notification();
  n.title = title; n.body = body; n.sound = null;
  if (id) {
    const url = `scriptable:///run/${encodeURIComponent(SCRIPT_NAME)}?fix=${id}`;
    n.openURL = url;
    n.addAction('Змінити категорію', url);
  }
  await n.schedule();
}

// ---------- Режим 1: прийшла оплата з Команд ----------
async function record(input) {
  if (!Keychain.contains(WHO_KEY)) {
    await notify('Фінанси: не налаштовано', 'Відкрий «Фінанси +» один раз і вибери, хто користується телефоном.');
    return;
  }
  const who = Keychain.get(WHO_KEY);
  let p = input;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = { amount: p }; } }
  const { sum, cur } = parseAmount(p.amount);
  if (!(sum > 0)) { await notify('Фінанси: не вдалось прочитати суму', String(p.amount)); return; }
  const merchant = String(p.merchant || '').trim() || null;
  const foreign = cur !== 'UAH' ? `⚠ ${sum} ${cur} — перевір суму в ₴` : null;
  const comm = [merchant, foreign].filter(Boolean).join(' · ') || null;

  try {
    const [r] = await req('rpc/auto_expense', 'POST', {
      p_who: who, p_sum: sum, p_merchant: merchant, p_source: 'applepay', p_comm: comm,
      p_date: new Date().toISOString(),
    });
    const cat = r.categoria + (r.subcategory ? ' › ' + r.subcategory : '');
    await notify(` ${money(r.sum)} · ${merchant || 'Apple Pay'}`, `${r.duplicate ? '✓ Вже є з Моно · ' : ''}${cat} — тапни, щоб змінити`, r.id);
    Script.setShortcutOutput(`${money(r.sum)} · ${cat}`);
  } catch (e) {
    // Немає інтернету — кладемо в чергу, віджет відправить пізніше
    let cats = null;
    if (fm.fileExists(catsPath)) { try { cats = JSON.parse(fm.readString(catsPath)).cats; } catch (e2) {} }
    const other = (cats || []).find(c => /Інше/.test(c)) || '📦 Інше';
    const row = { date: new Date().toISOString(), who, categoria: other, subcategory: null, sum, comm, metod: '💳 Карта', source: 'applepay', merchant, review: true };
    let q = [];
    if (fm.fileExists(queuePath)) { try { q = JSON.parse(fm.readString(queuePath)); } catch (e2) {} }
    q.push(row);
    fm.writeString(queuePath, JSON.stringify(q));
    await notify(`⏳  ${money(sum)} · ${merchant || 'Apple Pay'}`, 'Збережено офлайн — відправиться, коли буде інтернет');
  }
}

// ---------- Режим 2: тап по пушу — змінити категорію ----------
async function fix(id) {
  const [row] = await req(`expenses?id=eq.${id}&select=id,sum,merchant,categoria,subcategory`);
  if (!row) throw new Error('Запис не знайдено (можливо, видалений)');
  const [cats, subs] = await Promise.all([
    req('categories?select=name,hidden&order=name'),
    req('subcategory?select=name,category,hidden&order=name'),
  ]);
  const names = cats.filter(c => !c.hidden).map(c => c.name);
  const title = `${money(row.sum)} · ${row.merchant || ''}`;

  const a = new Alert();
  a.title = title;
  a.message = `Зараз: ${row.categoria}${row.subcategory ? ' › ' + row.subcategory : ''}`;
  a.addAction('✓ Усе вірно');
  names.forEach(c => a.addAction(c));
  a.addDestructiveAction('Видалити витрату');
  a.addCancelAction('Скасувати');
  const i = await a.presentSheet();
  if (i === -1) return;
  if (i === 0) { await req(`expenses?id=eq.${id}`, 'PATCH', { review: false }); return; }
  if (i === names.length + 1) {
    await req(`expenses?id=eq.${id}`, 'DELETE');
    await notify('Видалено', title);
    return;
  }
  const cat = names[i - 1];
  let sub = null;
  const list = subs.filter(s => s.category === cat && !s.hidden).map(s => s.name);
  if (list.length) {
    const b = new Alert();
    b.title = cat;
    b.addAction('Без підкатегорії');
    list.forEach(s => b.addAction(s));
    b.addCancelAction('Скасувати');
    const j = await b.presentSheet();
    if (j === -1) return;
    sub = j === 0 ? null : list[j - 1];
  }
  await req(`expenses?id=eq.${id}`, 'PATCH', { categoria: cat, subcategory: sub, review: false });
  await notify('✓ Категорію змінено', `${title} → ${cat}${sub ? ' › ' + sub : ''}. Наступного разу підставиться сама.`);
}

try {
  const q = args.queryParameters || {};
  if (q.fix) await fix(q.fix);
  else if (args.shortcutParameter != null) await record(args.shortcutParameter);
  else {
    const a = new Alert();
    a.title = 'Фінанси Apple Pay';
    a.message = 'Цей скрипт запускається автоматично з Команд після оплати Apple Pay. Інструкція — SHORTCUTS.md у репозиторії.';
    a.addAction('OK');
    await a.presentAlert();
  }
} catch (e) {
  await notify('Фінанси: помилка', String(e.message || e));
}
Script.complete();
