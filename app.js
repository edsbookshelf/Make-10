// app.js
(() => {
  "use strict";

  /**
   * v0.1 rules recap:
   * - 12 cards = 6 expressions + 6 "10" results
   * - Match = expression that equals 10 + a "10" card
   * - No expression-expression matches yet
   */

  const boardEl = document.getElementById("board");
  const matchesFoundEl = document.getElementById("matchesFound");
  const totalPairsEl = document.getElementById("totalPairs");
  const streakEl = document.getElementById("streak");
  const movesEl = document.getElementById("moves");
  const restartBtn = document.getElementById("restartBtn");
  const soundToggle = document.getElementById("soundToggle");

  const modalEl = document.getElementById("modal");
  const finalMovesEl = document.getElementById("finalMoves");
  const bestStreakEl = document.getElementById("bestStreak");
  const playAgainBtn = document.getElementById("playAgainBtn");

  // ---------- Simple sound (no assets) ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!soundToggle.checked) return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function beep(type) {
    const ctx = ensureAudio();
    if (!ctx) return;

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    const now = ctx.currentTime;
    const dur = 0.09;

    // Pleasant-ish tones
    const freq = type === "good" ? 660 : 220;

    o.type = "sine";
    o.frequency.setValueAtTime(freq, now);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.10, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    o.connect(g);
    g.connect(ctx.destination);

    o.start(now);
    o.stop(now + dur);
  }

  // ---------- Game state ----------
  const expressions = [
    { text: "1 + 9", value: 10 },
    { text: "2 + 8", value: 10 },
    { text: "3 + 7", value: 10 },
    { text: "4 + 6", value: 10 },
    { text: "5 + 5", value: 10 },
    { text: "8 + 2", value: 10 }, // reinforces 2+8
  ];

  const TOTAL_PAIRS = expressions.length; // 6
  totalPairsEl.textContent = String(TOTAL_PAIRS);

  /** @type {Array<{id:string, type:"expr"|"ten", text:string, value:number, matched:boolean}>} */
  let deck = [];

  /** @type {string[]} */
  let revealedIds = [];

  let lock = false;
  let matchesFound = 0;
  let streak = 0;
  let bestStreak = 0;
  let moves = 0;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildDeck() {
    /** Build 6 expr cards + 6 ten cards */
    const cards = [];
    expressions.forEach((ex, idx) => {
      cards.push({
        id: `expr-${idx}-${cryptoRand()}`,
        type: "expr",
        text: ex.text,
        value: ex.value,
        matched: false,
      });
      cards.push({
        id: `ten-${idx}-${cryptoRand()}`,
        type: "ten",
        text: "10",
        value: 10,
        matched: false,
      });
    });
    return shuffle(cards);
  }

  function cryptoRand() {
    // Stable enough uniqueness without libs.
    // If crypto not available, fallback.
    try {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0].toString(16);
    } catch {
      return Math.random().toString(16).slice(2);
    }
  }

  function resetState() {
    deck = buildDeck();
    revealedIds = [];
    lock = false;
    matchesFound = 0;
    streak = 0;
    bestStreak = 0;
    moves = 0;
    updateHud();
    hideModal();
  }

  function updateHud() {
    matchesFoundEl.textContent = String(matchesFound);
    streakEl.textContent = String(streak);
    movesEl.textContent = String(moves);
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    deck.forEach((card) => {
      const btn = document.createElement("button");
      btn.className = "card";
      btn.type = "button";
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-label", "Card");
      btn.dataset.id = card.id;

      // Back face (hidden)
      const back = document.createElement("div");
      back.className = "face back";
      back.textContent = "★";

      // Front face (revealed)
      const front = document.createElement("div");
      front.className = "face front";

      const text = document.createElement("div");
      text.className = "text";
      text.textContent = card.text;

      // Optional subtle hint line (keeps it kid-friendly without reading burden)
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = card.type === "expr" ? "Makes 10?" : "Ten";

      front.appendChild(text);
      front.appendChild(hint);

      btn.appendChild(back);
      btn.appendChild(front);

      btn.addEventListener("click", () => onCardClick(card.id));
      boardEl.appendChild(btn);
    });
  }

  function getCardById(id) {
    const c = deck.find((x) => x.id === id);
    if (!c) throw new Error("Card not found: " + id);
    return c;
  }

  function getCardEl(id) {
    return boardEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  }

  function setRevealed(id, revealed) {
    const el = getCardEl(id);
    if (!el) return;
    if (revealed) el.classList.add("revealed");
    else el.classList.remove("revealed");
  }

  function setMatched(id) {
    const el = getCardEl(id);
    if (!el) return;
    el.classList.add("matched");
    el.classList.remove("revealed");
    el.disabled = true;
  }

  function animate(id, cls) {
    const el = getCardEl(id);
    if (!el) return;
    el.classList.remove("success", "wrong");
    // Force reflow so animation restarts
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function onCardClick(id) {
    if (lock) return;

    const card = getCardById(id);
    if (card.matched) return;
    if (revealedIds.includes(id)) return;

    // First interaction in iOS Safari often requires a gesture to start audio; this is it.
    ensureAudio();

    revealedIds.push(id);
    setRevealed(id, true);

    if (revealedIds.length === 2) {
      moves += 1;
      updateHud();
      evaluatePair(revealedIds[0], revealedIds[1]);
    }
  }

  function evaluatePair(idA, idB) {
    lock = true;

    const a = getCardById(idA);
    const b = getCardById(idB);

    const isMatch =
      (a.type === "expr" && b.type === "ten" && a.value === 10) ||
      (b.type === "expr" && a.type === "ten" && b.value === 10);

    if (isMatch) {
      // Success
      beep("good");
      animate(idA, "success");
      animate(idB, "success");

      a.matched = true;
      b.matched = true;

      matchesFound += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      updateHud();

      window.setTimeout(() => {
        setMatched(idA);
        setMatched(idB);
        revealedIds = [];
        lock = false;

        if (matchesFound === TOTAL_PAIRS) {
          endRound();
        }
      }, 420);
    } else {
      // Wrong
      beep("bad");
      animate(idA, "wrong");
      animate(idB, "wrong");

      streak = 0;
      updateHud();

      window.setTimeout(() => {
        setRevealed(idA, false);
        setRevealed(idB, false);
        revealedIds = [];
        lock = false;
      }, 700);
    }
  }

  function endRound() {
    finalMovesEl.textContent = String(moves);
    bestStreakEl.textContent = String(bestStreak);
    showModal();
  }

  function showModal() {
    modalEl.classList.remove("hidden");
    modalEl.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    modalEl.classList.add("hidden");
    modalEl.setAttribute("aria-hidden", "true");
  }

  // ---------- Controls ----------
  restartBtn.addEventListener("click", () => {
    resetState();
    renderBoard();
  });

  playAgainBtn.addEventListener("click", () => {
    resetState();
    renderBoard();
  });

  // Optional: clicking outside modal card closes it (kid-friendly)
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) {
      hideModal();
    }
  });

  // ---------- Boot ----------
  resetState();
  renderBoard();
})();
