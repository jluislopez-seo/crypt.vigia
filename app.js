/* =========================================================
   Ledger — panel de acciones y cuentas X
   Todo el estado vive en localStorage. Sin backend propio.
   ========================================================= */

const LS_KEYS = {
  watchlist: 'jl_watchlist',
  xaccounts: 'jl_xaccounts',
  apiKey: 'jl_finnhub_key',
  activity: 'jl_activity',
  pollMs: 'jl_poll_interval',
  selected: 'jl_selected_symbol',
};

const state = {
  watchlist: JSON.parse(localStorage.getItem(LS_KEYS.watchlist) || '[]'),
  xaccounts: JSON.parse(localStorage.getItem(LS_KEYS.xaccounts) || '[]'),
  apiKey: localStorage.getItem(LS_KEYS.apiKey) || '',
  activity: JSON.parse(localStorage.getItem(LS_KEYS.activity) || '[]'),
  pollMs: parseInt(localStorage.getItem(LS_KEYS.pollMs) || '30000', 10),
  selected: localStorage.getItem(LS_KEYS.selected) || null,
  chart: null,
  pollTimer: null,
  twitterLoaded: false,
};

function save(key, val){ localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); }
function persistAll(){
  save(LS_KEYS.watchlist, state.watchlist);
  save(LS_KEYS.xaccounts, state.xaccounts);
  save(LS_KEYS.activity, state.activity);
  save(LS_KEYS.selected, state.selected || '');
}

function logActivity(text){
  state.activity.unshift({ text, time: Date.now() });
  state.activity = state.activity.slice(0, 20);
  save(LS_KEYS.activity, state.activity);
  renderActivity();
}

function timeAgo(ts){
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return Math.floor(s/60) + ' min';
  if (s < 86400) return Math.floor(s/3600) + ' h';
  return Math.floor(s/86400) + ' d';
}

/* ---------------- Finnhub API ---------------- */

