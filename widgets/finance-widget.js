// Віджет «Фінанси» для додатку Scriptable (iPhone).
// Показує витрати за місяць і бюджет (спільне / Влад / Таня).
// Параметр віджета: порожньо — усі; «Влад» або «Таня» — особистий вигляд.
// Розміри: малий, середній, великий + екран блокування.

const SUPABASE_URL = 'https://xezhbqcteaihrlrykbkr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qNcUyFxMlWAWAry3uSHndg_ADVMCE3a';
const APP_URL = 'https://vld1-def.github.io/finance-app/';
const WIDGET_SCRIPT = 'Фінанси';  // назва ЦЬОГО скрипта в Scriptable
const ADD_SCRIPT = 'Фінанси +';   // назва скрипта швидкого додавання

const USERS = ['Влад', 'Таня'];
const UCOLOR = { 'Влад': '#60a5fa', 'Таня': '#f472b6' };
const SHARED_COLOR = '#a78bfa';
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

const pad = n => String(n).padStart(2, '0');
const money = v => '₴' + Math.round(v || 0).toLocaleString('uk-UA').replace(/,/g, ' ');
const short = v => v >= 10000 ? '₴' + Math.round(v / 1000) + 'к' : money(v);
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const sum = (a, f = x => x) => a.reduce((t, x) => t + (f(x) || 0), 0);
const addRun = 'scriptable:///run/' + encodeURIComponent(ADD_SCRIPT);
// Тап по віджету відкриває сайт на весь екран усередині Scriptable.
// (iOS не дає іншим додаткам відкривати збережений на «Додому» сайт — лише Safari.)
const openRun = 'scriptable:///run/' + encodeURIComponent(WIDGET_SCRIPT) + '?open=1';

/* ---------- Дані ---------- */
async function api(path) {
  const r = new Request(SUPABASE_URL + '/rest/v1/' + path);
  r.headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
  r.timeoutInterval = 15;
  const data = await r.loadJSON();
  if (!Array.isArray(data)) throw new Error((data && data.message) || 'Помилка бази');
  return data;
}

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), 'finance-widget-cache.json');
const queuePath = fm.joinPath(fm.documentsDirectory(), 'finance-queue.json');

// Офлайн-записи, які скрипт «Фінанси +» не зміг відправити
async function flushQueue() {
  if (!fm.fileExists(queuePath)) return;
  let q = [];
  try { q = JSON.parse(fm.readString(queuePath)); } catch (e) {}
  if (!q.length) return;
  const r = new Request(SUPABASE_URL + '/rest/v1/expenses');
  r.method = 'POST';
  r.headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  r.body = JSON.stringify(q);
  await r.load();
  if (r.response && r.response.statusCode < 300) fm.writeString(queuePath, '[]');
}

async function loadData() {
  const now = new Date();
  const month = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  try {
    try { await flushQueue(); } catch (e) {}
    const [rows, budgets] = await Promise.all([
      api(`expenses?select=who,categoria,subcategory,sum,date,comm&date=gte.${encodeURIComponent(from)}&date=lt.${encodeURIComponent(to)}&order=date.desc&limit=2000`),
      api(`budgets?select=month,data&month=in.(${month},_savings)`),
    ]);
    const bm = budgets.find(b => b.month === month), sv = budgets.find(b => b.month === '_savings');
    const data = { month, rows, budget: bm ? bm.data : null, savings: sv ? sv.data : null, at: Date.now() };
    fm.writeString(cachePath, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(cachePath)) {
      const c = JSON.parse(fm.readString(cachePath));
      if (c.month === month) return { ...c, stale: true };
    }
    return { month, rows: [], budget: null, error: String(e.message || e) };
  }
}

