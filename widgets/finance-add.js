// «Фінанси +» — швидке додавання витрати без відкриття сайту (додаток Scriptable).
// Запускається з кнопки «+» на віджеті, з Команд (Shortcuts), Siri або кнопки «Дія».
// Кроки: сума → категорія → «Зберегти» (коментар — за бажанням).

const SUPABASE_URL = 'https://xezhbqcteaihrlrykbkr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qNcUyFxMlWAWAry3uSHndg_ADVMCE3a';
const USERS = ['Влад', 'Таня'];
const WHO_KEY = 'finance_who';

const fm = FileManager.local();
const queuePath = fm.joinPath(fm.documentsDirectory(), 'finance-queue.json');
const catsPath = fm.joinPath(fm.documentsDirectory(), 'finance-cats.json');
const money = v => '₴' + (+v).toLocaleString('uk-UA', { maximumFractionDigits: 2 }).replace(/,(?=\d{3})/g, ' ');
const headers = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, ...extra });

async function api(path) {
  const r = new Request(SUPABASE_URL + '/rest/v1/' + path);
  r.headers = headers(); r.timeoutInterval = 10;
  const d = await r.loadJSON();
  if (!Array.isArray(d)) throw new Error((d && d.message) || 'Помилка бази');
  return d;
}

// Хто користується цим телефоном — питаємо один раз
async function getWho() {
  if (Keychain.contains(WHO_KEY)) return Keychain.get(WHO_KEY);
  const a = new Alert();
  a.title = 'Хто користується цим телефоном?';
  a.message = 'Витрати записуватимуться на цю людину.';
  USERS.forEach(u => a.addAction(u));
  const i = await a.presentAlert();
  Keychain.set(WHO_KEY, USERS[i]);
  return USERS[i];
}

// Категорії + часті комбінації (з кешем, щоб працювало і без інтернету)
async function loadCats(who) {
  try {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const [cats, subs, recent] = await Promise.all([
      api('categories?select=name,hidden&order=name'),
      api('subcategory?select=name,category,hidden&order=name'),
      api(`expenses?select=who,categoria,subcategory&date=gte.${encodeURIComponent(since)}&order=date.desc&limit=1000`),
    ]);
    const d = { cats: cats.filter(c => !c.hidden).map(c => c.name), subs: subs.filter(s => !s.hidden), recent };
    fm.writeString(catsPath, JSON.stringify(d));
    return d;
  } catch (e) {
    if (fm.fileExists(catsPath)) return JSON.parse(fm.readString(catsPath));
    throw new Error('Немає інтернету, а категорії ще не завантажувались. Запусти один раз з інтернетом — далі працюватиме і офлайн.');
  }
}

async function insert(row) {
  const r = new Request(SUPABASE_URL + '/rest/v1/expenses');
  r.method = 'POST';
  r.headers = headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  r.body = JSON.stringify(row);
  r.timeoutInterval = 10;
  try {
    await r.load();
    if (r.response && r.response.statusCode < 300) return true;
  } catch (e) {}
  // Немає мережі — кладемо в чергу, віджет відправить пізніше
  let q = [];
  if (fm.fileExists(queuePath)) { try { q = JSON.parse(fm.readString(queuePath)); } catch (e) {} }
  q.push(row);
  fm.writeString(queuePath, JSON.stringify(q));
  return false;
}

function parseAmount(s) {
  let v = String(s || '').replace(/[\s₴]/g, '');
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.'); else v = v.replace(/,/g, '');
  return parseFloat(v);
}

async function main() {
  const who = await getWho();

  // 1. Сума (можна передати з Команд як параметр)
  let amount = parseAmount(args.shortcutParameter);
  if (!(amount > 0)) {
    const a = new Alert();
    a.title = 'Нова витрата';
    a.message = who;
    const f = a.addTextField('Сума, ₴', '');
    f.setDecimalPadKeyboard();
    a.addAction('Далі');
    a.addCancelAction('Скасувати');
    if (await a.presentAlert() === -1) return;
    amount = parseAmount(a.textFieldValue(0));
    if (!(amount > 0)) return;
  }

  // 2. Категорія: спершу часті комбінації цієї людини
  const d = await loadCats(who);
  const cnt = {};
  d.recent.filter(r => r.who === who && d.cats.includes(r.categoria)).forEach(r => {
    const k = r.categoria + '\u0001' + (r.subcategory || '');
    cnt[k] = (cnt[k] || 0) + 1;
  });
  const quick = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k.split('\u0001'));

  let cat = '', sub = '';
  const s1 = new Alert();
  s1.title = money(amount);
  s1.message = 'Категорія';
  quick.forEach(([c, sc]) => s1.addAction(sc ? `${c.split(' ')[0]} ${sc}` : c));
  s1.addAction('Інша категорія…');
  s1.addCancelAction('Скасувати');
  const i1 = await s1.presentSheet();
  if (i1 === -1) return;
  if (i1 < quick.length) { [cat, sub] = quick[i1]; }
  else {
    const s2 = new Alert();
    s2.title = money(amount);
    d.cats.forEach(c => s2.addAction(c));
    s2.addCancelAction('Скасувати');
    const i2 = await s2.presentSheet();
    if (i2 === -1) return;
    cat = d.cats[i2];
    const subs = d.subs.filter(s => s.category === cat).map(s => s.name);
    if (subs.length) {
      const s3 = new Alert();
      s3.title = cat;
      s3.addAction('Без підкатегорії');
      subs.forEach(s => s3.addAction(s));
      s3.addCancelAction('Скасувати');
      const i3 = await s3.presentSheet();
      if (i3 === -1) return;
      sub = i3 === 0 ? '' : subs[i3 - 1];
    }
  }

  // 3. Підтвердження + коментар
  const c = new Alert();
  c.title = `${money(amount)} · ${cat}${sub ? ' › ' + sub : ''}`;
  c.message = who;
  c.addTextField('Коментар (не обовʼязково)', '');
  c.addAction('Зберегти');
  c.addCancelAction('Скасувати');
  if (await c.presentAlert() === -1) return;

  const ok = await insert({
    date: new Date().toISOString(), who, categoria: cat, subcategory: sub || null,
    sum: Math.round(amount * 100) / 100, comm: c.textFieldValue(0).trim() || null,
  });

  const n = new Notification();
  n.title = ok ? '✓ Збережено' : '⏳ Збережено офлайн';
  n.body = `${money(amount)} · ${cat}${sub ? ' › ' + sub : ''}` + (ok ? '' : ' — відправиться, коли буде інтернет');
  n.sound = null;
  await n.schedule();
  Script.setShortcutOutput(n.body);
}

try { await main(); }
catch (e) {
  const a = new Alert(); a.title = 'Не вдалось зберегти'; a.message = String(e.message || e); a.addAction('OK'); await a.presentAlert();
}
Script.complete();