async function finnhubQuote(symbol){
  if (!state.apiKey) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${state.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('quote_failed');
  const data = await res.json();
  if (data.c === undefined) throw new Error('bad_symbol');
  return data; // {c: current, d: change, dp: percent, h,l,o,pc}
}

async function finnhubSearch(query){
  if (!state.apiKey) return [];
  const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${state.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.result || []).slice(0, 8);
}

async function finnhubProfile(symbol){
  if (!state.apiKey) return null;
  try{
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${state.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  }catch(e){ return null; }
}

/* ---------------- Watchlist ---------------- */

function findStock(symbol){
  return state.watchlist.find(s => s.symbol === symbol);
}

async function addStock(symbolRaw){
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return;
  if (findStock(symbol)){ flashApiStatus('Esa acción ya está en tu lista.', true); return; }

  const entry = { symbol, name: '', addedAt: Date.now(), price: null, change: null, changePct: null, history: [] };
  state.watchlist.push(entry);
  if (!state.selected) state.selected = symbol;
  persistAll();
  logActivity(`Añadida ${symbol} a la lista`);
  renderAll();

  if (state.apiKey){
    try{
      const [quote, profile] = await Promise.all([finnhubQuote(symbol), finnhubProfile(symbol)]);
      if (quote){
        entry.price = quote.c;
        entry.change = quote.d;
        entry.changePct = quote.dp;
        entry.history.push({ t: Date.now(), price: quote.c });
      }
      if (profile && profile.name) entry.name = profile.name;
      persistAll();
      renderAll();
    }catch(e){
      flashApiStatus('No se pudo obtener el precio de ' + symbol + '. Comprueba el símbolo o tu clave API.', true);
    }
  }
}

function removeStock(symbol){
  state.watchlist = state.watchlist.filter(s => s.symbol !== symbol);
  if (state.selected === symbol) state.selected = state.watchlist[0]?.symbol || null;
  persistAll();
  logActivity(`Eliminada ${symbol} de la lista`);
  renderAll();
}

async function refreshAllPrices(){
  if (!state.apiKey || state.watchlist.length === 0) return;
  for (const entry of state.watchlist){
    try{
      const quote = await finnhubQuote(entry.symbol);
      if (quote){
        entry.price = quote.c;
        entry.change = quote.d;
        entry.changePct = quote.dp;
        entry.history.push({ t: Date.now(), price: quote.c });
        if (entry.history.length > 200) entry.history = entry.history.slice(-200);
      }
    }catch(e){ /* skip symbol on failure */ }
  }
  persistAll();
  renderAll();
}

function startPolling(){
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.pollMs > 0){
    state.pollTimer = setInterval(refreshAllPrices, state.pollMs);
  }
}

/* ---------------- X / Twitter accounts ---------------- */

function addXAccount(handleRaw){
  const handle = handleRaw.trim().replace(/^@/, '');
  if (!handle) return;
  if (state.xaccounts.find(a => a.handle.toLowerCase() === handle.toLowerCase())){
    return;
  }
  state.xaccounts.push({ handle, addedAt: Date.now() });
  persistAll();
  logActivity(`Siguiendo a @${handle} en X`);
  renderAll();
}

function removeXAccount(handle){
  state.xaccounts = state.xaccounts.filter(a => a.handle !== handle);
  persistAll();
  logActivity(`Dejaste de seguir a @${handle}`);
  renderAll();
}

function ensureTwitterWidgets(cb){
  if (window.twttr && window.twttr.widgets){ cb(); return; }
  if (state.twitterLoaded){ setTimeout(() => cb(), 500); return; }
  state.twitterLoaded = true;
  const s = document.createElement('script');
  s.src = 'https://platform.twitter.com/widgets.js';
  s.async = true;
  s.onload = cb;
  s.onerror = () => console.warn('No se pudo cargar el widget de X.');
  document.body.appendChild(s);
}

/* ---------------- Rendering ---------------- */

function sparklinePath(history, w, h){
  if (!history || history.length < 2) return null;
  const prices = history.map(p => p.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = (max - min) || 1;
  const step = w / (prices.length - 1);
  return prices.map((p, i) => {
    const x = i * step;
    const y = h - ((p - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function sparklineSVG(entry, w=160, h=36){
  const up = (entry.changePct ?? 0) >= 0;
  const color = up ? 'var(--mint)' : 'var(--red)';
  const path = sparklinePath(entry.history, w, h);
  if (!path) return `<svg class="card-spark" viewBox="0 0 ${w} ${h}"><text x="4" y="${h/2}" fill="#5B6478" font-size="10">Esperando datos…</text></svg>`;
  return `<svg class="card-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function fmtPrice(v){ return v === null || v === undefined ? '—' : '$' + v.toFixed(2); }
function fmtPct(v){ return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

function renderCards(){
  const row = document.getElementById('cardsRow');
  const addBtn = row.querySelector('.card-add');
  row.querySelectorAll('.card:not(.card-add)').forEach(c => c.remove());
  state.watchlist.slice(0, 12).forEach(entry => {
    const up = (entry.changePct ?? 0) >= 0;
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.symbol = entry.symbol;
    card.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-sym">${entry.symbol}</div>
          <div class="card-name">${entry.name || 'Sin nombre'}</div>
        </div>
        <button class="card-remove" title="Eliminar">&times;</button>
      </div>
      <div class="card-price">${fmtPrice(entry.price)}</div>
      <div class="card-change ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fmtPct(entry.changePct)}</div>
      ${sparklineSVG(entry)}
    `;
    card.querySelector('.card-remove').addEventListener('click', (e) => { e.stopPropagation(); removeStock(entry.symbol); });
    card.addEventListener('click', () => { state.selected = entry.symbol; persistAll(); renderChart(); renderCards(); });
    row.insertBefore(card, addBtn);
  });
}

function renderTable(){
  const body = document.getElementById('watchlistBody');
  if (state.watchlist.length === 0){
    body.innerHTML = '<tr><td colspan="6" class="empty-row">Todavía no has añadido ninguna acción.</td></tr>';
    return;
  }
  body.innerHTML = state.watchlist.map(entry => {
    const up = (entry.changePct ?? 0) >= 0;
    return `<tr data-symbol="${entry.symbol}">
      <td class="wl-sym">${entry.symbol}</td>
      <td>${entry.name || '—'}</td>
      <td class="wl-price">${fmtPrice(entry.price)}</td>
      <td class="wl-chg ${up ? 'up' : 'down'}">${fmtPct(entry.changePct)}</td>
      <td>${sparklineSVG(entry, 90, 28).replace('card-spark','wl-spark')}</td>
      <td><button class="wl-remove" data-symbol="${entry.symbol}">Quitar</button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.wl-remove').forEach(btn => {
    btn.addEventListener('click', () => removeStock(btn.dataset.symbol));
  });
  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.wl-remove')) return;
      state.selected = tr.dataset.symbol;
      persistAll();
      renderChart();
      document.querySelector('[data-view="dashboard"]').click();
    });
  });
}

let currentRange = '30';

function renderChart(){
  const entry = findStock(state.selected);
  const title = document.getElementById('chartSymbolTitle');
  const priceEl = document.getElementById('chartSymbolPrice');
  const ctx = document.getElementById('mainChart');

  if (!entry){
    title.textContent = 'Selecciona una acción';
    priceEl.textContent = '—';
    if (state.chart){ state.chart.destroy(); state.chart = null; }
    return;
  }

  title.textContent = `${entry.symbol} — ${entry.name || ''}`;
  const up = (entry.changePct ?? 0) >= 0;
  priceEl.innerHTML = `${fmtPrice(entry.price)} <span style="color:${up?'var(--mint)':'var(--red)'}">${fmtPct(entry.changePct)}</span>`;

  let hist = entry.history;
  if (currentRange !== 'all'){
    const cutoff = Date.now() - parseInt(currentRange, 10) * 60000;
    hist = hist.filter(p => p.t >= cutoff);
  }
  if (hist.length < 2) hist = entry.history;

  const labels = hist.map(p => new Date(p.t).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }));
  const data = hist.map(p => p.price);

  const mintColor = getComputedStyle(document.body).getPropertyValue('--mint').trim() || '#22E6A8';

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: up ? '#22E6A8' : '#FF5C6C',
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,230);
          g.addColorStop(0, up ? 'rgba(34,230,168,.25)' : 'rgba(255,92,108,.25)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          return g;
        },
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5B6478', maxTicksLimit: 6, font: { family: 'JetBrains Mono', size: 10 } } },
        y: { grid: { color: '#1C222C' }, ticks: { color: '#5B6478', font: { family: 'JetBrains Mono', size: 10 } } },
      }
    }
  });
}

function renderSummary(){
  document.getElementById('summaryCount').textContent = state.watchlist.length;
  const list = document.getElementById('summaryList');
  if (state.watchlist.length === 0){
    list.innerHTML = '<div class="empty-row">Nada que mostrar aún.</div>';
    return;
  }
  list.innerHTML = state.watchlist.map(e => {
    const up = (e.changePct ?? 0) >= 0;
    return `<div class="summary-row">
      <span class="s-sym">${e.symbol}</span>
      <span>${fmtPrice(e.price)}</span>
      <span class="s-chg ${up?'up':'down'}">${fmtPct(e.changePct)}</span>
    </div>`;
  }).join('');
}

function renderActivity(){
  const list = document.getElementById('activityList');
  if (state.activity.length === 0){
    list.innerHTML = '<li class="empty-row">Sin actividad todavía.</li>';
    return;
  }
  list.innerHTML = state.activity.map(a => `
    <li><span class="activity-dot"></span><span>${a.text}</span><span class="a-time">${timeAgo(a.time)}</span></li>
  `).join('');
}

function renderTape(){
  const track = document.getElementById('tapeTrack');
  if (state.watchlist.length === 0){
    track.innerHTML = '<span class="tape-empty">Añade acciones a tu lista para ver la cinta en vivo →</span>';
    return;
  }
  const items = state.watchlist.map(e => {
    const up = (e.changePct ?? 0) >= 0;
    return `<span class="tape-item"><span class="t-sym">${e.symbol}</span> ${fmtPrice(e.price)} <span class="${up ? 't-up' : 't-down'}">${fmtPct(e.changePct)}</span></span>`;
  }).join('');
  track.innerHTML = items + items; // duplicated for seamless loop
}

function renderXMini(){
  const list = document.getElementById('xMiniList');
  if (state.xaccounts.length === 0){
    list.innerHTML = '<li class="empty-row">Aún no sigues ninguna cuenta.</li>';
    return;
  }
  list.innerHTML = state.xaccounts.slice(0, 5).map(a => `
    <li><span class="x-mini-avatar">${a.handle.slice(0,2).toUpperCase()}</span><span>@${a.handle}</span></li>
  `).join('');
}

function renderXGrid(){
  const grid = document.getElementById('xGrid');
  if (state.xaccounts.length === 0){
    grid.innerHTML = '<div class="empty-row">Añade tu primera cuenta para empezar a ver sus publicaciones.</div>';
    return;
  }
  grid.innerHTML = state.xaccounts.map(a => `
    <div class="x-card" data-handle="${a.handle}">
      <div class="x-card-head">
        <span class="x-mini-avatar">${a.handle.slice(0,2).toUpperCase()}</span>
        <div>
          <div class="x-handle">@${a.handle}</div>
          <a href="https://x.com/${a.handle}" target="_blank" rel="noopener">Ver perfil en X ↗</a>
        </div>
        <button class="x-card-remove" title="Dejar de seguir">&times;</button>
      </div>
      <div class="x-embed-wrap">
        <a class="twitter-timeline" data-theme="dark" data-chrome="noheader nofooter noborders transparent" href="https://twitter.com/${a.handle}?ref_src=twsrc%5Etfw">Publicaciones de @${a.handle}</a>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.x-card-remove').forEach(btn => {
    btn.addEventListener('click', () => removeXAccount(btn.closest('.x-card').dataset.handle));
  });
  ensureTwitterWidgets(() => { if (window.twttr) window.twttr.widgets.load(grid); });
}

function renderAll(){
  renderCards();
  renderTable();
  renderChart();
  renderSummary();
  renderActivity();
  renderTape();
  renderXMini();
  renderXGrid();
}

/* ---------------- Modals ---------------- */

function openModal(id){ document.getElementById(id).classList.add('is-open'); }
function closeModal(id){ document.getElementById(id).classList.remove('is-open'); }

document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('is-open'); });
});

document.getElementById('openAddStockDash').addEventListener('click', () => openModal('addStockModal'));
document.getElementById('openAddStockStocks').addEventListener('click', () => openModal('addStockModal'));
document.getElementById('openAddX').addEventListener('click', () => openModal('addXModal'));

document.getElementById('confirmAddStock').addEventListener('click', async () => {
  const input = document.getElementById('newStockSymbol');
  await addStock(input.value);
  input.value = '';
  closeModal('addStockModal');
});
document.getElementById('newStockSymbol').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmAddStock').click();
});