/* ---------- Бюджет (та сама логіка, що на сайті) ---------- */
function normBudget(raw) {
  if (!raw) return null;
  const b = { shared: { items: [], split: {} }, people: {} };
  USERS.forEach(u => { b.shared.split[u] = 50; b.people[u] = { income: 0, items: [] }; });
  if (raw.v === 2) {
    b.shared.items = (raw.shared && raw.shared.items) || [];
    USERS.forEach(u => { if (raw.people && raw.people[u]) b.people[u] = { income: raw.people[u].income || 0, items: raw.people[u].items || [] }; });
  } else {
    const items = raw.items || [];
    if (!raw.who || raw.who === 'All') b.shared.items = items;
    else if (b.people[raw.who]) b.people[raw.who].items = items;
  }
  return b;
}
function bestIdx(items, e) {
  let best = -1, score = 0;
  items.forEach((it, k) => {
    if (!it.cat || it.cat !== e.c) return;
    const s = it.sub ? (it.sub === e.sc ? 2 : 0) : 1;
    if (s > score) { score = s; best = k; }
  });
  return best;
}
function report(data) {
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = dim - now.getDate() + 1;
  const rows = data.rows.map(r => ({ u: r.who, c: r.categoria, sc: r.subcategory || '', a: num(r.sum), d: new Date(r.date), cm: r.comm || '' }));
  const today = now.toDateString();
  const R = {
    rows, pace: now.getDate() / dim, daysLeft,
    total: sum(rows, r => r.a),
    today: sum(rows.filter(r => r.d.toDateString() === today), r => r.a),
    by: Object.fromEntries(USERS.map(u => [u, sum(rows.filter(r => r.u === u), r => r.a)])),
    wallets: [],
  };
  const b = normBudget(data.budget);
  if (!b) return R;
  const shared = b.shared.items.map(() => 0);
  const pp = {}; USERS.forEach(u => pp[u] = { spent: b.people[u].items.map(() => 0), outside: 0 });
  rows.forEach(e => {
    let k = bestIdx(b.shared.items, e);
    if (k >= 0) { shared[k] += e.a; return; }
    if (!pp[e.u]) return;
    k = bestIdx(b.people[e.u].items, e);
    if (k >= 0) pp[e.u].spent[k] += e.a; else pp[e.u].outside += e.a;
  });
  // Статті «відкласти на ціль»: виконання = відкладене на цю ціль за місяць
  const svTx = (data.savings && data.savings.tx) || [];
  const saved = (goal, key) => sum(svTx.filter(t => t.goal === goal && t.amount > 0 && String(t.date).slice(0, 7) === data.month && (key === 'shared' || t.who === key)), t => t.amount);
  const wallet = (key, name, color, items, spentArr, outside) => {
    const planned = sum(items, x => num(x.amount));
    const spent = outside + sum(items.map((x, k) => x.goal ? saved(x.goal, key) : x.cat ? spentArr[k] : (x.done ? num(x.amount) : 0)));
    const flexLeft = sum(items.map((x, k) => x.cat ? num(x.amount) - spentArr[k] : 0)) - outside;
    return { key, name, color, planned, spent, left: planned - spent, perDay: Math.max(0, flexLeft) / daysLeft };
  };
  R.wallets = [wallet('shared', 'Спільне', SHARED_COLOR, b.shared.items, shared, 0),
    ...USERS.map(u => wallet(u, u, UCOLOR[u], b.people[u].items, pp[u].spent, pp[u].outside))];
  return R;
}

