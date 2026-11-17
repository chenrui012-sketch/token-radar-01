// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// breakdown and the protocol's farm plan, a sector table, and a model sandbox that re-ranks the
// board live. No network: every byte it shows is in data.js. The farm plans the page shows are
// the ones board.json carries, so the page and the board can never disagree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var DEFAULTS = { sector: 1, growth: DATA.model.growth_weight, floor: DATA.model.maturity_floor };
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sb: { sector: 1, growth: DATA.model.growth_weight, floor: DATA.model.maturity_floor } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function sandboxOn() {
    return state.sb.sector !== DEFAULTS.sector || state.sb.growth !== DEFAULTS.growth || state.sb.floor !== DEFAULTS.floor;
  }
  // The model in one function: the page recomputes a row from the snapshot figures. With the sandbox
  // at its defaults this is the number board.json carries; moved sliders re-rank the board live.
  function impliedOf(row, sb) {
    var m = DATA.model;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = 1 + (growth / 100) * sb.growth;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = sb.floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * (1 - sb.floor);
    var breadth = row.breadth_multiplier;
    return Math.max(1, Math.round(row.tvl_usd * row.sector_multiple * sb.sector * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var sbOn = sandboxOn();
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = sbOn ? impliedOf(a, state.sb) : a.implied_value_usd; bv = sbOn ? impliedOf(b, state.sb) : b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, so the board covers every pre-token protocol the snapshot holds. Implied value is a model, not a promise.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function spotlight() {
    var top = sortedRows(DATA.rows).slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five by implied value' },
      top.map(function (r, i) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + (i + 1) }),
          el('span', { class: 'name', text: r.name }),
          el('span', { class: 'val', text: fmtUsd(sandboxOn() ? impliedOf(r, state.sb) : r.implied_value_usd) }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtPct(r.change_7d) + ' 7d' })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var sbOn = sandboxOn();
    // The bar is a log scale, not a linear one: implied values span three orders of
    // magnitude, so a linear bar makes every row below the top few invisible. On a log
    // scale the top row is still full width and a row a hundred times smaller still reads.
    var maxLog = Math.log10(list.reduce(function (m, r) { var v = sbOn ? impliedOf(r, state.sb) : r.implied_value_usd; return v > m ? v : m; }, 1));
    var minLog = Math.log10(list.reduce(function (m, r) { var v = sbOn ? impliedOf(r, state.sb) : r.implied_value_usd; return v < m ? v : m; }, Infinity));
    var span = maxLog - minLog;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var value = sbOn ? impliedOf(r, state.sb) : r.implied_value_usd;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + (span > 0 ? Math.max(3, Math.round(((Math.log10(value) - minLog) / span) * 100)) : 100) + '%' })),
          el('span', { class: 'num', text: fmtUsd(value) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sbOn ? 'Sandbox is on: values below are re-ranked by your sliders, not the submitted board.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-per-TVL sets the sector multiples.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    function slider(id, label, min, max, step, get, set, fmt) {
      var out = el('output', { for: id, text: fmt(get()) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(get()) });
      input.addEventListener('input', function () { set(parseFloat(input.value)); out.textContent = fmt(get()); render(); });
      return el('div', null, el('label', { for: id, text: label + ': ' }, out), input);
    }
    var reset = el('button', { class: 'button ghost', type: 'button', text: 'Reset to radar-2', onclick: function () { state.sb = { sector: DEFAULTS.sector, growth: DEFAULTS.growth, floor: DEFAULTS.floor }; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x sector_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.04 x min(chains - 1, 4)) )'
      ),
      el('p', { class: 'sub', text: 'The sector multiple is the category median market-cap-per-TVL of the protocols that already trade, shrunk toward the global median and clamped to [' + m.sector_low + ', ' + m.sector_high + ']. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. A bridge, wrapped, staked or exchange-branded product is not ranked at all, however large its TVL: it cannot launch a token, so it cannot be a launch candidate. The live-token protocols are set aside with their market caps shown.' }),
      el('p', { class: 'sub', text: 'Sensitivity, checked on this snapshot by moving each weight in turn: moving the growth weight from 0.3 to 1.5, the maturity floor from 0.5 to 0.8, or the breadth bonus from 0 to 0.08 moves no more than 2 of the top 20, and the leader never changes; growth only starts to matter at a weight of 3, five times the setting. The sector prior is the one lever that matters: with no shrinkage (prior 1) the top 20 reshuffles (rank correlation 0.86, one row moves 15 places), because 20 of 34 categories have at most two live comparables — the top three rows\u2019 Risk Curators multiple is shrunk from a single one, Api3 at 2.97x. So the prior stays at 3, in the middle of the stable band (2 to 5): the gentlest shrinkage that still steadies categories with only one or two live comparables, so no single protocol sets the top of the board.' }),
      el('div', { class: 'sandbox' },
        slider('sb-sector', 'Sector scale', 0.5, 2, 0.05, function () { return state.sb.sector; }, function (v) { state.sb.sector = v; }, function (v) { return v.toFixed(2) + 'x'; }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, function () { return state.sb.growth; }, function (v) { state.sb.growth = v; }, function (v) { return v.toFixed(2); }),
        slider('sb-floor', 'Maturity floor', 0.4, 0.9, 0.05, function () { return state.sb.floor; }, function (v) { state.sb.floor = v; }, function (v) { return v.toFixed(2); }),
        el('p', { class: 'note', text: 'Move a slider to re-rank the board by your own weights. The submitted board is radar-2 at the defaults above.' }),
        reset
      )
    );
  }

  function sectorPanel() {
    var rows = DATA.sector_table.slice(0, 12);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.category })),
        el('td', { class: 'num', text: String(r.protocols) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' })
      ));
    });
    return el('section', { class: 'panel sectors' },
      el('h2', { text: 'Sector multiples, read off the market' }),
      el('p', { class: 'sub', text: 'Each category\u2019s multiple is the median market-cap-per-TVL of its protocols that already trade. The twelve highest are shown; the full table ships in the data.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'sector-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'num', text: 'Live protocols' }), el('th', { scope: 'col', class: 'num', text: 'Multiple' }))),
          tbody
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var sbOn = sandboxOn();
    var recomputed = impliedOf(row, { sector: DEFAULTS.sector, growth: DEFAULTS.growth, floor: DEFAULTS.floor });
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: '7d growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Age, no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Sector multiple' }), el('b', { class: 'num', text: row.sector_multiple.toFixed(2) + 'x' })),
      el('div', null, el('span', { text: 'Growth ×' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
      el('div', null, el('span', { text: 'Maturity ×' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
      el('div', null, el('span', { text: 'Breadth ×' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
      el('div', { class: 'chains' }, el('span', { text: 'Chains' }), el('b', { class: 'num', text: (row.chains || []).join(', ') || 'n/a' })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
    );
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      eq,
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + (sbOn ? ' Sandbox is on: this row re-ranks at ' + fmtUsd(impliedOf(row, state.sb)) + ' under your sliders.' : '') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sectorPanel());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Source: DefiLlama protocol index, fetched ' + DATA.as_of + '. Implied values are this radar\u2019s own model, not prices and not promises. A protocol records no token here when the snapshot records none for it.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