document.getElementById('confirmAddX').addEventListener('click', () => {
  const input = document.getElementById('newXHandle');
  addXAccount(input.value);
  input.value = '';
  closeModal('addXModal');
});
document.getElementById('newXHandle').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('confirmAddX').click();
});

/* ---------------- Navigation ---------------- */

document.querySelectorAll('.nav-item, #tipSettingsBtn, [data-view]').forEach(el => {
  el.addEventListener('click', () => {
    const target = el.dataset.view;
    if (!target) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.view === target));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + target));
    if (target === 'social') renderXGrid();
  });
});

/* ---------------- Range toggle ---------------- */

document.getElementById('rangeToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  currentRange = btn.dataset.range;
  renderChart();
});

/* ---------------- Search ---------------- */

const searchInput = document.getElementById('symbolSearch');
const searchResults = document.getElementById('searchResults');
let searchDebounce = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 1){ searchResults.classList.remove('is-open'); return; }
  if (!state.apiKey){
    searchResults.innerHTML = '<div class="search-result-item"><span class="desc">Añade tu clave de Finnhub en Ajustes para buscar símbolos.</span></div>';
    searchResults.classList.add('is-open');
    return;
  }
  searchDebounce = setTimeout(async () => {
    const results = await finnhubSearch(q);
    if (results.length === 0){
      searchResults.innerHTML = '<div class="search-result-item"><span class="desc">Sin resultados.</span></div>';
    } else {
      searchResults.innerHTML = results.map(r => `
        <div class="search-result-item" data-symbol="${r.symbol}">
          <span class="sym">${r.symbol}</span>
          <span class="desc">${r.description}</span>
        </div>`).join('');
      searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', async () => {
          await addStock(item.dataset.symbol);
          searchInput.value = '';
          searchResults.classList.remove('is-open');
        });
      });
    }
    searchResults.classList.add('is-open');
  }, 350);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) searchResults.classList.remove('is-open');
});

