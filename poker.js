/* Kanai: local, play-money No-Limit Texas Hold'em with sequential betting rounds,
   believable bot opponents, a turn timer and lightweight table animations. */
(() => {
  const $ = id => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SB = 25, BB = 50, START = 1000, TURN_SECONDS = 30;

  const AVATARS = [
    'linear-gradient(145deg,#ff9f6b,#e5533d)',
    'linear-gradient(145deg,#5bd1ff,#3a74e5)',
    'linear-gradient(145deg,#b06bff,#7a3de5)',
    'linear-gradient(145deg,#ffd45b,#e59a3d)',
    'linear-gradient(145deg,#5bffb0,#2ea97a)'
  ];
  const BOT_ROSTER = [
    { name: 'Mia Chen', flag: 'CA' },
    { name: 'Eli Brooks', flag: 'GB' },
    { name: 'Sofia Reyes', flag: 'ES' },
    { name: 'Noah Kim', flag: 'KR' },
    { name: 'Theo Martin', flag: 'JP' }
  ];

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

  /* ---------- state ---------- */
  let players = [];           // index 0 is always the hero
  let deck = [];
  let board = [];
  let pot = 0;
  let currentBet = 0;         // highest committed amount in the active betting round
  let minRaise = BB;          // size of the last raise (minimum legal raise increment)
  let buttonIdx = 0;          // dealer button player index
  let toActIdx = -1;          // seat the scheduler should resolve next
  let street = 'preflop';
  let phase = 'idle';         // idle | betting | showdown | done
  let handNo = 0;
  let finished = false;
  let username = 'You', heroFlag = 'UN';
  let message = 'Welcome to the table';
  let handStartedAt = 0, handStartStack = START, actionIndex = 0, revealedHands = [];
  let soundOn = true, audioCtx = null;
  let turnTimer = null, turnDeadline = 0;

  const sessionStats = { handsPlayed: 0, handsWon: 0, handsLost: 0, folds: 0, calls: 0, checks: 0, raises: 0, netChips: 0 };

  /* ---------- seat geometry (hero fixed at the bottom) ---------- */
  const SEAT_IDS = ['seat-4', 'seat-5', 'seat-6', 'seat-1', 'seat-2', 'seat-3'];
  const SEAT_CLASSES = ['seat-bottom', 'seat-lower-left', 'seat-upper-left', 'seat-top', 'seat-upper-right', 'seat-lower-right'];

  /* ---------- helpers ---------- */
  const money = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
  const n = () => players.length;
  const live = () => players.filter(p => !p.folded);
  const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const rankLabel = v => (v <= 10 ? String(v) : RANKS[v]);
  const cardCode = c => rankLabel(c.v) + c.s;
  const isRed = c => c.s === '♥' || c.s === '♦';

  function shuffledDeck() {
    const d = [];
    for (const s of SUITS) for (let v = 2; v <= 14; v++) d.push({ s, v });
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  /* ---------- sound (tiny synth, no assets) ---------- */
  function beep(freq, dur = 0.08, type = 'sine', gain = 0.04) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (_) { /* audio unsupported */ }
  }
  const sfx = {
    deal: () => beep(520, 0.05, 'triangle', 0.03),
    chip: () => beep(300, 0.06, 'square', 0.03),
    check: () => beep(420, 0.05, 'sine', 0.03),
    fold: () => beep(180, 0.12, 'sine', 0.035),
    raise: () => { beep(440, 0.06, 'square', 0.035); setTimeout(() => beep(620, 0.07, 'square', 0.035), 60); },
    win: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.045), i * 90)); },
    lose: () => beep(200, 0.25, 'sine', 0.035),
    tick: () => beep(760, 0.03, 'sine', 0.025)
  };

  /* ---------- telemetry (kept compatible with the existing pipeline) ---------- */
  const streetName = () => street;
  const sendEvent = (event, details = {}) => window.kanaiWebhook && window.kanaiWebhook(event, {
    gameState: {
      handNumber: handNo, street, pot: pot || 0, currentBet: currentBet || 0, phase, actionIndex,
      player: { name: username, stack: hero().stack, committed: hero().bet || 0, privateCards: hero().hole?.map(cardCode) || [] },
      communityCards: board.map(cardCode),
      opponents: players.slice(1).map(p => ({ name: p.name, countryCode: p.flag, stack: p.stack, status: p.folded ? 'folded' : 'in_hand' }))
    },
    sessionStats: { ...sessionStats }, ...details
  });

  const hero = () => players[0];

  /* ---------- card rendering ---------- */
  function cardHTML(c, dealt) {
    const cls = `playing-card${isRed(c) ? ' red' : ''}${dealt ? ' dealt' : ''}`;
    return `<div class="${cls}"><span class="card-rank">${rankLabel(c.v)}<span class="card-suit">${c.s}</span></span><span class="card-center">${c.s}</span></div>`;
  }
  const cardBackHTML = () => '<div class="playing-card card-back" aria-label="Face down card"></div>';
  const slotHTML = () => '<div class="card-slot" aria-hidden="true"></div>';
  function miniCardHTML(c, back) {
    if (back) return '<span class="mini-card back" aria-hidden="true"></span>';
    return `<span class="mini-card${isRed(c) ? ' red' : ''}">${rankLabel(c.v)}${c.s}</span>`;
  }

  /* ---------- persistence ---------- */
  function save() {
    try { localStorage.setItem('kanai_' + username.toLowerCase(), JSON.stringify({ heroStack: hero().stack, handNo })); } catch (_) {}
  }

  /* ---------- rendering ---------- */
  function badgeFor(idx) {
    const sb = (buttonIdx + 1) % n(), bb = (buttonIdx + 2) % n();
    if (idx === buttonIdx) return '<span class="seat-badge badge-D" title="Dealer">D</span>';
    if (idx === sb) return '<span class="seat-badge badge-S" title="Small blind">SB</span>';
    if (idx === bb) return '<span class="seat-badge badge-B" title="Big blind">BB</span>';
    return '';
  }
  function statusMarkup(p) {
    if (p.winner) return '<span class="seat-status status-win show">WON</span>';
    if (p.folded) return '<span class="seat-status status-fold show">FOLDED</span>';
    if (p.allIn) return '<span class="seat-status status-allin show">ALL-IN</span>';
    if (p.last) {
      const map = { call: 'status-call CALLED', check: 'status-check CHECKED', raise: 'status-raise RAISED', bet: 'status-raise BET' };
      const m = map[p.last];
      if (m) { const [cls, label] = [m.slice(0, m.indexOf(' ')), m.slice(m.indexOf(' ') + 1)]; return `<span class="seat-status ${cls} show">${label}</span>`; }
    }
    return '<span class="seat-status"></span>';
  }
  function holeMarkup(p) {
    if (p.isHero || !p.hole || !p.hole.length) return '';
    const faceUp = p.reveal && !p.folded;
    return `<div class="seat-hole" aria-hidden="true">${p.hole.map(c => miniCardHTML(c, !faceUp)).join('')}</div>`;
  }
  function betMarkup(p) {
    if (!p.bet || p.folded) return '';
    return `<div class="seat-bet"><span class="chip-stack"></span>${money(p.bet)}</div>`;
  }

  function renderSeats() {
    players.forEach((p, idx) => {
      const el = $(SEAT_IDS[idx]);
      if (!el) return;
      const activeHere = phase === 'betting' && toActIdx === idx && !finished;
      el.className = 'seat ' + SEAT_CLASSES[idx]
        + (p.isHero ? ' hero-seat' : '')
        + (p.folded ? ' seat-folded' : '')
        + (activeHere ? ' active' : '')
        + (p.winner ? ' seat-winner' : '');
      el.innerHTML = statusMarkup(p)
        + `<div class="seat-card">
             <div class="seat-avatar" style="background:${p.avatar}">${p.initial}</div>
             <div class="seat-text">
               <div class="seat-name">${flagMarkup(p.flag)} ${p.name}${p.isHero ? ' <small style="color:#8d879a">(you)</small>' : ''} ${badgeFor(idx)}</div>
               <div class="seat-stack"><span class="chip-ico"></span>${money(p.stack)}</div>
             </div>
             ${holeMarkup(p)}
           </div>`
        + betMarkup(p);
    });
  }

  function render(opts = {}) {
    $('hero-name').textContent = username;
    $('hero-avatar').textContent = (username[0] || 'Y').toUpperCase();
    $('hero-avatar').style.background = hero().avatar;
    $('hero-stack').textContent = money(hero().stack);
    $('topbar-stack').textContent = money(hero().stack);
    const potEl = $('pot-display') || document.querySelector('.pot-display');
    $('pot-value').textContent = money(pot);
    if (opts.potBump && potEl) { potEl.classList.remove('bump'); void potEl.offsetWidth; potEl.classList.add('bump'); }
    $('hand-count').textContent = `HAND #${String(handNo).padStart(3, '0')}`;
    $('hero-cards').innerHTML = hero().hole ? hero().hole.map(c => cardHTML(c, opts.dealHero)).join('') : '';
    renderBoard(opts.dealBoard);
    $('hand-message').textContent = message;
    renderSeats();
    updateControls();
  }

  function renderBoard(animate) {
    const host = $('community-cards');
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (board[i]) html += cardHTML(board[i], animate && i >= (animate.from || 0));
      else html += slotHTML();
    }
    host.innerHTML = html;
  }

  /* ---------- controls ---------- */
  function updateControls() {
    const act = phase === 'betting' && toActIdx === 0 && !finished;
    const h = hero();
    const toCall = Math.max(0, currentBet - h.bet);
    const canRaise = h.stack > toCall;
    $('action-fold').hidden = !act;
    $('action-check').hidden = !act || toCall > 0;
    $('action-call').hidden = !act || toCall <= 0;
    $('action-raise').hidden = !act;
    $('action-next').hidden = !finished;
    if (toCall > 0) {
      const callAmt = Math.min(toCall, h.stack);
      $('call-amt').textContent = money(callAmt);
      $('action-call').firstChild.textContent = callAmt >= h.stack ? 'All-in ' : 'Call ';
    }
    $('action-raise').firstChild && ($('action-raise').firstChild.textContent = toCall > 0 ? 'Raise' : 'Bet');

    ['action-fold', 'action-check', 'action-call'].forEach(id => $(id).disabled = !act);
    $('action-raise').disabled = !act || !canRaise;

    const panel = $('bet-panel');
    const range = $('bet-range');
    if (act && canRaise) {
      panel.classList.remove('disabled');
      const minTo = Math.min(h.stack + h.bet, currentBet + minRaise);
      const maxTo = h.stack + h.bet;
      range.min = minTo; range.max = maxTo; range.step = 10;
      if (Number(range.value) < minTo || Number(range.value) > maxTo) range.value = Math.min(maxTo, Math.max(minTo, Math.round((pot * 0.6 + minTo) / 10) * 10));
      $('bet-amount').textContent = money(Number(range.value));
      range.disabled = false;
    } else {
      panel.classList.add('disabled');
      range.disabled = true;
    }
  }

  /* ---------- turn timer ---------- */
  function startTurnTimer() {
    clearTurnTimer();
    turnDeadline = Date.now() + TURN_SECONDS * 1000;
    const ind = $('turn-indicator'), ring = $('turn-ring'), label = $('turn-timer');
    ind.hidden = false;
    const tick = () => {
      const remaining = Math.max(0, turnDeadline - Date.now());
      const frac = remaining / (TURN_SECONDS * 1000);
      ring.style.setProperty('--t', frac.toFixed(3));
      const secs = Math.ceil(remaining / 1000);
      label.textContent = '0:' + String(secs).padStart(2, '0');
      ring.classList.toggle('urgent', secs <= 8);
      if (secs <= 5 && secs > 0 && remaining % 1000 > 920) sfx.tick();
      if (remaining <= 0) { clearTurnTimer(); autoAct(); return; }
      turnTimer = requestAnimationFrame(tick);
    };
    tick();
  }
  function clearTurnTimer() {
    if (turnTimer) cancelAnimationFrame(turnTimer);
    turnTimer = null;
    $('turn-indicator').hidden = true;
  }
  function autoAct() {
    const toCall = Math.max(0, currentBet - hero().bet);
    message = toCall > 0 ? 'Time up — hand folded.' : 'Time up — you check.';
    heroAct(toCall > 0 ? 'fold' : 'check');
  }

  /* ---------- hand lifecycle ---------- */
  function initPlayers() {
    const heroInitial = (username[0] || 'Y').toUpperCase();
    players = [
      { isHero: true, name: username, initial: heroInitial, flag: heroFlag, avatar: 'linear-gradient(145deg,#8a5bff,#5b38b0)', stack: START },
      ...BOT_ROSTER.map((b, i) => ({ isHero: false, name: b.name, initial: b.name[0], flag: b.flag, avatar: AVATARS[i % AVATARS.length], stack: 600 + Math.floor(Math.random() * 900) }))
    ];
    buttonIdx = Math.floor(Math.random() * players.length);
  }

  function resetRoundFlags() { players.forEach(p => { p.bet = 0; p.acted = false; p.last = ''; }); }

  function startHand() {
    clearTurnTimer();
    $('winner-banner').hidden = true;
    $('winner-banner').classList.remove('win');

    if (!players.length) initPlayers();
    // keep stacks healthy for a casual, endless session
    if (hero().stack < BB) { hero().stack = START; message = 'Your seat was topped up to ' + money(START) + ' chips.'; }
    players.forEach((p, i) => { if (i > 0 && p.stack < BB * 2) p.stack = 500 + Math.floor(Math.random() * 1000); });

    players.forEach(p => { p.hole = []; p.bet = 0; p.committed = 0; p.folded = false; p.allIn = false; p.acted = false; p.last = ''; p.reveal = false; p.winner = false; });

    handNo++; sessionStats.handsPlayed++;
    handStartedAt = Date.now(); handStartStack = hero().stack; actionIndex = 0; revealedHands = [];
    deck = shuffledDeck(); board = []; pot = 0; currentBet = 0; minRaise = BB;
    street = 'preflop'; phase = 'betting'; finished = false;

    buttonIdx = (buttonIdx + 1) % players.length;

    // deal two hole cards to each, starting left of the button
    for (let r = 0; r < 2; r++) for (let k = 1; k <= players.length; k++) players[(buttonIdx + k) % players.length].hole.push(deck.pop());

    // post blinds
    const sbIdx = (buttonIdx + 1) % players.length, bbIdx = (buttonIdx + 2) % players.length;
    postBlind(sbIdx, SB); postBlind(bbIdx, BB);
    currentBet = BB; minRaise = BB;
    players.forEach(p => p.acted = false);
    toActIdx = (bbIdx + 1) % players.length;

    message = 'Blinds posted. Cards in the air.';
    sfx.deal();
    render({ dealHero: true, dealBoard: { from: 0 } });
    save();
    sendEvent('hand_started', {
      handNumber: handNo, startingStack: handStartStack, stackAfterBlinds: hero().stack,
      smallBlind: SB, bigBlind: BB, blindLevel: `${SB}/${BB}`, pot, privateCards: hero().hole.map(cardCode),
      street: 'preflop', tableType: 'simulated_play_money', playerCount: players.length,
      buttonSeat: buttonIdx, startedAt: new Date(handStartedAt).toISOString()
    });
    setTimeout(schedule, 820);
  }

  function postBlind(idx, amount) {
    const p = players[idx];
    const paid = Math.min(amount, p.stack);
    p.stack -= paid; p.bet += paid; p.committed += paid; pot += paid;
    if (p.stack === 0) p.allIn = true;
  }

  /* ---------- betting scheduler ---------- */
  function nextToAct(start) {
    for (let k = 0; k < players.length; k++) {
      const idx = (start + k) % players.length;
      const p = players[idx];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < currentBet)) return idx;
    }
    return -1;
  }

  function schedule() {
    if (finished) return;
    if (live().length === 1) return endByFold();
    const idx = nextToAct(toActIdx);
    if (idx === -1) return advanceStreet();
    toActIdx = idx;
    renderSeats(); updateControls();
    if (players[idx].isHero) {
      message = currentBet - hero().bet > 0 ? 'Your move — call, raise or fold.' : 'Your move — check or bet.';
      $('hand-message').textContent = message;
      startTurnTimer();
    } else {
      clearTurnTimer();
      setTimeout(() => botAct(idx), 650 + Math.random() * 750);
    }
  }

  function afterAction(idx) {
    players[idx].acted = true;
    toActIdx = (idx + 1) % players.length;
    render();
    setTimeout(schedule, 420);
  }

  /* ---------- hero actions ---------- */
  function heroAct(kind) {
    if (phase !== 'betting' || toActIdx !== 0 || finished) return;
    clearTurnTimer();
    const h = hero();
    const toCall = Math.max(0, currentBet - h.bet);
    actionIndex++;
    const potBefore = pot, stackBefore = h.stack, str = street;
    let amount = 0, raiseTo = null;

    if (kind === 'fold') {
      h.folded = true; h.last = 'fold'; sessionStats.folds++; sfx.fold();
    } else if (kind === 'check' && toCall === 0) {
      h.last = 'check'; sessionStats.checks++; sfx.check();
    } else if (kind === 'call' || (kind === 'check' && toCall > 0)) {
      amount = Math.min(toCall, h.stack);
      h.stack -= amount; h.bet += amount; h.committed += amount; pot += amount;
      if (h.stack === 0) h.allIn = true;
      h.last = 'call'; sessionStats.calls++; sfx.chip();
    } else if (kind === 'raise') {
      raiseTo = Math.min(Number($('bet-range').value), h.stack + h.bet);
      if (raiseTo <= currentBet) return; // illegal, ignore
      amount = raiseTo - h.bet;
      h.stack -= amount; h.committed += amount; pot += amount;
      minRaise = Math.max(minRaise, raiseTo - currentBet);
      h.bet = raiseTo; currentBet = raiseTo;
      if (h.stack === 0) h.allIn = true;
      h.last = currentBet - amount === 0 ? 'bet' : 'raise';
      players.forEach((p, i) => { if (i !== 0 && !p.folded && !p.allIn) p.acted = false; });
      sessionStats.raises++; sfx.raise();
    } else return;

    sendEvent('player_action', {
      handNumber: handNo, action: kind, actionIndex, street: str,
      elapsedSinceHandStartMs: Date.now() - handStartedAt,
      amount, raiseTo, potBefore, potAfter: pot, stackBefore, stackAfter: h.stack,
      toCall, privateCards: h.hole.map(cardCode), communityCards: board.map(cardCode)
    });

    if (kind === 'fold') { render(); return afterFoldCheck(0); }
    afterAction(0);
  }

  function afterFoldCheck(idx) {
    players[idx].acted = true;
    toActIdx = (idx + 1) % players.length;
    render();
    setTimeout(schedule, 420);
  }

  /* ---------- bot AI ---------- */
  function handStrength(p) {
    if (board.length === 0) {
      const [a, b] = p.hole;
      const hi = Math.max(a.v, b.v), lo = Math.min(a.v, b.v);
      let s = (hi / 14) * 0.46 + (lo / 14) * 0.12;
      if (a.v === b.v) s += 0.34 + (a.v / 14) * 0.14;      // pocket pair
      if (a.s === b.s) s += 0.06;                           // suited
      if (hi - lo <= 2 && a.v !== b.v) s += 0.05;           // connected
      return Math.max(0.05, Math.min(0.97, s));
    }
    const rank = best([...p.hole, ...board]);
    const cat = Math.floor(rank / 759375); // 0..8
    if (cat === 0) {
      const high = Math.max(...p.hole.map(c => c.v), ...board.map(c => c.v));
      const myHigh = Math.max(p.hole[0].v, p.hole[1].v);
      return 0.12 + (myHigh === high ? 0.14 : 0.04) + (myHigh / 14) * 0.08;
    }
    if (cat === 1) return 0.40 + (Math.floor(rank / 50625) % 15) / 15 * 0.12;
    return Math.min(0.99, 0.5 + cat * 0.072);
  }

  function botAct(idx) {
    if (finished || toActIdx !== idx) return;
    const p = players[idx];
    if (p.folded || p.allIn) { afterAction(idx); return; }
    const toCall = Math.max(0, currentBet - p.bet);
    const strength = handStrength(p);
    const potOdds = toCall / (pot + toCall || 1);
    const r = Math.random();
    const potBefore = pot, stackBefore = p.stack;
    let decision = 'check', amount = 0, raiseTo = null;

    const sizeRaise = () => {
      const target = currentBet + Math.max(minRaise, Math.round((pot * (0.4 + strength * 0.5)) / 10) * 10);
      return Math.min(p.stack + p.bet, Math.max(currentBet + minRaise, target));
    };

    if (toCall === 0) {
      if (strength > 0.66 && r < 0.55) { decision = 'raise'; raiseTo = sizeRaise(); }
      else decision = 'check';
    } else {
      if (strength < 0.30) { decision = (potOdds < 0.08 && r < 0.35) ? 'call' : 'fold'; }
      else if (strength > 0.82 && r < 0.5 && p.stack > toCall + minRaise) { decision = 'raise'; raiseTo = sizeRaise(); }
      else if (strength > potOdds + 0.12) decision = 'call';
      else if (r < 0.2) decision = 'call';
      else decision = 'fold';
    }

    if (decision === 'fold') {
      p.folded = true; p.last = 'fold'; sfx.fold();
      message = `${p.name} folds.`;
    } else if (decision === 'check') {
      p.last = 'check'; sfx.check();
      message = `${p.name} checks.`;
    } else if (decision === 'call') {
      amount = Math.min(toCall, p.stack);
      p.stack -= amount; p.bet += amount; p.committed += amount; pot += amount;
      if (p.stack === 0) p.allIn = true;
      p.last = 'call'; sfx.chip();
      message = p.allIn ? `${p.name} is all-in.` : `${p.name} calls ${money(amount)}.`;
    } else { // raise
      raiseTo = Math.min(raiseTo, p.stack + p.bet);
      if (raiseTo <= currentBet) { // fallback to call
        amount = Math.min(toCall, p.stack); p.stack -= amount; p.bet += amount; p.committed += amount; pot += amount;
        if (p.stack === 0) p.allIn = true; p.last = 'call'; message = `${p.name} calls.`;
      } else {
        amount = raiseTo - p.bet;
        p.stack -= amount; p.committed += amount; pot += amount;
        minRaise = Math.max(minRaise, raiseTo - currentBet);
        p.bet = raiseTo; currentBet = raiseTo;
        if (p.stack === 0) p.allIn = true;
        p.last = currentBet - amount === 0 ? 'bet' : 'raise'; sfx.raise();
        message = p.allIn ? `${p.name} shoves to ${money(raiseTo)}.` : `${p.name} raises to ${money(raiseTo)}.`;
        players.forEach((q, i) => { if (i !== idx && !q.folded && !q.allIn) q.acted = false; });
      }
    }

    sendEvent('opponent_action', {
      opponent: p.name, countryCode: p.flag, action: decision, street,
      amount, raiseTo, potBefore, potAfter: pot, stackBefore, stackAfter: p.stack,
      decisionType: 'simulated_bot', handStrength: Math.round(strength * 100) / 100
    });
    afterAction(idx);
  }

  /* ---------- street progression ---------- */
  function advanceStreet() {
    resetRoundFlags();
    currentBet = 0; minRaise = BB;
    if (street === 'preflop') { board.push(deck.pop(), deck.pop(), deck.pop()); street = 'flop'; message = 'The flop.'; }
    else if (street === 'flop') { board.push(deck.pop()); street = 'turn'; message = 'The turn.'; }
    else if (street === 'turn') { board.push(deck.pop()); street = 'river'; message = 'The river.'; }
    else { return showdown(); }
    toActIdx = (buttonIdx + 1) % players.length;
    sfx.deal();
    const from = street === 'flop' ? 0 : board.length - 1;
    render({ dealBoard: { from }, potBump: true });
    sendEvent('community_cards_dealt', { street, boardCards: board.map(cardCode), activeOpponentCount: live().length - 1 });
    setTimeout(schedule, 900);
  }

  /* ---------- showdown & payout ---------- */
  const CATEGORY = n => ['high card', 'a pair', 'two pair', 'three of a kind', 'a straight', 'a flush', 'a full house', 'four of a kind', 'a straight flush'][Math.max(0, Math.min(8, n))];

  function rankFive(cards) {
    const vals = cards.map(c => c.v).sort((a, b) => b - a);
    const counts = {}; vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
    const groups = Object.entries(counts).map(([v, c]) => [+v, c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every(c => c.s === cards[0].s);
    const uniq = [...new Set(vals)];
    let straight = 0;
    for (let i = 0; i <= uniq.length - 5; i++) if (uniq[i] - uniq[i + 4] === 4) { straight = uniq[i]; break; }
    if (!straight && [14, 5, 4, 3, 2].every(v => uniq.includes(v))) straight = 5;
    const kick = (cat, arr) => { const d = arr.slice(0, 5); while (d.length < 5) d.push(0); return d.reduce((a, v) => a * 15 + v, cat); };
    if (flush && straight) return kick(8, [straight]);
    if (groups[0][1] === 4) return kick(7, [groups[0][0], groups[1][0]]);
    if (groups[0][1] === 3 && groups[1][1] >= 2) return kick(6, [groups[0][0], groups[1][0]]);
    if (flush) return kick(5, vals);
    if (straight) return kick(4, [straight]);
    if (groups[0][1] === 3) return kick(3, [groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)]);
    if (groups[0][1] === 2 && groups[1][1] === 2) return kick(2, [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]]);
    if (groups[0][1] === 2) return kick(1, [groups[0][0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)]);
    return kick(0, vals);
  }
  function best(cards) {
    let high = 0;
    for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++)
      for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++)
        high = Math.max(high, rankFive([cards[a], cards[b], cards[c], cards[d], cards[e]]));
    return high;
  }

  function endByFold() {
    const winner = live()[0];
    const idx = players.indexOf(winner);
    winner.stack += pot; winner.winner = true;
    const heroWon = winner.isHero;
    finalize([winner.name], heroWon ? 'You win — everyone folded.' : `${winner.name} wins the pot.`,
      heroWon ? 'Everyone folded to you.' : 'You folded this hand.', heroWon);
  }

  function showdown() {
    phase = 'showdown';
    while (board.length < 5) board.push(deck.pop());
    const contenders = players.filter(p => !p.folded);
    contenders.forEach(p => { p.reveal = true; p.value = best([...p.hole, ...board]); });
    const high = Math.max(...contenders.map(p => p.value));
    const winners = contenders.filter(p => p.value === high);
    const share = Math.floor(pot / winners.length);
    winners.forEach(w => { w.stack += share; w.winner = true; });
    const heroWon = winners.some(w => w.isHero);
    revealedHands = contenders.map(p => ({ name: p.isHero ? 'hero' : p.name, cards: p.hole.map(cardCode), handRank: CATEGORY(Math.floor(p.value / 759375)), rankValue: p.value }));
    const handName = CATEGORY(Math.floor(high / 759375));
    const title = heroWon
      ? (winners.length > 1 ? 'Split pot!' : 'You win!')
      : `${winners[0].name} wins`;
    const sub = `with ${handName}`;
    finalize(winners.map(w => w.isHero ? 'hero' : w.name), title, sub, heroWon, handName);
  }

  function finalize(winners, title, sub, heroWon, handName) {
    const finalPot = pot;
    const net = hero().stack - handStartStack;
    sessionStats.netChips += net;
    if (heroWon) sessionStats.handsWon++; else sessionStats.handsLost++;
    phase = 'done'; finished = true; message = title + (sub ? ' — ' + sub : '');
    clearTurnTimer();
    if (heroWon) sfx.win(); else sfx.lose();

    const banner = $('winner-banner');
    banner.className = 'winner-banner' + (heroWon ? ' win' : '');
    const netLabel = net ? ` · ${net > 0 ? '+' + money(net) : '−' + money(-net)} chips` : '';
    banner.innerHTML = `<span class="wb-title">${title}</span><span class="wb-sub">${sub}${netLabel}</span>`;
    banner.hidden = false;

    render({ potBump: true });
    save();
    sendEvent('hand_finished', {
      handNumber: handNo, winners, winnerIsPlayer: heroWon, result: title + ' ' + sub,
      pot: finalPot, endingStack: hero().stack, netChips: net, handName: handName || null,
      handDurationMs: Date.now() - handStartedAt, sessionStats: { ...sessionStats }, revealedHands
    });
  }

  /* ---------- bet slider & presets ---------- */
  function syncBetAmount() { $('bet-amount').textContent = money(Number($('bet-range').value)); }
  $('bet-range').addEventListener('input', syncBetAmount);
  document.querySelectorAll('.bet-presets button').forEach(btn => btn.addEventListener('click', () => {
    const range = $('bet-range');
    const minTo = Number(range.min), maxTo = Number(range.max);
    const toCall = Math.max(0, currentBet - hero().bet);
    let v = minTo;
    const preset = btn.dataset.bet;
    if (preset === 'min') v = minTo;
    else if (preset === 'half') v = currentBet + Math.round((pot + toCall) * 0.5 / 10) * 10;
    else if (preset === 'pot') v = currentBet + Math.round((pot + toCall) / 10) * 10;
    else v = maxTo;
    range.value = Math.min(maxTo, Math.max(minTo, v));
    syncBetAmount();
    sendEvent('bet_preset_selected', { preset, selectedRaiseTo: Number(range.value) });
  }));

  /* ---------- buttons ---------- */
  $('action-fold').addEventListener('click', () => heroAct('fold'));
  $('action-check').addEventListener('click', () => heroAct('check'));
  $('action-call').addEventListener('click', () => heroAct('call'));
  $('action-raise').addEventListener('click', () => heroAct('raise'));
  $('action-next').addEventListener('click', startHand);
  $('btn-help').addEventListener('click', () => { const panel = $('poker-help'); panel.hidden = !panel.hidden; sendEvent('help_toggled', { open: !panel.hidden }); });
  $('btn-sound').addEventListener('click', e => {
    soundOn = !soundOn;
    e.currentTarget.setAttribute('aria-pressed', String(!soundOn));
    e.currentTarget.classList.toggle('is-muted', !soundOn);
    if (soundOn) sfx.check();
    sendEvent('sound_toggled', { muted: !soundOn });
  });

  /* keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if ($('screen-game').hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const act = phase === 'betting' && toActIdx === 0 && !finished;
    const k = e.key.toLowerCase();
    if (finished && (k === 'enter' || k === ' ' || k === 'n')) { e.preventDefault(); startHand(); return; }
    if (!act) return;
    const toCall = Math.max(0, currentBet - hero().bet);
    if (k === 'f') { e.preventDefault(); heroAct('fold'); }
    else if (k === 'c') { e.preventDefault(); heroAct(toCall > 0 ? 'call' : 'check'); }
    else if (k === 'r') { e.preventDefault(); if (!$('action-raise').disabled) heroAct('raise'); }
  });

  /* ---------- external hooks (kept compatible) ---------- */
  window.kanaiSessionSummary = () => ({
    handNumber: handNo, stack: hero()?.stack ?? START, pot: pot || 0,
    street: phase === 'betting' ? street : phase, buttonSeat: buttonIdx,
    handStartedAt: handStartedAt ? new Date(handStartedAt).toISOString() : null,
    sessionStats: { ...sessionStats },
    opponents: players.slice(1).map(p => ({ name: p.name, countryCode: p.flag, stack: p.stack, status: p.folded ? 'folded' : 'in_hand' }))
  });

  window.addEventListener('kanai:start', e => {
    username = e.detail?.username || $('username-input')?.value?.trim() || 'You';
    heroFlag = e.detail?.countryCode || e.detail?.flag || 'UN';
    initPlayers();
    try {
      const data = JSON.parse(localStorage.getItem('kanai_' + username.toLowerCase()) || '{}');
      if (typeof data.heroStack === 'number') hero().stack = data.heroStack;
      if (typeof data.handNo === 'number') handNo = data.handNo;
    } catch (_) {}
    startHand();
  });
  window.addEventListener('kanai:profile-updated', e => {
    heroFlag = e.detail?.countryCode || e.detail?.flag || 'UN';
    if (players.length) { hero().flag = heroFlag; renderSeats(); }
  });
})();
