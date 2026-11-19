'use strict';
/* ==========================================================================
   Фінанси — сімейний трекер витрат (Влад і Таня)
   Дані: Supabase (expenses, categories, subcategory, budgets).
   ========================================================================== */

const SUPABASE_URL = 'https://xezhbqcteaihrlrykbkr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qNcUyFxMlWAWAry3uSHndg_ADVMCE3a';

const USERS = ['Влад', 'Таня'];
const UCOLOR = { 'Влад': '#60a5fa', 'Таня': '#f472b6' };
const SHARED_COLOR = '#a78bfa';
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];
const LS = { me: 'finMe', queue: 'finQueue', budgets: 'finBudgets', cache: 'finCache', noInstall: 'finNoInstall' };

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватний режим / переповнено */ } },
};

let sb = null;

const S = {
  raw: [], queue: [], d: [], cats: [], subs: [], budgets: {}, budgetDb: true,
  loadedAt: 0, sync: 'busy',
  tab: 'home', mF: '', openCat: '', homeWho: 'All',
  me: store.get(LS.me, ''),
  hist: { u: 'All', c: 'All', sc: 'All', day: 'All', q: '' },
  an: { 'Влад': true, 'Таня': true },
  add: { u: '', c: '', sc: '', iso: '' }, addMode: 'one', bulk: [],
  edit: null,
  bud: { month: '', wallet: 'shared', draft: null, status: '' },
  catSheet: null,
};
const charts = {};

