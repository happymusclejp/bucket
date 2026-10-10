(() => {
  'use strict';

  const DATA = window.CLF_DATA;
  const DOMAINS = DATA.domains;
  const QUESTIONS = DATA.questions;
  const CARDS = DATA.cards;
  const TERMS = DATA.terms;

  const STORE_KEY = 'clf-c02-quest-v1';
  const DAILY_GOAL = 20;
  const QUEST_SIZE = 10;
  // 模試の出題数はドメインの配点(24/30/34/12%)どおり。本番は65問/90分、ミニはそれを20問に縮めたもの
  const MOCKS = {
    mini: { label: 'ミニ模試', counts: { 1: 5, 2: 6, 3: 7, 4: 2 }, minutes: 28, bonus: 30 },
    full: { label: '本番模試', counts: { 1: 16, 2: 19, 3: 22, 4: 8 }, minutes: 90, bonus: 80 },
  };
  const SPEED_SECONDS = 60;
  const KEYS = 'ABCD';

  const TITLES = [
    [1, 'Free Tier'], [3, 'On-Demand'], [5, 'Spot Hunter'], [8, 'Reserved'],
    [12, 'Savings Plan'], [16, 'Well-Architected'], [20, 'Cloud Practitioner'],
  ];

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pct = (x) => Math.round(x * 100);

  // ───────── 保存データ ─────────
  const blank = () => ({
    xp: 0,
    answered: 0,
    q: {},        // 問題ID → { n: 回答数, c: 正解数, last: 直近の正誤(1/0), w: 不正解数 }
    cards: {},    // サービス名 → 1 (覚えた)
    terms: {},    // 用語 → 1 (覚えた)
    streak: { last: null, days: 0 },
    today: { date: null, n: 0 },
    badges: {},
    best: { speed: 0, mock: 0, full: 0, combo: 0 },
  });

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = Object.assign(blank(), JSON.parse(raw));
        s.best = Object.assign(blank().best, s.best);
        s.terms = s.terms || {};
        return s;
      }
    } catch (e) { /* 保存領域が使えない環境ではメモリ上だけで動かす */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 同上 */ }
  }

  let S = load();

  // ───────── 日付・連続日数 ─────────
  const ymd = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

  function touchDay() {
    const t = ymd();
    if (S.today.date !== t) S.today = { date: t, n: 0 };
    if (S.streak.last !== t) {
      S.streak.days = S.streak.last && dayDiff(S.streak.last, t) === 1 ? S.streak.days + 1 : 1;
      S.streak.last = t;
    }
  }
  const streakNow = () => (S.streak.last && dayDiff(S.streak.last, ymd()) <= 1 ? S.streak.days : 0);
  const todayCount = () => (S.today.date === ymd() ? S.today.n : 0);

  // ───────── レベル・XP ─────────
  function levelOf(xp) {
    let lv = 1, need = 80, rest = xp;
    while (rest >= need) { rest -= need; lv++; need = 80 + 40 * (lv - 1); }
    return { lv, cur: rest, need };
  }
  const titleOf = (lv) => TITLES.filter(([l]) => l <= lv).pop()[1];
  const nextTitle = (lv) => TITLES.find(([l]) => l > lv);

  function addXP(n) {
    if (n <= 0) return;
    const before = levelOf(S.xp).lv;
    S.xp += n;
    const after = levelOf(S.xp).lv;
    if (after > before) {
      toast(`レベルアップ！ Lv.${after}「${titleOf(after)}」`, 'gold');
      confetti();
    }
    renderTop();
  }

  // ───────── 成績 ─────────
  function record(q, ok) {
    touchDay();
    const r = S.q[q.id] || (S.q[q.id] = { n: 0, c: 0, last: 0, w: 0 });
    r.n++;
    if (ok) { r.c++; r.last = 1; } else { r.last = 0; r.w++; }
    S.answered++;
    S.today.n++;
  }

  function domainStats(d) {
    const qs = QUESTIONS.filter((q) => q.d === d);
    let seen = 0, mastered = 0, n = 0, c = 0;
    for (const q of qs) {
      const r = S.q[q.id];
      if (!r) continue;
      seen++; n += r.n; c += r.c;
      if (r.last) mastered++;
    }
    return { total: qs.length, seen, mastered, acc: n ? c / n : null };
  }
  // 各ドメインの「直近で正解している問題の割合」を配点で重み付け
  const readinessParts = () => DOMAINS.map((d) => {
    const st = domainStats(d.id);
    return { d, share: (d.weight / 100) * (st.mastered / st.total) };
  });
  const readiness = () => readinessParts().reduce((s, p) => s + p.share, 0);
  const weakList = () => QUESTIONS
    .filter((q) => S.q[q.id] && !S.q[q.id].last)
    .sort((a, b) => S.q[b.id].w - S.q[a.id].w);
  // 単語帳のデッキ。覚えたかどうかはデッキごとに別の保存先に記録する
  const DECKS = {
    cards: { title: 'サービス単語帳', list: CARDS, store: () => S.cards, nameLabel: 'サービス', descLabel: 'どんなサービス？' },
    terms: { title: '用語カード', list: TERMS, store: () => S.terms, nameLabel: '用語', descLabel: 'どういう意味？' },
  };
  const knownIn = (key) => { const st = DECKS[key].store(); return DECKS[key].list.filter((c) => st[c.n]).length; };
  const knownCards = () => knownIn('cards');

  // ───────── バッジ ─────────
  const BADGES = [
    { id: 'first', mark: '1st', name: 'はじめの一歩', desc: 'はじめて問題に回答', test: () => S.answered >= 1 },
    { id: 'q100', mark: '100', name: '100問ノック', desc: '累計100問に回答', test: () => S.answered >= 100 },
    { id: 'q500', mark: '500', name: '500問ノック', desc: '累計500問に回答', test: () => S.answered >= 500 },
    { id: 'combo10', mark: 'x10', name: '10コンボ', desc: '10問連続で正解', test: () => S.best.combo >= 10 },
    { id: 'streak3', mark: '3d', name: '三日坊主卒業', desc: '3日連続で学習', test: () => streakNow() >= 3 },
    { id: 'streak7', mark: '7d', name: '1週間皆勤', desc: '7日連続で学習', test: () => streakNow() >= 7 },
    ...DOMAINS.map((d) => ({
      id: 'dom' + d.id, mark: d.code, name: `${d.code} 制覇`, desc: `${d.name}の全問に正解`,
      test: () => { const st = domainStats(d.id); return st.mastered === st.total; },
    })),
    { id: 'mock700', mark: '700', name: '合格ライン突破', desc: 'ミニ模試で700点以上', test: () => S.best.mock >= 700 },
    { id: 'mock900', mark: '900', name: '余裕の合格圏', desc: 'ミニ模試で900点以上', test: () => S.best.mock >= 900 },
    { id: 'full700', mark: '65', name: '本番リハーサル', desc: '本番模試で700点以上', test: () => S.best.full >= 700 },
    { id: 'full850', mark: '850', name: '本番も怖くない', desc: '本番模試で850点以上', test: () => S.best.full >= 850 },
    { id: 'speed15', mark: '15', name: '早押し名人', desc: '早押しで15問以上正解', test: () => S.best.speed >= 15 },
    { id: 'cards30', mark: '30', name: 'カードコレクター', desc: 'サービス単語帳で30枚を覚えた', test: () => knownCards() >= 30 },
    { id: 'cardsAll', mark: 'ALL', name: 'サービス図鑑', desc: 'サービス単語帳をすべて覚えた', test: () => knownCards() === CARDS.length },
    { id: 'terms30', mark: 'T30', name: '用語マスター', desc: '用語カードで30枚を覚えた', test: () => knownIn('terms') >= 30 },
  ];

  function checkBadges() {
    let changed = false;
    for (const b of BADGES) {
      if (!S.badges[b.id] && b.test()) {
        S.badges[b.id] = ymd();
        toast(`バッジ獲得：${b.name}`, 'gold');
        changed = true;
      }
    }
    if (changed) save();
  }

  // ───────── 画面切り替え ─────────
  const SCREENS = ['home', 'quiz', 'result', 'speed', 'cards'];
  function show(id) {
    stopTimers();
    for (const s of SCREENS) $('#' + s).hidden = s !== id;
    if (id === 'home') renderHome();
    renderTop();
    window.scrollTo(0, 0);
  }

  function renderTop() {
    const L = levelOf(S.xp);
    $('#top-stats').innerHTML =
      `<span class="pill">今日 <b class="mono">${Math.min(todayCount(), 999)}/${DAILY_GOAL}</b></span>` +
      `<span class="pill lv">Lv.${L.lv}</span>`;
  }

  // ───────── ホーム ─────────
  const ICONS = {
    mock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
    speed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    terms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 8h6"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>',
  };

  function renderHome() {
    const L = levelOf(S.xp);
    const nt = nextTitle(L.lv);
    const td = todayCount();
    const goal = Math.min(td / DAILY_GOAL, 1);
    const C = 2 * Math.PI * 32;
    const weak = weakList().length;
    const ready = readiness();
    const parts = readinessParts();

    $('#home').innerHTML = `
      <section class="idcard" aria-label="プレイヤー">
        <div class="id-head"><span class="eyebrow">Practitioner ID</span><span class="mono">累計 ${S.answered} 問</span></div>
        <div class="id-main">
          <div class="id-lv"><span class="id-lv-label">LV</span><span class="id-lv-num">${L.lv}</span></div>
          <div class="id-who">
            <p class="id-title">${esc(titleOf(L.lv))}</p>
            <p class="id-arn mono">arn:clf-c02:quest::player/lv-${L.lv}</p>
          </div>
        </div>
        <div class="xpbar" role="progressbar" aria-label="次のレベルまで" aria-valuemin="0" aria-valuemax="${L.need}" aria-valuenow="${L.cur}"><i style="width:${pct(L.cur / L.need)}%"></i></div>
        <div class="id-foot mono"><span>${L.cur} / ${L.need} XP</span><span>${nt ? `Lv.${nt[0]} で「${esc(nt[1])}」` : '称号コンプリート'}</span></div>
      </section>

      <section class="panel today" aria-label="今日の学習">
        <div class="ring">
          <svg width="78" height="78" viewBox="0 0 78 78" aria-hidden="true">
            <circle class="ring-bg" cx="39" cy="39" r="32" fill="none" stroke-width="7"/>
            <circle class="ring-fg" cx="39" cy="39" r="32" fill="none" stroke-width="7" stroke-linecap="round" ${td ? '' : 'stroke-opacity="0"'} stroke-dasharray="${(goal * C).toFixed(1)} ${C.toFixed(1)}"/>
          </svg>
          <div class="ring-text"><b>${Math.min(td, 99)}</b><span>/ ${DAILY_GOAL}問</span></div>
        </div>
        <div class="today-info">
          <div class="today-line">
            <span>連続 <b class="mono">${streakNow()}</b> 日</span>
            <span>${td >= DAILY_GOAL ? '今日の目標クリア' : `目標まであと <b class="mono">${DAILY_GOAL - td}</b> 問`}</span>
          </div>
          <button type="button" class="btn primary block" data-action="quest" data-d="0">ミックス10問で始める</button>
        </div>
      </section>

      <section class="modes" aria-label="モード">
        <button type="button" class="mode" data-action="mock">
          ${ICONS.mock}<span class="mode-name">ミニ模試</span>
          <span class="mode-desc">20問・28分。本番の配点どおりに出題</span>
          <span class="mode-stat mono">ベスト ${S.best.mock || '—'}</span>
        </button>
        <button type="button" class="mode" data-action="full">
          ${ICONS.full}<span class="mode-name">本番模試</span>
          <span class="mode-desc">65問・90分。本番と同じボリュームで通し練習</span>
          <span class="mode-stat mono">ベスト ${S.best.full || '—'}</span>
        </button>
        <button type="button" class="mode" data-action="speed">
          ${ICONS.speed}<span class="mode-name">サービス早押し</span>
          <span class="mode-desc">60秒で何問当てられる？</span>
          <span class="mode-stat mono">ベスト ${S.best.speed} 問</span>
        </button>
        <button type="button" class="mode" data-action="cards" data-deck="cards">
          ${ICONS.cards}<span class="mode-name">サービス単語帳</span>
          <span class="mode-desc">めくって覚える${CARDS.length}サービス</span>
          <span class="mode-stat mono">覚えた ${knownCards()} / ${CARDS.length}</span>
        </button>
        <button type="button" class="mode" data-action="cards" data-deck="terms">
          ${ICONS.terms}<span class="mode-name">用語カード</span>
          <span class="mode-desc">RTOやSCPなど試験に出る用語${TERMS.length}個</span>
          <span class="mode-stat mono">覚えた ${knownIn('terms')} / ${TERMS.length}</span>
        </button>
        <button type="button" class="mode" data-action="review" ${weak ? '' : 'disabled'}>
          ${ICONS.review}<span class="mode-name">苦手復習</span>
          <span class="mode-desc">${weak ? '最後にまちがえた問題だけを解き直す' : '間違えた問題があるとここに出ます'}</span>
          <span class="mode-stat mono">${weak} 問</span>
        </button>
      </section>

      <section class="panel" aria-label="合格準備度">
        <div class="panel-head"><h2>合格準備度</h2><span class="ready-num">${pct(ready)}<small>%</small></span></div>
        <div class="stack" aria-hidden="true">
          ${parts.map((p) => `<i style="width:${(p.share * 100).toFixed(2)}%; --dc: var(--d${p.d.id})"></i>`).join('')}
          <span class="mark"><span>目安 70%</span></span>
        </div>
        <p class="note">各ドメインで直近に正解している問題の割合を、試験の配点で重み付けしたアプリ内の目安です。</p>
        <div class="drows">
          ${DOMAINS.map((d) => {
            const st = domainStats(d.id);
            return `
            <div class="drow" style="--dc: var(--d${d.id})">
              <span class="dcode">${d.code}<small>${d.weight}%</small></span>
              <div class="dinfo">
                <p class="dname">${esc(d.name)}</p>
                <p class="dsub mono">正解済み ${st.mastered}/${st.total}・正答率 ${st.acc === null ? '—' : pct(st.acc) + '%'}</p>
                <div class="dbar"><i style="width:${pct(st.mastered / st.total)}%"></i></div>
              </div>
              <button type="button" class="btn sm" data-action="quest" data-d="${d.id}">10問</button>
            </div>`;
          }).join('')}
        </div>
      </section>

      <section class="panel" aria-label="バッジ">
        <div class="panel-head"><h2>バッジ</h2><span class="mono">${Object.keys(S.badges).length} / ${BADGES.length}</span></div>
        <ul class="badges">
          ${BADGES.map((b) => `
            <li class="badge ${S.badges[b.id] ? 'on' : ''}">
              <span class="hex">${esc(b.mark)}</span>
              <span class="badge-name">${esc(b.name)}</span>
              <span class="badge-desc">${esc(b.desc)}</span>
            </li>`).join('')}
        </ul>
      </section>

      <details class="panel exam">
        <summary>CLF-C02 試験メモ</summary>
        <dl>
          <dt>問題数</dt><dd>65問(採点対象50問＋採点対象外15問)</dd>
          <dt>試験時間</dt><dd>90分</dd>
          <dt>合格ライン</dt><dd>700点(100〜1,000点のスケールスコア)</dd>
          <dt>出題形式</dt><dd>択一選択・複数選択</dd>
          <dt>配点</dt><dd>${DOMAINS.map((d) => `${d.code} ${esc(d.name)} ${d.weight}%`).join('<br>')}</dd>
        </dl>
        <p class="note">このアプリの収録数：問題 ${QUESTIONS.length}問(${DOMAINS.map((d) => `${d.code} ${QUESTIONS.filter((q) => q.d === d.id).length}`).join('・')})、サービスカード ${CARDS.length}枚、用語カード ${TERMS.length}枚。</p>
        <p class="note">受験料・試験ガイドの最新版は AWS 認定の公式ページで確認してください。</p>
      </details>

      <div class="home-foot">
        <span>記録はこのブラウザの中だけに保存されます。</span>
        <span id="reset-area"><button type="button" class="link" data-action="reset">学習記録をリセット</button></span>
      </div>`;
  }

  // ───────── 出題 (クエスト・模試・復習) ─────────
  let run = null;

  function pickQuest(pool, n) {
    // 未回答 → 不正解のまま → 正解済み の順に出やすくする
    return pool
      .map((q) => {
        const r = S.q[q.id];
        const base = !r ? 0 : r.last ? 2 : 0.5;
        return { q, k: base + Math.random() * 1.2 };
      })
      .sort((a, b) => a.k - b.k)
      .slice(0, n)
      .map((x) => x.q);
  }

  function begin(spec) {
    let qs, label;
    if (spec.mode === 'quest') {
      const pool = spec.d ? QUESTIONS.filter((q) => q.d === spec.d) : QUESTIONS;
      qs = pickQuest(pool, QUEST_SIZE);
      label = spec.d ? `${DOMAINS[spec.d - 1].code} ${DOMAINS[spec.d - 1].name}` : 'ミックス10問';
    } else if (spec.mode === 'mock') {
      const m = MOCKS[spec.size];
      qs = shuffle(Object.entries(m.counts).flatMap(([d, n]) => shuffle(QUESTIONS.filter((q) => q.d === +d)).slice(0, n)));
      label = m.label;
    } else {
      qs = weakList().slice(0, QUEST_SIZE);
      label = '苦手復習';
      if (!qs.length) { toast('復習する問題はありません'); show('home'); return; }
    }
    show('quiz');
    run = {
      spec, label,
      items: qs.map((q) => ({ q, order: shuffle(q.o.map((_, i) => i)), picked: new Set(), done: false, ok: false })),
      i: 0, combo: 0, maxCombo: 0, xp: 0, timeout: false,
    };
    const timer = $('#q-timer');
    timer.hidden = spec.mode !== 'mock';
    if (spec.mode === 'mock') {
      run.deadline = Date.now() + MOCKS[spec.size].minutes * 60000;
      run.timer = setInterval(tickMock, 1000);
      tickMock();
    }
    disarmQuit();
    renderQ();
  }

  function tickMock() {
    const left = Math.max(0, run.deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const el = $('#q-timer');
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('low', left < 3 * 60000);
    if (left <= 0) { run.timeout = true; finish(); }
  }

  const correctKeys = (it) => it.order.map((oi, k) => (it.q.a.includes(oi) ? k : -1)).filter((k) => k >= 0);

  function renderQ() {
    const it = run.items[run.i];
    const q = it.q;
    const dom = DOMAINS[q.d - 1];
    const need = q.a.length;
    $('#q-mode').textContent = run.label;
    $('#q-count').textContent = `${run.i + 1} / ${run.items.length}`;
    $('#q-progress').style.width = `${(run.i / run.items.length) * 100}%`;
    const combo = $('#q-combo');
    combo.hidden = run.spec.mode === 'mock' || run.combo < 2;
    combo.textContent = `${run.combo} コンボ`;
    $('#q-meta').innerHTML =
      `<span class="dtag" style="--dc: var(--d${q.d})">${dom.code} ${esc(dom.name)}</span>` +
      (need > 1 ? `<span class="multi">${need}つ選択</span>` : '');
    $('#q-text').textContent = q.q;
    $('#q-opts').innerHTML = it.order.map((oi, k) =>
      `<button type="button" class="opt" data-action="pick" data-k="${k}" aria-pressed="false">` +
      `<span class="key">${KEYS[k]}</span><span class="otext">${esc(q.o[oi])}</span></button>`).join('');
    $('#q-feedback').hidden = true;
    updateSubmit();
  }

  function updateSubmit() {
    const it = run.items[run.i];
    const last = run.i === run.items.length - 1;
    const btn = $('#q-submit');
    if (it.done) {
      btn.textContent = last ? '結果を見る' : '次の問題へ';
      btn.disabled = false;
    } else {
      btn.textContent = run.spec.mode === 'mock' ? (last ? '回答して採点' : '回答して次へ') : '回答する';
      btn.disabled = it.picked.size !== it.q.a.length;
    }
  }

  function pick(k) {
    const it = run.items[run.i];
    if (it.done || k >= it.order.length) return;
    const need = it.q.a.length;
    if (need === 1) {
      it.picked = new Set([k]);
    } else if (it.picked.has(k)) {
      it.picked.delete(k);
    } else {
      if (it.picked.size >= need) it.picked.delete(it.picked.values().next().value);
      it.picked.add(k);
    }
    document.querySelectorAll('#q-opts .opt').forEach((b, i) => b.setAttribute('aria-pressed', String(it.picked.has(i))));
    updateSubmit();
  }

  function submit() {
    const it = run.items[run.i];
    if (it.done) { next(); return; }
    if (it.picked.size !== it.q.a.length) return;

    const ck = correctKeys(it);
    const ok = ck.every((k) => it.picked.has(k));
    it.ok = ok;
    it.done = true;
    record(it.q, ok);
    if (ok) {
      run.combo++;
      run.maxCombo = Math.max(run.maxCombo, run.combo);
      S.best.combo = Math.max(S.best.combo, run.combo);
    } else {
      run.combo = 0;
    }

    if (run.spec.mode === 'mock') { save(); next(); return; }

    const gain = ok ? 10 + Math.min(run.combo - 1, 5) * 2 : 2;
    run.xp += gain;
    addXP(gain);

    document.querySelectorAll('#q-opts .opt').forEach((b, k) => {
      b.disabled = true;
      if (ck.includes(k)) b.classList.add('is-correct');
      else if (it.picked.has(k)) b.classList.add('is-wrong');
    });
    const fb = $('#q-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'ng');
    fb.innerHTML =
      `<p class="fb-head">${ok ? `正解 <span class="mono">+${gain} XP</span>` : `不正解　正解は ${ck.map((k) => KEYS[k]).join('・')}`}</p>` +
      `<p class="fb-exp">${esc(it.q.e)}</p>`;
    fb.hidden = false;
    const combo = $('#q-combo');
    combo.hidden = run.combo < 2;
    combo.textContent = `${run.combo} コンボ`;

    save();
    checkBadges();
    updateSubmit();
    $('#q-submit').focus({ preventScroll: true });
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function next() {
    if (run.i < run.items.length - 1) {
      run.i++;
      renderQ();
      window.scrollTo(0, 0);
    } else {
      finish();
    }
  }

  function finish() {
    stopTimers();
    const items = run.items;
    const correct = items.filter((it) => it.ok).length;
    if (run.spec.mode === 'mock') {
      const score = Math.round((correct / items.length) * 1000);
      run.score = score;
      const bestKey = run.spec.size === 'full' ? 'full' : 'mock';
      S.best[bestKey] = Math.max(S.best[bestKey], score);
      const gain = correct * 8 + (run.timeout ? 0 : MOCKS[run.spec.size].bonus);
      run.xp += gain;
      addXP(gain);
      if (score >= 700) confetti();
    } else if (correct === items.length && items.length >= QUEST_SIZE) {
      run.xp += 30;
      addXP(30);
      confetti();
    }
    save();
    checkBadges();
    renderResult();
  }

  function renderResult() {
    const items = run.items;
    const total = items.length;
    const correct = items.filter((it) => it.ok).length;
    let html = `<p class="eyebrow">${esc(run.label)}${run.timeout ? '・時間切れ' : ''}</p>`;

    if (run.spec.mode === 'mock') {
      const pass = run.score >= 700;
      html += `
        <div class="score"><span class="score-num">${run.score}</span><span class="score-of">/ 1000 (目安)</span></div>
        <p class="verdict ${pass ? 'pass' : 'fail'}">${pass ? '合格ライン 700 をクリア' : `合格ライン 700 まであと ${700 - run.score}`}</p>
        <div class="breakdown">
          ${DOMAINS.map((d) => {
            const its = items.filter((it) => it.q.d === d.id);
            const c = its.filter((it) => it.ok).length;
            return `<div class="bd-row" style="--dc: var(--d${d.id})">
              <span class="dcode">${d.code}</span><span>${esc(d.name)}</span><span class="mono">${c}/${its.length}</span>
              <span></span><div class="dbar"><i style="width:${its.length ? pct(c / its.length) : 0}%"></i></div>
            </div>`;
          }).join('')}
        </div>
        <p class="note">スコアは正答率を1000点満点に換算した目安です。本番のスケールスコアとは計算方法が異なります。</p>`;
    } else {
      html += `<div class="score"><span class="score-num">${correct}</span><span class="score-of">/ ${total} 問正解</span></div>`;
    }
    html += `<p class="result-sub mono">+${run.xp} XP・最大 ${run.maxCombo} コンボ</p>`;

    const wrong = items.filter((it) => !it.ok);
    if (wrong.length) {
      html += `<div class="review"><h3>見直し(${wrong.length}問)</h3>` + wrong.map((it) => `
        <details>
          <summary>${esc(it.q.q)}</summary>
          ${it.done ? '' : '<p class="note">未回答</p>'}
          <p class="rv-ans">正解：${it.q.a.map((a) => esc(it.q.o[a])).join(' / ')}</p>
          <p>${esc(it.q.e)}</p>
        </details>`).join('') + '</div>';
    } else {
      html += '<p class="verdict pass">全問正解！ ボーナス +30 XP</p>';
    }
    html += `<div class="actions">
      <button type="button" class="btn primary" data-action="again">もう一回</button>
      <button type="button" class="btn" data-action="home">ホームへ</button>
    </div>`;
    $('#result-body').innerHTML = html;
    for (const s of SCREENS) $('#' + s).hidden = s !== 'result';
    renderTop();
    window.scrollTo(0, 0);
  }

  // 「やめる」は2回押しで確定(ダイアログが使えない環境向け)
  let quitTimer = null;
  function quitQuiz() {
    const btn = $('#q-quit');
    if (btn.classList.contains('armed')) { disarmQuit(); show('home'); return; }
    btn.classList.add('armed');
    btn.textContent = 'もう一度押すと終了';
    quitTimer = setTimeout(disarmQuit, 3000);
  }
  function disarmQuit() {
    clearTimeout(quitTimer);
    const btn = $('#q-quit');
    btn.classList.remove('armed');
    btn.textContent = 'やめる';
  }

  // ───────── サービス早押し ─────────
  let sp = null;

  function speedIntro() {
    show('speed');
    $('#sp-intro').hidden = false;
    $('#sp-stage').hidden = true;
    $('#sp-end').hidden = true;
    $('#sp-best').textContent = S.best.speed;
  }

  function speedStart() {
    touchDay();
    sp = { score: 0, combo: 0, xp: 0, end: Date.now() + SPEED_SECONDS * 1000, lock: false, cur: null, miss: [] };
    $('#sp-intro').hidden = true;
    $('#sp-end').hidden = true;
    $('#sp-stage').hidden = false;
    sp.timer = setInterval(speedTick, 100);
    speedNext();
    speedTick();
  }

  function speedNext() {
    let card;
    do { card = CARDS[Math.floor(Math.random() * CARDS.length)]; } while (sp.cur && card === sp.cur.card);
    // 同じカテゴリから2つ混ぜて、カテゴリだけでは当てられないようにする
    const same = shuffle(CARDS.filter((c) => c !== card && c.c === card.c));
    const other = shuffle(CARDS.filter((c) => c.c !== card.c));
    const opts = shuffle([card, ...[...same.slice(0, 2), ...other].slice(0, 3)]);
    sp.cur = { card, opts };
    $('#sp-desc').textContent = card.d;
    $('#sp-cat').textContent = card.c;
    $('#sp-penalty').innerHTML = '';
    $('#sp-opts').innerHTML = opts.map((c, k) =>
      `<button type="button" class="opt" data-action="sp-pick" data-k="${k}"><span class="key">${KEYS[k]}</span><span class="otext">${esc(c.n)}</span></button>`).join('');
    $('#sp-score').textContent = `${sp.score} 問`;
    $('#sp-combo').textContent = sp.combo >= 2 ? `${sp.combo} コンボ` : '';
  }

  function speedPick(k) {
    if (!sp || sp.lock || !sp.cur || k >= sp.cur.opts.length) return;
    const ok = sp.cur.opts[k] === sp.cur.card;
    sp.lock = true;
    const btns = document.querySelectorAll('#sp-opts .opt');
    btns.forEach((b, i) => {
      b.disabled = true;
      if (sp.cur.opts[i] === sp.cur.card) b.classList.add('is-correct');
      else if (i === k) b.classList.add('is-wrong');
    });
    S.today.n++;
    if (ok) {
      sp.score++;
      sp.combo++;
      sp.xp += 5 + Math.min(sp.combo - 1, 5);
    } else {
      sp.combo = 0;
      sp.end -= 3000;
      sp.miss.push(sp.cur.card);
      $('#sp-penalty').innerHTML = '<span class="penalty">-3秒</span>';
    }
    $('#sp-score').textContent = `${sp.score} 問`;
    setTimeout(() => {
      if (!sp) return;
      sp.lock = false;
      if (Date.now() < sp.end) speedNext();
    }, ok ? 280 : 900);
  }

  function speedTick() {
    const left = Math.max(0, sp.end - Date.now());
    const el = $('#sp-time');
    el.textContent = Math.ceil(left / 1000);
    el.classList.toggle('low', left < 10000);
    $('#sp-bar').style.width = `${(left / (SPEED_SECONDS * 1000)) * 100}%`;
    if (left <= 0) speedEnd();
  }

  function speedEnd() {
    clearInterval(sp.timer);
    const record = sp.score > S.best.speed;
    if (record) S.best.speed = sp.score;
    addXP(sp.xp);
    save();
    checkBadges();
    if (record && sp.score >= 5) confetti();
    const uniqMiss = [...new Set(sp.miss)];
    $('#sp-stage').hidden = true;
    const end = $('#sp-end');
    end.hidden = false;
    end.innerHTML = `
      <p class="eyebrow">Time up</p>
      <div class="score"><span class="score-num">${sp.score}</span><span class="score-of">問正解</span></div>
      <p class="${record ? 'verdict pass' : 'result-sub mono'}">${record ? '自己ベスト更新！' : `自己ベスト ${S.best.speed} 問`}</p>
      <p class="result-sub mono">+${sp.xp} XP</p>
      ${uniqMiss.length ? `<div class="review"><h3>まちがえたサービス</h3><div class="miss-list">${uniqMiss.map((c) => `<p><b>${esc(c.n)}</b>${esc(c.d)}</p>`).join('')}</div></div>` : ''}
      <div class="actions">
        <button type="button" class="btn primary" data-action="sp-start">もう一回</button>
        <button type="button" class="btn" data-action="home">ホームへ</button>
      </div>`;
    sp = null;
  }

  // ───────── 単語帳 ─────────
  let fc = { key: 'cards', deck: [], i: 0, reverse: false };

  function cardsStart(key = fc.key) {
    show('cards');
    const D = DECKS[key], st = D.store();
    const unknown = shuffle(D.list.filter((c) => !st[c.n]));
    const known = shuffle(D.list.filter((c) => st[c.n]));
    fc = { key, deck: [...unknown, ...known], i: 0, reverse: fc.reverse };
    $('#fc-title').textContent = D.title;
    renderCard();
  }

  function renderCard() {
    const c = fc.deck[fc.i];
    const D = DECKS[fc.key];
    const known = !!D.store()[c.n];
    const name = `<p class="face-main">${esc(c.n)}</p>`;
    const desc = `<p class="face-main desc">${esc(c.d)}</p>`;
    $('#fc-flash').classList.remove('flipped');
    $('#fc-front').innerHTML =
      `<p class="eyebrow">${esc(c.c)}</p>${fc.reverse ? desc : name}` +
      `<p class="face-hint">${known ? '<span class="known-mark">覚えた</span>・' : ''}タップでめくる</p>`;
    $('#fc-back').innerHTML = `<p class="eyebrow">${fc.reverse ? D.nameLabel : D.descLabel}</p>${fc.reverse ? name : desc}`;
    $('#fc-count').textContent = `${fc.i + 1} / ${fc.deck.length}・覚えた ${knownIn(fc.key)}`;
    $('#fc-bar').style.width = `${(knownIn(fc.key) / D.list.length) * 100}%`;
    $('#fc-reverse').textContent = fc.reverse ? '名前→説明' : '説明→名前';
  }

  function cardMark(known) {
    const c = fc.deck[fc.i];
    const st = DECKS[fc.key].store();
    touchDay();
    if (known) {
      if (!st[c.n]) { st[c.n] = 1; addXP(3); }
    } else {
      delete st[c.n];
    }
    fc.i = (fc.i + 1) % fc.deck.length;
    if (fc.i === 0) toast('1周しました。覚えていないカードから並べ直します');
    save();
    checkBadges();
    if (fc.i === 0) cardsStart(); else renderCard();
  }

  // ───────── 演出 ─────────
  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  function confetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#fx');
    const ctx = cv.getContext('2d');
    const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const colors = ['--xp', '--d1', '--d2', '--d3', '--d4'].map((v) => cs.getPropertyValue(v).trim());
    const ps = Array.from({ length: 90 }, () => ({
      x: w / 2, y: h * 0.35,
      vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 10 - 3,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 5, h: 3 + Math.random() * 4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    cv.hidden = false;
    const frame = (t) => {
      const el = t - t0;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, 1 - el / 1700);
      for (const p of ps) {
        p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (el < 1700) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, w, h); cv.hidden = true; }
    };
    requestAnimationFrame(frame);
  }

  function stopTimers() {
    if (run && run.timer) { clearInterval(run.timer); run.timer = null; }
    if (sp && sp.timer) { clearInterval(sp.timer); sp = null; }
  }

  // ───────── 入力 ─────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'home': show('home'); break;
      case 'quest': begin({ mode: 'quest', d: Number(el.dataset.d) || 0 }); break;
      case 'mock': begin({ mode: 'mock', size: 'mini' }); break;
      case 'full': begin({ mode: 'mock', size: 'full' }); break;
      case 'review': begin({ mode: 'review' }); break;
      case 'again': begin(run.spec); break;
      case 'pick': pick(Number(el.dataset.k)); break;
      case 'submit': submit(); break;
      case 'quit': quitQuiz(); break;
      case 'speed': speedIntro(); break;
      case 'sp-start': speedStart(); break;
      case 'sp-pick': speedPick(Number(el.dataset.k)); break;
      case 'cards': cardsStart(el.dataset.deck); break;
      case 'flip': $('#fc-flash').classList.toggle('flipped'); break;
      case 'fc-known': cardMark(true); break;
      case 'fc-unknown': cardMark(false); break;
      case 'fc-reverse': fc.reverse = !fc.reverse; renderCard(); break;
      case 'reset':
        $('#reset-area').innerHTML = '<span class="confirm">すべての記録を消しますか？' +
          '<button type="button" class="btn sm" data-action="reset-yes">消す</button>' +
          '<button type="button" class="btn sm" data-action="reset-no">やめる</button></span>';
        break;
      case 'reset-yes': S = blank(); save(); toast('学習記録をリセットしました'); show('home'); break;
      case 'reset-no': renderHome(); break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target.tagName === 'BUTTON';
    const key = e.key.toLowerCase();
    let idx = '1234'.indexOf(key);
    if (idx < 0) idx = 'abcd'.indexOf(key);

    if (!$('#quiz').hidden && run) {
      if (idx >= 0) { pick(idx); e.preventDefault(); }
      else if (e.key === 'Enter' && !onButton) { submit(); e.preventDefault(); }
    } else if (!$('#speed').hidden && sp && !$('#sp-stage').hidden) {
      if (idx >= 0) { speedPick(idx); e.preventDefault(); }
    } else if (!$('#cards').hidden) {
      if (e.key === ' ' && !onButton) { $('#fc-flash').classList.toggle('flipped'); e.preventDefault(); }
      else if (e.key === 'ArrowRight') cardMark(true);
      else if (e.key === 'ArrowLeft') cardMark(false);
    }
  });

  // 起動
  if (S.today.date !== ymd()) S.today = { date: ymd(), n: 0 };
  show('home');
})();
