(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { token: '', query: '', catalogStart: 1, catalogTotal: 0, trackedStart: 1, trackedTotal: 0, selected: null, cursor: null, history: [] };
  const limit = 10;
  const notice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
  async function api(path, options = {}) {
    if (!state.token) throw new Error('Сначала введите токен API.');
    const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  }
  const button = (label, action, secondary = true) => {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
    if (secondary) el.className = 'secondary';
    el.addEventListener('click', () => run(action)); return el;
  };
  async function run(action) { try { await action(); } catch (error) { notice(error instanceof Error ? error.message : 'Ошибка запроса', true); } }
  function item(currency, actions, price) {
    const row = document.createElement('div'); row.className = 'item';
    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.alt = '';
    icon.width = 32;
    icon.height = 32;
    icon.src = `https://s2.coinmarketcap.com/static/img/coins/64x64/${currency.id}.png`;
    icon.addEventListener('error', () => icon.remove());
    const info = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = `${currency.name} · ${currency.symbol}`;
    const sub = document.createElement('small'); sub.textContent = `ID ${currency.id} · ${currency.slug}${currency.is_active === false ? ' · на паузе' : ''}`;
    info.append(name, sub);
    if (price !== undefined) { const p = document.createElement('div'); p.className = 'price'; p.textContent = price; info.append(p); }
    const controls = document.createElement('div'); controls.className = 'actions'; controls.append(...actions);
    row.append(icon, info, controls); return row;
  }
  function pagination(prefix, start, total) {
    $(`${prefix}-page`).textContent = total ? `${start}–${Math.min(start + limit - 1, total)} из ${total}` : 'Нет записей';
    $(`${prefix}-prev`).disabled = start <= 1;
    $(`${prefix}-next`).disabled = start + limit > total;
  }
  async function loadCatalog() {
    const params = new URLSearchParams({ start: String(state.catalogStart), limit: String(limit) });
    if (state.query) params.set('q', state.query);
    const result = await api(`/v1/cryptocurrency/map?${params}`);
    state.catalogTotal = result.pagination.total; $('catalog').replaceChildren();
    for (const currency of result.data) $('catalog').append(item(currency, [button('Отслеживать', async () => {
      await api('/v1/cryptocurrency/tracked', { method: 'POST', body: JSON.stringify({ id: currency.id }) });
      notice(`${currency.symbol} добавлена в отслеживание.`); await loadTracked();
    }, false)]));
    pagination('catalog', state.catalogStart, state.catalogTotal);
  }
  async function loadTracked() {
    const result = await api(`/v1/cryptocurrency/tracked?start=${state.trackedStart}&limit=${limit}`);
    if (!result.data.length && result.pagination.total && state.trackedStart > 1) { state.trackedStart = Math.max(1, state.trackedStart - limit); return loadTracked(); }
    state.trackedTotal = result.pagination.total;
    const prices = result.data.length ? await api(`/v1/cryptocurrency/prices/latest?id=${result.data.map((c) => c.id).join(',')}`) : { data: [] };
    const byId = new Map(prices.data.map((c) => [c.id, c.price]));
    $('tracked').replaceChildren();
    for (const currency of result.data) {
      const quote = byId.get(currency.id);
      const label = quote ? `${quote.price} ${quote.quote_currency} · ${quote.fetched_at}` : 'Цена ещё не получена';
      $('tracked').append(item(currency, [
        button('История', async () => { state.selected = currency; state.cursor = null; state.history = []; await loadHistory(); }),
        button(currency.is_active ? 'Пауза' : 'Возобновить', async () => {
          await api(`/v1/cryptocurrency/tracked?id=${currency.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !currency.is_active }) });
          notice('Статус отслеживания обновлён.'); await loadTracked();
        }),
        button('Удалить', async () => {
          if (!window.confirm(`Удалить ${currency.symbol} из отслеживания? История сохранится.`)) return;
          await api(`/v1/cryptocurrency/tracked?id=${currency.id}`, { method: 'DELETE' }); notice('Отслеживание удалено.'); await loadTracked();
        })
      ], label));
    }
    pagination('tracked', state.trackedStart, state.trackedTotal);
  }
  function drawChart(rows) {
    const canvas = $('chart');
    if (!rows.length) { canvas.hidden = true; return; }
    canvas.hidden = false;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const ordered = rows.slice(0, 500).reverse(), values = ordered.map((row) => row.price);
    const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#39865d'; ctx.lineWidth = 3; ctx.beginPath();
    ordered.forEach((row, i) => { const x = 25 + i * (canvas.width - 50) / Math.max(ordered.length - 1, 1); const y = canvas.height - 25 - (row.price - min) / spread * (canvas.height - 50); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  }
  async function loadHistory() {
    const params = new URLSearchParams({ id: String(state.selected.id), count: '50' });
    if (state.cursor) params.set('cursor', state.cursor);
    const result = await api(`/v1/cryptocurrency/prices/historical?${params}`);
    state.history.push(...result.data); state.cursor = result.meta.next_cursor;
    $('history-title').textContent = `История · ${state.selected.name} (${state.selected.symbol})`;
    $('history-message').textContent = `Загружено ${state.history.length} из ${result.meta.total}. График показывает до 500 последних точек в валюте котировки последней записи.`;
    $('history-list').replaceChildren();
    for (const row of state.history) {
      const el = document.createElement('div'); el.className = 'history-row';
      const date = document.createElement('span'); date.textContent = row.fetched_at;
      const price = document.createElement('strong'); price.textContent = `${row.price} ${row.quote_currency}`;
      el.append(date, price); $('history-list').append(el);
    }
    const currency = state.history[0]?.quote_currency;
    drawChart(state.history.filter((row) => row.quote_currency === currency));
    $('more').hidden = !state.cursor;
  }
  $('auth-form').addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
    state.token = $('token').value; $('token').value = ''; state.catalogStart = 1; state.trackedStart = 1;
    state.selected = null; state.cursor = null; state.history = []; $('history-list').replaceChildren(); $('chart').hidden = true; $('more').hidden = true; $('history-title').textContent = 'История цен';
    await Promise.all([loadCatalog(), loadTracked()]); notice('Подключено.');
  }); });
  $('search-form').addEventListener('submit', (event) => { event.preventDefault(); state.query = $('query').value.trim(); state.catalogStart = 1; run(loadCatalog); });
  $('refresh').addEventListener('click', () => run(loadTracked));
  $('catalog-prev').addEventListener('click', () => { state.catalogStart = Math.max(1, state.catalogStart - limit); run(loadCatalog); });
  $('catalog-next').addEventListener('click', () => { state.catalogStart += limit; run(loadCatalog); });
  $('tracked-prev').addEventListener('click', () => { state.trackedStart = Math.max(1, state.trackedStart - limit); run(loadTracked); });
  $('tracked-next').addEventListener('click', () => { state.trackedStart += limit; run(loadTracked); });
  $('more').addEventListener('click', () => run(loadHistory));
  pagination('catalog', 1, 0); pagination('tracked', 1, 0);
})();