/* ---------- Хелпери ---------- */
const pad = n => String(n).padStart(2, '0');
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayISO = () => isoDay(new Date());
const curMonth = () => todayISO().slice(0, 7);
const sum = (arr, f = x => x) => arr.reduce((t, x) => t + (f(x) || 0), 0);
const num = v => { const n = typeof v === 'number' ? v : parseMoney(v); return isFinite(n) ? n : 0; };
function shiftMonth(k, dir) { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + dir, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function monthLabel(k) { const [y, m] = k.split('-'); return MONTHS[+m - 1] + ' ' + y; }
function daysInMonth(k) { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function esc(t) { return String(t ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }
const money = v => '₴' + Math.round(v || 0).toLocaleString('uk-UA');
const moneyExact = v => '₴' + (+v || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
function shortMoney(v) { return v >= 1000 ? String(Math.round(v / 100) / 10).replace('.', ',') + 'к' : String(Math.round(v)); }
function dateForDb(iso) {
  if (!iso || iso === todayISO()) return new Date().toISOString();
  return new Date(iso + 'T12:00:00').toISOString();
}
// «15 000,50» / «15000» / «1,500.50» / «₴200» → число
function parseMoney(str) {
  let v = String(str ?? '').replace(/[\s  ₴]|грн\.?/gi, '');
  if (!v) return NaN;
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  return parseFloat(v);
}
// «🛒 Продукти» → { e: '🛒', t: 'Продукти' }
function catParts(name) {
  const s = String(name || '');
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (m && !/[\p{L}\p{N}]/u.test(m[1])) return { e: m[1], t: m[2] };
  return { e: '•', t: s || '—' };
}
function dayLabel(iso) {
  const t = todayISO(), y = isoDay(new Date(Date.now() - 864e5));
  if (iso === t) return 'Сьогодні';
  if (iso === y) return 'Вчора';
  const d = new Date(iso + 'T00:00:00');
  const s = d.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' });
  return d.getFullYear() === new Date().getFullYear() ? s : s + ' ' + d.getFullYear();
}
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function isNetErr(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  return !navigator.onLine || /failed to fetch|load failed|network|fetch|timed? ?out/i.test(m);
}
function vibrate() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }

/* ---------- Toast і діалоги ---------- */
let toastTimer;
function toast(msg, action) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button id="toastAct">${esc(action.label)}</button>` : '');
  t.classList.add('show');
  if (action) $('toastAct').onclick = () => { t.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2400);
}

// Простий діалог: поле вводу, список або лише підтвердження. Повертає значення або null.
function ask({ title, text = '', value = '', options = null, ok = 'Готово', danger = false, input = true }) {
  return new Promise(resolve => {
    const box = $('dlgBox');
    const field = options
      ? `<select class="sel" id="dlgIn">${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
      : input ? `<input class="inp" id="dlgIn" value="${esc(value)}" autocomplete="off">` : '';
    box.innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${field}
      <div class="row-btns"><button id="dlgNo">Скасувати</button><button id="dlgOk" style="${danger ? 'color:var(--bad)' : 'background:var(--text);color:#000'}">${esc(ok)}</button></div>`;
    $('dlg').classList.add('open');
    const inp = $('dlgIn');
    if (inp && !options) { inp.focus(); inp.select(); }
    const done = v => { $('dlg').classList.remove('open'); resolve(v); };
    $('dlgNo').onclick = () => done(null);
    $('dlgOk').onclick = () => done(inp ? inp.value.trim() : true);
    if (inp) inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim()); };
  });
}
const confirmDlg = (title, text, ok = 'Так', danger = false) => ask({ title, text, ok, danger, input: false });

function openWho(force) {
  if (S.me && !force) return;
  $('dlgBox').innerHTML = `<h3>Хто користується цим телефоном?</h3><p>Нові витрати одразу записуватимуться на цю людину. Змінити можна в налаштуваннях.</p>
    <div class="who-pick">${USERS.map(u => `<button style="--c:${UCOLOR[u]}" onclick="setMe('${u}')">${u}</button>`).join('')}</div>`;
  $('dlg').classList.add('open');
}
function setMe(u) {
  S.me = u; store.set(LS.me, u);
  $('dlg').classList.remove('open');
  if (S.tab === 'settings') renderSettings();
}

/* ---------- Дані ---------- */
function mapRow(r) {
  const dt = new Date(r.date || r.created_at);
  const iso = isoDay(dt);
  return {
    id: r._q || r.id, u: r.who, c: r.categoria || '—', sc: r.subcategory || '', a: parseFloat(r.sum) || 0,
    cm: r.comm || '', ts: dt.getTime(), iso, mId: iso.slice(0, 7), pending: !!r._q,
  };
}
function rebuild() {
  S.d = [...S.raw, ...S.queue].map(mapRow).sort((a, b) => b.ts - a.ts);
}
function saveCache() {
  store.set(LS.cache, { cats: S.cats, subs: S.subs, raw: S.raw, budgets: S.budgets, budgetDb: S.budgetDb });
}

// Supabase за замовчуванням віддає максимум 1000 рядків — тягнемо сторінками
async function fetchAllExpenses() {
  const step = 1000;
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from('expenses')
      .select('id,date,created_at,who,categoria,subcategory,sum,comm')
      .order('date', { ascending: false }).order('id', { ascending: false })
      .range(from, from + step - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function flushQueue() {
  if (!sb || !S.queue.length) return;
  const items = [...S.queue];
  const { error } = await sb.from('expenses').insert(items.map(({ _q, ...r }) => r));
  if (error) { if (!isNetErr(error)) console.warn('queue', error); return; }
  S.queue = S.queue.filter(q => !items.includes(q));
  store.set(LS.queue, S.queue);
  toast(`Відправлено ${items.length} офлайн-${items.length === 1 ? 'запис' : 'записів'}`);
}

let loading = null;
function loadData() {
  if (loading) return loading;
  loading = (async () => {
    if (!sb) { setSync('off'); return; }
    setSync('busy');
    try {
      await flushQueue();
      const [c, sc, b, exp] = await Promise.all([
        sb.from('categories').select('*').order('name'),
        sb.from('subcategory').select('*').order('name'),
        sb.from('budgets').select('*'),
        fetchAllExpenses(),
      ]);
      if (c.error) throw c.error;
      if (sc.error) throw sc.error;
      S.cats = c.data || []; S.subs = sc.data || []; S.raw = exp;
      if (b.error) {
        S.budgetDb = false;
        S.budgets = store.get(LS.budgets, {});
      } else {
        S.budgetDb = true;
        S.budgets = {};
        (b.data || []).forEach(r => { if (r.data) S.budgets[r.month] = r.data; });
      }
      saveCache();
      S.loadedAt = Date.now();
      setSync('ok');
    } catch (e) {
      console.error(e);
      setSync('off');
    }
    rebuild();
    renderActive();
  })().finally(() => { loading = null; });
  return loading;
}

function setSync(st) {
  S.sync = st;
  const el = $('syncEl');
  if (el) el.outerHTML = syncHTML();
}
function syncHTML() {
  const q = S.queue.length;
  const txt = S.sync === 'busy' ? 'оновлення…' : S.sync === 'off' ? (q ? `офлайн · ${q} в черзі` : 'офлайн') : (q ? `${q} в черзі` : '');
  return `<span id="syncEl" class="sync ${S.sync === 'busy' ? 'sync-busy' : S.sync === 'off' ? 'sync-off' : ''}" onclick="loadData()"><i></i>${txt}</span>`;
}

// Запис витрат: якщо мережі нема — у локальну чергу, відправиться пізніше
async function insertExpenses(rows) {
  if (sb) {
    try {
      const { data, error } = await sb.from('expenses').insert(rows).select();
      if (!error) { S.raw.push(...data); saveCache(); rebuild(); return { ids: data.map(x => x.id) }; }
      if (!isNetErr(error)) throw error;
    } catch (e) { if (!isNetErr(e)) throw e; }
  }
  const qs = rows.map(r => ({ ...r, _q: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }));
  S.queue.push(...qs);
  store.set(LS.queue, S.queue);
  rebuild();
  setSync('off');
  return { queued: qs.map(q => q._q) };
}

async function removeExpenses(ids) {
  const qIds = ids.filter(id => String(id).startsWith('q'));
  const dbIds = ids.filter(id => !String(id).startsWith('q'));
  if (qIds.length) { S.queue = S.queue.filter(q => !qIds.includes(q._q)); store.set(LS.queue, S.queue); }
  if (dbIds.length) {
    const { error } = await sb.from('expenses').delete().in('id', dbIds);
    if (error) { toast('Не вдалось видалити: ' + error.message); return false; }
    S.raw = S.raw.filter(r => !dbIds.includes(r.id));
    saveCache();
  }
  rebuild();
  return true;
}

/* ---------- Навігація ---------- */
function go(tab) {
  S.tab = tab;
  document.querySelectorAll('.screen').forEach(x => x.classList.toggle('active', x.id === 'scr-' + tab));
  document.querySelectorAll('.tab[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  renderActive();
  $('scr-' + tab).scrollTop = 0;
}
function renderActive() {
  ({ home: renderHome, history: renderHistory, analytics: renderAnalytics, budget: renderBudget, settings: renderSettings })[S.tab]();
}

function monthBounds() {
  let min = curMonth();
  S.d.forEach(i => { if (i.mId < min) min = i.mId; });
  return { min, max: shiftMonth(curMonth(), 1) };
}
function stepMonth(dir) {
  const n = shiftMonth(S.mF, dir), { min, max } = monthBounds();
  if (n < min || n > max) return;
  S.mF = n; S.hist.day = 'All'; S.openCat = '';
  renderActive();
}
function monthNavHTML(month = S.mF, fn = 'stepMonth') {
  const { min, max } = monthBounds();
  const tag = month === curMonth() ? 'поточний місяць' : month > curMonth() ? 'наступний місяць' : '';
  return `<div class="mnav"><button onclick="${fn}(-1)" ${fn === 'stepMonth' && month <= min ? 'disabled' : ''} aria-label="Попередній місяць">‹</button>
    <div class="mnav-l">${monthLabel(month)}${tag ? `<small>${tag}</small>` : ''}</div>
    <button onclick="${fn}(1)" ${fn === 'stepMonth' && month >= max ? 'disabled' : ''} aria-label="Наступний місяць">›</button></div>`;
}

/* ---------- Огляд ---------- */
function setHomeWho(u) { S.homeWho = S.homeWho === u ? 'All' : u; S.openCat = ''; renderHome(); }
function toggleCat(i) { const name = S._homeCats[i]; S.openCat = S.openCat === name ? '' : name; renderHome(); }

function renderHome() {
  const month = S.mF;
  const rows = S.d.filter(i => i.mId === month);
  const tot = {}; USERS.forEach(u => tot[u] = 0);
  rows.forEach(i => tot[i.u] = (tot[i.u] || 0) + i.a);
  const total = sum(rows, i => i.a);
  const isCur = month === curMonth();

  // Порівняння з минулим місяцем на ту саму дату
  const prevK = shiftMonth(month, -1);
  const dayCut = isCur ? new Date().getDate() : 31;
  const prevTotal = sum(S.d.filter(i => i.mId === prevK && +i.iso.slice(8) <= dayCut), i => i.a);
  let cmp = '';
  if (prevTotal > 0 && total > 0) {
    const p = Math.round((total - prevTotal) / prevTotal * 100);
    cmp = `<span class="${p > 0 ? 'bad' : 'good'}">${p > 0 ? '↑' : '↓'} ${Math.abs(p)}%</span> ${isCur ? 'ніж минулого місяця на цю дату' : 'ніж у попередньому місяці'}`;
  }
  const today = isCur ? sum(rows.filter(i => i.iso === todayISO()), i => i.a) : 0;

  const filt = S.homeWho === 'All' ? rows : rows.filter(i => i.u === S.homeWho);
  const fTotal = sum(filt, i => i.a);
  const catT = {};
  filt.forEach(i => catT[i.c] = (catT[i.c] || 0) + i.a);
  const catList = Object.entries(catT).sort((a, b) => b[1] - a[1]);
  S._homeCats = catList.map(x => x[0]);
  const maxCat = catList.length ? catList[0][1] : 1;

  const showInstall = !isStandalone() && !store.get(LS.noInstall, false);

  $('scr-home').innerHTML = `
    <header class="top"><h1>Огляд</h1><div class="top-r">${syncHTML()}<button class="icon-btn" onclick="go('settings')" aria-label="Налаштування">⚙︎</button></div></header>
    ${showInstall ? `<div class="banner"><span>📲 Встанови як додаток: ${isIOS() ? 'у Safari «Поділитися» → «На екран „Додому“»' : 'меню браузера → «Встановити додаток»'}</span><button onclick="hideInstall()" aria-label="Сховати">✕</button></div>` : ''}
    ${S.queue.length ? `<div class="banner"><span>⏳ ${S.queue.length} ${S.queue.length === 1 ? 'запис чекає' : 'записів чекають'} інтернету — відправляться автоматично</span><button onclick="loadData()">↻</button></div>` : ''}
    ${monthNavHTML()}
    <div class="card hero">
      <div class="label">Витрачено${S.homeWho !== 'All' ? ' · ' + S.homeWho : ''}</div>
      <div class="big num">${money(S.homeWho === 'All' ? total : fTotal)}</div>
      <div class="sub">${isCur ? `Сьогодні ${money(today)}${cmp ? ' · ' : ''}` : ''}${cmp}</div>
      <div class="who-split">${USERS.map(u => `<button class="who-b ${S.homeWho === u ? 'on' : ''}" style="--c:${UCOLOR[u]}" onclick="setHomeWho('${u}')">
        <span class="n"><i></i>${u}</span><b>${money(tot[u])}</b></button>`).join('')}</div>
      <div class="splitbar">${total ? USERS.map(u => `<i style="width:${tot[u] / total * 100}%;background:${UCOLOR[u]}"></i>`).join('') : ''}</div>
    </div>
    ${budgetHomeHTML(month)}
    <div class="card">
      <div class="card-h"><h3>Категорії${S.homeWho !== 'All' ? ' · ' + S.homeWho : ''}</h3></div>
      ${catList.length ? catList.map(([name, v], i) => {
        const p = catParts(name), open = S.openCat === name;
        return `<div class="cat-row" onclick="toggleCat(${i})">
          <div class="cat-row-h"><div class="cat-e">${p.e}</div>
            <div class="cat-m"><div class="cat-t">${esc(p.t)}</div><div class="bar"><i style="width:${v / maxCat * 100}%;background:var(--grad)"></i></div></div>
            <div class="cat-v">${money(v)}<small>${fTotal ? Math.round(v / fTotal * 100) : 0}%</small></div></div>
          ${open ? subBreakdownHTML(filt, name) : ''}</div>`;
      }).join('') : `<p class="empty">Ще немає витрат за цей місяць.<br>Натисни «+», щоб додати першу.</p>`}
    </div>
    ${rows.length ? `<div class="card">
      <div class="card-h"><h3>Останні</h3><button class="link" onclick="go('history')">Уся історія →</button></div>
      ${filt.slice(0, 5).map(txHTML).join('')}
    </div>` : ''}`;
}

function subBreakdownHTML(rows, cat) {
  const t = {};
  rows.filter(i => i.c === cat).forEach(i => { const k = i.sc || 'Без підкатегорії'; t[k] = (t[k] || 0) + i.a; });
  const list = Object.entries(t).sort((a, b) => b[1] - a[1]);
  return `<div class="cat-subs">${list.map(([n, v]) => `<div class="cat-sub"><span>${esc(n)}</span><b>${money(v)}</b></div>`).join('')}</div>`;
}

function txHTML(i) {
  const p = catParts(i.c);
  const time = new Date(i.ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `<div class="tx" onclick="openEdit('${i.id}')">
    <div class="tx-ic" style="--c:${UCOLOR[i.u] || '#888'}">${p.e}</div>
    <div class="tx-m"><div class="tx-t">${esc(p.t)}${i.sc ? `<span> · ${esc(i.sc)}</span>` : ''}</div>
      <div class="tx-s">${i.pending ? '⏳ ' : ''}${esc(i.u)} · ${time}${i.cm ? ' · ' + esc(i.cm) : ''}</div></div>
    <div class="tx-a">${money(i.a)}</div></div>`;
}

function hideInstall() { store.set(LS.noInstall, true); renderHome(); }

/* ---------- Бюджет: модель ----------
   v2: { v: 2,
         shared: { items: [...], split: { Влад: 50, Таня: 50 } },   ← спільні витрати обох
         people: { Влад: { income, items: [...] }, Таня: { ... } } } ← особисті
   item: { name, amount, cat, sub, done }
   Витрата йде у спільну статтю, якщо збігається категорія (і підкатегорія, якщо задана).
   Інакше — в особисту статтю того, хто витратив. Інакше — «поза планом» цієї людини.
   Стаття без категорії (оренда, кредит, «відкласти») — фіксований платіж, відмічається галочкою. */
function blankItem() { return { name: '', amount: '', cat: '', sub: '', done: false }; }
function emptyBudget() {
  const b = { v: 2, shared: { items: [], split: {} }, people: {} };
  USERS.forEach(u => { b.shared.split[u] = 100 / USERS.length; b.people[u] = { income: 0, items: [] }; });
  return b;
}
function normBudget(raw) {
  if (!raw) return null;
  if (raw.v === 2) {
    const b = emptyBudget();
    b.shared.items = (raw.shared && raw.shared.items) || [];
    Object.assign(b.shared.split, (raw.shared && raw.shared.split) || {});
    USERS.forEach(u => { if (raw.people && raw.people[u]) b.people[u] = { income: raw.people[u].income || 0, items: raw.people[u].items || [] }; });
    return b;
  }
  // v1: { income, who: 'All'|'Влад'|'Таня', items }
  const b = emptyBudget();
  const items = (raw.items || []).map(x => ({ ...blankItem(), ...x }));
  if (!raw.who || raw.who === 'All') { b.shared.items = items; b.people[USERS[0]].income = raw.income || 0; }
  else if (b.people[raw.who]) { b.people[raw.who].items = items; b.people[raw.who].income = raw.income || 0; }
  return b;
}
const budgetOf = m => normBudget(S.budgets[m]);
const allItems = b => [...b.shared.items, ...USERS.flatMap(u => b.people[u].items)];
const itemFilled = it => String(it.name || '').trim() || num(it.amount) > 0 || it.cat;
const budgetEmpty = b => !b || (!allItems(b).some(itemFilled) && !USERS.some(u => num(b.people[u].income) > 0));
function cleanBudget(d) {
  const ci = items => items.filter(itemFilled).map(x => ({
    name: String(x.name || '').trim() || catParts(x.cat).t || 'Без назви',
    amount: num(x.amount), cat: x.cat || '', sub: x.sub || '', done: !!x.done,
  }));
  const b = { v: 2, shared: { items: ci(d.shared.items), split: { ...d.shared.split } }, people: {} };
  USERS.forEach(u => b.people[u] = { income: num(d.people[u].income), items: ci(d.people[u].items) });
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

function budgetReport(b, month) {
  const rows = S.d.filter(i => i.mId === month);
  const sharedSpent = b.shared.items.map(() => 0);
  const pp = {};
  USERS.forEach(u => pp[u] = { spent: b.people[u].items.map(() => 0), outside: 0, outsideCats: {} });
  rows.forEach(e => {
    let k = bestIdx(b.shared.items, e);
    if (k >= 0) { sharedSpent[k] += e.a; return; }
    const p = pp[e.u]; if (!p) return;
    k = bestIdx(b.people[e.u].items, e);
    if (k >= 0) p.spent[k] += e.a;
    else { p.outside += e.a; p.outsideCats[e.c] = (p.outsideCats[e.c] || 0) + e.a; }
  });

  const cm = curMonth(), dim = daysInMonth(month);
  const isCur = month === cm;
  const daysLeft = isCur ? dim - new Date().getDate() + 1 : month > cm ? dim : 0;
  const pace = isCur ? new Date().getDate() / dim : month < cm ? 1 : 0;

  const wallet = (key, name, color, items, spentArr, outside) => {
    const its = items.map((it, k) => ({ ...it, amount: num(it.amount), spent: it.cat ? spentArr[k] : null }));
    const planned = sum(its, x => x.amount);
    const spent = outside + sum(its, x => x.cat ? x.spent : (x.done ? x.amount : 0));
    const flexLeft = sum(its.filter(x => x.cat), x => x.amount - x.spent) - outside;
    return { key, name, color, items: its, planned, spent, outside, left: planned - spent,
      perDay: daysLeft ? Math.max(0, flexLeft) / daysLeft : 0,
      over: its.filter(x => x.cat && x.amount > 0 && x.spent > x.amount) };
  };
  const wallets = [
    wallet('shared', 'Спільне', SHARED_COLOR, b.shared.items, sharedSpent, 0),
    ...USERS.map(u => wallet(u, u, UCOLOR[u], b.people[u].items, pp[u].spent, pp[u].outside)),
  ];
  const sharedPlanned = wallets[0].planned;
  const people = USERS.map(u => {
    const income = num(b.people[u].income);
    const contrib = sharedPlanned * num(b.shared.split[u]) / 100;
    const own = wallets.find(w => w.key === u).planned;
    return { u, income, contrib, own, free: income - contrib - own, outsideCats: pp[u].outsideCats };
  });
  return { wallets, people, pace, daysLeft, isCur, sharedPlanned };
}

function walletHTML(w, R) {
  const pct = w.planned ? w.spent / w.planned * 100 : (w.spent ? 100 : 0);
  const color = !w.planned ? 'rgba(255,255,255,.25)' : pct > 100 ? 'var(--bad)' : pct > R.pace * 100 + 10 && R.isCur ? 'var(--warn)' : w.color;
  const foot = w.planned
    ? (w.left >= 0
        ? `<span>лишилось <b class="good">${money(w.left)}</b></span>${R.daysLeft && w.perDay ? `<span>≈ ${money(w.perDay)} / день</span>` : ''}`
        : `<span class="bad">перевищено на ${money(-w.left)}</span>`)
    : `<span>без плану${w.spent ? ' · витрачено ' + money(w.spent) : ''}</span>`;
  return `<div class="wal">
    <div class="wal-h"><span class="wal-n" style="--c:${w.color}"><i></i>${esc(w.name)}</span>
      <span class="wal-v"><b>${money(w.spent)}</b> / ${money(w.planned)}</span></div>
    <div class="bar"><i style="width:${Math.min(100, pct)}%;background:${color}"></i>${R.isCur ? `<span class="pace" style="left:${R.pace * 100}%"></span>` : ''}</div>
    <div class="wal-f">${foot}</div></div>`;
}

function budgetHomeHTML(month) {
  const b = budgetOf(month);
  if (budgetEmpty(b)) {
    const target = month >= curMonth() ? month : null;
    return target ? `<div class="card cta" onclick="openBudget('${target}')"><span>🎯 Бюджет на ${monthLabel(target).toLowerCase()} ще не сплановано</span><b>Спланувати →</b></div>` : '';
  }
  const R = budgetReport(b, month);
  const ws = R.wallets.filter(w => w.planned > 0 || w.spent > 0);
  const over = R.wallets.flatMap(w => w.over.map(x => ({ w, x }))).sort((a, b) => (b.x.spent - b.x.amount) - (a.x.spent - a.x.amount)).slice(0, 3);
  return `<div class="card">
    <div class="card-h"><h3>🎯 Бюджет</h3><button class="link" onclick="openBudget('${month}')">Відкрити →</button></div>
    ${ws.map(w => walletHTML(w, R)).join('')}
    ${over.length ? `<div class="alerts">${over.map(({ w, x }) => `<p>⚠ ${esc(x.name)} (${esc(w.name)}): +${money(x.spent - x.amount)} понад план</p>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- Бюджет: редактор ---------- */
function defaultBudgetMonth() { return new Date().getDate() >= 20 ? shiftMonth(curMonth(), 1) : curMonth(); }
function openBudget(month) { flushBudgetSave(); S.bud.month = month; S.bud.draft = null; go('budget'); }
function budDraft() {
  if (!S.bud.month) S.bud.month = defaultBudgetMonth();
  if (!S.bud.draft || S.bud.draft._m !== S.bud.month) {
    const b = budgetOf(S.bud.month);
    S.bud.draft = b ? JSON.parse(JSON.stringify(b)) : emptyBudget();
    S.bud.draft._m = S.bud.month;
  }
  return S.bud.draft;
}
function budItems(d = budDraft()) { return S.bud.wallet === 'shared' ? d.shared.items : d.people[S.bud.wallet].items; }
function budStep(dir) { flushBudgetSave(); S.bud.month = shiftMonth(S.bud.month || defaultBudgetMonth(), dir); S.bud.draft = null; renderBudget(); }
function budWallet(k) { S.bud.wallet = k; renderBudget(); }

function catOptions(sel, emptyLabel = '— без категорії —') {
  const names = S.cats.filter(c => !c.hidden || c.name === sel).map(c => c.name);
  if (sel && !names.includes(sel)) names.unshift(sel);
  return `<option value="">${emptyLabel}</option>` + names.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
}
function subOptions(cat, sel, emptyLabel = 'вся категорія') {
  const list = S.subs.filter(x => x.category === cat && (!x.hidden || x.name === sel)).map(x => x.name);
  if (sel && !list.includes(sel)) list.unshift(sel);
  return { n: list.length, html: `<option value="">${emptyLabel}</option>` + list.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('') };
}

function renderBudget() {
  const d = budDraft(), m = d._m, w = S.bud.wallet;
  const items = budItems(d);
  if (!items.length) items.push(blankItem());
  const R = budgetReport(d, m);
  const rep = R.wallets.find(x => x.key === w);
  const started = m <= curMonth();
  const u0 = USERS[0], u1 = USERS[1];

  $('scr-budget').innerHTML = `
    <header class="top"><h1>Бюджет</h1><span class="bud-status" id="budStatus">${esc(S.bud.status)}</span></header>
    ${!S.budgetDb ? `<div class="banner"><span>Бюджет зараз зберігається лише на цьому пристрої — таблиця budgets у базі недоступна.</span></div>` : ''}
    ${monthNavHTML(m, 'budStep')}
    <div class="card">
      <div class="card-h"><h3>Доходи і спільне</h3></div>
      ${USERS.map(u => `<label class="inc-row"><span style="--c:${UCOLOR[u]}"><i></i>${u}</span>
        <input class="inp num" inputmode="decimal" data-inc="${u}" value="${d.people[u].income || ''}" placeholder="дохід за місяць"></label>`).join('')}
      <div class="split-ctl">
        <div class="split-lbl"><span>Спільні витрати ділимо</span><b id="splitLbl"></b></div>
        <input type="range" min="0" max="100" step="5" id="splitRange" value="${num(d.shared.split[u0])}" aria-label="Частка ${u0} у спільних витратах">
        <div class="row-btns"><button onclick="setSplit(50)">Порівну</button><button onclick="setSplitByIncome()">Пропорційно доходу</button></div>
      </div>
      <div class="ppl" id="budPeople"></div>
    </div>

    <div class="seg wallets">${['shared', ...USERS].map(k => `<button class="${w === k ? 'on' : ''}" onclick="budWallet('${k}')">${k === 'shared' ? 'Спільне' : k}<small id="wsum-${k}"></small></button>`).join('')}</div>

    <div class="card">
      <p class="hint">${w === 'shared'
        ? `Спільні витрати обох: оренда, комуналка, продукти… Сюди рахуються витрати і ${u0}, і ${u1} у вибраних категоріях.`
        : `Особисті витрати: ${w}. Усе, що ${w} витрачає поза спільними статтями, рахується тут, а якщо категорії немає в плані, то як «поза планом».`}
        Стаття без категорії — фіксований платіж, його відмічають галочкою.</p>
      <div id="budItems">${items.map((it, i) => budItemHTML(it, i, rep.items[i], started)).join('')}</div>
      ${w !== 'shared' && rep.outside > 0 ? `<p class="hint" style="margin-top:10px">Поза планом: <b class="warn">${money(rep.outside)}</b> — ${outsideList(R, w)}</p>` : ''}
      <div class="row-btns"><button onclick="budAdd()">+ Стаття</button><button onclick="budSuggest()">💡 Заповнити з історії</button></div>
      <div class="row-btns"><button onclick="budCopyPrev()">⧉ Як минулого місяця</button><button onclick="$('pasteBox').hidden=!$('pasteBox').hidden">📋 Вставити список</button></div>
      <div id="pasteBox" hidden style="margin-top:10px">
        <p class="hint">Скопіюй дві колонки з Google Таблиць (сума + назва). Рядок лише із сумою стане доходом${w === 'shared' ? ` ${u0}` : ''}. Категорії підберуться за назвою. Статті додадуться у «${w === 'shared' ? 'Спільне' : w}».</p>
        <textarea id="budPaste" class="inp" placeholder="55 000&#10;15 000	оренда&#10;12 000	продукти"></textarea>
        <div class="row-btns"><button onclick="budImport()">Розібрати й додати</button></div>
      </div>
    </div>`;
  renderBudSummary();
}

function outsideList(R, u) {
  const p = R.people.find(x => x.u === u);
  return Object.entries(p.outsideCats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${esc(catParts(c).t)} ${money(v)}`).join(', ');
}

function budItemHTML(it, i, rep, started) {
  const subs = subOptions(it.cat, it.sub);
  let prog = '';
  if (it.cat && started && rep) {
    const a = num(it.amount), p = a ? rep.spent / a * 100 : (rep.spent ? 100 : 0);
    const col = p > 100 ? 'var(--bad)' : p >= 85 ? 'var(--warn)' : 'var(--good)';
    prog = `<div class="bi-p"><div class="bar"><i style="width:${Math.min(100, p)}%;background:${col}"></i></div>
      <p><span>витрачено ${money(rep.spent)}</span><span class="${a - rep.spent < 0 ? 'bad' : ''}">${a - rep.spent < 0 ? 'перевищено на ' + money(rep.spent - a) : 'лишилось ' + money(a - rep.spent)}</span></p></div>`;
  }
  return `<div class="bi" data-i="${i}">
    <div class="bi-r1">${it.cat ? '' : `<button class="chk ${it.done ? 'on' : ''}" data-act="done" aria-label="Сплачено">✓</button>`}
      <input class="inp" data-f="name" value="${esc(it.name)}" placeholder="${it.cat ? esc(catParts(it.cat).t) : 'Назва (оренда, кредит…)'}">
      <input class="inp amt num" data-f="amount" inputmode="decimal" value="${it.amount === 0 ? '' : esc(it.amount)}" placeholder="0">
      <button class="x" data-act="del" aria-label="Видалити статтю">✕</button></div>
    <div class="bi-r2"><select class="sel" data-f="cat">${catOptions(it.cat)}</select>
      <select class="sel" data-f="sub" ${subs.n ? '' : 'disabled'}>${subs.html}</select></div>
    ${prog}</div>`;
}

function renderBudSummary() {
  const d = budDraft();
  const R = budgetReport(d, d._m);
  const u0 = USERS[0], u1 = USERS[1];
  const s0 = num(d.shared.split[u0]);
  const lbl = $('splitLbl');
  if (lbl) lbl.textContent = `${u0} ${s0}% · ${u1} ${100 - s0}%`;
  const box = $('budPeople');
  if (box) box.innerHTML = R.people.map(p => `<div><div class="ppl-r"><b style="color:var(--text)">${p.u}</b>
      <b class="${p.free < 0 ? 'bad' : 'good'}">${p.free < 0 ? 'бракує ' + money(-p.free) : 'вільно ' + money(p.free)}</b></div>
      <div class="tiny faint">${money(p.income)} дохід − ${money(p.contrib)} у спільне − ${money(p.own)} особисте</div></div>`).join('')
    + `<div class="ppl-r"><span>Разом заплановано</span><b>${money(sum(R.wallets, w => w.planned))}</b></div>`;
  R.wallets.forEach(w => { const el = $('wsum-' + w.key); if (el) el.textContent = money(w.planned); });
}

function setBudStatus(t) { S.bud.status = t; const el = $('budStatus'); if (el) el.textContent = t; }
let budTimer = null;
function budChanged(rerender) {
  setBudStatus('Зберігаю…');
  clearTimeout(budTimer);
  budTimer = setTimeout(saveBudgetNow, 700);
  if (rerender) renderBudget(); else renderBudSummary();
}
function flushBudgetSave() { if (budTimer) { clearTimeout(budTimer); saveBudgetNow(); } }

async function persistBudget(month, data) {
  const empty = budgetEmpty(data);
  if (empty) delete S.budgets[month]; else S.budgets[month] = data;
  saveCache();
  if (S.budgetDb && sb) {
    const { error } = empty
      ? await sb.from('budgets').delete().eq('month', month)
      : await sb.from('budgets').upsert({ month, data, updated_at: new Date().toISOString() });
    if (!error) return true;
    toast('Не вдалось зберегти бюджет у базу: ' + error.message);
  }
  store.set(LS.budgets, S.budgets);
  return false;
}
async function saveBudgetNow() {
  budTimer = null;
  const d = S.bud.draft;
  if (!d) return;
  const ok = await persistBudget(d._m, cleanBudget(d));
  setBudStatus(ok ? 'Збережено ✓' : 'Збережено на пристрої');
  if (S.tab === 'home') renderHome();
}

function onBudInput(e) {
  const t = e.target, d = budDraft();
  if (t.dataset.inc) { d.people[t.dataset.inc].income = t.value; return budChanged(false); }
  if (t.id === 'splitRange') { d.shared.split[USERS[0]] = +t.value; d.shared.split[USERS[1]] = 100 - t.value; return budChanged(false); }
  const row = t.closest('.bi'); if (!row) return;
  const it = budItems(d)[+row.dataset.i];
  if (t.dataset.f === 'name' || t.dataset.f === 'amount') { it[t.dataset.f] = t.value; budChanged(false); }
}
function onBudChange(e) {
  const t = e.target, row = t.closest('.bi');
  if (!row || (t.dataset.f !== 'cat' && t.dataset.f !== 'sub')) return;
  const it = budItems()[+row.dataset.i];
  const autoName = !it.name || it.name === catParts(it.cat).t || it.name === it.sub;
  it[t.dataset.f] = t.value;
  if (t.dataset.f === 'cat') it.sub = '';
  if (autoName) it.name = it.sub || (it.cat ? catParts(it.cat).t : '');
  budChanged(true);
}
function onBudClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = b.closest('.bi'); if (!row) return;
  const items = budItems(), i = +row.dataset.i;
  if (b.dataset.act === 'del') items.splice(i, 1);
  if (b.dataset.act === 'done') items[i].done = !items[i].done;
  budChanged(true);
}
function setSplit(p) { const d = budDraft(); d.shared.split[USERS[0]] = p; d.shared.split[USERS[1]] = 100 - p; budChanged(true); }
function setSplitByIncome() {
  const d = budDraft();
  const a = num(d.people[USERS[0]].income), b = num(d.people[USERS[1]].income);
  if (!(a + b)) return toast('Спочатку впиши доходи');
  setSplit(Math.round(a / (a + b) * 100));
}
function budAdd() {
  budItems().push(blankItem());
  renderBudget();
  const rows = document.querySelectorAll('#budItems .bi');
  rows[rows.length - 1].querySelector('[data-f="name"]').focus();
}

async function budCopyPrev() {
  const d = budDraft();
  let k = shiftMonth(d._m, -1), prev = null;
  for (let n = 0; n < 6 && !prev; n++, k = shiftMonth(k, -1)) { const b = budgetOf(k); if (!budgetEmpty(b)) prev = { b, k }; }
  if (!prev) return toast('Немає попередніх бюджетів');
  if (!budgetEmpty(cleanBudget(d)) && !await confirmDlg('Замінити бюджет?', `Усі статті ${monthLabel(d._m).toLowerCase()} буде замінено бюджетом за ${monthLabel(prev.k).toLowerCase()}.`, 'Замінити')) return;
  const copy = JSON.parse(JSON.stringify(prev.b));
  allItems(copy).forEach(x => x.done = false);
  copy._m = d._m;
  S.bud.draft = copy;
  budChanged(true);
  toast('Скопійовано з ' + monthLabel(prev.k).toLowerCase());
}

// Середні витрати за останні 3 місяці по категоріях, яких ще нема в плані
function budSuggest() {
  const d = budDraft(), w = S.bud.wallet;
  // Беремо лише завершені місяці перед планованим
  const base = d._m <= curMonth() ? d._m : curMonth();
  const months = [1, 2, 3].map(k => shiftMonth(base, -k)).filter(m => S.d.some(i => i.mId === m));
  if (!months.length) return toast('Немає завершених місяців з історією');
  const items = budItems(d);
  let pool = S.d.filter(i => months.includes(i.mId));
  pool = w === 'shared' ? pool : pool.filter(i => i.u === w && bestIdx(d.shared.items, i) < 0);
  const byCat = {}, byWho = {};
  pool.forEach(i => {
    if (bestIdx(items, i) >= 0) return;
    byCat[i.c] = (byCat[i.c] || 0) + i.a;
    (byWho[i.c] = byWho[i.c] || {})[i.u] = (byWho[i.c][i.u] || 0) + i.a;
  });
  // У спільне пропонуємо лише категорії, де помітно витрачають обоє (кожен ≥ 25%)
  const isShared = c => USERS.every(u => (byWho[c][u] || 0) >= byCat[c] * 0.25);
  const add = Object.entries(byCat).filter(([c]) => w !== 'shared' || isShared(c))
    .map(([c, v]) => ({ c, avg: v / months.length })).filter(x => x.avg >= 200).sort((a, b) => b.avg - a.avg);
  if (!add.length) return toast(w === 'shared' ? 'Немає категорій, де обоє регулярно витрачають, — додай статті вручну' : 'Усі категорії з історії вже є в плані');
  for (let i = items.length - 1; i >= 0; i--) if (!itemFilled(items[i])) items.splice(i, 1);
  add.forEach(x => items.push({ name: catParts(x.c).t, amount: Math.ceil(x.avg / 100) * 100, cat: x.c, sub: '', done: false }));
  budChanged(true);
  toast(`Додано ${add.length} статей — середнє за ${months.length} міс. Підправ суми під себе`);
}

const normName = t => String(t).toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim();
function guessCat(name) {
  const n = normName(name);
  if (!n) return { cat: '', sub: '' };
  const words = n.split(' ').filter(w => w.length >= 4);
  const hit = label => {
    const l = normName(catParts(label).t);
    return l.length >= 3 && (n.includes(l) || l.includes(n) || words.some(w => l.split(' ').some(lw => lw.startsWith(w.slice(0, 5)))));
  };
  const sub = S.subs.find(x => !x.hidden && hit(x.name));
  if (sub) return { cat: sub.category, sub: sub.name };
  const cat = S.cats.find(c => !c.hidden && hit(c.name));
  return { cat: cat ? cat.name : '', sub: '' };
}
function budImport() {
  const d = budDraft(), w = S.bud.wallet;
  let income = null; const parsed = [];
  $('budPaste').value.split(/\r?\n/).forEach(line => {
    line = line.trim(); if (!line) return;
    let numS, name;
    const m = line.match(/^([\d\s .,₴]+)(.*)$/);
    if (m) { numS = m[1]; name = m[2]; }
    else { const m2 = line.match(/^(.*?)[\s\t]+([\d\s .,₴]+)$/); if (!m2) return; name = m2[1]; numS = m2[2]; }
    const amount = parseMoney(numS);
    name = name.replace(/^[\t\s₴|;:-]+/, '').trim();
    if (!(amount > 0)) return;
    if (!name) { if (income === null) income = amount; return; }
    parsed.push({ name, amount, ...guessCat(name), done: false });
  });
  if (!parsed.length && income === null) return toast('Не вдалось розпізнати рядки. Формат: «3 000  кава»');
  const items = budItems(d);
  for (let i = items.length - 1; i >= 0; i--) if (!itemFilled(items[i])) items.splice(i, 1);
  items.push(...parsed);
  if (income !== null) d.people[w === 'shared' ? USERS[0] : w].income = income;
  budChanged(true);
  toast(`Додано ${parsed.length} статей`);
}

/* ---------- Швидке додавання ---------- */
function usageStats(days, who) {
  const since = Date.now() - days * 864e5;
  const cat = {}, combo = {};
  S.d.forEach(i => {
    if (i.ts < since || (who && i.u !== who)) return;
    cat[i.c] = (cat[i.c] || 0) + 1;
    const k = i.c + '\u0001' + i.sc;
    combo[k] = (combo[k] || 0) + 1;
  });
  return { cat, combo };
}

function openAdd(preset) {
  S.add = { u: S.me || USERS[0], c: '', sc: '', iso: todayISO(), ...(preset || {}) };
  $('aAmount').value = '';
  $('aComment').value = '';
  setAddMode(S.addMode);
  renderAdd();
  $('sheet-add').classList.add('open');
  // Фокус синхронно в обробнику кліку — інакше iOS не покаже клавіатуру
  if (S.addMode === 'one') $('aAmount').focus();
}
function closeAdd() { $('aAmount').blur(); $('sheet-add').classList.remove('open'); }

function setAddMode(m) {
  S.addMode = m;
  $('addOne').hidden = m !== 'one';
  $('addBulk').hidden = m !== 'bulk';
  $('modeOne').classList.toggle('on', m === 'one');
  $('modeBulk').classList.toggle('on', m === 'bulk');
  $('sheet-add').classList.toggle('bulk', m === 'bulk');
  $('aWho').style.visibility = m === 'one' ? 'visible' : 'hidden';
  if (m === 'bulk') { if (!S.bulk.length) S.bulk = [bulkNewRow(), bulkNewRow(), bulkNewRow()]; renderBulk(); }
  updateAddSave();
}

function renderAdd() {
  const a = S.add;
  $('aWho').innerHTML = USERS.map(u => `<button class="${a.u === u ? 'on' : ''}" onclick="addWho('${u}')">${u}</button>`).join('');

  // Часті комбінації категорія+підкатегорія цієї людини
  const st = usageStats(90, a.u);
  const combos = Object.entries(st.combo).sort((x, y) => y[1] - x[1]).slice(0, 10)
    .map(([k]) => k.split('\u0001')).filter(([c]) => S.cats.some(x => x.name === c && !x.hidden));
  S._quick = combos;
  $('aQuickWrap').hidden = !combos.length;
  $('aQuick').innerHTML = combos.map(([c, sc], i) => {
    const p = catParts(c);
    return `<button class="chip ${a.c === c && a.sc === sc ? 'on' : ''}" onclick="pickQuick(${i})">${p.e} ${esc(sc || p.t)}</button>`;
  }).join('');

  // Категорії: найчастіші — першими
  const all = usageStats(120).cat;
  const cats = S.cats.filter(c => !c.hidden).sort((x, y) => (all[y.name] || 0) - (all[x.name] || 0) || x.name.localeCompare(y.name));
  S._addCats = cats.map(c => c.name);
  $('aCats').innerHTML = cats.map((c, i) => {
    const p = catParts(c.name);
    return `<button class="cat-btn ${a.c === c.name ? 'on' : ''}" onclick="pickCat(${i})"><span class="e">${p.e}</span><span class="t">${esc(p.t)}</span></button>`;
  }).join('') || `<p class="muted small">Категорій ще немає — додай їх у налаштуваннях.</p>`;

  renderAddSubs();
  renderAddDate();
  const comms = [...new Set(S.d.filter(i => i.cm && (!a.c || i.c === a.c)).slice(0, 300).map(i => i.cm))].slice(0, 40);
  $('aCommList').innerHTML = comms.map(c => `<option value="${esc(c)}">`).join('');
  updateAddSave();
}

function renderAddSubs() {
  const a = S.add;
  if (!a.c) { $('aSubs').innerHTML = ''; return; }
  const cnt = {};
  S.d.forEach(i => { if (i.c === a.c && i.sc) cnt[i.sc] = (cnt[i.sc] || 0) + 1; });
  const subs = S.subs.filter(x => x.category === a.c && !x.hidden).sort((x, y) => (cnt[y.name] || 0) - (cnt[x.name] || 0) || x.name.localeCompare(y.name));
  S._addSubs = subs.map(x => x.name);
  $('aSubs').innerHTML = subs.map((x, i) => `<button class="chip ${a.sc === x.name ? 'on' : ''}" onclick="pickSub(${i})">${esc(x.name)}</button>`).join('')
    + `<button class="chip dash" onclick="addSubInline()">+ нова</button>`;
}

function renderAddDate() {
  const a = S.add, t = todayISO();
  const y = isoDay(new Date(Date.now() - 864e5)), y2 = isoDay(new Date(Date.now() - 2 * 864e5));
  const other = ![t, y, y2].includes(a.iso);
  const otherLbl = other ? new Date(a.iso + 'T00:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '📅 Інша';
  $('aDate').innerHTML = [[t, 'Сьогодні'], [y, 'Вчора'], [y2, 'Позавчора']].map(([v, l]) =>
    `<button class="chip ${a.iso === v ? 'on' : ''}" onclick="addDate('${v}')">${l}</button>`).join('')
    + `<label class="chip date-chip ${other ? 'on' : ''}">${otherLbl}<input type="date" value="${a.iso}" max="${t}" onchange="addDate(this.value)" aria-label="Інша дата"></label>`;
}

function updateAddSave() {
  if (S.addMode === 'bulk') { $('aSaveTop').textContent = 'Зберегти'; return; }
  const a = parseMoney($('aAmount').value);
  const ok = a > 0 && S.add.c;
  const p = catParts(S.add.c);
  $('aSave').textContent = ok ? `Зберегти ${moneyExact(a)}` : (a > 0 ? 'Обери категорію' : 'Введи суму');
  $('aAmount').style.width = Math.max(2, $('aAmount').value.length + 0.6) + 'ch';
  $('aSave').disabled = !ok;
  $('aSaveTop').disabled = !ok;
  $('aPicked').innerHTML = S.add.c ? `${p.e} <b>${esc(p.t)}</b>${S.add.sc ? ' · ' + esc(S.add.sc) : ''}` : '';
}

function addWho(u) { S.add.u = u; renderAdd(); }
function addDate(v) { if (v) S.add.iso = v; renderAddDate(); }
function pickCat(i) {
  const c = S._addCats[i];
  if (S.add.c !== c) { S.add.c = c; S.add.sc = ''; }
  vibrate(); renderAdd();
}
function pickSub(i) { const sc = S._addSubs[i]; S.add.sc = S.add.sc === sc ? '' : sc; vibrate(); renderAddSubs(); updateAddSave(); }
function pickQuick(i) {
  const [c, sc] = S._quick[i];
  S.add.c = c; S.add.sc = sc; vibrate(); renderAdd();
  if (!(parseMoney($('aAmount').value) > 0)) $('aAmount').focus();
}
async function addSubInline() {
  const cat = S.add.c;
  const name = await ask({ title: 'Нова підкатегорія', text: catParts(cat).t, value: '' });
  if (!name) return;
  if (!S.subs.some(x => x.category === cat && x.name === name)) {
    const { data, error } = await sb.from('subcategory').insert({ name, category: cat }).select();
    if (error) return toast(error.message);
    S.subs.push(...data); saveCache();
  }
  S.add.sc = name; renderAddSubs(); updateAddSave();
}

async function saveAdd() {
  if (S.addMode === 'bulk') return bulkSave();
  const a = parseMoney($('aAmount').value);
  if (!(a > 0)) {
    const w = $('aAmountWrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
    $('aAmount').focus(); return;
  }
  if (!S.add.c) { toast('Обери категорію'); return; }
  const row = {
    date: dateForDb(S.add.iso), who: S.add.u, categoria: S.add.c,
    subcategory: S.add.sc || null, sum: Math.round(a * 100) / 100, comm: $('aComment').value.trim() || null,
  };
  $('aSave').disabled = true; $('aSaveTop').disabled = true;
  try {
    const res = await insertExpenses([row]);
    vibrate();
    closeAdd();
    if (S.add.iso.slice(0, 7) !== S.mF && S.add.iso.slice(0, 7) <= shiftMonth(curMonth(), 1)) S.mF = S.add.iso.slice(0, 7);
    renderActive();
    const p = catParts(row.categoria);
    toast(res.queued ? `Збережено офлайн · ${money(a)}` : `${p.e} ${money(a)} збережено`, {
      label: 'Скасувати', fn: async () => { await removeExpenses(res.ids || res.queued); renderActive(); toast('Скасовано'); },
    });
  } catch (e) {
    toast('Помилка: ' + (e.message || e));
  } finally { updateAddSave(); }
}

/* ---------- Масове додавання ---------- */
function bulkNewRow() {
  const prev = [...S.bulk].reverse().find(r => r.c) || S.bulk[S.bulk.length - 1];
  return { u: prev ? prev.u : (S.me || USERS[0]), iso: prev ? prev.iso : todayISO(), c: prev ? prev.c : '', sc: '', a: '', cm: '' };
}
function bulkAddRow() {
  S.bulk.push(bulkNewRow()); renderBulk();
  const rows = document.querySelectorAll('#bulkBody tr');
  rows[rows.length - 1].querySelector('[data-f="a"]').focus();
}
function bulkDelRow(i) { S.bulk.splice(i, 1); if (!S.bulk.length) S.bulk = [bulkNewRow()]; renderBulk(); }
function renderBulk() {
  const body = $('bulkBody');
  body.innerHTML = S.bulk.map((r, i) => {
    const subs = subOptions(r.c, r.sc, '—');
    return `<tr data-idx="${i}">
      <td><select class="sel" data-f="u">${USERS.map(u => `<option ${r.u === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
      <td><input type="date" class="inp" data-f="iso" value="${r.iso}"></td>
      <td><select class="sel" data-f="c">${catOptions(r.c, '— вибери —')}</select></td>
      <td><select class="sel" data-f="sc" ${subs.n ? '' : 'disabled'}>${subs.html}</select></td>
      <td><input class="inp num" data-f="a" inputmode="decimal" value="${esc(r.a)}" placeholder="0" style="width:100px;text-align:right"></td>
      <td><input class="inp" data-f="cm" value="${esc(r.cm)}" placeholder="—"></td>
      <td><button class="x" onclick="bulkDelRow(${i})" aria-label="Видалити рядок">✕</button></td></tr>`;
  }).join('');
  updateBulkTotals();
}
function onBulkInput(e) {
  const f = e.target.dataset.f; if (!f) return;
  const i = +e.target.closest('tr').dataset.idx;
  S.bulk[i][f] = e.target.value;
  if (e.type === 'change' && f === 'c') { S.bulk[i].sc = ''; renderBulk(); }
  else updateBulkTotals();
}
const bulkReady = () => S.bulk.filter(r => r.c && parseMoney(r.a) > 0);
function updateBulkTotals() {
  const ready = bulkReady();
  $('bulkTotal').textContent = ready.length ? `Готово ${ready.length} з ${S.bulk.length} · ${money(sum(ready, r => parseMoney(r.a)))}` : `${S.bulk.length} рядків, жоден ще не заповнений`;
  $('bulkSaveBtn').textContent = ready.length ? `Зберегти ${ready.length}` : 'Зберегти всі';
}
async function bulkSave() {
  const ready = bulkReady();
  if (!ready.length) return toast('Заповни хоча б один рядок: категорія + сума');
  const btn = $('bulkSaveBtn'); btn.disabled = true;
  try {
    const res = await insertExpenses(ready.map(r => ({
      date: dateForDb(r.iso), who: r.u, categoria: r.c, subcategory: r.sc || null,
      sum: Math.round(parseMoney(r.a) * 100) / 100, comm: (r.cm || '').trim() || null,
    })));
    S.bulk = [];
    S.bulk = [bulkNewRow(), bulkNewRow(), bulkNewRow()];
    renderBulk(); renderActive();
    toast(`${res.queued ? 'Збережено офлайн' : 'Збережено'}: ${ready.length}`, { label: 'Скасувати', fn: async () => { await removeExpenses(res.ids || res.queued); renderActive(); toast('Скасовано'); } });
  } catch (e) { toast('Помилка: ' + (e.message || e)); }
  btn.disabled = false;
}

/* ---------- Редагування запису ---------- */
function openEdit(id) {
  const it = S.d.find(x => String(x.id) === String(id));
  if (!it) return;
  S.edit = { id: it.id, u: it.u, iso: it.iso, ts: it.ts, c: it.c, sc: it.sc, pending: it.pending };
  renderEdit(it);
  $('sheet-edit').classList.add('open');
}
function renderEdit(it) {
  const e = S.edit;
  const subs = subOptions(e.c, e.sc, '— без підкатегорії —');
  $('editBody').innerHTML = `
    <div class="seg" style="margin-bottom:12px">${USERS.map(u => `<button class="${e.u === u ? 'on' : ''}" onclick="editWho('${u}')">${u}</button>`).join('')}</div>
    <div class="filters">
      <div class="two"><input class="inp num" id="eAmount" inputmode="decimal" value="${it ? it.a : esc($('eAmount').value)}" placeholder="Сума" aria-label="Сума">
        <input type="date" class="inp" id="eDate" value="${it ? it.iso : esc($('eDate').value)}" aria-label="Дата"></div>
      <select class="sel" id="eCat" onchange="editCat(this.value)" aria-label="Категорія">${catOptions(e.c, '— категорія —')}</select>
      <select class="sel" id="eSub" ${subs.n ? '' : 'disabled'} aria-label="Підкатегорія">${subs.html}</select>
      <input class="inp" id="eComment" value="${esc(it ? it.cm : $('eComment').value)}" placeholder="Коментар">
    </div>
    ${e.pending ? `<p class="hint" style="margin-top:10px">⏳ Цей запис ще не відправлено в базу (нема інтернету).</p>` : ''}
    <div class="row-btns" style="margin-top:16px"><button class="btn danger" onclick="deleteEdit()">Видалити</button><button class="btn" style="background:var(--text);color:#000" onclick="saveEdit()">Зберегти</button></div>`;
}
function editWho(u) { S.edit.u = u; S.edit.sc = $('eSub').value; renderEdit(null); }
function editCat(c) { S.edit.c = c; S.edit.sc = ''; renderEdit(null); }
function closeEdit() { $('sheet-edit').classList.remove('open'); S.edit = null; }

async function saveEdit() {
  const e = S.edit; if (!e) return;
  const amount = parseMoney($('eAmount').value);
  if (!(amount > 0)) return toast('Вкажи суму');
  if (!$('eCat').value) return toast('Обери категорію');
  const newIso = $('eDate').value || e.iso;
  const date = newIso === e.iso ? new Date(e.ts).toISOString() : new Date(newIso + 'T12:00:00').toISOString();
  const patch = { date, who: e.u, categoria: $('eCat').value, subcategory: $('eSub').value || null, sum: Math.round(amount * 100) / 100, comm: $('eComment').value.trim() || null };
  if (e.pending) {
    const q = S.queue.find(x => x._q === e.id); Object.assign(q, patch); store.set(LS.queue, S.queue);
  } else {
    const { data, error } = await sb.from('expenses').update(patch).eq('id', e.id).select();
    if (error) return toast(isNetErr(error) ? 'Немає інтернету — редагування не збережено' : error.message);
    const k = S.raw.findIndex(r => r.id === e.id);
    if (k >= 0 && data && data[0]) S.raw[k] = data[0];
    saveCache();
  }
  rebuild(); closeEdit(); renderActive(); vibrate(); toast('Збережено');
}
async function deleteEdit() {
  const e = S.edit; if (!e) return;
  const it = S.d.find(x => String(x.id) === String(e.id));
  const raw = e.pending ? S.queue.find(x => x._q === e.id) : S.raw.find(r => r.id === e.id);
  const backup = raw ? { ...raw } : null;
  if (!await removeExpenses([e.id])) return;
  closeEdit(); renderActive();
  toast(`Видалено ${it ? money(it.a) : ''}`, backup ? { label: 'Повернути', fn: async () => {
    const { id, created_at, _q, ...row } = backup;
    await insertExpenses([row]); renderActive();
  } } : null);
}

/* ---------- Історія ---------- */
function setHist(k, v) {
  S.hist[k] = v;
  if (k === 'c') S.hist.sc = 'All';
  if (k !== 'day' && k !== 'q') S.hist.day = 'All';
  renderHistory();
}
let histSearchT;
function histSearch(v) { clearTimeout(histSearchT); histSearchT = setTimeout(() => { S.hist.q = v; renderHistList(); }, 150); }

function histRows() {
  const h = S.hist, q = h.q.trim().toLowerCase();
  // З пошуком — шукаємо за весь час, без пошуку — у вибраному місяці
  const base = q ? S.d : S.d.filter(i => i.mId === S.mF);
  return base.filter(i =>
    (h.u === 'All' || i.u === h.u) && (h.c === 'All' || i.c === h.c) &&
    (h.sc === 'All' || (h.sc === '__none__' ? !i.sc : i.sc === h.sc)) &&
    (q || h.day === 'All' || i.iso.slice(8) === h.day) &&
    (!q || (i.c + ' ' + i.sc + ' ' + i.cm + ' ' + i.a).toLowerCase().includes(q)));
}

function renderHistory() {
  const h = S.hist;
  const monthRows = S.d.filter(i => i.mId === S.mF && (h.u === 'All' || i.u === h.u));
  const cats = [...new Set(monthRows.map(i => i.c))].sort();
  if (h.c !== 'All' && !cats.includes(h.c)) cats.unshift(h.c);
  const pool = h.c === 'All' ? monthRows : monthRows.filter(i => i.c === h.c);
  const subs = [...new Set(pool.filter(i => i.sc).map(i => i.sc))].sort();
  const hasNone = pool.some(i => !i.sc);
  const days = [...new Set(pool.filter(i => h.sc === 'All' || (h.sc === '__none__' ? !i.sc : i.sc === h.sc)).map(i => i.iso.slice(8)))].sort().reverse();

  $('scr-history').innerHTML = `
    <header class="top"><h1>Історія</h1><div class="top-r">${syncHTML()}</div></header>
    ${monthNavHTML()}
    <div class="card filters">
      <input class="inp" type="search" placeholder="🔍 Пошук: кава, Таврія, 450…" value="${esc(h.q)}" oninput="histSearch(this.value)" autocomplete="off">
      <div class="chips">${['All', ...USERS].map(u => `<button class="chip ${h.u === u ? 'on' : ''}" onclick="setHist('u','${u}')">${u === 'All' ? 'Усі' : u}</button>`).join('')}</div>
      <div class="two">
        <select class="sel" onchange="setHist('c', this.value)" aria-label="Категорія"><option value="All">Усі категорії</option>${cats.map(c => `<option value="${esc(c)}" ${h.c === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select class="sel" onchange="setHist('sc', this.value)" ${subs.length || hasNone ? '' : 'disabled'} aria-label="Підкатегорія"><option value="All">Усі підкатегорії</option>
          ${hasNone && subs.length ? `<option value="__none__" ${h.sc === '__none__' ? 'selected' : ''}>Без підкатегорії</option>` : ''}
          ${subs.map(x => `<option value="${esc(x)}" ${h.sc === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>
      ${days.length > 1 ? `<div class="chips scroll-x days">${['All', ...days].map(d => `<button class="chip ${h.day === d ? 'on' : ''}" onclick="setHist('day','${d}')">${d === 'All' ? 'Усі дні' : +d}</button>`).join('')}</div>` : ''}
    </div>
    <div id="hList"></div>`;
  renderHistList();
}

function renderHistList() {
  const rows = histRows(), box = $('hList');
  if (!box) return;
  if (!rows.length) { box.innerHTML = `<p class="empty">${S.hist.q ? 'Нічого не знайдено' : 'Немає витрат'}</p>`; return; }
  const byDay = {};
  rows.forEach(i => (byDay[i.iso] = byDay[i.iso] || []).push(i));
  const days = Object.keys(byDay).sort().reverse();
  const shown = days.slice(0, S.hist.q ? 60 : 62);
  box.innerHTML = `<p class="muted small" style="margin:0 4px 4px">${rows.length} ${rows.length === 1 ? 'запис' : 'записів'} · ${money(sum(rows, i => i.a))}${S.hist.q ? ' · за весь час' : ''}</p>`
    + shown.map(iso => `<div class="day-h"><span>${dayLabel(iso)}</span><span class="num">${money(sum(byDay[iso], i => i.a))}</span></div>
      <div class="card day-card">${byDay[iso].map(txHTML).join('')}</div>`).join('');
}

/* ---------- Аналітика ---------- */
function toggleAn(u) {
  const other = USERS.find(x => x !== u);
  if (S.an[u] && !S.an[other]) return;
  S.an[u] = !S.an[u];
  renderAnalytics();
}

function renderAnalytics() {
  const m = S.mF, rows = S.d.filter(i => i.mId === m && S.an[i.u]);
  const total = sum(rows, i => i.a);
  const isCur = m === curMonth();
  const daysPassed = isCur ? new Date().getDate() : daysInMonth(m);
  const prevRows = S.d.filter(i => i.mId === shiftMonth(m, -1) && S.an[i.u]);
  const prevTotal = sum(prevRows, i => i.a);
  const forecast = isCur && daysPassed > 3 ? total / daysPassed * daysInMonth(m) : 0;

  $('scr-analytics').innerHTML = `
    <header class="top"><h1>Аналіз</h1>
      <div class="an-users">${USERS.map(u => `<button class="an-chip ${S.an[u] ? 'on' : ''}" style="--c:${UCOLOR[u]}" onclick="toggleAn('${u}')">${u}</button>`).join('')}</div></header>
    ${monthNavHTML()}
    <div class="kpis">
      <div class="kpi"><p>Всього</p><b>${money(total)}</b><small>${prevTotal ? `${total > prevTotal ? '↑' : '↓'} ${Math.abs(Math.round((total - prevTotal) / prevTotal * 100))}% до мин.` : '&nbsp;'}</small></div>
      <div class="kpi"><p>В середньому</p><b>${money(total / Math.max(1, daysPassed))}</b><small>на день</small></div>
      <div class="kpi"><p>${isCur ? 'Прогноз' : 'Записів'}</p><b>${isCur ? (forecast ? money(forecast) : '—') : rows.length}</b><small>${isCur ? 'до кінця місяця' : 'за місяць'}</small></div>
      <div class="kpi"><p>Найбільша</p><b style="font-size:16px">${rows.length ? esc(catParts(topCat(rows)).e + ' ' + catParts(topCat(rows)).t) : '—'}</b><small>категорія</small></div>
    </div>
    <div class="card"><div class="card-h"><h3>Наростаючим підсумком</h3><span class="tiny faint">цей vs минулий місяць</span></div><div class="chart-box"><canvas id="cumChart"></canvas></div></div>
    <div class="card"><div class="card-h"><h3>По місяцях</h3><span class="tiny faint">натисни стовпчик</span></div><div class="chart-box" style="height:220px"><canvas id="monthChart"></canvas></div></div>
    <div class="card"><div class="card-h"><h3>Топ категорій</h3><span class="tiny faint">vs минулий місяць</span></div><div id="topCats"></div></div>`;
  renderTopCats(rows, prevRows);
  if (!window.Chart) {
    ['cumChart', 'monthChart'].forEach(id => $(id).parentElement.innerHTML = `<p class="empty">Графіки завантажаться, коли буде інтернет</p>`);
    return;
  }
  Chart.defaults.color = 'rgba(244,244,246,.45)';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Roboto, sans-serif';
  renderCumChart(m);
  renderMonthChart();
}
function topCat(rows) { const t = {}; rows.forEach(i => t[i.c] = (t[i.c] || 0) + i.a); return Object.entries(t).sort((a, b) => b[1] - a[1])[0][0]; }

function cumSeries(m) {
  const arr = new Array(daysInMonth(m)).fill(0);
  S.d.forEach(i => { if (i.mId === m && S.an[i.u]) arr[+i.iso.slice(8) - 1] += i.a; });
  let s = 0;
  return arr.map(v => s += v);
}
function renderCumChart(m) {
  const cur = cumSeries(m), prev = cumSeries(shiftMonth(m, -1));
  const n = Math.max(cur.length, prev.length);
  const cut = m === curMonth() ? new Date().getDate() : cur.length;
  const ds = [
    { label: monthLabel(m), data: cur.map((v, i) => i < cut ? v : null), borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.12)', fill: true, tension: .3, pointRadius: 0, borderWidth: 2.5 },
    { label: monthLabel(shiftMonth(m, -1)), data: prev, borderColor: 'rgba(255,255,255,.3)', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5, tension: .3 },
  ];
  const b = budgetOf(m);
  if (!budgetEmpty(b) && USERS.every(u => S.an[u])) {
    const planned = sum(budgetReport(b, m).wallets, w => w.planned);
    if (planned) ds.push({ label: 'План', data: new Array(n).fill(planned), borderColor: 'rgba(74,222,128,.6)', borderDash: [2, 3], pointRadius: 0, borderWidth: 1.5 });
  }
  if (charts.cum) charts.cum.destroy();
  charts.cum = new Chart($('cumChart'), {
    type: 'line',
    data: { labels: Array.from({ length: n }, (_, i) => i + 1), datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { callback: v => shortMoney(v), maxTicksLimit: 5 } } },
      plugins: { legend: { labels: { boxWidth: 10, boxHeight: 2 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
    },
  });
}

const stackTotals = {
  id: 'stackTotals',
  afterDatasetsDraw(chart) {
    const vis = chart.data.datasets.map((ds, di) => ({ ds, meta: chart.getDatasetMeta(di) })).filter(x => !x.meta.hidden);
    if (!vis.length) return;
    const ctx = chart.ctx;
    ctx.save(); ctx.font = '700 10px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,255,255,.75)';
    chart.data.labels.forEach((_, i) => {
      let t = 0, top = Infinity;
      vis.forEach(({ ds, meta }) => { t += ds.data[i] || 0; const el = meta.data[i]; if (el && el.y < top) top = el.y; });
      if (t > 0) ctx.fillText(shortMoney(t), vis[0].meta.data[i].x, top - 3);
    });
    ctx.restore();
  },
};
function renderMonthChart() {
  const by = {};
  S.d.forEach(i => { if (!S.an[i.u]) return; (by[i.mId] = by[i.mId] || {})[i.u] = (by[i.mId][i.u] || 0) + i.a; });
  const keys = Object.keys(by).sort().slice(-12);
  if (charts.month) charts.month.destroy();
  charts.month = new Chart($('monthChart'), {
    type: 'bar', plugins: [stackTotals],
    data: {
      labels: keys.map(k => MONTHS_SHORT[+k.slice(5) - 1]),
      datasets: USERS.filter(u => S.an[u]).map(u => ({
        label: u, data: keys.map(k => by[k][u] || 0),
        backgroundColor: keys.map(k => k === S.mF ? UCOLOR[u] : UCOLOR[u] + '59'), borderRadius: 6, borderSkipped: false,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, display: false } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => monthLabel(keys[it[0].dataIndex]), label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
      onClick: (e, els) => { if (els.length) { S.mF = keys[els[0].index]; renderAnalytics(); } },
    },
  });
}
function renderTopCats(rows, prevRows) {
  const cur = {}, prev = {};
  rows.forEach(i => cur[i.c] = (cur[i.c] || 0) + i.a);
  prevRows.forEach(i => prev[i.c] = (prev[i.c] || 0) + i.a);
  const list = Object.entries(cur).sort((a, b) => b[1] - a[1]);
  if (!list.length) { $('topCats').innerHTML = `<p class="empty">Немає витрат</p>`; return; }
  const total = sum(list, x => x[1]), max = list[0][1];
  $('topCats').innerHTML = list.map(([c, v]) => {
    const p = prev[c];
    let d = '<span class="faint">нова</span>';
    if (p > 0) {
      const r = Math.round((v - p) / p * 100);
      d = r >= 200 ? `<span class="bad">×${Math.round(v / p)}</span>` : r === 0 ? '<span class="faint">=</span>' : `<span class="${r > 0 ? 'bad' : 'good'}">${r > 0 ? '+' : ''}${r}%</span>`;
    }
    const cp = catParts(c);
    return `<div class="top-c"><div class="r"><span>${cp.e} ${esc(cp.t)}</span><b>${money(v)} <span class="faint tiny">${Math.round(v / total * 100)}%</span> <span class="tiny">${d}</span></b></div>
      <div class="bar"><i style="width:${v / max * 100}%;background:var(--grad)"></i></div></div>`;
  }).join('');
}

/* ---------- Налаштування і категорії ---------- */
function renderSettings() {
  prefetchWidgets();
  const cnt = {};
  S.d.forEach(i => cnt[i.c] = (cnt[i.c] || 0) + 1);
  const cats = [...S.cats].sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || (cnt[b.name] || 0) - (cnt[a.name] || 0));
  S._setCats = cats.map(c => c.id);
  const orphan = [...new Set(S.d.map(i => i.c))].filter(c => !S.cats.some(x => x.name === c));

  $('scr-settings').innerHTML = `
    <header class="top"><div style="display:flex;align-items:center;gap:10px"><button class="icon-btn" onclick="go('home')" aria-label="Назад">‹</button><h1>Налаштування</h1></div></header>
    <div class="card">
      <div class="card-h"><h3>Цей телефон</h3></div>
      <p class="hint">Нові витрати за замовчуванням записуються на:</p>
      <div class="seg">${USERS.map(u => `<button class="${S.me === u ? 'on' : ''}" onclick="setMe('${u}')">${u}</button>`).join('')}</div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Додаток на екрані «Додому»</h3></div>
      ${isStandalone() ? `<p class="small">✓ Встановлено — відкривається як окремий додаток.</p>` : isIOS() ? `<ol class="steps">
          <li>Відкрий цю сторінку в <b>Safari</b></li><li>Натисни <b>«Поділитися»</b> (квадрат зі стрілкою)</li>
          <li>Обери <b>«На екран „Додому“»</b> → «Додати»</li></ol>
          <p class="hint" style="margin-top:8px">Після цього «Фінанси» відкриваються на весь екран, як звичайний додаток, і працюють навіть без інтернету — записи відправляться пізніше.</p>`
        : `<p class="small muted">Відкрий меню браузера → «Встановити додаток» / «Додати на головний екран».</p>`}
    </div>
    <div class="card">
      <div class="card-h"><h3>Віджети на iPhone</h3></div>
      <p class="hint">Через безкоштовний додаток <b>Scriptable</b>: віджет із бюджетом на екрані «Додому» і блокування, а «+» на ньому додає витрату, не відкриваючи сайт.</p>
      <ol class="steps">
        <li>Встанови <a class="link" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener">Scriptable</a> з App Store</li>
        <li>Натисни <b>«Копіювати віджет»</b> нижче → у Scriptable «+» → встав код → назви скрипт <b>Фінанси</b></li>
        <li>Натисни <b>«Копіювати „+“»</b> → новий скрипт → встав → назви <b>Фінанси +</b> (саме так, із плюсом)</li>
        <li>Затисни екран «Додому» → «+» → Scriptable → обери розмір → торкнись віджета → Script: <b>Фінанси</b></li>
      </ol>
      <div class="row-btns"><button onclick="copyWidget('finance-widget.js', this)">📋 Копіювати віджет</button><button onclick="copyWidget('finance-add.js', this)">📋 Копіювати «+»</button></div>
      <p class="hint" style="margin-top:10px">Розміри: малий (тап — одразу додати витрату), середній (бюджет усіх гаманців + кнопка «+»), великий (ще топ категорій і останні записи). Для екрана блокування теж є. У полі <b>Parameter</b> віджета можна вписати «Влад» чи «Таня», щоб бачити лише своє і спільне.</p>
      <p class="hint">Бонус: у додатку «Команди» створи команду з дією Scriptable «Run Script» → «Фінанси +» і назви її «Витрата» — тоді працюватиме «Сірі, витрата», кнопка «Дія» та подвійний тап по задній кришці.</p>
    </div>
    <div class="card">
      <div class="card-h"><h3>Категорії</h3><span class="tiny faint">натисни, щоб змінити</span></div>
      ${cats.map((c, i) => {
        const p = catParts(c.name), ns = S.subs.filter(x => x.category === c.name).length;
        return `<div class="set-row ${c.hidden ? 'off' : ''}" onclick="openCat(${c.id})"><div class="cat-e">${p.e}</div>
          <div class="cat-m"><div class="cat-t">${esc(p.t)}</div><small>${cnt[c.name] || 0} записів · ${ns} підкат.${c.hidden ? ' · приховано' : ''}</small></div><span class="chev">›</span></div>`;
      }).join('')}
      <div class="add-line"><input class="inp" id="newCat" placeholder="🐶 Нова категорія (емодзі + назва)" autocomplete="off"><button class="btn" onclick="addCategory()">+</button></div>
      ${orphan.length ? `<p class="hint" style="margin-top:10px">У записах є категорії, яких немає в списку: ${orphan.map(esc).join(', ')}</p>` : ''}
    </div>
    <div class="card">
      <div class="card-h"><h3>Дані</h3></div>
      <p class="small muted" style="margin:0 0 10px">${S.raw.length} записів у базі${S.queue.length ? ` · ${S.queue.length} в черзі` : ''}${S.loadedAt ? ` · оновлено ${new Date(S.loadedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      <div class="row-btns"><button onclick="loadData().then(()=>toast('Оновлено'))">↻ Оновити</button><button onclick="exportCSV()">⬇︎ Експорт CSV</button></div>
    </div>`;
}

async function addCategory() {
  const n = $('newCat').value.trim();
  if (!n) return;
  if (S.cats.some(c => c.name === n)) return toast('Така категорія вже є');
  const { error } = await sb.from('categories').insert({ name: n });
  if (error) return toast(error.message);
  await loadData(); toast('Категорію додано');
}

function openCat(id) { S.catSheet = id; renderCatSheet(); $('sheet-cat').classList.add('open'); }
function closeSheet(id) { $(id).classList.remove('open'); }
function renderCatSheet() {
  const c = S.cats.find(x => x.id === S.catSheet);
  if (!c) { closeSheet('sheet-cat'); return; }
  const cnt = {}; let total = 0;
  S.d.forEach(i => { if (i.c === c.name) { total++; if (i.sc) cnt[i.sc] = (cnt[i.sc] || 0) + 1; } });
  const subs = S.subs.filter(x => x.category === c.name).sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || (cnt[b.name] || 0) - (cnt[a.name] || 0));
  $('catTitle').textContent = c.name;
  $('catBody').innerHTML = `
    <p class="sec-t" style="margin-top:0">Назва</p>
    <div class="add-line" style="margin-top:0"><input class="inp" id="catName" value="${esc(c.name)}" autocomplete="off"><button class="btn" onclick="renameCategory()">Зберегти</button></div>
    <p class="hint" style="margin-top:6px">Емодзі на початку назви стане іконкою. Перейменування оновить і всі ${total} записів, і бюджети.</p>
    <p class="sec-t">Підкатегорії</p>
    <div>${subs.map(x => `<div class="sub-r ${x.hidden ? 'off' : ''}"><span class="nm">${esc(x.name)}<small>${cnt[x.name] || 0}</small></span>
        <button onclick="renameSub(${x.id})" aria-label="Перейменувати">✎</button>
        <button onclick="moveSub(${x.id})" aria-label="Перенести в іншу категорію">⇄</button>
        <button onclick="toggleHidden('subcategory', ${x.id}, ${!x.hidden})" aria-label="${x.hidden ? 'Показати' : 'Приховати'}">${x.hidden ? '🙈' : '👁'}</button>
        <button onclick="deleteSub(${x.id})" aria-label="Видалити" style="color:var(--bad)">✕</button></div>`).join('') || `<p class="muted small">Немає підкатегорій</p>`}</div>
    <div class="add-line"><input class="inp" id="newSub" placeholder="Нова підкатегорія" autocomplete="off" onkeydown="if(event.key==='Enter')addSub()"><button class="btn" onclick="addSub()">+</button></div>
    <p class="hint" style="margin-top:8px">⇄ — перенести підкатегорію разом із її записами в іншу категорію (якщо там така вже є, вони обʼєднаються).</p>
    <div class="row-btns" style="margin-top:18px"><button onclick="toggleHidden('categories', ${c.id}, ${!c.hidden})">${c.hidden ? '👁 Показати' : '🙈 Приховати'}</button>
      <button style="color:var(--bad)" onclick="deleteCategory()">Видалити</button></div>
    <p class="hint" style="margin-top:8px">Прихована категорія зникає з форми додавання, але лишається в історії та статистиці.</p>`;
}
const catById = () => S.cats.find(x => x.id === S.catSheet);
async function afterCatChange(msg) { await loadData(); if ($('sheet-cat').classList.contains('open')) renderCatSheet(); if (msg) toast(msg); }

async function budgetsReplace(pred, fn) {
  for (const m of Object.keys(S.budgets)) {
    const b = normBudget(S.budgets[m]);
    let ch = false;
    allItems(b).forEach(it => { if (pred(it)) { fn(it); ch = true; } });
    if (ch) await persistBudget(m, b);
  }
}

async function renameCategory() {
  const c = catById(), nn = $('catName').value.trim(), old = c.name;
  if (!nn || nn === old) return;
  if (S.cats.some(x => x.name === nn)) return toast('Така категорія вже є');
  const r = await sb.from('categories').update({ name: nn }).eq('id', c.id);
  if (r.error) return toast(r.error.message);
  await sb.from('subcategory').update({ category: nn }).eq('category', old);
  await sb.from('expenses').update({ categoria: nn }).eq('categoria', old);
  await budgetsReplace(it => it.cat === old, it => { it.cat = nn; });
  await afterCatChange('Перейменовано');
}
async function addSub() {
  const c = catById(), n = $('newSub').value.trim();
  if (!n) return;
  if (S.subs.some(x => x.category === c.name && x.name === n)) return toast('Така вже є');
  const { error } = await sb.from('subcategory').insert({ name: n, category: c.name });
  if (error) return toast(error.message);
  await afterCatChange('Додано');
}
async function renameSub(id) {
  const x = S.subs.find(s => s.id === id);
  const nn = await ask({ title: 'Перейменувати', value: x.name, ok: 'Зберегти' });
  if (!nn || nn === x.name) return;
  if (S.subs.some(s => s.category === x.category && s.name === nn)) return toast('Така вже є — скористайся ⇄, щоб обʼєднати');
  const r = await sb.from('subcategory').update({ name: nn }).eq('id', id);
  if (r.error) return toast(r.error.message);
  await sb.from('expenses').update({ subcategory: nn }).eq('categoria', x.category).eq('subcategory', x.name);
  await budgetsReplace(it => it.cat === x.category && it.sub === x.name, it => { it.sub = nn; if (it.name === x.name) it.name = nn; });
  await afterCatChange('Перейменовано');
}
async function moveSub(id) {
  const x = S.subs.find(s => s.id === id);
  const target = await ask({ title: `Перенести «${x.name}»`, text: 'В яку категорію? Записи переїдуть разом із підкатегорією.', ok: 'Перенести',
    options: S.cats.filter(c => c.name !== x.category).map(c => ({ value: c.name, label: c.name })) });
  if (!target) return;
  const dup = S.subs.find(s => s.category === target && s.name === x.name);
  const r = dup ? await sb.from('subcategory').delete().eq('id', id) : await sb.from('subcategory').update({ category: target }).eq('id', id);
  if (r.error) return toast(r.error.message);
  await sb.from('expenses').update({ categoria: target }).eq('categoria', x.category).eq('subcategory', x.name);
  await budgetsReplace(it => it.cat === x.category && it.sub === x.name, it => { it.cat = target; });
  await afterCatChange(dup ? `Обʼєднано з «${catParts(target).t} › ${x.name}»` : 'Перенесено');
}
async function deleteSub(id) {
  const x = S.subs.find(s => s.id === id);
  const n = S.d.filter(i => i.c === x.category && i.sc === x.name).length;
  if (!await confirmDlg(`Видалити «${x.name}»?`, n ? `${n} записів залишаться в історії з цією підкатегорією. Якщо просто не хочеш її бачити — краще приховати.` : '', 'Видалити', true)) return;
  const r = await sb.from('subcategory').delete().eq('id', id);
  if (r.error) return toast(r.error.message);
  await afterCatChange('Видалено');
}
async function deleteCategory() {
  const c = catById();
  const n = S.d.filter(i => i.c === c.name).length;
  if (!await confirmDlg(`Видалити «${c.name}»?`, n ? `${n} записів залишаться в історії з цією категорією. Можна натомість приховати.` : 'Підкатегорії теж буде видалено.', 'Видалити', true)) return;
  const r = await sb.from('categories').delete().eq('id', c.id);
  if (r.error) return toast(r.error.message);
  await sb.from('subcategory').delete().eq('category', c.name);
  closeSheet('sheet-cat');
  await afterCatChange('Категорію видалено');
}
async function toggleHidden(table, id, val) {
  const { error } = await sb.from(table).update({ hidden: val }).eq('id', id);
  if (error) return toast(error.message);
  await afterCatChange(val ? 'Приховано' : 'Показано');
}

// Код віджетів підтягуємо заздалегідь: Safari дозволяє копіювати лише одразу в момент тапу
const widgetCode = {};
function prefetchWidgets() {
  ['finance-widget.js', 'finance-add.js'].forEach(f => {
    if (!widgetCode[f]) fetch('widgets/' + f).then(r => r.ok ? r.text() : Promise.reject()).then(t => { widgetCode[f] = t; }).catch(() => {});
  });
}
async function copyWidget(f, btn) {
  const label = btn.textContent;
  try {
    if (widgetCode[f]) await navigator.clipboard.writeText(widgetCode[f]);
    else await navigator.clipboard.write([new ClipboardItem({ 'text/plain': fetch('widgets/' + f).then(r => r.blob()) })]);
    btn.textContent = '✓ Скопійовано';
    toast('Скопійовано — встав у новий скрипт у Scriptable');
  } catch (e) {
    window.open('widgets/' + f, '_blank'); // запасний варіант: відкрити код і скопіювати вручну
  }
  setTimeout(() => { btn.textContent = label; }, 2500);
}

function exportCSV() {
  const head = ['Дата', 'Хто', 'Категорія', 'Підкатегорія', 'Сума', 'Коментар'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = S.d.map(i => [i.iso, i.u, i.c, i.sc, String(i.a).replace('.', ','), i.cm].map(q).join(';'));
  const blob = new Blob(['﻿' + [head.map(q).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'finance-' + todayISO() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Старт ---------- */
function boot() {
  try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch (e) { sb = null; }

  const cache = store.get(LS.cache, null);
  if (cache) {
    S.cats = cache.cats || []; S.subs = cache.subs || []; S.raw = cache.raw || [];
    S.budgets = cache.budgets || {}; S.budgetDb = cache.budgetDb !== false;
  }
  S.queue = store.get(LS.queue, []);
  S.mF = curMonth();
  rebuild();

  $('aAmount').addEventListener('input', updateAddSave);
  $('aAmount').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); S.add.c ? saveAdd() : $('aAmount').blur(); } });
  $('aComment').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveAdd(); } });
  const bb = $('bulkBody'); bb.addEventListener('input', onBulkInput); bb.addEventListener('change', onBulkInput);
  const bs = $('scr-budget'); bs.addEventListener('input', onBudInput); bs.addEventListener('change', onBudChange); bs.addEventListener('click', onBudClick);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('dlg').classList.contains('open')) return $('dlg').classList.remove('open');
    closeAdd(); closeEdit(); closeSheet('sheet-cat');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBudgetSave();
    else if (Date.now() - S.loadedAt > 30000) loadData();
  });
  window.addEventListener('online', () => loadData());

  renderActive();
  loadData();
  openWho(false);

  const p = new URLSearchParams(location.search);
  if (p.has('add')) { history.replaceState(null, '', location.pathname); openAdd(); }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.addEventListener('DOMContentLoaded', boot);