/* ---------- Малювання ---------- */
const C = {
  bg1: new Color('#16161f'), bg2: new Color('#0b0b10'),
  text: new Color('#f4f4f6'), muted: new Color('#f4f4f6', 0.55), faint: new Color('#f4f4f6', 0.35),
  good: new Color('#4ade80'), warn: new Color('#fbbf24'), bad: new Color('#f87171'),
};
function bar(width, pct, color, pace) {
  const h = 6, ctx = new DrawContext();
  ctx.size = new Size(width, h + 4); ctx.opaque = false; ctx.respectScreenScale = true;
  const track = new Path(); track.addRoundedRect(new Rect(0, 2, width, h), h / 2, h / 2);
  ctx.addPath(track); ctx.setFillColor(new Color('#ffffff', 0.1)); ctx.fillPath();
  const w = Math.max(h, Math.min(1, pct) * width);
  if (pct > 0) { const p = new Path(); p.addRoundedRect(new Rect(0, 2, w, h), h / 2, h / 2); ctx.addPath(p); ctx.setFillColor(color); ctx.fillPath(); }
  if (pace != null) { ctx.setFillColor(new Color('#ffffff', 0.8)); ctx.fillRect(new Rect(Math.round(pace * width) - 1, 0, 2, h + 4)); }
  return ctx.getImage();
}
function txt(stack, s, size, color = C.text, weight = 'medium') {
  const t = stack.addText(s);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'regular' ? Font.systemFont(size) : Font.mediumSystemFont(size);
  t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function walletColor(w, pace) {
  if (!w.planned) return new Color('#ffffff', 0.25);
  const p = w.spent / w.planned;
  return p > 1 ? C.bad : p > pace + 0.1 ? C.warn : new Color(w.color);
}
function walletRow(parent, w, R, width) {
  const s = parent.addStack(); s.layoutVertically();
  const h = s.addStack(); h.centerAlignContent();
  txt(h, '● ', 9, new Color(w.color), 'bold');
  txt(h, w.name, 12, C.text, 'bold');
  h.addSpacer();
  txt(h, w.planned ? (w.left >= 0 ? short(w.left) : '−' + short(-w.left)) : short(w.spent), 12, w.planned && w.left < 0 ? C.bad : C.text, 'bold');
  s.addSpacer(3);
  const img = s.addImage(bar(width, w.planned ? w.spent / w.planned : 0, walletColor(w, R.pace), R.pace));
  img.imageSize = new Size(width, 10);
  s.addSpacer(2);
  txt(s, w.planned ? (w.left >= 0 ? `лишилось · ≈ ${short(w.perDay)}/день` : 'перевищено') : 'без плану', 9, C.faint, 'regular');
}
function plusButton(parent, size) {
  const b = parent.addStack();
  b.size = new Size(size, size); b.cornerRadius = size / 2;
  b.backgroundGradient = grad(['#6366f1', '#a855f7']);
  b.centerAlignContent();
  const t = txt(b, '+', size * 0.62, Color.white(), 'bold'); t.centerAlignText();
  b.url = addRun;
  return b;
}
function grad(cols) { const g = new LinearGradient(); g.colors = cols.map(c => new Color(c)); g.locations = [0, 1]; g.startPoint = new Point(0, 0); g.endPoint = new Point(1, 1); return g; }

function pickWallets(R, who) {
  const ws = R.wallets.filter(w => w.planned > 0 || w.spent > 0);
  return who ? ws.filter(w => w.key === 'shared' || w.key === who) : ws;
}

function build(data, family, who) {
  const R = report(data);
  const now = new Date();
  const spent = who ? R.by[who] || 0 : R.total;
  const ws = pickWallets(R, who);
  const planned = sum(ws, w => w.planned), wSpent = sum(ws, w => w.spent);
  const left = planned - wSpent;
  const perDay = sum(ws, w => w.perDay);

  const w = new ListWidget();
  w.url = openRun;
  w.refreshAfterDate = new Date(Date.now() + 5 * 60000);

  // --- Екран блокування ---
  if (family === 'accessoryInline') {
    w.addText(planned ? `🎯 ${short(left)} · ${short(perDay)}/день` : `💸 ${short(spent)} за місяць`);
    return w;
  }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const p = planned ? Math.round(wSpent / planned * 100) : null;
    const t1 = w.addText(p != null ? p + '%' : short(spent)); t1.font = Font.boldSystemFont(p != null ? 16 : 12); t1.centerAlignText(); t1.minimumScaleFactor = 0.5;
    const t2 = w.addText(p != null ? 'бюджет' : 'місяць'); t2.font = Font.systemFont(9); t2.centerAlignText();
    return w;
  }
  if (family === 'accessoryRectangular') {
    const t0 = w.addText(planned ? `🎯 лишилось ${money(left)}` : `💸 ${money(spent)}`); t0.font = Font.boldSystemFont(14); t0.minimumScaleFactor = 0.6;
    const t1 = w.addText(planned ? `≈ ${money(perDay)} на день` : `сьогодні ${money(R.today)}`); t1.font = Font.systemFont(12);
    const t2 = w.addText(planned ? `витрачено ${money(wSpent)} з ${money(planned)}` : MONTHS[now.getMonth()]); t2.font = Font.systemFont(11); t2.textOpacity = 0.7; t2.minimumScaleFactor = 0.6;
    return w;
  }

  // --- Домашній екран ---
  w.backgroundGradient = (() => { const g = grad(['#16161f', '#0b0b10']); return g; })();
  const small = family === 'small';
  w.setPadding(small ? 14 : 14, 15, 14, 15);

  const head = w.addStack(); head.centerAlignContent();
  txt(head, (who ? who + ' · ' : '') + MONTHS[now.getMonth()], 12, C.muted, 'bold');
  head.addSpacer();
  if (data.stale || data.error) txt(head, data.error && !data.stale ? '⚠︎' : '⏱', 11, C.faint);
  if (!small) { head.addSpacer(6); plusButton(head, 26); }

  w.addSpacer(small ? 4 : 6);

  if (small) {
    txt(w, money(spent), 24, C.text, 'bold');
    txt(w, `сьогодні ${money(R.today)}`, 11, C.muted, 'regular');
    w.addSpacer();
    if (planned) {
      txt(w, left >= 0 ? `лишилось ${short(left)}` : `перевищено ${short(-left)}`, 12, left >= 0 ? C.good : C.bad, 'bold');
      const img = w.addImage(bar(120, wSpent / planned, walletColor({ planned, spent: wSpent }, R.pace), R.pace)); img.imageSize = new Size(120, 10);
      txt(w, `≈ ${short(perDay)} на день`, 10, C.faint, 'regular');
    } else {
      txt(w, 'бюджет не задано', 11, C.faint, 'regular');
    }
    return w;
  }

  const body = w.addStack();
  body.layoutHorizontally();
  const left1 = body.addStack(); left1.layoutVertically(); left1.size = new Size(118, 0);
  txt(left1, money(spent), 24, C.text, 'bold');
  txt(left1, 'витрачено', 10, C.faint, 'regular');
  left1.addSpacer(6);
  txt(left1, `сьогодні ${money(R.today)}`, 11, C.muted, 'regular');
  if (!who) USERS.forEach(u => { const r = left1.addStack(); txt(r, '● ', 9, new Color(UCOLOR[u]), 'bold'); txt(r, `${u} ${short(R.by[u] || 0)}`, 11, C.muted, 'regular'); });
  left1.addSpacer();
  body.addSpacer(10);
  const right = body.addStack(); right.layoutVertically();
  if (ws.length) {
    ws.slice(0, 3).forEach((x, i) => { if (i) right.addSpacer(5); walletRow(right, x, R, 160); });
  } else {
    txt(right, '🎯 Бюджет не задано', 12, C.muted, 'bold');
    txt(right, 'Сплануй у додатку → Бюджет', 10, C.faint, 'regular');
  }
  right.addSpacer();

  if (family === 'large' || family === 'extraLarge') {
    w.addSpacer(12);
    // Топ категорій
    const rows = who ? R.rows.filter(r => r.u === who) : R.rows;
    const cat = {}; rows.forEach(r => cat[r.c] = (cat[r.c] || 0) + r.a);
    const top = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 4);
    txt(w, 'ТОП КАТЕГОРІЙ', 9, C.faint, 'bold');
    w.addSpacer(4);
    top.forEach(([c, v]) => {
      const r = w.addStack(); r.centerAlignContent();
      txt(r, c, 12, C.text, 'regular'); r.addSpacer(); txt(r, money(v), 12, C.text, 'bold');
      const img = w.addImage(bar(290, v / top[0][1], new Color('#8b7cf6'), null)); img.imageSize = new Size(290, 8);
      w.addSpacer(3);
    });
    w.addSpacer(8);
    txt(w, 'ОСТАННІ', 9, C.faint, 'bold');
    w.addSpacer(4);
    rows.slice(0, 4).forEach(r => {
      const s = w.addStack(); s.centerAlignContent();
      txt(s, '● ', 8, new Color(UCOLOR[r.u] || '#888888'), 'bold');
      txt(s, r.c + (r.sc ? ' · ' + r.sc : ''), 11, C.muted, 'regular'); s.addSpacer(); txt(s, money(r.a), 11, C.text, 'bold');
      w.addSpacer(2);
    });
    w.addSpacer();
  }
  return w;
}

/* ---------- Запуск ---------- */
const who = USERS.includes((args.widgetParameter || '').trim()) ? args.widgetParameter.trim() : null;
const q = args.queryParameters || {};

if (q.open && !config.runsInWidget && !config.runsInAccessoryWidget) {
  // Відкрито тапом по віджету: показуємо додаток, а після закриття оновлюємо дані віджета
  const wv = new WebView();
  await wv.loadURL(APP_URL + '?in=scriptable' + (q.add ? '&add=1' : ''));
  await wv.present(true);
  await loadData();
} else {
const data = await loadData();
if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(build(data, config.widgetFamily, who));
} else {
  // Запуск із додатку Scriptable — показати попередній перегляд
  const a = new Alert();
  a.title = 'Фінанси'; a.message = 'Який розмір показати?';
  ['Малий', 'Середній', 'Великий'].forEach(x => a.addAction(x));
  a.addCancelAction('Закрити');
  const i = await a.presentSheet();
  if (i >= 0) {
    const fam = ['small', 'medium', 'large'][i];
    const wd = build(data, fam, who);
    await [wd.presentSmall, wd.presentMedium, wd.presentLarge][i].call(wd);
  }
}
}
Script.complete();