/* ---------------- Settings ---------------- */

function flashApiStatus(msg, isErr){
  const el = document.getElementById('apiStatus');
  el.textContent = msg;
  el.className = 'api-status ' + (isErr ? 'err' : 'ok');
}

document.getElementById('apiKeyInput').value = state.apiKey;
document.getElementById('saveApiKey').addEventListener('click', async () => {
  const val = document.getElementById('apiKeyInput').value.trim();
  state.apiKey = val;
  save(LS_KEYS.apiKey, val);
  if (!val){ flashApiStatus('Clave eliminada. Los precios no se actualizarán.', true); return; }
  flashApiStatus('Comprobando clave…', false);
  try{
    const test = await finnhubQuote('AAPL');
    if (test){
      flashApiStatus('Clave guardada y funcionando correctamente.', false);
      refreshAllPrices();
      startPolling();
    }
  }catch(e){
    flashApiStatus('La clave no parece válida. Revísala en finnhub.io.', true);
  }
});

const pollSelect = document.getElementById('pollInterval');
pollSelect.value = String(state.pollMs);
pollSelect.addEventListener('change', () => {
  state.pollMs = parseInt(pollSelect.value, 10);
  save(LS_KEYS.pollMs, String(state.pollMs));
  startPolling();
});

document.getElementById('resetData').addEventListener('click', () => {
  if (!confirm('¿Seguro que quieres borrar todos los datos guardados? Esta acción no se puede deshacer.')) return;
  Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
  location.reload();
});

/* ---------------- Clock ---------------- */

function tickClock(){
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('es-ES');
}
setInterval(tickClock, 1000);
tickClock();

/* ---------------- Init ---------------- */

if (!state.selected && state.watchlist[0]) state.selected = state.watchlist[0].symbol;
renderAll();
startPolling();
if (state.apiKey) refreshAllPrices();
