/* ═══════════════════════════════════════════════════════════
   STONE VS STICK — COMPLETE GAME ENGINE v2
   Fixes: diagonal wins, 5-win match, AI turn order,
          coin toss icon, full AI rewrite, themed board
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─── BOARD GRAPH ───────────────────────────────────────────
     0 ─ 1 ─ 2
     │   │   │
     3 ─ 4 ─ 5
     │   │   │
     6 ─ 7 ─ 8
  ──────────────────────────────────────────────────────────── */
  const ADJ = {
    0:[1,3], 1:[0,2,4], 2:[1,5],
    3:[0,4,6], 4:[1,3,5,7], 5:[2,4,8],
    6:[3,7], 7:[6,8,4], 8:[5,7]
  };

  /* ALL win lines — horizontal + vertical + diagonal */
  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8],   // rows
    [0,3,6],[1,4,7],[2,5,8],   // cols
    [0,4,8],[2,4,6]            // diagonals ← NEW
  ];

  const MATCH_WIN = 5;   // first to 5 rounds wins the match
  const PIECE_LIMIT = 3;

  /* ─── STATE ─────────────────────────────────────────────── */
  const S = {
    phase: 'idle',        // idle | placement | movement
    cur: 1,              // 1=stone, 2=stick
    board: Array(9).fill(null),
    placed: {1:0, 2:0},
    scores: {1:0, 2:0},
    selected: null,
    lastWinner: null,    // who won last round (starts next)
    aiOn: false,
    aiThinking: false,
  };

  /* ─── DOM ────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const canvas       = $('board-canvas');
  const ctx          = canvas.getContext('2d');
  const piecesLayer  = $('pieces-layer');
  const boardWrapper = $('board-wrapper');
  const boardOuter   = $('board-outer');
  const statusMsg    = $('status-msg');
  const phaseBadge   = $('phase-badge');
  const scoreStone   = $('score-stone');
  const scoreStick   = $('score-stick');
  const scoreP1      = $('score-p1');
  const scoreP2      = $('score-p2');
  const pipsStone    = $('pips-stone');
  const pipsStick    = $('pips-stick');
  const coinOverlay  = $('coin-overlay');
  const winOverlay   = $('win-overlay');
  const matchOverlay = $('match-overlay');
  const coin           = $('coin');
  const coinFront      = $('coin-front-icon');
  const coinBack       = $('coin-back-icon');
  const coinFrontLabel = $('coin-front-label');
  const coinBackLabel  = $('coin-back-label');
  const tossResult     = $('toss-result');
  const winPieceIcon   = $('win-piece-icon');
  const winTitle       = $('win-title');
  const winSub         = $('win-sub');
  const matchTitle     = $('match-title');
  const matchSub       = $('match-sub');
  const btnToss        = $('btn-toss');
  const btnAi          = $('btn-ai');
  const btnReset       = $('btn-reset');
  const btnNext        = $('btn-next');
  const btnNewMatch    = $('btn-new-match');
  const btnHelp        = $('btn-help');
  const btnHelpClose   = $('btn-help-close');
  const helpOverlay    = $('help-overlay');

  /* ─── NODES (canvas positions) ──────────────────────────── */
  let nodes = [];

  function computeNodes(size) {
    const pad  = size * 0.17;
    const step = (size - 2 * pad) / 2;
    nodes = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        nodes.push({ x: pad + c * step, y: pad + r * step });
  }

  /* ─── RESIZE ─────────────────────────────────────────────── */
  function resizeBoard() {
    const rect = boardWrapper.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    canvas.width  = size;
    canvas.height = size;
    computeNodes(size);
    drawBoard();
    renderPieces();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeBoard, 80);
  });

  /* ─── DRAW BOARD ─────────────────────────────────────────── */
  function drawBoard(winLine = null) {
    const W = canvas.width;
    ctx.clearRect(0, 0, W, W);

    /* board bg */
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, W, W);

    /* grid lines */
    ctx.save();
    ctx.strokeStyle = 'rgba(200,169,110,0.5)';
    ctx.lineWidth   = W * 0.008;
    ctx.lineCap     = 'round';
    for (const [a, list] of Object.entries(ADJ))
      for (const b of list)
        if (b > +a) {
          ctx.beginPath();
          ctx.moveTo(nodes[a].x, nodes[a].y);
          ctx.lineTo(nodes[b].x, nodes[b].y);
          ctx.stroke();
        }
    ctx.restore();

    /* winning-line glow */
    if (winLine) {
      const tc = getThemeColor();
      ctx.save();
      ctx.strokeStyle = tc;
      ctx.lineWidth   = W * 0.025;
      ctx.lineCap     = 'round';
      ctx.shadowColor = tc;
      ctx.shadowBlur  = W * 0.05;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(nodes[winLine[0]].x, nodes[winLine[0]].y);
      ctx.lineTo(nodes[winLine[1]].x, nodes[winLine[1]].y);
      ctx.lineTo(nodes[winLine[2]].x, nodes[winLine[2]].y);
      ctx.stroke();
      ctx.restore();
    }

    /* valid-move highlights (movement phase) */
    if (S.phase === 'movement' && S.selected !== null) {
      for (const idx of validMoves(S.selected)) {
        ctx.beginPath();
        ctx.arc(nodes[idx].x, nodes[idx].y, W * 0.046, 0, Math.PI*2);
        ctx.fillStyle   = 'rgba(200,169,110,0.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,169,110,0.55)';
        ctx.lineWidth   = W * 0.007;
        ctx.stroke();
      }
    }

    /* nodes */
    for (const { x, y } of nodes) {
      ctx.beginPath();
      ctx.arc(x, y, W * 0.03, 0, Math.PI*2);
      ctx.fillStyle   = '#1e1a13';
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,169,110,0.65)';
      ctx.lineWidth   = W * 0.006;
      ctx.stroke();
    }
  }

  function getThemeColor() {
    return getComputedStyle(document.body).getPropertyValue('--t-primary').trim() || '#3a7a3e';
  }

  /* ─── PIECE SVG ───────────────────────────────────────────── */
  function stoneSVG(sz) {
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sg${sz}" cx="37%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#888"/>
          <stop offset="55%" stop-color="#333"/>
          <stop offset="100%" stop-color="#111"/>
        </radialGradient>
        <filter id="sf${sz}"><feDropShadow dx="1" dy="2.5" stdDeviation="2.5" flood-color="rgba(0,0,0,0.75)"/></filter>
      </defs>
      <circle cx="22" cy="22" r="19" fill="url(#sg${sz})" filter="url(#sf${sz})" stroke="#0a0a0a" stroke-width="0.5"/>
      <ellipse cx="16" cy="15" rx="4.5" ry="2.5" fill="rgba(255,255,255,0.13)" transform="rotate(-25,16,15)"/>
      <ellipse cx="28" cy="28" rx="3" ry="1.5" fill="rgba(0,0,0,0.2)" transform="rotate(-25,28,28)"/>
    </svg>`;
  }

  function stickSVG(sz) {
    const w = Math.round(sz * 0.46);
    return `<svg width="${w}" height="${sz}" viewBox="0 0 20 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wg${sz}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#3a1205"/>
          <stop offset="30%"  stop-color="#c86828"/>
          <stop offset="55%"  stop-color="#a05018"/>
          <stop offset="80%"  stop-color="#c86828"/>
          <stop offset="100%" stop-color="#3a1205"/>
        </linearGradient>
        <filter id="wf${sz}"><feDropShadow dx="1.5" dy="2" stdDeviation="2" flood-color="rgba(50,15,0,0.65)"/></filter>
      </defs>
      <rect x="5" y="1" width="10" height="42" rx="3.5" fill="url(#wg${sz})" filter="url(#wf${sz})"/>
      <line x1="7" y1="10" x2="13" y2="10" stroke="rgba(255,200,100,0.15)" stroke-width="1"/>
      <line x1="7" y1="18" x2="13" y2="18" stroke="rgba(255,200,100,0.12)" stroke-width="1"/>
      <line x1="7" y1="26" x2="13" y2="26" stroke="rgba(255,200,100,0.12)" stroke-width="1"/>
      <line x1="7" y1="34" x2="13" y2="34" stroke="rgba(255,200,100,0.10)" stroke-width="1"/>
    </svg>`;
  }

  /* ─── RENDER PIECES ──────────────────────────────────────── */
  const pieceEls = {};

  function renderPieces() {
    piecesLayer.innerHTML = '';
    Object.keys(pieceEls).forEach(k => delete pieceEls[k]);

    const sz = canvas.width * 0.18;
    for (let i = 0; i < 9; i++) {
      if (!S.board[i]) continue;
      const p  = S.board[i];
      const el = document.createElement('div');
      el.className   = 'piece';
      el.dataset.node   = i;
      el.dataset.player = p;
      el.innerHTML   = p === 1 ? stoneSVG(sz) : stickSVG(sz);
      el.style.left  = nodes[i].x + 'px';
      el.style.top   = nodes[i].y + 'px';
      piecesLayer.appendChild(el);
      pieceEls[i] = el;
      bindDrag(el, p);
    }
  }

  function movePieceEl(el, idx, animate) {
    el.style.transition = animate
      ? 'left 0.24s cubic-bezier(0.34,1.56,0.64,1), top 0.24s cubic-bezier(0.34,1.56,0.64,1)'
      : 'none';
    el.style.left = nodes[idx].x + 'px';
    el.style.top  = nodes[idx].y + 'px';
    el.dataset.node = idx;
  }

  /* ─── DRAG & DROP ────────────────────────────────────────── */
  let drag = null;

  function bindDrag(el, player) {
    function start(e) {
      if (S.phase !== 'movement' || S.aiThinking) return;
      if (player !== S.cur) {
        flash(el); return;
      }
      if (S.aiOn && player === 2) return;
      e.preventDefault();

      const nodeIdx = +el.dataset.node;
      const pos     = evPos(e);
      const bRect   = piecesLayer.getBoundingClientRect();

      drag = {
        el,
        origin: nodeIdx,
        ox: pos.x - bRect.left - nodes[nodeIdx].x,
        oy: pos.y - bRect.top  - nodes[nodeIdx].y,
      };
      el.classList.add('dragging');
      el.style.transition = 'none';
      S.selected = nodeIdx;
      drawBoard();

      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, { passive:false });
      document.addEventListener('mouseup',   end);
      document.addEventListener('touchend',  end);
    }

    function move(e) {
      if (!drag) return;
      e.preventDefault();
      const pos   = evPos(e);
      const bRect = piecesLayer.getBoundingClientRect();
      drag.el.style.left = (pos.x - bRect.left - drag.ox) + 'px';
      drag.el.style.top  = (pos.y - bRect.top  - drag.oy) + 'px';
    }

    function end(e) {
      if (!drag) return;
      const pos    = evPos(e.changedTouches ? e : e);
      const bRect  = piecesLayer.getBoundingClientRect();
      const dropX  = pos.x - bRect.left;
      const dropY  = pos.y - bRect.top;
      const target = nearestNode(dropX, dropY);
      const ok     = target !== null && validMoves(drag.origin).includes(target);

      if (ok) {
        drag.el.classList.remove('dragging');
        drag = null;
        removeListeners(move, end);
        doMove(drag ? drag.origin : target, target); // drag already null
        // re-call correctly:
      } else {
        flash(drag.el);
        movePieceEl(drag.el, drag.origin, true);
        drag.el.classList.remove('dragging');
        S.selected = null;
        drawBoard();
        drag = null;
        removeListeners(move, end);
      }
    }

    el.addEventListener('mousedown',  start);
    el.addEventListener('touchstart', start, { passive:false });
  }

  /* fix: end handler had a bug — redo properly */
  function bindDrag(el, player) {
    let localDrag = null;

    function start(e) {
      if (S.phase !== 'movement' || S.aiThinking) return;
      if (player !== S.cur) { flash(el); return; }
      if (S.aiOn && player === 2) return;
      e.preventDefault();

      const nIdx  = +el.dataset.node;
      const pos   = evPos(e);
      const bRect = piecesLayer.getBoundingClientRect();
      localDrag   = { origin: nIdx, ox: pos.x - bRect.left - nodes[nIdx].x, oy: pos.y - bRect.top - nodes[nIdx].y };

      el.classList.add('dragging');
      el.style.transition = 'none';
      S.selected = nIdx;
      drawBoard();

      function move(e) {
        e.preventDefault();
        const p = evPos(e), b = piecesLayer.getBoundingClientRect();
        el.style.left = (p.x - b.left - localDrag.ox) + 'px';
        el.style.top  = (p.y - b.top  - localDrag.oy) + 'px';
      }

      function end(e) {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('mouseup',   end);
        document.removeEventListener('touchend',  end);
        el.classList.remove('dragging');

        const p      = evPos(e.changedTouches ? e : e);
        const b      = piecesLayer.getBoundingClientRect();
        const target = nearestNode(p.x - b.left, p.y - b.top);
        const vms    = validMoves(localDrag.origin);
        const ok     = target !== null && vms.includes(target);

        if (ok) {
          doMove(localDrag.origin, target);
        } else {
          flash(el);
          movePieceEl(el, localDrag.origin, true);
          S.selected = null;
          drawBoard();
        }
        localDrag = null;
      }

      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, { passive:false });
      document.addEventListener('mouseup',   end);
      document.addEventListener('touchend',  end);
    }

    el.addEventListener('mousedown',  start);
    el.addEventListener('touchstart', start, { passive:false });
  }

  function flash(el) {
    el.classList.remove('invalid-move');
    void el.offsetWidth;
    el.classList.add('invalid-move');
    setTimeout(() => el.classList.remove('invalid-move'), 380);
  }

  function evPos(e) {
    if (e.touches       && e.touches.length)        return { x:e.touches[0].clientX,        y:e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x:e.changedTouches[0].clientX, y:e.changedTouches[0].clientY };
    return { x:e.clientX, y:e.clientY };
  }

  function nearestNode(x, y) {
    let best = null, bd = Infinity;
    const thresh = canvas.width * 0.19;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - x, nodes[i].y - y);
      if (d < bd && d < thresh) { bd = d; best = i; }
    }
    return best;
  }

  /* ─── PLACEMENT (canvas click) ───────────────────────────── */
  canvas.addEventListener('click', e => {
    if (S.phase !== 'placement' || (S.aiOn && S.cur === 2) || S.aiThinking) return;
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const n  = nearestNode((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
    if (n !== null && !S.board[n]) placePiece(n, S.cur);
  });

  canvas.addEventListener('touchend', e => {
    if (S.phase !== 'placement' || (S.aiOn && S.cur === 2) || S.aiThinking) return;
    e.preventDefault();
    const t  = e.changedTouches[0];
    const r  = canvas.getBoundingClientRect();
    const n  = nearestNode((t.clientX - r.left) * (canvas.width/r.width), (t.clientY - r.top) * (canvas.height/r.height));
    if (n !== null && !S.board[n]) placePiece(n, S.cur);
  }, { passive:false });

  /* ─── GAME LOGIC ─────────────────────────────────────────── */
  function placePiece(idx, player) {
    S.board[idx] = player;
    S.placed[player]++;
    renderPieces();
    drawBoard();

    const wl = checkWin(player);
    if (wl) { setTimeout(() => endRound(player, wl), 280); return; }

    S.cur = opp(player);
    updateUI();

    if (S.placed[1] === PIECE_LIMIT && S.placed[2] === PIECE_LIMIT) {
      S.phase = 'movement';
      setPhaseBadge('MOVEMENT', true);
      setStatus(`${pname(S.cur)}'s turn — drag a piece`);
    } else {
      setStatus(`${pname(S.cur)}'s turn — place a piece`);
    }

    if (S.aiOn && S.cur === 2) scheduleAI();
  }

  function doMove(from, to) {
    const player  = S.board[from];
    S.board[to]   = player;
    S.board[from] = null;
    S.selected    = null;

    /* move DOM element */
    const el = pieceEls[from];
    if (el) {
      delete pieceEls[from];
      pieceEls[to] = el;
      el.dataset.node = to;
      movePieceEl(el, to, true);
    }
    drawBoard();

    const wl = checkWin(player);
    if (wl) { setTimeout(() => endRound(player, wl), 350); return; }

    S.cur = opp(player);
    updateUI();
    setStatus(`${pname(S.cur)}'s turn — drag a piece`);
    if (S.aiOn && S.cur === 2) scheduleAI();
  }

  function validMoves(idx) {
    return ADJ[idx].filter(nb => !S.board[nb]);
  }

  function checkWin(player) {
    for (const line of WIN_LINES)
      if (line.every(i => S.board[i] === player)) return line;
    return null;
  }

  /* ─── ROUND END ──────────────────────────────────────────── */
  function endRound(winner, winLine) {
    S.phase = 'idle';
    S.scores[winner]++;
    S.lastWinner = winner;

    updateScoreboard();
    drawBoard(winLine);
    for (const idx of winLine)
      if (pieceEls[idx]) pieceEls[idx].classList.add('winner-piece');

    /* check match win */
    if (S.scores[winner] >= MATCH_WIN) {
      setTimeout(() => {
        matchTitle.textContent = `${pname(winner)} wins the Match!`;
        matchSub.textContent   = `${MATCH_WIN} rounds won — Champion! 🏆`;
        matchOverlay.classList.remove('hidden');
      }, 700);
      return;
    }

    winPieceIcon.textContent = winner === 1 ? '🪨' : '🪵';
    winTitle.textContent     = `${pname(winner)} Wins!`;
    winSub.textContent       = `Score — Stone ${S.scores[1]}  ·  Stick ${S.scores[2]}`;
    winOverlay.classList.remove('hidden');
  }

  /* ─── AI ─────────────────────────────────────────────────── */
  function scheduleAI() {
    if (S.aiThinking) return;
    S.aiThinking = true;
    setTimeout(() => {
      if (S.aiOn && S.cur === 2) aiTurn();
      S.aiThinking = false;
    }, 550 + Math.random() * 350);
  }

  function aiTurn() {
    if (S.phase === 'placement') {
      const move = aiPickPlacement();
      if (move !== null) placePiece(move, 2);

    } else if (S.phase === 'movement') {
      const mv = aiPickMove();
      if (mv) doMove(mv.from, mv.to);
    }
  }

  function aiPickPlacement() {
    /* 1. win immediately */
    for (let i = 0; i < 9; i++) {
      if (S.board[i]) continue;
      S.board[i] = 2;
      const w = checkWin(2);
      S.board[i] = null;
      if (w) return i;
    }
    /* 2. block player */
    for (let i = 0; i < 9; i++) {
      if (S.board[i]) continue;
      S.board[i] = 1;
      const w = checkWin(1);
      S.board[i] = null;
      if (w) return i;
    }
    /* 3. prefer center, then corners, then edges */
    const pref = [4, 0, 2, 6, 8, 1, 3, 5, 7];
    for (const p of pref) if (!S.board[p]) return p;
    return null;
  }

  function aiPickMove() {
    const aiPieces = S.board.map((v,i) => v===2 ? i : -1).filter(i => i>=0);
    /* 1. try to win */
    for (const from of aiPieces)
      for (const to of validMoves(from)) {
        S.board[to] = 2; S.board[from] = null;
        const w = checkWin(2);
        S.board[from] = 2; S.board[to] = null;
        if (w) return { from, to };
      }
    /* 2. block */
    const p1 = S.board.map((v,i) => v===1 ? i : -1).filter(i => i>=0);
    for (const pi of p1)
      for (const to of validMoves(pi)) {
        /* pretend player1 moves there, block it */
        for (const from of aiPieces)
          if (validMoves(from).includes(to)) return { from, to };
      }
    /* 3. prefer moving toward center */
    let best = null, bestScore = -Infinity;
    for (const from of aiPieces)
      for (const to of validMoves(from)) {
        const sc = [4,0,2,6,8].indexOf(to) >= 0 ? 2 : 0;
        if (sc > bestScore) { bestScore = sc; best = { from, to }; }
      }
    return best;
  }

  /* ─── COIN TOSS ──────────────────────────────────────────── */
  btnToss.addEventListener('click', () => {
    if (S.phase !== 'idle') return;

    /* Reset coin faces — front=Stone, back=Stick */
    coinFront.textContent = '🪨';
    coinFrontLabel.textContent = 'STONE';
    coinBack.textContent  = '🪵';
    coinBackLabel.textContent  = 'STICK';

    tossResult.classList.add('hidden');
    coin.classList.remove('spinning');
    void coin.offsetWidth;
    coin.classList.add('spinning');
    coinOverlay.classList.remove('hidden');

    setTimeout(() => {
      const winner = Math.random() < 0.5 ? 1 : 2;
      S.cur = winner;

      /* Update the winning face so coin shows winner when it lands */
      if (winner === 1) {
        /* Stone wins — front face shows (even rotations land on front) */
        coinFront.textContent      = '🪨';
        coinFrontLabel.textContent = 'STONE';
      } else {
        /* Stick wins — back face shows (odd rotations land on back) */
        coinBack.textContent      = '🪵';
        coinBackLabel.textContent = 'STICK';
      }

      /* Small line below coin: just "Starts First!" for clarity */
      tossResult.textContent = `${pname(winner)} goes first!`;
      tossResult.classList.remove('hidden');

      setTimeout(() => {
        coinOverlay.classList.add('hidden');
        resetBoard();
        startPlacement();
      }, 1500);
    }, 1000);
  });

  /* ─── NEXT ROUND ─────────────────────────────────────────── */
  btnNext.addEventListener('click', () => {
    winOverlay.classList.add('hidden');
    /* ── FIX: last winner goes first — including AI ── */
    S.cur = S.lastWinner;
    resetBoard();
    startPlacement();
  });

  /* ─── NEW MATCH ──────────────────────────────────────────── */
  btnNewMatch.addEventListener('click', () => {
    matchOverlay.classList.add('hidden');
    S.scores  = { 1:0, 2:0 };
    S.lastWinner = null;
    S.cur     = 1;
    resetBoard();
    updateScoreboard();
    updatePips();
    phaseBadge.classList.add('hidden');
    setStatus('Press Toss Coin to begin!');
    scoreP1.classList.remove('active-turn');
    scoreP2.classList.remove('active-turn');
    drawBoard();
    renderPieces();
  });

  /* ─── RESET BUTTON ───────────────────────────────────────── */
  btnReset.addEventListener('click', () => {
    S.scores  = { 1:0, 2:0 };
    S.lastWinner = null;
    S.phase   = 'idle';
    S.aiThinking = false;
    winOverlay.classList.add('hidden');
    matchOverlay.classList.add('hidden');
    coinOverlay.classList.add('hidden');
    phaseBadge.classList.add('hidden');
    resetBoard();
    updateScoreboard();
    updatePips();
    updateUI();
    drawBoard();
    renderPieces();
    setStatus('Press Toss Coin to begin!');
    scoreP1.classList.remove('active-turn');
    scoreP2.classList.remove('active-turn');
  });

  /* ─── AI TOGGLE ──────────────────────────────────────────── */
  btnAi.addEventListener('click', () => {
    S.aiOn = !S.aiOn;
    btnAi.textContent = `🤖 AI: ${S.aiOn ? 'ON' : 'OFF'}`;
    btnAi.classList.toggle('ai-on', S.aiOn);
  });

  /* ─── HELP BUTTON ────────────────────────────────────────── */
  btnHelp.addEventListener('click', () => {
    helpOverlay.classList.remove('hidden');
  });
  btnHelpClose.addEventListener('click', () => {
    helpOverlay.classList.add('hidden');
  });
  helpOverlay.addEventListener('click', e => {
    if (e.target === helpOverlay) helpOverlay.classList.add('hidden');
  });

  /* ─── THEMES ─────────────────────────────────────────────── */
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.dataset.theme = btn.dataset.theme;
      drawBoard();
    });
  });

  /* ─── HELPERS ────────────────────────────────────────────── */
  function opp(p)    { return p === 1 ? 2 : 1; }
  function pname(p)  { return p === 1 ? 'Stone' : 'Stick'; }
  function setStatus(m) { statusMsg.textContent = m; }

  function setPhaseBadge(text, isMove) {
    phaseBadge.textContent = text;
    phaseBadge.classList.remove('hidden','move-phase');
    if (isMove) phaseBadge.classList.add('move-phase');
  }

  function updateUI() {
    scoreP1.classList.toggle('active-turn', S.cur === 1);
    scoreP2.classList.toggle('active-turn', S.cur === 2);
  }

  function updateScoreboard() {
    scoreStone.textContent = S.scores[1];
    scoreStick.textContent = S.scores[2];
    updatePips();
  }

  function updatePips() {
    function buildPips(container, count) {
      container.innerHTML = '';
      for (let i = 0; i < MATCH_WIN; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip' + (i < count ? ' filled' : '');
        container.appendChild(pip);
      }
    }
    buildPips(pipsStone, S.scores[1]);
    buildPips(pipsStick, S.scores[2]);
  }

  function resetBoard() {
    S.board      = Array(9).fill(null);
    S.placed     = { 1:0, 2:0 };
    S.selected   = null;
    S.aiThinking = false;
    S.phase      = 'idle';
  }

  function startPlacement() {
    S.phase = 'placement';
    setPhaseBadge('PLACEMENT', false);
    updateUI();
    setStatus(`${pname(S.cur)}'s turn — place a piece`);
    drawBoard();
    renderPieces();
    /* ── FIX: if AI starts (winner of last round was AI), trigger AI ── */
    if (S.aiOn && S.cur === 2) scheduleAI();
  }

  /* ─── INIT ───────────────────────────────────────────────── */
  function init() {
    document.body.dataset.theme = 'forest';
    updatePips();
    resizeBoard();
    setStatus('Press Toss Coin to begin!');
  }

  init();

})();
