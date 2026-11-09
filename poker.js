/* Kanai Poker — local, play-money No-Limit Texas Hold'em.
   - Allocation-free 5/6/7-card evaluator (rank counts + suit bitmasks)
   - Correct side pots for multi-way all-ins
   - Bots with distinct styles that decide from Monte-Carlo equity and pot odds
   - All-in equity display, best-hand highlight, chip/number animations
   - Local progression: XP, levels, achievements, daily bonus streak
   - Incremental DOM updates (seats are built once and patched) */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SB = 25, BB = 50, START = 1000, TURN_SECONDS = 30, AUTO_DEAL_SECONDS = 5;
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const BOT_ROSTER = [
    { name: 'Mia Chen', flag: 'CA', style: 'Sharp', tight: 0.62, aggr: 0.70, bluff: 0.08, avatar: 'linear-gradient(145deg,#ff9f6b,#e5533d)' },
    { name: 'Eli Brooks', flag: 'GB', style: 'Calling station', tight: 0.30, aggr: 0.22, bluff: 0.03, avatar: 'linear-gradient(145deg,#5bd1ff,#3a74e5)' },
    { name: 'Sofia Reyes', flag: 'ES', style: 'Aggressive', tight: 0.48, aggr: 0.88, bluff: 0.15, avatar: 'linear-gradient(145deg,#b06bff,#7a3de5)' },
    { name: 'Noah Kim', flag: 'KR', style: 'Rock', tight: 0.78, aggr: 0.40, bluff: 0.02, avatar: 'linear-gradient(145deg,#ffd45b,#e59a3d)' },
    { name: 'Theo Martin', flag: 'JP', style: 'Wild card', tight: 0.28, aggr: 0.74, bluff: 0.24, avatar: 'linear-gradient(145deg,#5bffb0,#2ea97a)' }
  ];
  const RANDOM_NAMES = ['AceHunter', 'RiverRat', 'NutFlush', 'BluffKing', 'PocketRockets', 'CheckRaise', 'TiltFree', 'ChipLeader', 'SilentShark', 'LuckyRiver', 'AllInAnna', 'FoldEmFred'];

  const FLAG_SVGS = {
    CA: '<rect width="30" height="20" fill="#fff"/><path fill="#d52b1e" d="M0 0h8v20H0zm22 0h8v20h-8z"/><path fill="#d52b1e" d="m15 3 1.4 4 2.6-1-1.3 3 2.3 2-3.2.2.2 4.8-2-1.4-2 1.4.2-4.8-3.2-.2 2.3-2-1.3-3 2.6 1z"/>',
    GB: '<rect width="30" height="20" fill="#21468b"/><path stroke="#fff" stroke-width="5" d="m0 0 30 20M30 0 0 20"/><path stroke="#c8102e" stroke-width="2" d="m0 0 30 20M30 0 0 20"/><path stroke="#fff" stroke-width="7" d="M15 0v20M0 10h30"/><path stroke="#c8102e" stroke-width="3" d="M15 0v20M0 10h30"/>',
    ES: '<rect width="30" height="20" fill="#aa151b"/><path fill="#f1bf00" d="M0 5h30v10H0z"/>',
    KR: '<rect width="30" height="20" fill="#fff"/><path fill="#cd2e3a" d="M15 4a6 6 0 0 1 0 12 3 3 0 0 0 0-6 3 3 0 0 1 0-6"/><path fill="#0047a0" d="M15 16a6 6 0 0 1 0-12 3 3 0 0 0 0 6 3 3 0 0 1 0 6"/>',
    JP: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5.4" fill="#bc002d"/>',
    IL: '<rect width="30" height="20" fill="#fff"/><path stroke="#0038b8" stroke-width="2" d="M1 4h28M1 16h28"/><path fill="none" stroke="#0038b8" stroke-width="1" d="m15 6-3 5h6zm0 8-3-5h6z"/>',
    US: '<rect width="30" height="20" fill="#fff"/><path stroke="#b22234" stroke-width="2" d="M0 1h30M0 5h30M0 9h30M0 13h30M0 17h30"/><path fill="#3c3b6e" d="M0 0h14v10H0z"/>',
    FR: '<path fill="#0055a4" d="M0 0h10v20H0z"/><path fill="#fff" d="M10 0h10v20H10z"/><path fill="#ef4135" d="M20 0h10v20H20z"/>',
    DE: '<path fill="#111" d="M0 0h30v6.7H0z"/><path fill="#d00" d="M0 6.7h30v6.6H0z"/><path fill="#ffce00" d="M0 13.3h30V20H0z"/>',
    IT: '<path fill="#009246" d="M0 0h10v20H0z"/><path fill="#fff" d="M10 0h10v20H10z"/><path fill="#ce2b37" d="M20 0h10v20H20z"/>'
  };
  function flagMarkup(code) {
    const cc = /^[A-Z]{2}$/.test(code || '') ? code : 'UN';
    const art = FLAG_SVGS[cc];
    return art
      ? `<span class="seat-flag" role="img" aria-label="${cc} flag"><svg viewBox="0 0 30 20" aria-hidden="true">${art}</svg></span>`
      : `<span class="seat-flag seat-flag-code" aria-label="Country ${cc}">${cc}</span>`;
  }
  const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ======================================================================
     Hand evaluator — no allocations in the hot path.
     Score = category * 15^5 + up to five tiebreak digits (base 15).
     ====================================================================== */
  const P5 = 759375, P4 = 50625, P3 = 3375, P2 = 225, P1 = 15;
  const CNT = new Uint8Array(15), SCNT = new Uint8Array(4), SMASK = new Uint16Array(4);
  function straightHigh(mask) {
    if (mask & 16384) mask |= 2; // ace plays low
    for (let h = 14; h >= 5; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
    return 0;
  }
  function evaluate(cards, len) {
    CNT.fill(0); SCNT.fill(0); SMASK.fill(0);
    let rankMask = 0;
    for (let i = 0; i < len; i++) { const c = cards[i]; CNT[c.v]++; SCNT[c.si]++; SMASK[c.si] |= 1 << c.v; rankMask |= 1 << c.v; }
    for (let s = 0; s < 4; s++) {
      if (SCNT[s] < 5) continue;
      const m = SMASK[s], sf = straightHigh(m);
      if (sf) return 8 * P5 + sf * P4;
      let k = 0, n = 0;
      for (let v = 14; v >= 2 && n < 5; v--) if (m & (1 << v)) { k = k * 15 + v; n++; }
      return 5 * P5 + k; // a flush cannot coexist with quads/boat in 7 cards
    }
    let quad = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0;
    for (let v = 14; v >= 2; v--) {
      const c = CNT[v];
      if (c === 4) quad = v;
      else if (c === 3) { if (!t1) t1 = v; else if (!t2) t2 = v; }
      else if (c === 2) { if (!p1) p1 = v; else if (!p2) p2 = v; }
    }
    if (quad) { let k = 0; for (let v = 14; v >= 2; v--) if (v !== quad && CNT[v]) { k = v; break; } return 7 * P5 + quad * P4 + k * P3; }
    if (t1 && (t2 || p1)) return 6 * P5 + t1 * P4 + Math.max(t2, p1) * P3;
    const st = straightHigh(rankMask);
    if (st) return 4 * P5 + st * P4;
    let k = 0, n = 0;
    if (t1) { for (let v = 14; v >= 2 && n < 2; v--) if (v !== t1 && CNT[v]) { k = k * 15 + v; n++; } return 3 * P5 + t1 * P4 + k * P2; }
    if (p1 && p2) { for (let v = 14; v >= 2; v--) if (v !== p1 && v !== p2 && CNT[v]) { k = v; break; } return 2 * P5 + p1 * P4 + p2 * P3 + k * P2; }
    if (p1) { for (let v = 14; v >= 2 && n < 3; v--) if (v !== p1 && CNT[v]) { k = k * 15 + v; n++; } return P5 + p1 * P4 + k * P1; }
    for (let v = 14; v >= 2 && n < 5; v--) if (CNT[v]) { k = k * 15 + v; n++; }
    while (n++ < 5) k *= 15;
    return k;
  }
  const scoreOf = cards => evaluate(cards, cards.length);
  const categoryOf = score => Math.floor(score / P5);
  const CATEGORY = n => ['high card', 'a pair', 'two pair', 'three of a kind', 'a straight', 'a flush', 'a full house', 'four of a kind', 'a straight flush'][Math.max(0, Math.min(8, n))];
  const RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const plural = v => (v === 6 ? 'Sixes' : RANK_NAME[v] + 's');
  function describe(score) {
    const cat = categoryOf(score), d0 = Math.floor(score / P4) % 15, d1 = Math.floor(score / P3) % 15;
    switch (cat) {
      case 8: return d0 === 14 ? 'Royal flush' : `Straight flush, ${RANK_NAME[d0]} high`;
      case 7: return `Four ${plural(d0)}`;
      case 6: return `Full house, ${plural(d0)} over ${plural(d1)}`;
      case 5: return `Flush, ${RANK_NAME[d0]} high`;
      case 4: return `Straight, ${RANK_NAME[d0]} high`;
      case 3: return `Three ${plural(d0)}`;
      case 2: return `Two pair, ${plural(d0)} & ${plural(d1)}`;
      case 1: return `Pair of ${plural(d0)}`;
      default: return `${RANK_NAME[d0]} high`;
    }
  }
  function describePreflop(hole) {
    const [a, b] = hole[0].v >= hole[1].v ? hole : [hole[1], hole[0]];
    if (a.v === b.v) return `Pocket ${plural(a.v)}`;
    return `${rankLabel(a.v)}-${rankLabel(b.v)} ${a.si === b.si ? 'suited' : 'offsuit'}`;
  }
  // Best five cards (only used at showdown for highlighting — 21 combos, rare).
  const FIVE = new Array(5);
  function bestFive(cards) {
    const target = scoreOf(cards);
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      FIVE[0] = cards[a]; FIVE[1] = cards[b]; FIVE[2] = cards[c]; FIVE[3] = cards[d]; FIVE[4] = cards[e];
      if (evaluate(FIVE, 5) === target) return FIVE.slice();
    }
    return cards.slice(0, 5);
  }

  /* ---------- deck ---------- */
  const FULL_DECK = [];
  for (let si = 0; si < 4; si++) for (let v = 2; v <= 14; v++) FULL_DECK.push({ s: SUITS[si], si, v, id: si * 15 + v });
  function shuffledDeck() {
    const d = FULL_DECK.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
    return d;
  }
  const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  function rankLabel(v) { return v <= 10 ? String(v) : RANKS[v]; }
  const cardCode = c => rankLabel(c.v) + c.s;
  const isRed = c => c.si === 1 || c.si === 2;

  /* ======================================================================
     Equity (exact enumeration for ≤2 unknown board cards, Monte-Carlo otherwise)
     ====================================================================== */
  const HAND7 = new Array(7);
  function unknownCards(exclude) {
    const used = new Uint8Array(60);
    for (const c of exclude) used[c.id] = 1;
    return FULL_DECK.filter(c => !used[c.id]);
  }
  function showdownEquity(holes, boardCards, iterations = 2500) {
    const n = holes.length, wins = new Float64Array(n), scores = new Float64Array(n);
    const known = boardCards.slice();
    holes.forEach(h => known.push(h[0], h[1]));
    const rest = unknownCards(known);
    const need = 5 - boardCards.length;
    const runBoard = new Array(5);
    for (let i = 0; i < boardCards.length; i++) runBoard[i] = boardCards[i];
    let trials = 0;
    const score = () => {
      let best = -1, count = 0;
      for (let p = 0; p < n; p++) {
        HAND7[0] = holes[p][0]; HAND7[1] = holes[p][1];
        for (let i = 0; i < 5; i++) HAND7[i + 2] = runBoard[i];
        const s = evaluate(HAND7, 7); scores[p] = s;
        if (s > best) { best = s; count = 1; } else if (s === best) count++;
      }
      for (let p = 0; p < n; p++) if (scores[p] === best) wins[p] += 1 / count;
      trials++;
    };
    const L = boardCards.length;
    if (need === 0) score();
    else if (need === 1) { for (const c of rest) { runBoard[4] = c; score(); } }
    else if (need === 2) { for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) { runBoard[L] = rest[i]; runBoard[L + 1] = rest[j]; score(); } }
    else {
      const pool = rest.slice();
      for (let t = 0; t < iterations; t++) {
        for (let k = 0; k < need; k++) { const j = k + Math.floor(Math.random() * (pool.length - k)); const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp; runBoard[L + k] = pool[k]; }
        score();
      }
    }
    return Array.from(wins, w => w / trials);
  }
  // A bot's view: its own cards vs `opponents` random unknown hands.
  function estimateEquity(hole, boardCards, opponents, iterations = 260) {
    if (opponents <= 0) return 1;
    const pool = unknownCards([...hole, ...boardCards]);
    const L = boardCards.length, need = 5 - L;
    for (let i = 0; i < L; i++) HAND7[i + 2] = boardCards[i];
    const oppHand = new Array(7);
    let total = 0;
    for (let t = 0; t < iterations; t++) {
      const draw = need + opponents * 2;
      for (let k = 0; k < draw; k++) { const j = k + Math.floor(Math.random() * (pool.length - k)); const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp; }
      HAND7[0] = hole[0]; HAND7[1] = hole[1];
      for (let k = 0; k < need; k++) HAND7[L + 2 + k] = pool[k];
      const mine = evaluate(HAND7, 7);
      for (let i = 2; i < 7; i++) oppHand[i] = HAND7[i];
      let beaten = false, ties = 0;
      for (let o = 0; o < opponents && !beaten; o++) {
        oppHand[0] = pool[need + o * 2]; oppHand[1] = pool[need + o * 2 + 1];
        const s = evaluate(oppHand, 7);
        if (s > mine) beaten = true; else if (s === mine) ties++;
      }
      if (!beaten) total += 1 / (ties + 1);
    }
    return total / iterations;
  }

  /* ======================================================================
     State
     ====================================================================== */
  let players = [];           // index 0 is always the hero
  let deck = [], board = [];
  let pot = 0, currentBet = 0, minRaise = BB, lastRaiser = -1, heroAggressed = false;
  let buttonIdx = 0, toActIdx = -1, actorIdx = -1; // toActIdx: where the search resumes; actorIdx: who we are waiting on
  let street = 'preflop', phase = 'idle', handNo = 0, finished = false, runout = false;
  let username = 'You', heroFlag = 'UN';
  let message = 'Welcome to the table';
  let handStartedAt = 0, handStartStack = START, actionIndex = 0, revealedHands = [];
  let soundOn = true, audioCtx = null;
  let turnTimer = null, turnDeadline = 0, autoTimer = null, pending = null;
  let profile = null, winIdsNow = null;
  const sessionStats = { handsPlayed: 0, handsWon: 0, handsLost: 0, folds: 0, calls: 0, checks: 0, raises: 0, netChips: 0 };

  // Seat positions per table size. Index 0 is always the hero.
  const LAYOUTS = {
    2: ['seat-hu-hero', 'seat-hu-opp'],
    6: ['seat-bottom', 'seat-lower-left', 'seat-upper-left', 'seat-top', 'seat-upper-right', 'seat-lower-right']
  };
  const MAX_SEATS = 6;
  const EMOTES = ['👍', '😂', '😮', '😎', '🔥', '😭', '🤑', '🙏'];
  let mode = 'solo', selectedMode = 'solo', selectedOpp = 0;   // 'solo' = 6-max vs 5 bots, 'headsup' = 1v1
  let preAction = null, handLog = [], lastLogged = '', titleBlink = null, lastEmoteAt = 0;
  const blindSeats = () => players.length === 2
    ? { sb: buttonIdx, bb: (buttonIdx + 1) % 2 }                        // heads-up: the button posts the small blind
    : { sb: (buttonIdx + 1) % players.length, bb: (buttonIdx + 2) % players.length };

  const money = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
  const hero = () => players[0];
  const live = () => players.filter(p => !p.folded);
  const canActCount = () => players.reduce((n, p) => n + (!p.folded && !p.allIn ? 1 : 0), 0);
  const speed = () => (hero() && hero().folded ? 0.35 : 1);
  // One pending engine step at a time; a new hand cancels whatever was queued.
  function later(ms, fn) { clearTimeout(pending); pending = setTimeout(fn, Math.round(ms * speed())); }

  /* ---------- storage helpers ---------- */
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  };
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ======================================================================
     Sound (tiny synth, no assets)
     ====================================================================== */
  function beep(freq, dur = 0.08, type = 'sine', gain = 0.04, delay = 0) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime + delay;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + dur);
    } catch (_) { /* audio unsupported */ }
  }
  const sfx = {
    deal: () => beep(560, 0.04, 'triangle', 0.03),
    chip: () => { beep(1800, 0.03, 'square', 0.012); beep(1300, 0.04, 'square', 0.012, 0.03); },
    check: () => beep(420, 0.05, 'sine', 0.03),
    fold: () => beep(170, 0.12, 'sine', 0.03),
    raise: () => { beep(440, 0.06, 'square', 0.03); beep(660, 0.07, 'square', 0.03, 0.06); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, 'triangle', 0.045, i * 0.09)),
    lose: () => beep(196, 0.25, 'sine', 0.03),
    tick: () => beep(760, 0.03, 'sine', 0.02),
    achieve: () => [784, 988, 1319].forEach((f, i) => beep(f, 0.18, 'sine', 0.04, i * 0.08))
  };

  /* ---------- telemetry (event names & shape kept compatible) ---------- */
  const sendEvent = (event, details = {}) => window.kanaiWebhook && window.kanaiWebhook(event, {
    gameState: {
      handNumber: handNo, street, pot: pot || 0, currentBet: currentBet || 0, phase, actionIndex,
      player: { name: username, stack: hero() ? hero().stack : START, committed: hero() ? hero().bet : 0, privateCards: hero() && hero().hole ? hero().hole.map(cardCode) : [] },
      communityCards: board.map(cardCode),
      opponents: players.slice(1).map(p => ({ name: p.name, countryCode: p.flag, stack: p.stack, status: p.folded ? 'folded' : 'in_hand' }))
    },
    sessionStats: { ...sessionStats }, ...details
  });

  /* ======================================================================
     Animation helpers
     ====================================================================== */
  const numberAnims = new WeakMap();
  function setNumber(el, value, ms = 520) {
    if (!el) return;
    const from = Number(el.dataset ? el.dataset.val : NaN);
    if (el.dataset) el.dataset.val = String(value);
    if (REDUCED || !Number.isFinite(from) || from === value || typeof requestAnimationFrame !== 'function' || !window.performance) { el.textContent = money(value); return; }
    const prev = numberAnims.get(el); if (prev) cancelAnimationFrame(prev);
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(from + (value - from) * e);
      if (k < 1) numberAnims.set(el, requestAnimationFrame(step)); else numberAnims.delete(el);
    };
    numberAnims.set(el, requestAnimationFrame(step));
  }
  function setText(el, t) { if (el && el._t !== t) { el.textContent = t; el._t = t; } }
  function toggle(el, cls, on) { if (el && el.classList) el.classList.toggle(cls, !!on); }
  function center(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }
  function flyChips(fromEl, toEl, count = 4) {
    if (REDUCED) return;
    const layer = $('fx-layer'), a = center(fromEl), b = center(toEl);
    if (!layer || !a || !b || !document.createElement) return;
    const lr = center(layer.parentElement) ? layer.getBoundingClientRect() : null;
    if (!lr) return;
    for (let i = 0; i < count; i++) {
      const chip = document.createElement('span');
      chip.className = 'fly-chip';
      chip.style.left = (a.x - lr.left) + 'px'; chip.style.top = (a.y - lr.top) + 'px';
      layer.appendChild(chip);
      const jitter = (Math.random() - 0.5) * 18;
      if (chip.animate) {
        const anim = chip.animate([
          { transform: 'translate(-50%,-50%) scale(.9)', opacity: 0.95 },
          { transform: `translate(calc(-50% + ${(b.x - a.x) / 2 + jitter}px), calc(-50% + ${(b.y - a.y) / 2 - 30}px)) scale(1.05)`, opacity: 1, offset: 0.55 },
          { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.8)`, opacity: 0.2 }
        ], { duration: 520 + i * 60, delay: i * 45, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
        anim.onfinish = () => chip.remove();
      } else chip.remove();
    }
  }
  function confetti(amount = 36) {
    if (REDUCED) return;
    const layer = $('fx-layer');
    if (!layer || !document.createElement) return;
    const colors = ['#aa83ff', '#ffcf5c', '#36d39b', '#ff6b86', '#5bd1ff'];
    for (let i = 0; i < amount; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.left = (35 + Math.random() * 30) + '%';
      p.style.background = colors[i % colors.length];
      layer.appendChild(p);
      if (p.animate) {
        const dx = (Math.random() - 0.5) * 520, dy = -180 - Math.random() * 260, rot = (Math.random() - 0.5) * 900;
        p.animate([
          { transform: 'translate(0,0) rotate(0)', opacity: 1 },
          { transform: `translate(${dx * 0.6}px,${dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px,${dy + 520}px) rotate(${rot}deg)`, opacity: 0 }
        ], { duration: 1500 + Math.random() * 700, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => p.remove();
      } else p.remove();
    }
  }
  // Toasts are queued: at most two on screen, the rest follow one by one.
  const toastQueue = []; let toastsShown = 0;
  function toast(title, sub, icon = '★', tone = '') { toastQueue.push({ title, sub, icon, tone }); pumpToasts(); }
  function pumpToasts() {
    const host = $('toasts');
    if (!host || !document.createElement) { toastQueue.length = 0; return; }
    while (toastsShown < 2 && toastQueue.length) {
      const { title, sub, icon, tone } = toastQueue.shift();
      const t = document.createElement('div');
      t.className = 'toast ' + tone;
      t.innerHTML = `<span class="toast-icon">${icon}</span><div><strong>${escapeHTML(title)}</strong>${sub ? `<small>${escapeHTML(sub)}</small>` : ''}</div>`;
      host.appendChild(t);
      toastsShown++;
      setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); toastsShown--; pumpToasts(); }, 380); }, toastQueue.length ? 2000 : 2800);
    }
  }

  /* ======================================================================
     Progression: XP, levels, achievements, daily bonus
     ====================================================================== */
  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🏆', title: 'First pot', desc: 'Win your first hand' },
    { id: 'showdown', icon: '🃏', title: 'Show me', desc: 'Win a pot at showdown' },
    { id: 'pressure', icon: '💥', title: 'Pressure', desc: 'Win with a bet or raise, no showdown' },
    { id: 'straight', icon: '📈', title: 'Connected', desc: 'Win with a straight' },
    { id: 'flush', icon: '♦', title: 'Flush!', desc: 'Win with a flush' },
    { id: 'full_house', icon: '🏠', title: 'Full house', desc: 'Win with a full house' },
    { id: 'quads', icon: '🎯', title: 'Quads', desc: 'Win with four of a kind' },
    { id: 'straight_flush', icon: '👑', title: 'Legendary', desc: 'Win with a straight flush' },
    { id: 'allin_win', icon: '🔥', title: 'All-in survivor', desc: 'Win an all-in showdown' },
    { id: 'streak3', icon: '⚡', title: 'Hot streak', desc: 'Win 3 hands in a row' },
    { id: 'big_pot', icon: '💰', title: 'High roller', desc: 'Win a pot of 1,500+' },
    { id: 'double_up', icon: '🚀', title: 'Double up', desc: 'Reach a 2,000 chip stack' },
    { id: 'duelist', icon: '⚔️', title: 'Duelist', desc: 'Win a heads-up showdown' },
    { id: 'chatty', icon: '💬', title: 'Table talk', desc: 'Send your first emote' }
  ];
  const xpForLevel = l => 50 * l * (l - 1); // L1:0  L2:100  L3:300  L4:600 …
  function levelOf(xp) { let l = 1; while (xp >= xpForLevel(l + 1)) l++; return l; }
  function loadProfile(name) {
    const p = store.get('kanai_progress_' + name.toLowerCase(), {});
    return {
      xp: p.xp || 0, achievements: Array.isArray(p.achievements) ? p.achievements : [],
      lastBonusDay: p.lastBonusDay || null, streak: p.streak || 0,
      handsPlayed: p.handsPlayed || 0, handsWon: p.handsWon || 0, biggestPot: p.biggestPot || 0,
      bestStack: p.bestStack || START, winStreak: 0, bestWinStreak: p.bestWinStreak || 0
    };
  }
  function saveProfile() { if (profile) store.set('kanai_progress_' + username.toLowerCase(), profile); }
  function addXP(amount) {
    const before = levelOf(profile.xp);
    profile.xp += amount;
    const after = levelOf(profile.xp);
    if (after > before) {
      const reward = 150 * after;
      hero().stack += reward;
      sfx.achieve();
      toast(`Level ${after}!`, `+${money(reward)} chips reward`, '⬆', 'level');
      confetti(28);
    }
    renderProgress();
  }
  function unlock(id) {
    if (!profile || profile.achievements.includes(id)) return;
    const a = ACHIEVEMENTS.find(x => x.id === id); if (!a) return;
    profile.achievements.push(id);
    sfx.achieve();
    toast(`Achievement · ${a.title}`, a.desc + ' · +50 XP', a.icon, 'ach');
    addXP(50);
  }
  function claimDailyBonus() {
    const today = dayKey();
    if (profile.lastBonusDay === today) return 0;
    const y = new Date(); y.setDate(y.getDate() - 1);
    profile.streak = profile.lastBonusDay === dayKey(y) ? profile.streak + 1 : 1;
    profile.lastBonusDay = today;
    const bonus = 100 * Math.min(profile.streak, 7);
    hero().stack += bonus;
    saveProfile();
    return bonus;
  }
  function renderProgress() {
    if (!profile) return;
    const lvl = levelOf(profile.xp), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
    const frac = Math.max(0, Math.min(1, (profile.xp - lo) / (hi - lo)));
    setText($('level-num'), 'Lv ' + lvl);
    const fill = $('xp-fill'); if (fill) fill.style.width = (frac * 100).toFixed(1) + '%';
  }
  function renderProfilePanel() {
    const lvl = levelOf(profile.xp), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
    $('profile-title').textContent = username;
    $('profile-avatar').textContent = (username[0] || 'Y').toUpperCase();
    $('profile-level').textContent = `Level ${lvl} · ${profile.streak || 0}-day streak`;
    $('profile-xp-fill').style.width = ((profile.xp - lo) / (hi - lo) * 100).toFixed(1) + '%';
    $('profile-xp-text').textContent = `${money(profile.xp - lo)} / ${money(hi - lo)} XP to level ${lvl + 1}`;
    const rate = profile.handsPlayed ? Math.round(profile.handsWon / profile.handsPlayed * 100) : 0;
    const stats = [['Hands', money(profile.handsPlayed)], ['Won', money(profile.handsWon)], ['Win rate', rate + '%'], ['Biggest pot', money(profile.biggestPot)], ['Best stack', money(profile.bestStack)], ['Best streak', money(profile.bestWinStreak)]];
    $('profile-stats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    $('ach-count').textContent = `${profile.achievements.length} / ${ACHIEVEMENTS.length}`;
    $('achievement-grid').innerHTML = ACHIEVEMENTS.map(a => {
      const got = profile.achievements.includes(a.id);
      return `<div class="ach${got ? ' got' : ''}" title="${escapeHTML(a.desc)}"><span>${got ? a.icon : '🔒'}</span><b>${a.title}</b><small>${a.desc}</small></div>`;
    }).join('');
  }

  /* ======================================================================
     Seat DOM — built once per session, then patched field by field
     ====================================================================== */
  function buildSeats() {
    const n = players.length, layout = LAYOUTS[n] || LAYOUTS[6];
    const felt = $('table-felt');
    if (felt) felt.className = 'table-felt layout-' + n;
    for (let i = n; i < MAX_SEATS; i++) { const el = $('seat-' + (i + 1)); if (el) { el.hidden = true; el.innerHTML = ''; el.className = 'seat'; } }
    players.forEach((p, idx) => {
      const root = $('seat-' + (idx + 1));
      if (!root) return;
      root.hidden = false;
      root.className = 'seat ' + layout[idx] + (n === 2 ? ' seat-hu' : '') + (p.isHero ? ' hero-seat' : '');
      root.innerHTML = `
        <span class="seat-status"></span>
        <div class="seat-card">
          <div class="seat-avatar" style="background:${p.avatar}">${escapeHTML(p.initial)}</div>
          <div class="seat-text">
            <div class="seat-name"><span class="flag-slot">${flagMarkup(p.flag)}</span><span class="seat-nm">${escapeHTML(p.name)}</span>${p.isHero ? '<small class="you">(you)</small>' : ''}<span class="seat-badge"></span></div>
            <div class="seat-stack"><span class="chip-ico"></span><span class="stack-val">${money(p.stack)}</span></div>
          </div>
          <div class="seat-hole" aria-hidden="true"></div>
        </div>
        <span class="seat-equity" hidden></span>
        <span class="seat-handtag" hidden></span>
        <div class="seat-bet" hidden><span class="chip-stack"></span><span class="bet-val"></span></div>`;
      const q = sel => root.querySelector(sel);
      p.ui = { root, status: q('.seat-status'), flag: q('.flag-slot'), badge: q('.seat-badge'), stack: q('.stack-val'), hole: q('.seat-hole'), equity: q('.seat-equity'), handtag: q('.seat-handtag'), bet: q('.seat-bet'), betVal: q('.bet-val') };
      root.title = p.isHero ? '' : `${p.name} — ${p.style}`;
      if (p.ui.stack && p.ui.stack.dataset) p.ui.stack.dataset.val = String(p.stack);
    });
  }
  const STATUS = { call: ['status-call', 'CALLED'], check: ['status-check', 'CHECKED'], raise: ['status-raise', 'RAISED'], bet: ['status-raise', 'BET'] };
  function updateSeat(p, idx) {
    const u = p.ui; if (!u) return;
    const active = phase === 'betting' && actorIdx === idx && !finished && !runout;
    toggle(u.root, 'active', active);
    toggle(u.root, 'seat-folded', p.folded);
    toggle(u.root, 'seat-winner', !!p.winner);
    toggle(u.root, 'thinking', active && !p.isHero);

    const { sb, bb } = blindSeats();
    const badge = idx === buttonIdx ? 'D' : idx === sb ? 'SB' : idx === bb ? 'BB' : '';
    if (u.badge._t !== badge) { u.badge.className = 'seat-badge' + (badge ? ' badge-' + badge[0] : ''); setText(u.badge, badge); }

    let st = null;
    if (p.winner) st = ['status-win', p.winAmount ? '+' + money(p.winAmount) : 'WON'];
    else if (p.folded) st = ['status-fold', 'FOLDED'];
    else if (p.allIn) st = ['status-allin', 'ALL-IN'];
    else if (p.last && STATUS[p.last]) st = STATUS[p.last];
    const stKey = st ? st.join('|') : '';
    if (u.status._k !== stKey) {
      u.status._k = stKey;
      u.status.className = 'seat-status' + (st ? ' show ' + st[0] : '');
      u.status.textContent = st ? st[1] : '';
    }

    setNumber(u.stack, p.stack);

    const showBet = p.bet > 0 && !p.folded;
    u.bet.hidden = !showBet;
    if (showBet) setText(u.betVal, money(p.bet));

    if (!p.isHero) {
      const faceUp = p.reveal && !p.folded;
      const key = (p.hole || []).map(c => c.id).join(',') + (faceUp ? 'u' : 'd') + (p.folded ? 'f' : '') + (p.winCards ? 'w' + p.winCards.join('.') : '');
      if (u.hole._k !== key) {
        u.hole._k = key;
        u.hole.innerHTML = p.folded || !p.hole ? '' : p.hole.map(c => faceUp
          ? `<span class="mini-card${isRed(c) ? ' red' : ''}${p.winCards && p.winCards.includes(c.id) ? ' win-card' : ''}">${rankLabel(c.v)}${c.s}</span>`
          : '<span class="mini-card back"></span>').join('');
        toggle(u.hole, 'revealed', faceUp);
      }
    }
    const eq = p.equity != null && !p.folded ? Math.round(p.equity * 100) + '%' : '';
    u.equity.hidden = !eq; setText(u.equity, eq);
    const tag = p.handName && !p.folded && p.reveal ? p.handName : '';
    u.handtag.hidden = !tag; setText(u.handtag, tag);
  }
  function renderSeats() { players.forEach(updateSeat); }

  /* ---------- board & hero cards ---------- */
  function cardHTML(c, extra = '') {
    return `<div class="playing-card${isRed(c) ? ' red' : ''}${extra}" data-id="${c.id}"><span class="card-rank">${rankLabel(c.v)}<span class="card-suit">${c.s}</span></span><span class="card-center">${c.s}</span></div>`;
  }
  let boardSlots = null;
  function ensureBoard() {
    if (boardSlots) return;
    const host = $('community-cards');
    host.innerHTML = '<div class="board-slot"></div>'.repeat(5);
    boardSlots = Array.from(host.querySelectorAll ? host.querySelectorAll('.board-slot') : []);
    if (boardSlots.length !== 5) boardSlots = [0, 1, 2, 3, 4].map(() => ({ innerHTML: '', _h: '' })); // non-DOM fallback
  }
  // Cards are created once (so the deal animation plays exactly once); later
  // renders only toggle highlight classes.
  function highlight(el, id, winIds, extraOn) {
    if (!el || !el.classList) return;
    el.classList.toggle('win-card', !!winIds && winIds.includes(id));
    el.classList.toggle('dim', !!winIds && !winIds.includes(id));
    if (extraOn !== undefined) el.classList.toggle('folded', extraOn);
  }
  function renderBoard(winIds) {
    ensureBoard();
    for (let i = 0; i < 5; i++) {
      const slot = boardSlots[i], c = board[i], id = c ? c.id : null;
      if (slot._id !== id) {
        slot._id = id;
        if (c) {
          if (slot.style && slot.style.setProperty) slot.style.setProperty('--d', (Math.max(0, i - (board.length === 3 ? 0 : board.length - 1)) * 0.09) + 's');
          slot.innerHTML = cardHTML(c, REDUCED ? '' : ' dealt');
        } else slot.innerHTML = '<div class="card-slot" aria-hidden="true"></div>';
      }
      if (c) highlight(slot.firstElementChild, id, winIds);
    }
  }
  function renderHeroCards(winIds) {
    const h = hero(), host = $('hero-cards');
    if (host._hand !== handNo) {
      host._hand = handNo;
      host.innerHTML = (h.hole || []).map(c => cardHTML(c, REDUCED ? '' : ' dealt')).join('');
    }
    const kids = host.children || [];
    for (let i = 0; i < kids.length; i++) highlight(kids[i], Number(kids[i].dataset && kids[i].dataset.id), winIds, h.folded);
  }
  function renderHeroHand() {
    const h = hero(), el = $('hero-hand');
    if (!h.hole || !h.hole.length || h.folded) { el.hidden = true; return; }
    const text = board.length ? describe(scoreOf([...h.hole, ...board])) : describePreflop(h.hole);
    el.hidden = false;
    setText(el, text);
  }

  /* ---------- whole-table render ---------- */
  function render(opts = {}) {
    const h = hero();
    setText($('hero-name'), username);
    setNumber($('hero-stack'), h.stack);
    setNumber($('topbar-stack'), h.stack);
    setNumber($('pot-value'), pot, 380);
    if (opts.potBump) { const pd = $('pot-display'); pd.classList.remove('bump'); void pd.offsetWidth; pd.classList.add('bump'); }
    setText($('hand-count'), `HAND #${String(handNo).padStart(3, '0')}`);
    if (opts.winIds) winIdsNow = opts.winIds;
    renderHeroCards(winIdsNow);
    renderBoard(winIdsNow);
    renderHeroHand();
    setText($('hand-message'), message);
    if (message !== lastLogged && !/^(Your move|Blinds posted)/.test(message)) { lastLogged = message; pushLog(message); }
    renderSeats();
    updateControls();
  }

  /* ======================================================================
     Controls
     ====================================================================== */
  const heroCanAct = () => phase === 'betting' && actorIdx === 0 && !finished && !runout && !hero().folded && !hero().allIn;
  function updateControls() {
    const act = heroCanAct();
    const h = hero();
    const toCall = Math.max(0, currentBet - h.bet);
    const canRaise = h.stack > toCall && canActCount() > 1;
    $('action-fold').hidden = !act;
    $('action-check').hidden = !act || toCall > 0;
    $('action-call').hidden = !act || toCall <= 0;
    $('action-raise').hidden = !act;
    $('action-next').hidden = !finished;
    const waiting = phase === 'betting' && !finished && !act && h.hole && h.hole.length && !h.folded && !h.allIn && !runout;
    $('pre-actions').hidden = !waiting;
    if (waiting) {
      toggle($('pre-checkfold'), 'on', preAction === 'checkfold'); $('pre-checkfold').setAttribute('aria-pressed', String(preAction === 'checkfold'));
      toggle($('pre-callany'), 'on', preAction === 'callany'); $('pre-callany').setAttribute('aria-pressed', String(preAction === 'callany'));
    }
    if (toCall > 0) {
      const callAmt = Math.min(toCall, h.stack);
      setText($('call-amt'), money(callAmt));
      if ($('action-call').firstChild) $('action-call').firstChild.textContent = callAmt >= h.stack ? 'All-in ' : 'Call ';
    }
    ['action-fold', 'action-check', 'action-call'].forEach(id => { $(id).disabled = !act; });
    $('action-raise').disabled = !act || !canRaise;

    const panel = $('bet-panel'), range = $('bet-range');
    if (act && canRaise) {
      panel.classList.remove('disabled');
      const maxTo = h.stack + h.bet;
      const minTo = Math.min(maxTo, currentBet + minRaise);
      range.min = minTo; range.max = maxTo; range.step = 10;
      const v = Number(range.value);
      if (!(v >= minTo && v <= maxTo) || range._hand !== handNo + street) {
        range._hand = handNo + street;
        range.value = Math.min(maxTo, Math.max(minTo, Math.round((currentBet + (pot + toCall) * 0.6) / 10) * 10));
      }
      range.disabled = false;
      syncBetAmount();
    } else {
      panel.classList.add('disabled');
      range.disabled = true;
      setText($('bet-amount'), '—');
    }
    setText($('bet-label'), toCall > 0 || street === 'preflop' ? 'RAISE TO' : 'BET');
  }
  function syncBetAmount() {
    const range = $('bet-range'), h = hero();
    const v = Number(range.value);
    const allIn = h && v >= h.stack + h.bet;
    setText($('bet-amount'), allIn ? 'ALL-IN ' + money(v) : money(v));
    const toCall = h ? Math.max(0, currentBet - h.bet) : 0;
    setText($('raise-label'), allIn ? 'All-in' : (toCall > 0 || street === 'preflop' ? 'Raise' : 'Bet'));
  }

  /* ---------- turn timer (CSS drives the ring; JS only checks every 250ms) ---------- */
  function startTurnTimer() {
    clearTurnTimer();
    turnDeadline = Date.now() + TURN_SECONDS * 1000;
    const ind = $('turn-indicator'), ring = $('turn-ring'), label = $('turn-timer');
    ind.hidden = false;
    ring.classList.remove('run', 'urgent'); void ring.offsetWidth; ring.classList.add('run');
    let lastSecs = -1;
    const tick = () => {
      const remaining = Math.max(0, turnDeadline - Date.now());
      const secs = Math.ceil(remaining / 1000);
      if (secs !== lastSecs) {
        lastSecs = secs;
        label.textContent = '0:' + String(secs).padStart(2, '0');
        ring.classList.toggle('urgent', secs <= 8);
        if (secs <= 5 && secs > 0) sfx.tick();
      }
      if (remaining <= 0) { clearTurnTimer(); autoAct(); }
    };
    tick();
    turnTimer = setInterval(tick, 250);
  }
  function clearTurnTimer() {
    if (turnTimer) clearInterval(turnTimer);
    turnTimer = null;
    $('turn-indicator').hidden = true;
  }
  function autoAct() {
    const toCall = Math.max(0, currentBet - hero().bet);
    message = toCall > 0 ? 'Time up — hand folded.' : 'Time up — you check.';
    heroAct(toCall > 0 ? 'fold' : 'check');
  }

  /* ---------- auto-deal countdown ---------- */
  function startAutoDeal() {
    stopAutoDeal();
    if (!$('auto-deal').checked) return;
    let left = AUTO_DEAL_SECONDS;
    setText($('next-count'), String(left));
    autoTimer = setInterval(() => {
      left--;
      setText($('next-count'), left > 0 ? String(left) : '');
      if (left <= 0) { stopAutoDeal(); if (finished && $('profile-panel').hidden) startHand(); }
    }, 1000);
  }
  function stopAutoDeal() { if (autoTimer) clearInterval(autoTimer); autoTimer = null; setText($('next-count'), ''); }

  /* ======================================================================
     Hand lifecycle
     ====================================================================== */
  function initPlayers() {
    const bots = mode === 'headsup' ? [BOT_ROSTER[selectedOpp] || BOT_ROSTER[0]] : BOT_ROSTER;
    players = [
      { isHero: true, name: username, initial: (username[0] || 'Y').toUpperCase(), flag: heroFlag, avatar: 'linear-gradient(145deg,#8a5bff,#5b38b0)', stack: START, style: 'You' },
      ...bots.map(b => ({ ...b, isHero: false, initial: b.name[0], stack: mode === 'headsup' ? START : 700 + Math.floor(Math.random() * 900) }))
    ];
    buttonIdx = Math.floor(Math.random() * players.length);
    boardSlots = null;
    buildSeats();
  }
  function postBlind(idx, amount) {
    const p = players[idx];
    const paid = Math.min(amount, p.stack);
    p.stack -= paid; p.bet += paid; p.committed += paid; pot += paid;
    if (p.stack === 0) p.allIn = true;
  }

  function startHand() {
    clearTurnTimer(); stopAutoDeal(); clearTimeout(pending);
    $('winner-banner').hidden = true;
    $('hand-message').hidden = false;
    if (!players.length) initPlayers();
    if (hero().stack < BB) { hero().stack = START; toast('Seat topped up', `Back to ${money(START)} chips`, '🪙'); }
    players.forEach((p, i) => {
      if (i === 0 || p.stack >= BB * 4) return;
      p.stack = mode === 'headsup' ? START : 600 + Math.floor(Math.random() * 1000);
      if (mode === 'headsup') { toast(`${p.name} rebuys`, `Back to ${money(START)} chips — keep the pressure on`, '🔁'); pushLog(`${p.name} rebuys for ${money(START)}.`, 'info'); }
    });
    players.forEach(p => Object.assign(p, { hole: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false, last: '', reveal: false, winner: false, winAmount: 0, equity: null, handName: '', winCards: null }));

    handNo++; sessionStats.handsPlayed++;
    handStartedAt = Date.now(); handStartStack = hero().stack; actionIndex = 0; revealedHands = [];
    winIdsNow = null;
    deck = shuffledDeck(); board = []; pot = 0; currentBet = 0; minRaise = BB; lastRaiser = -1; heroAggressed = false;
    street = 'preflop'; phase = 'betting'; finished = false; runout = false; actorIdx = -1;
    buttonIdx = (buttonIdx + 1) % players.length;

    for (let r = 0; r < 2; r++) for (let k = 1; k <= players.length; k++) players[(buttonIdx + k) % players.length].hole.push(deck.pop());
    const { sb: sbIdx, bb: bbIdx } = blindSeats();
    postBlind(sbIdx, SB); postBlind(bbIdx, BB);
    currentBet = BB; minRaise = BB; lastRaiser = bbIdx;
    toActIdx = (bbIdx + 1) % players.length;

    message = 'Blinds posted. Cards in the air.';
    preAction = null;
    handLog = []; lastLogged = '';
    pushLog(`Hand #${handNo} · ${players.length === 2 ? 'Heads-up' : '6-max'} · blinds ${SB}/${BB}`, 'head');
    pushLog(`You hold ${hero().hole.map(cardCode).join(' ')}.`, 'hero');
    sfx.deal();
    render();
    save();
    sendEvent('hand_started', {
      handNumber: handNo, startingStack: handStartStack, stackAfterBlinds: hero().stack,
      smallBlind: SB, bigBlind: BB, blindLevel: `${SB}/${BB}`, pot, privateCards: hero().hole.map(cardCode),
      street: 'preflop', tableType: 'simulated_play_money', tableMode: mode, playerCount: players.length,
      buttonSeat: buttonIdx, startedAt: new Date(handStartedAt).toISOString()
    });
    later(760, schedule);
  }

  function nextToAct(start) {
    for (let k = 0; k < players.length; k++) {
      const idx = (start + k) % players.length, p = players[idx];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < currentBet)) return idx;
    }
    return -1;
  }

  function schedule() {
    if (finished) return;
    if (live().length === 1) return endByFold();
    const idx = nextToAct(toActIdx);
    // Round over, or nobody left who can still bet against anyone.
    if (idx === -1 || (canActCount() <= 1 && players[idx].bet >= currentBet)) return endRound();
    toActIdx = idx; actorIdx = idx;
    renderSeats(); updateControls();
    if (players[idx].isHero) {
      message = currentBet - hero().bet > 0 ? 'Your move — call, raise or fold.' : 'Your move — check or bet.';
      setText($('hand-message'), message);
      startTurnTimer();
      notifyTurn();
      if (runPreAction()) return;
    } else {
      clearTurnTimer();
      later(520 + Math.random() * 700, () => botAct(idx));
    }
  }

  function applyBet(p, idx, kind, raiseTo) {
    const toCall = Math.max(0, currentBet - p.bet);
    let amount = 0;
    if (kind === 'fold') { p.folded = true; p.last = 'fold'; sfx.fold(); }
    else if (kind === 'check') { p.last = 'check'; sfx.check(); }
    else if (kind === 'call') {
      amount = Math.min(toCall, p.stack);
      p.stack -= amount; p.bet += amount; p.committed += amount; pot += amount;
      if (p.stack === 0) p.allIn = true;
      p.last = 'call'; sfx.chip();
    } else if (kind === 'raise') {
      raiseTo = Math.min(raiseTo, p.stack + p.bet);
      amount = raiseTo - p.bet;
      const increment = raiseTo - currentBet;
      p.stack -= amount; p.committed += amount; pot += amount;
      p.last = currentBet === 0 ? 'bet' : 'raise';
      p.bet = raiseTo;
      if (p.stack === 0) p.allIn = true;
      if (increment >= minRaise) { // a full raise re-opens the action
        minRaise = increment;
        players.forEach((q, i) => { if (i !== idx && !q.folded && !q.allIn) q.acted = false; });
      }
      currentBet = Math.max(currentBet, raiseTo);
      lastRaiser = idx;
      sfx.raise();
    }
    p.acted = true;
    return amount;
  }

  function afterAction(idx) {
    actorIdx = -1;
    toActIdx = (idx + 1) % players.length;
    render({ potBump: false });
    later(360, schedule);
  }

  /* ---------- hero ---------- */
  function heroAct(kind) {
    if (!heroCanAct()) return;
    const h = hero();
    const toCall = Math.max(0, currentBet - h.bet);
    if (kind === 'check' && toCall > 0) kind = 'call';
    if (kind === 'call' && toCall === 0) kind = 'check';
    let raiseTo = null;
    if (kind === 'raise') {
      raiseTo = Math.min(Number($('bet-range').value), h.stack + h.bet);
      if (raiseTo <= currentBet) return;
      heroAggressed = true;
    }
    clearTurnTimer();
    actionIndex++;
    const potBefore = pot, stackBefore = h.stack, str = street;
    const amount = applyBet(h, 0, kind, raiseTo);
    if (kind === 'fold') sessionStats.folds++; else if (kind === 'check') sessionStats.checks++; else if (kind === 'call') sessionStats.calls++; else sessionStats.raises++;
    message = kind === 'fold' ? 'You fold. Watching the hand play out…' : kind === 'check' ? 'You check.' : kind === 'call' ? `You call ${money(amount)}.` : `You ${h.last === 'bet' ? 'bet' : 'raise to'} ${money(h.bet)}.`;
    if (amount && h.ui) flyChips(h.ui.root, $('pot-display'), 2);
    sendEvent('player_action', {
      handNumber: handNo, action: kind, actionIndex, street: str,
      elapsedSinceHandStartMs: Date.now() - handStartedAt,
      amount, raiseTo, potBefore, potAfter: pot, stackBefore, stackAfter: h.stack,
      toCall, privateCards: h.hole.map(cardCode), communityCards: board.map(cardCode)
    });
    afterAction(0);
  }

  /* ---------- bots ---------- */
  function botDecide(p) {
    const toCall = Math.max(0, currentBet - p.bet);
    const opps = live().length - 1;
    const eq = estimateEquity(p.hole, board, opps, board.length ? 240 : 200);
    const fair = 1 / (opps + 1);
    const rel = eq / fair;                       // >1 means better than an average hand here
    const potOdds = toCall / (pot + toCall || 1);
    const r = Math.random();
    const late = board.length >= 3;
    const sizeTo = (frac) => {
      const target = currentBet + Math.max(minRaise, Math.round(((pot + toCall) * frac) / 10) * 10);
      return Math.min(p.stack + p.bet, target);
    };
    // Short stack with a strong hand: just shove.
    const shortStack = p.stack <= BB * 8;

    if (toCall === 0) {
      if (rel > 1.55 - p.aggr * 0.35 && r < 0.35 + p.aggr * 0.55) return { kind: 'raise', to: shortStack && rel > 1.8 ? p.stack + p.bet : sizeTo(0.45 + Math.random() * 0.4), eq };
      if (late && opps <= 2 && r < p.bluff * 1.4) return { kind: 'raise', to: sizeTo(0.5 + Math.random() * 0.25), eq, bluff: true };
      return { kind: 'check', eq };
    }
    const needed = potOdds * (0.85 + p.tight * 0.45);
    if (rel > 2.3 - p.aggr * 0.7 && r < 0.25 + p.aggr * 0.5 && p.stack > toCall) return { kind: 'raise', to: shortStack ? p.stack + p.bet : sizeTo(0.7 + Math.random() * 0.5), eq };
    if (eq >= needed) return { kind: 'call', eq };
    if (late && opps === 1 && r < p.bluff * 0.6 && p.stack > toCall * 3) return { kind: 'raise', to: sizeTo(0.8), eq, bluff: true };
    if (toCall <= BB && r < (1 - p.tight) * 0.55) return { kind: 'call', eq };
    return { kind: 'fold', eq };
  }

  function botAct(idx) {
    if (finished || actorIdx !== idx) return;
    const p = players[idx];
    if (p.folded || p.allIn) { p.acted = true; afterAction(idx); return; }
    const potBefore = pot, stackBefore = p.stack;
    let d = botDecide(p);
    if (d.kind === 'raise' && (d.to <= currentBet || p.stack <= Math.max(0, currentBet - p.bet))) d = { ...d, kind: currentBet > p.bet ? 'call' : 'check' };
    const amount = applyBet(p, idx, d.kind, d.to);
    if (d.kind === 'fold') message = `${p.name} folds.`;
    else if (d.kind === 'check') message = `${p.name} checks.`;
    else if (d.kind === 'call') message = p.allIn ? `${p.name} calls all-in!` : `${p.name} calls ${money(amount)}.`;
    else message = p.allIn ? `${p.name} moves all-in for ${money(p.bet)}!` : `${p.name} ${p.last === 'bet' ? 'bets' : 'raises to'} ${money(p.bet)}.`;
    if (amount && p.ui) flyChips(p.ui.root, $('pot-display'), d.kind === 'raise' ? 3 : 2);
    sendEvent('opponent_action', {
      opponent: p.name, countryCode: p.flag, action: d.kind, street,
      amount, raiseTo: d.kind === 'raise' ? p.bet : null, potBefore, potAfter: pot, stackBefore, stackAfter: p.stack,
      decisionType: 'simulated_bot', playStyle: p.style, handStrength: Math.round((d.eq || 0) * 100) / 100
    });
    afterAction(idx);
  }

  /* ---------- streets ---------- */
  function endRound() {
    actorIdx = -1;
    // Return an uncalled portion of the top bet (keeps pots honest).
    const bets = players.map(p => p.bet).sort((a, b) => b - a);
    if (bets[0] > bets[1]) {
      const top = players.find(p => p.bet === bets[0]);
      const back = bets[0] - bets[1];
      top.bet -= back; top.committed -= back; top.stack += back; pot -= back;
    }
    const hadBets = players.some(p => p.bet > 0);
    if (hadBets) players.forEach(p => { if (p.bet > 0 && p.ui) flyChips(p.ui.bet, $('pot-display'), 2); });
    players.forEach(p => { p.bet = 0; p.acted = false; if (!p.allIn && !p.folded) p.last = ''; });
    currentBet = 0; minRaise = BB;
    if (hadBets) sfx.chip();

    if (!runout && canActCount() <= 1 && live().length > 1) {
      runout = true;
      live().forEach(p => { p.reveal = true; });
      message = 'All-in! Running it out…';
    }
    if (street === 'river') { render({ potBump: hadBets }); return later(runout ? 900 : 650, showdown); }
    later(hadBets ? 420 : 200, dealStreet);
    render({ potBump: hadBets });
  }

  function dealStreet() {
    if (finished) return;
    deck.pop(); // burn
    if (street === 'preflop') { board.push(deck.pop(), deck.pop(), deck.pop()); street = 'flop'; }
    else if (street === 'flop') { board.push(deck.pop()); street = 'turn'; }
    else { board.push(deck.pop()); street = 'river'; }
    sfx.deal();
    if (runout) {
      const lv = live();
      const eq = showdownEquity(lv.map(p => p.hole), board);
      lv.forEach((p, i) => { p.equity = eq[i]; });
      message = `${street[0].toUpperCase() + street.slice(1)}: ${(street === 'flop' ? board.slice(0, 3) : [board[board.length - 1]]).map(cardCode).join(' ')} · ${lv.map(p => `${p.isHero ? 'You' : p.name.split(' ')[0]} ${Math.round(p.equity * 100)}%`).join(' · ')}`;
    } else {
      message = street === 'flop' ? `Flop: ${board.slice(0, 3).map(cardCode).join(' ')}` : `${street === 'turn' ? 'Turn' : 'River'}: ${cardCode(board[board.length - 1])}`;
    }
    toActIdx = (buttonIdx + 1) % players.length;
    render();
    sendEvent('community_cards_dealt', { street, boardCards: board.map(cardCode), activeOpponentCount: live().length - 1 });
    if (runout) later(1350, street === 'river' ? showdown : dealStreet);
    else later(720, schedule);
  }

  /* ---------- pots & payout ---------- */
  function buildPots() {
    const levels = [...new Set(players.map(p => p.committed).filter(c => c > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      for (const p of players) amount += Math.max(0, Math.min(p.committed, lvl) - prev);
      const eligible = players.filter(p => !p.folded && p.committed >= lvl);
      const last = pots[pots.length - 1];
      if (amount > 0) {
        if (!eligible.length && last) last.amount += amount;
        else if (last && last.eligible.length === eligible.length && last.eligible.every((p, i) => p === eligible[i])) last.amount += amount;
        else if (eligible.length) pots.push({ amount, eligible });
      }
      prev = lvl;
    }
    return pots;
  }
  function seatOrderFromButton(list) {
    const n = players.length, pos = p => (players.indexOf(p) - buttonIdx - 1 + 2 * n) % n;
    return list.slice().sort((a, b) => pos(a) - pos(b));
  }

  function endByFold() {
    const winner = live()[0];
    const won = pot;
    winner.stack += won; winner.winner = true; winner.winAmount = won;
    if (winner.ui) flyChips($('pot-display'), winner.ui.root, 5);
    pot = 0;
    const heroWon = winner.isHero;
    finalize({
      winners: [heroWon ? 'hero' : winner.name], heroWon, heroWin: heroWon ? won : 0, finalPot: won,
      title: heroWon ? `You win ${money(won)}!` : `${winner.name} wins ${money(won)}`,
      sub: heroWon ? 'Everyone folded to you.' : (hero().folded ? 'You folded this hand.' : 'Nobody called.'),
      showdown: false
    });
  }

  function showdown() {
    if (finished) return;
    phase = 'showdown';
    while (board.length < 5) board.push(deck.pop());
    const contenders = live();
    if (contenders.length < 2) return endByFold();
    contenders.forEach(p => { p.reveal = true; p.equity = null; p.value = scoreOf([...p.hole, ...board]); p.handName = describe(p.value); });
    const finalPot = pot;
    const pots = buildPots();
    const winnersAll = new Set();
    let heroWin = 0;
    pots.forEach(pt => {
      const high = Math.max(...pt.eligible.map(p => p.value));
      const ws = seatOrderFromButton(pt.eligible.filter(p => p.value === high));
      const share = Math.floor(pt.amount / ws.length);
      let rem = pt.amount - share * ws.length;
      ws.forEach(w => { const amt = share + (rem-- > 0 ? 1 : 0); w.stack += amt; w.winAmount = (w.winAmount || 0) + amt; w.winner = true; winnersAll.add(w); if (w.isHero) heroWin += amt; });
    });
    pot = 0;
    // Highlight the best hand overall.
    const top = [...winnersAll].sort((a, b) => b.value - a.value)[0];
    const winIds = bestFive([...top.hole, ...board]).map(c => c.id);
    top.winCards = winIds;
    winnersAll.forEach(w => { if (w.ui) flyChips($('pot-display'), w.ui.root, 5); });
    revealedHands = contenders.map(p => ({ name: p.isHero ? 'hero' : p.name, cards: p.hole.map(cardCode), handRank: CATEGORY(categoryOf(p.value)), handName: p.handName, rankValue: p.value }));

    const heroWon = heroWin > 0;
    const others = [...winnersAll].filter(w => !w.isHero);
    const split = winnersAll.size > 1;
    const title = heroWon ? (split && pots.length === 1 ? `Split pot · +${money(heroWin)}` : `You win ${money(heroWin)}!`)
      : others.length > 1 ? `${others.map(w => w.name.split(' ')[0]).join(' & ')} split the pot` : `${others[0].name} wins`;
    const sub = heroWon ? `with ${hero().handName}` : `with ${others[0].handName}`;
    finalize({ winners: [...winnersAll].map(w => w.isHero ? 'hero' : w.name), heroWon, heroWin, finalPot, title, sub, showdown: true, winIds, handName: heroWon ? hero().handName : others[0].handName, potCount: pots.length });
  }

  function finalize(res) {
    phase = 'done'; finished = true; runout = false; actorIdx = -1;
    clearTurnTimer(); clearTimeout(pending);
    const h = hero();
    const net = h.stack - handStartStack;
    sessionStats.netChips += net;
    if (res.heroWon) sessionStats.handsWon++; else sessionStats.handsLost++;
    message = res.title + ' — ' + res.sub;

    // progression
    profile.handsPlayed++;
    addXP(10);
    if (res.heroWon) {
      profile.handsWon++;
      profile.winStreak++;
      profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.winStreak);
      profile.biggestPot = Math.max(profile.biggestPot, res.heroWin);
      addXP(25 + Math.min(75, Math.floor(res.heroWin / 100) * 5));
      unlock('first_win');
      if (res.showdown) {
        unlock('showdown');
        const cat = categoryOf(h.value || 0);
        if (cat === 4) unlock('straight');
        if (cat === 5) unlock('flush');
        if (cat === 6) unlock('full_house');
        if (cat === 7) unlock('quads');
        if (cat === 8) unlock('straight_flush');
        if (h.allIn || players.some(p => p.allIn && !p.folded)) unlock('allin_win');
        if (players.length === 2) unlock('duelist');
      } else if (heroAggressed) unlock('pressure');
      if (profile.winStreak >= 3) unlock('streak3');
      if (res.heroWin >= 1500) unlock('big_pot');
    } else profile.winStreak = 0;
    profile.bestStack = Math.max(profile.bestStack, h.stack);
    if (h.stack >= 2000) unlock('double_up');
    saveProfile();

    if (res.heroWon) { sfx.win(); if (res.heroWin >= 400) confetti(res.heroWin >= 1200 ? 60 : 34); } else sfx.lose();
    botReactions(res);

    const banner = $('winner-banner');
    banner.className = 'winner-banner' + (res.heroWon ? ' win' : '');
    const netLabel = net ? `<span class="wb-net ${net > 0 ? 'up' : 'down'}">${net > 0 ? '+' : '−'}${money(Math.abs(net))} this hand</span>` : '';
    banner.innerHTML = `<span class="wb-title">${escapeHTML(res.title)}</span><span class="wb-sub">${escapeHTML(res.sub)}</span>${netLabel}`;
    banner.hidden = false;
    $('hand-message').hidden = true;

    render({ potBump: true, winIds: res.winIds });
    save();
    startAutoDeal();
    sendEvent('hand_finished', {
      handNumber: handNo, winners: res.winners, winnerIsPlayer: res.heroWon, result: res.title + ' ' + res.sub,
      pot: res.finalPot, endingStack: h.stack, netChips: net, handName: res.handName || null, potCount: res.potCount || 1,
      handDurationMs: Date.now() - handStartedAt, sessionStats: { ...sessionStats }, revealedHands
    });
  }

  function save() {
    store.set('kanai_' + username.toLowerCase(), { heroStack: hero().stack, handNo });
    store.set('kanai_last_player', username);
  }

  /* ======================================================================
     Hand log, pre-actions, emotes, turn alerts
     ====================================================================== */
  function pushLog(text, cls) {
    if (!cls) cls = /^You\b/.test(text) ? 'hero' : /^(Flop|Turn|River)\b/.test(text) ? 'street' : /\bwins?\b|split|Split/.test(text) ? 'result' : '';
    handLog.push({ text, cls });
    if (handLog.length > 80) handLog.shift();
    if (!$('log-panel').hidden) renderLog();
  }
  function renderLog() {
    const list = $('log-list');
    if (!list) return;
    list.innerHTML = handLog.map(l => `<li class="${l.cls}">${escapeHTML(l.text)}</li>`).join('') || '<li>No actions yet.</li>';
    list.scrollTop = list.scrollHeight;
  }
  function togglePanel(id) {
    const panel = $(id);
    const open = panel.hidden;
    ['poker-help', 'log-panel'].forEach(other => { if (other !== id) $(other).hidden = true; });
    panel.hidden = !open;
    if (id === 'log-panel' && open) renderLog();
    if (id === 'poker-help') sendEvent('help_toggled', { open });
  }
  // Pre-selected action that fires as soon as it becomes your turn.
  function runPreAction() {
    if (!preAction || !heroCanAct()) return false;
    const toCall = Math.max(0, currentBet - hero().bet);
    const kind = preAction === 'checkfold' ? (toCall > 0 ? 'fold' : 'check') : 'call';
    preAction = null;
    setTimeout(() => heroAct(kind), 280);
    return true;
  }
  function notifyTurn() {
    if (navigator.vibrate && document.hidden === false) { try { navigator.vibrate(35); } catch (_) {} }
    if (document.hidden && !titleBlink) {
      const base = document.title; let on = false;
      titleBlink = setInterval(() => { on = !on; document.title = on ? '● Your turn — Kanai' : base; }, 900);
      const stop = () => { clearInterval(titleBlink); titleBlink = null; document.title = base; document.removeEventListener('visibilitychange', stop); };
      document.addEventListener('visibilitychange', stop);
    }
  }
  function showEmote(p, e) {
    if (!p || !p.ui || !p.ui.root || !document.createElement) return;
    const old = p.ui.root.querySelector && p.ui.root.querySelector('.emote-bubble');
    if (old && old.remove) old.remove();
    const b = document.createElement('span');
    b.className = 'emote-bubble'; b.textContent = e;
    p.ui.root.appendChild(b);
    setTimeout(() => b.remove && b.remove(), 2600);
  }
  function sendEmote(e) {
    if (!EMOTES.includes(e) || !players.length) return;
    const now = Date.now();
    if (now - lastEmoteAt < 1200) return;
    lastEmoteAt = now;
    showEmote(hero(), e);
    unlock('chatty');
    // Opponents sometimes answer back.
    const others = players.filter(p => !p.isHero && !p.folded);
    if (others.length && Math.random() < 0.55) {
      const bot = others[Math.floor(Math.random() * others.length)];
      const answers = { '😂': ['😂', '😏'], '😎': ['🙄', '😏'], '🔥': ['🔥', '😮'], '😭': ['😂', '🙏'], '🤑': ['😤', '🙄'], '👍': ['👍'], '😮': ['😎'], '🙏': ['👍', '😇'] };
      const pool = answers[e] || ['👍'];
      setTimeout(() => showEmote(bot, pool[Math.floor(Math.random() * pool.length)]), 700 + Math.random() * 900);
    }
  }
  function botReactions(res) {
    players.forEach(p => {
      if (p.isHero) return;
      if (p.winner && (p.winAmount || 0) >= 400 && Math.random() < 0.45) setTimeout(() => showEmote(p, ['😎', '🤑', '😏'][Math.floor(Math.random() * 3)]), 500 + Math.random() * 700);
      else if (res.showdown && p.allIn && !p.winner && !p.folded && Math.random() < 0.6) setTimeout(() => showEmote(p, ['😭', '😤', '🙈'][Math.floor(Math.random() * 3)]), 600 + Math.random() * 600);
    });
  }

  /* ======================================================================
     Input
     ====================================================================== */
  $('bet-range').addEventListener('input', syncBetAmount);
  document.querySelectorAll('.bet-presets button').forEach(btn => btn.addEventListener('click', () => {
    const range = $('bet-range');
    const minTo = Number(range.min), maxTo = Number(range.max);
    const toCall = Math.max(0, currentBet - hero().bet);
    const preset = btn.dataset.bet;
    let v = minTo;
    if (preset === 'half') v = currentBet + Math.round((pot + toCall) * 0.5 / 10) * 10;
    else if (preset === 'pot') v = currentBet + Math.round((pot + toCall) / 10) * 10;
    else if (preset === 'max') v = maxTo;
    range.value = Math.min(maxTo, Math.max(minTo, v));
    syncBetAmount();
    sendEvent('bet_preset_selected', { preset, selectedRaiseTo: Number(range.value) });
  }));
  $('pre-checkfold').addEventListener('click', () => { preAction = preAction === 'checkfold' ? null : 'checkfold'; updateControls(); });
  $('pre-callany').addEventListener('click', () => { preAction = preAction === 'callany' ? null : 'callany'; updateControls(); });
  $('btn-emote').addEventListener('click', () => { const m = $('emote-menu'); m.hidden = !m.hidden; });
  $('emote-menu').innerHTML = EMOTES.map(e => `<button type="button" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join('');
  $('emote-menu').addEventListener('click', e => { const b = e.target.closest ? e.target.closest('button') : null; if (b && b.dataset.e) { sendEmote(b.dataset.e); $('emote-menu').hidden = true; } });
  $('action-fold').addEventListener('click', () => heroAct('fold'));
  $('action-check').addEventListener('click', () => heroAct('check'));
  $('action-call').addEventListener('click', () => heroAct('call'));
  $('action-raise').addEventListener('click', () => heroAct('raise'));
  $('action-next').addEventListener('click', () => { if (finished) startHand(); });
  $('auto-deal').addEventListener('change', e => { store.set('kanai_autodeal', e.target.checked); if (!e.target.checked) stopAutoDeal(); else if (finished) startAutoDeal(); });
  $('btn-help').addEventListener('click', () => togglePanel('poker-help'));
  $('btn-log').addEventListener('click', () => togglePanel('log-panel'));
  $('btn-sound').addEventListener('click', e => {
    soundOn = !soundOn;
    store.set('kanai_sound', soundOn);
    e.currentTarget.setAttribute('aria-pressed', String(!soundOn));
    e.currentTarget.classList.toggle('is-muted', !soundOn);
    if (soundOn) sfx.check();
    sendEvent('sound_toggled', { muted: !soundOn });
  });
  const openProfile = () => { renderProfilePanel(); $('profile-panel').hidden = false; stopAutoDeal(); };
  const closeProfile = () => { $('profile-panel').hidden = true; if (finished) startAutoDeal(); };
  $('btn-profile').addEventListener('click', openProfile);
  $('profile-close').addEventListener('click', closeProfile);
  $('profile-panel').addEventListener('click', e => { if (e.target === e.currentTarget) closeProfile(); });

  document.addEventListener('keydown', e => {
    if ($('screen-game').hidden) return;
    if (e.key === 'Escape') { if (!$('profile-panel').hidden) closeProfile(); $('poker-help').hidden = true; $('log-panel').hidden = true; $('emote-menu').hidden = true; return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (!$('profile-panel').hidden) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'h') { e.preventDefault(); togglePanel('poker-help'); return; }
    if (k === 'l') { e.preventDefault(); togglePanel('log-panel'); return; }
    if (finished && (k === 'enter' || k === ' ' || k === 'n')) { e.preventDefault(); startHand(); return; }
    if (!heroCanAct()) return;
    if (k === 'f') { e.preventDefault(); heroAct('fold'); }
    else if (k === 'c') { e.preventDefault(); heroAct('call'); }
    else if (k === 'r') { e.preventDefault(); if (!$('action-raise').disabled) heroAct('raise'); }
    else if (k === 'arrowright' || k === 'arrowleft') {
      e.preventDefault();
      const range = $('bet-range');
      range.value = Math.min(Number(range.max), Math.max(Number(range.min), Number(range.value) + (k === 'arrowright' ? BB : -BB)));
      syncBetAmount();
    }
  });

  /* ======================================================================
     Landing page: returning player, daily bonus teaser, random name
     ====================================================================== */
  (function landing() {
    const input = $('username-input');
    const dice = $('btn-random-name');
    if (dice) dice.addEventListener('click', () => {
      input.value = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] + Math.floor(10 + Math.random() * 90);
      input.dispatchEvent && input.dispatchEvent(new Event('input'));
      input.focus();
    });

    // Table picker: 6-max vs five bots, or a heads-up duel against one chosen opponent.
    selectedMode = store.get('kanai_mode', 'solo') === 'headsup' ? 'headsup' : 'solo';
    selectedOpp = Math.max(0, Math.min(BOT_ROSTER.length - 1, Number(store.get('kanai_opp', 0)) || 0));
    const oppHost = $('opponent-picker');
    if (oppHost) oppHost.innerHTML = BOT_ROSTER.map((b, i) => `<button type="button" class="opp" data-opp="${i}" role="radio" aria-checked="false" title="${escapeHTML(b.name)} — ${escapeHTML(b.style)}"><span class="opp-avatar" style="background:${b.avatar}">${b.name[0]}</span><b>${escapeHTML(b.name.split(' ')[0])}</b><small>${escapeHTML(b.style)}</small></button>`).join('');
    let bonusReady = false, returning = false;
    const syncPicker = () => {
      document.querySelectorAll('.mode-card').forEach(btn => { const on = btn.dataset.mode === selectedMode; toggle(btn, 'on', on); btn.setAttribute('aria-checked', String(on)); });
      document.querySelectorAll('.opp').forEach(btn => { const on = Number(btn.dataset.opp) === selectedOpp; toggle(btn, 'on', on); btn.setAttribute('aria-checked', String(on)); });
      const hu = $('hu-options'); if (hu) hu.hidden = selectedMode !== 'headsup';
      const btnText = $('btn-play-text');
      if (btnText && !$('btn-play').disabled) btnText.textContent = bonusReady ? 'Play & claim bonus'
        : selectedMode === 'headsup' ? `Challenge ${BOT_ROSTER[selectedOpp].name.split(' ')[0]}` : returning ? 'Continue playing' : 'Play now';
    };
    document.querySelectorAll('.mode-card').forEach(btn => btn.addEventListener('click', () => { selectedMode = btn.dataset.mode; syncPicker(); }));
    document.querySelectorAll('.opp').forEach(btn => btn.addEventListener('click', () => { selectedOpp = Number(btn.dataset.opp); syncPicker(); }));

    const last = store.get('kanai_last_player', null);
    const box = $('returning');
    if (last && typeof last === 'string' && box) {
      const prog = loadProfile(last);
      const saved = store.get('kanai_' + last.toLowerCase(), {});
      input.value = last;
      $('returning-avatar').textContent = last[0].toUpperCase();
      $('returning-name').textContent = `Welcome back, ${last}`;
      $('returning-meta').textContent = `Lv ${levelOf(prog.xp)} · ${money(typeof saved.heroStack === 'number' ? saved.heroStack : START)} chips · ${prog.achievements.length}/${ACHIEVEMENTS.length} achievements`;
      bonusReady = prog.lastBonusDay !== dayKey();
      $('returning-bonus').hidden = !bonusReady;
      box.hidden = false;
      returning = true;
    }
    syncPicker();
  })();

  /* ======================================================================
     External hooks (kept compatible)
     ====================================================================== */
  window.kanaiSessionSummary = () => ({
    handNumber: handNo, stack: hero() ? hero().stack : START, pot: pot || 0,
    street: phase === 'betting' ? street : phase, buttonSeat: buttonIdx,
    handStartedAt: handStartedAt ? new Date(handStartedAt).toISOString() : null,
    sessionStats: { ...sessionStats },
    opponents: players.slice(1).map(p => ({ name: p.name, countryCode: p.flag, stack: p.stack, status: p.folded ? 'folded' : 'in_hand' }))
  });

  window.addEventListener('kanai:start', e => {
    username = (e.detail && e.detail.username) || ($('username-input') && $('username-input').value.trim()) || 'You';
    heroFlag = (e.detail && (e.detail.countryCode || e.detail.flag)) || 'UN';
    soundOn = store.get('kanai_sound', true) !== false;
    $('btn-sound').classList.toggle('is-muted', !soundOn);
    $('auto-deal').checked = store.get('kanai_autodeal', true) !== false;
    mode = selectedMode === 'headsup' ? 'headsup' : 'solo';
    store.set('kanai_mode', mode); store.set('kanai_opp', selectedOpp);
    initPlayers();
    const data = store.get('kanai_' + username.toLowerCase(), {});
    if (typeof data.heroStack === 'number') hero().stack = data.heroStack;
    if (typeof data.handNo === 'number') handNo = data.handNo;
    profile = loadProfile(username);
    $('hero-avatar').textContent = (username[0] || 'Y').toUpperCase();
    renderProgress();
    const bonus = claimDailyBonus();
    startHand();
    if (bonus) {
      setTimeout(() => { toast(`Daily bonus · Day ${profile.streak}`, `+${money(bonus)} chips · come back tomorrow for more`, '🎁', 'bonus'); sfx.achieve(); }, 600);
    }
  });
  window.addEventListener('kanai:profile-updated', e => {
    heroFlag = (e.detail && (e.detail.countryCode || e.detail.flag)) || 'UN';
    if (players.length) { hero().flag = heroFlag; if (hero().ui) hero().ui.flag.innerHTML = flagMarkup(heroFlag); }
  });


  // Installable + offline-capable (service worker only on secure origins).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  // Exposed for automated tests only (no effect on gameplay).
  window.__kanaiTest = { evaluate: scoreOf, describe, showdownEquity, buildPots: () => buildPots(), state: () => ({ players, pot, board, street, phase, finished, buttonIdx, actorIdx, currentBet }) };
})();
