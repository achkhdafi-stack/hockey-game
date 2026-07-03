// ── roundRect polyfill (Chrome <99, Firefox <112, older Safari) ──
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        r = Math.min(+r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
        this.beginPath();
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.arcTo(x + w, y, x + w, y + r, r);
        this.lineTo(x + w, y + h - r);
        this.arcTo(x + w, y + h, x + w - r, y + h, r);
        this.lineTo(x + r, y + h);
        this.arcTo(x, y + h, x, y + h - r, r);
        this.lineTo(x, y + r);
        this.arcTo(x, y, x + r, y, r);
        this.closePath();
    };
}

const CV = document.getElementById("c");
const G = CV.getContext("2d");
CV.width = 760;
CV.height = 520;
const W = 760, H = 520;

// ── DOM refs (safe: getElementById is fine at top level) ──
const readyEl    = document.getElementById("ready-screen");
const gameoverEl = document.getElementById("gameover-screen");
const goWho      = document.getElementById("go-who");
const goFinal    = document.getElementById("go-final");
const goWinsEl   = document.getElementById("go-wins");
const menuEl     = document.getElementById("menu-screen");
const gameRootEl = document.getElementById("game-root");
const labelLeftEl  = document.getElementById("label-left");
const labelRightEl = document.getElementById("label-right");
const statsModalEl = document.getElementById("stats-modal");
const bracketEl    = document.getElementById("tournament-bracket");
const btnNextRound = document.getElementById("btn-next-round");
const pauseOverlay   = document.getElementById("pause-overlay");
const pauseSoundBtn  = document.getElementById("pause-sound");
const muteBtn        = document.getElementById("mute-btn");
const DOM = {
    scoreP:    document.getElementById("score-p"),
    scoreCPU:  document.getElementById("score-cpu"),
    pStreak:   document.getElementById("stat-p-streak"),
    pSpeed:    document.getElementById("stat-p-speed"),
    pPower:    document.getElementById("stat-p-power"),
    cpuStreak: document.getElementById("stat-cpu-streak"),
    cpuSpeed:  document.getElementById("stat-cpu-speed"),
    cpuPower:  document.getElementById("stat-cpu-power")
};

// ── Small helpers (SVG icons + mobile layout) ──
let tick = 0;
let shakeAmt = 0;
let shakeX = 0;
let shakeY = 0;
let state = "menu"; // "menu" | "play" | "goal" | "paused" | "over"
let goalFlash = 0;
let goalWho = "p";
let goalMsgScale = 0;
let speedUpTimer = 0;
let speedUpMsg = "";
let puckSpeedMult = 1.0;
let lastSpeedUpAt = 0;

function iconHTML(id, extraClass = "") {
    const cls = ["icon", extraClass].filter(Boolean).join(" ");
    return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"></use></svg>`;
}
function setButtonIconText(btn, iconId, text) {
    if (!btn) return;
    btn.innerHTML = `${iconHTML(iconId)} ${text}`;
}
function setSvgUse(svgEl, iconId) {
    if (!svgEl) return;
    const use = svgEl.querySelector("use");
    if (use) use.setAttribute("href", `#${iconId}`);
}
function updateMobileClasses() {
    const isMobile = matchMedia("(hover: none) and (pointer: coarse)").matches;
    document.body.classList.toggle("is-mobile", isMobile);
    document.body.classList.toggle("is-portrait", window.innerHeight >= window.innerWidth);
}
window.addEventListener("resize", updateMobileClasses, { passive: true });
window.addEventListener("orientationchange", updateMobileClasses, { passive: true });
updateMobileClasses();

// ── Mode + Colors ──
let gameMode = "1p";
let P1_COLOR = "#00d4ff";
let P2_COLOR = "#ff2d55";
const COLOR_PALETTE = ["#00d4ff","#ff2d55","#ffc940","#22c55e","#a855f7","#fb923c","#ec4899","#ffffff"];

// ── Theme ──
const THEMES = [
    { id: "cyber",   label: "CYBER NEON",   icon: "i-bolt" },
    { id: "lava",    label: "LAVA ARENA",   icon: "i-flame" },
    { id: "ice",     label: "ICE WORLD",    icon: "i-snow" },
    { id: "nature",  label: "NATURE ARENA", icon: "i-leaf" },
    { id: "retro",   label: "RETRO ARCADE", icon: "i-gamepad" }
];
let currentTheme = "cyber";
let THEME_COLORS = { bg:"#04060a", tableA:"#0a1a2e", tableB:"#071422", rail:"#1a4a6e", accent:"#00d4ff" };
function readThemeColors() {
    const cs = getComputedStyle(document.body);
    THEME_COLORS = {
        bg:     cs.getPropertyValue("--bg").trim()      || "#04060a",
        tableA: cs.getPropertyValue("--table-a").trim() || "#0a1a2e",
        tableB: cs.getPropertyValue("--table-b").trim() || "#071422",
        rail:   cs.getPropertyValue("--rail").trim()    || "#1a4a6e",
        accent: cs.getPropertyValue("--accent").trim()  || "#00d4ff"
    };
}
function setTheme(id) {
    currentTheme = id;
    document.body.setAttribute("data-theme", id);
    document.querySelectorAll(".theme-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.theme === id)
    );
    readThemeColors();
}

// ── Paddle Shape ──
const PADDLE_SHAPES = [
    { id: "circle",   label: "CIRCLE",   icon: "●" },
    { id: "hexagon",  label: "HEXAGON",  icon: "⬡" },
    { id: "triangle", label: "TRIANGLE", icon: "▲" },
    { id: "diamond",  label: "DIAMOND",  icon: "◆" }
];
let paddleShape   = "circle";
let glowIntensity = 1.0;
const LS_PREFS_KEY = "airhockey_prefs_v1";
function loadPrefs() {
    try {
        const raw = localStorage.getItem(LS_PREFS_KEY);
        if (raw) { const p = JSON.parse(raw); if (p.shape) paddleShape = p.shape; if (p.glow) glowIntensity = p.glow; }
    } catch(e) {}
}
function savePrefs() {
    try { localStorage.setItem(LS_PREFS_KEY, JSON.stringify({ shape: paddleShape, glow: glowIntensity })); } catch(e) {}
}

// ── Difficulty ──
let CPU_SPEED = 4.6, CPU_REACT = 0.62, CPU_ERROR_Y = 26, CPU_MISTAKE_CHANCE = 0.018, CPU_MISTAKE_DUR = 42;
const DIFFICULTY_PRESETS = {
    easy:   { speed:5,  react:0.4,  errY:50, mistake:0.05,  mistakeDur:60 },
    normal: { speed:8,  react:0.62, errY:26, mistake:0.018, mistakeDur:42 },
    hard:   { speed:12, react:0.8,  errY:14, mistake:0.006, mistakeDur:24 },
    insane: { speed:16, react:0.95, errY:5,  mistake:0.001, mistakeDur:10 }
};
let difficulty = "normal";
function applyDifficulty(d) {
    const p = DIFFICULTY_PRESETS[d] || DIFFICULTY_PRESETS.normal;
    CPU_SPEED = p.speed; CPU_REACT = p.react; CPU_ERROR_Y = p.errY;
    CPU_MISTAKE_CHANCE = p.mistake; CPU_MISTAKE_DUR = p.mistakeDur;
}

// ── Power-ups toggle ──
let powerUpsEnabled = true;

// ── Daily Challenge ──
const DAILY_CHALLENGES = [
    { text: "Win without using any Power-Ups",       key: "noPowerUp",   reward: "GOLDEN THEME UNLOCKED" },
    { text: "Score 5 goals in a row (win streak)",   key: "streak5goals",reward: "PERFECT AIM BADGE" },
    { text: "Win the match 7–0",                     key: "shutout",     reward: "ICE COLD BADGE" },
    { text: "Win in under 3 minutes",                key: "speedRun",    reward: "LIGHTNING BADGE" },
    { text: "Hit the puck 50+ times in one match",   key: "rally50",     reward: "RALLY KING BADGE" },
    { text: "Comeback win (down by 3+ goals)",       key: "comeback3",   reward: "COMEBACK FIRE BADGE" },
    { text: "Win with INSANE difficulty",            key: "insaneWin",   reward: "INSANE MODE BADGE" }
];
const LS_DC_KEY = "airhockey_dc_v1";
let dailyChallenge = null, dailyChallengeCompleted = false;
function loadDailyChallenge() {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const idx = (today.getDate() + today.getMonth() * 3) % DAILY_CHALLENGES.length;
    dailyChallenge = { ...DAILY_CHALLENGES[idx], dateKey };
    try {
        const raw = localStorage.getItem(LS_DC_KEY);
        if (raw) { const s = JSON.parse(raw); if (s.dateKey === dateKey && s.completed) dailyChallengeCompleted = true; }
    } catch(e) {}
    const dcText   = document.getElementById("dc-text");
    const dcReward = document.getElementById("dc-reward");
    if (dcText)   dcText.textContent = dailyChallenge.text;
    if (dcReward) {
        dcReward.textContent = dailyChallengeCompleted ? "COMPLETED: " + dailyChallenge.reward : dailyChallenge.reward;
        dcReward.style.color = dailyChallengeCompleted ? "#22c55e" : "";
    }
}
function checkDailyChallenge(key) {
    if (!dailyChallenge || dailyChallenge.key !== key || dailyChallengeCompleted) return;
    dailyChallengeCompleted = true;
    try { localStorage.setItem(LS_DC_KEY, JSON.stringify({ dateKey: dailyChallenge.dateKey, completed: true })); } catch(e) {}
    powerUpToastQueue.push({ text: "DAILY CHALLENGE COMPLETE! " + dailyChallenge.reward, col: "#ffc940" });
    const dcReward = document.getElementById("dc-reward");
    if (dcReward) { dcReward.textContent = "COMPLETED: " + dailyChallenge.reward; dcReward.style.color = "#22c55e"; }
}

// ── Tournament ──
const TOURNAMENT_ROUNDS = ["ROUND 1", "SEMI FINAL", "FINAL"];
let tournamentData = { active:false, round:0, results:[], wins:0, losses:0 };
function startTournament() {
    tournamentData = { active:true, round:0, results:[], wins:0, losses:0 };
    showBracket();
}
function showBracket() {
    if (!bracketEl) return;
    bracketEl.classList.remove("hidden");
    const rounds = document.getElementById("tb-rounds");
    rounds.innerHTML = TOURNAMENT_ROUNDS.map((name, i) => {
        const res = tournamentData.results[i];
        let cls = "tb-round", status = "—";
        if (res) { cls += res.won ? " tb-won" : " tb-lost"; status = res.won ? `WIN  ${res.playerScore}–${res.cpuScore}` : `LOSS  ${res.playerScore}–${res.cpuScore}`; }
        else if (i === tournamentData.round) { cls += " tb-current"; status = "▶ NOW"; }
        return `<div class="${cls}"><span class="tb-round-name">${name}</span><span class="tb-round-status">${status}</span></div>`;
    }).join("");
    const cont = document.getElementById("tb-continue");
    if (cont) cont.textContent = tournamentData.round > 0 ? "PLAY NEXT MATCH" : "START ROUND 1";
}
function onTournamentMatchEnd(playerWon, pScore, cpuScore) {
    tournamentData.results.push({ won:playerWon, playerScore:pScore, cpuScore:cpuScore });
    if (playerWon) tournamentData.wins++; else tournamentData.losses++;
    if (!playerWon) {
        tournamentData.active = false;
        setTimeout(() => {
            showBracket();
            const cont = document.getElementById("tb-continue");
            cont.textContent = "BACK TO MENU";
            cont.onclick = () => { bracketEl.classList.add("hidden"); backToMenu(); };
        }, 400);
        return;
    }
    tournamentData.round++;
    if (tournamentData.round >= TOURNAMENT_ROUNDS.length) {
        tournamentData.active = false;
        unlockAchievement("tournament_champ");
        setTimeout(() => {
            showBracket();
            const cont = document.getElementById("tb-continue");
            cont.textContent = "CHAMPION! BACK TO MENU";
            cont.onclick = () => { bracketEl.classList.add("hidden"); backToMenu(); };
        }, 400);
        return;
    }
    setTimeout(() => {
        showBracket();
        const cont = document.getElementById("tb-continue");
        cont.onclick = () => { bracketEl.classList.add("hidden"); gameoverEl.classList.remove("on","lose-state"); startGame(); };
    }, 400);
}

// ── Persistent stats & achievements ──
const LS_STATS_KEY = "airhockey_stats_v1";
const LS_ACHV_KEY  = "airhockey_achv_v1";
function loadLifetimeStats() {
    try { const raw = localStorage.getItem(LS_STATS_KEY); if (raw) return JSON.parse(raw); } catch(e) {}
    return { gamesPlayed:0, wins:0, totalGoals:0, bestWinStreak:0, fastestGoalMs:null, longestMatchMs:0, totalPlayTimeMs:0 };
}
let lifetime = loadLifetimeStats();
function saveLifetimeStats() {
    try { localStorage.setItem(LS_STATS_KEY, JSON.stringify(lifetime)); } catch(e) {}
}
const ACHIEVEMENTS = [
    { id:"first_win",         label:"First Win" },
    { id:"streak5",           label:"5 Win Streak" },
    { id:"speed_demon",       label:"Speed Demon" },
    { id:"no_damage",         label:"No Damage Match" },
    { id:"comeback",          label:"Comeback King" },
    { id:"tournament_champ",  label:"Tournament Champion" }
];
function loadAchievements() {
    try { const raw = localStorage.getItem(LS_ACHV_KEY); if (raw) return JSON.parse(raw); } catch(e) {}
    return {};
}
let unlockedAchv = loadAchievements();
let achvToastQueue = [], achvToastTimer = 0, achvToastText = "";
function unlockAchievement(id) {
    if (unlockedAchv[id]) return;
    unlockedAchv[id] = Date.now();
    try { localStorage.setItem(LS_ACHV_KEY, JSON.stringify(unlockedAchv)); } catch(e) {}
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) achvToastQueue.push(a.label);
}
function renderStats() {
    const grid = document.getElementById("stats-grid");
    if (!grid) return;
    const cards = [
        [lifetime.gamesPlayed, "Games Played"],
        [lifetime.wins, "Wins"],
        [lifetime.totalGoals, "Total Goals"],
        [lifetime.bestWinStreak, "Best Win Streak"],
        [lifetime.fastestGoalMs ? (lifetime.fastestGoalMs/1000).toFixed(1)+"s" : "—", "Fastest Goal"],
        [fmtDuration(lifetime.longestMatchMs), "Longest Match"],
        [fmtDuration(lifetime.totalPlayTimeMs), "Total Play Time"]
    ];
    grid.innerHTML = cards.map(([v,l]) => `<div class="stat-card"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
    const achvGrid = document.getElementById("achv-grid");
    if (achvGrid) achvGrid.innerHTML = ACHIEVEMENTS.map(a =>
        `<div class="achv-badge${unlockedAchv[a.id]?" unlocked":""}">${a.label}</div>`).join("");
}
function fmtDuration(ms) {
    if (!ms) return "0:00";
    const s = Math.floor(ms/1000), m = Math.floor(s/60), r = s%60;
    return `${m}:${r.toString().padStart(2,"0")}`;
}

// ── Match tracking ──
let matchStartTime = 0, lastGoalTime = 0, minScoreDiffForPlayer = 0;

// ── UI helpers ──
function buildSwatches(container, defaultColor, onPick) {
    container.innerHTML = "";
    COLOR_PALETTE.forEach(c => {
        const sw = document.createElement("div");
        sw.className = "swatch" + (c === defaultColor ? " selected" : "");
        sw.style.background = c; sw.style.color = c;
        sw.onclick = () => {
            [...container.children].forEach(ch => ch.classList.remove("selected"));
            sw.classList.add("selected"); onPick(c);
        };
        container.appendChild(sw);
    });
}
function setMode(m) {
    gameMode = m;
    document.getElementById("mode-1p").classList.toggle("active", m==="1p");
    document.getElementById("mode-2p").classList.toggle("active", m==="2p");
    document.getElementById("mode-tournament").classList.toggle("active", m==="tournament");
    document.getElementById("p2-color-label").textContent = m==="2p" ? "PLAYER 2 COLOR" : "CPU COLOR";
    document.getElementById("controls-hint").textContent  = m==="2p" ? "P1: W A S D  ·  P2: ARROW KEYS" : "MOUSE / TOUCH TO MOVE";
    const ds = document.getElementById("difficulty-section");
    if (ds) ds.style.display = m==="2p" ? "none" : "";
}
function applyColorsToDOM() {
    labelLeftEl.textContent  = gameMode === "2p" ? "P1" : "YOU";
    labelLeftEl.style.color  = P1_COLOR;
    labelRightEl.textContent = gameMode === "2p" ? "P2" : "CPU";
    labelRightEl.style.color = P2_COLOR;
    DOM.scoreP.style.color       = P1_COLOR;
    DOM.scoreP.style.textShadow  = `0 0 20px ${P1_COLOR}`;
    DOM.scoreCPU.style.color     = P2_COLOR;
    DOM.scoreCPU.style.textShadow= `0 0 20px ${P2_COLOR}`;
    // CSS vars for responsive inheritance
    document.documentElement.style.setProperty("--p1-col", P1_COLOR);
    document.documentElement.style.setProperty("--p2-col", P2_COLOR);
    // Pause score colors
    const psl = document.getElementById("pause-score-left");
    const psr = document.getElementById("pause-score-right");
    if (psl) psl.style.color = P1_COLOR;
    if (psr) psr.style.color = P2_COLOR;
}
function backToMenu() {
    state = "menu";
    if (confettiInterval) { clearInterval(confettiInterval); confettiInterval = null; }
    if (pauseOverlay) pauseOverlay.classList.remove("on");
    gameoverEl.classList.remove("on","lose-state");
    gameRootEl.classList.add("hidden-init");
    menuEl.classList.remove("hidden");
    document.body.classList.add("menu-open");
}
function setPaused(on) {
    if (on) {
        if (state !== "play") return;
        state = "paused";
        pauseOverlay.classList.add("on");
        pauseScoreLeft.textContent  = score.p;
        pauseScoreLeft.style.color  = P1_COLOR;
        pauseScoreRight.textContent = score.cpu;
        pauseScoreRight.style.color = P2_COLOR;
        renderPauseSoundButton();
    } else {
        if (state !== "paused") return;
        state = "play";
        pauseOverlay.classList.remove("on");
    }
}
function toggleMute() {
    muted = !muted;
    if (!muted) getAudio().resume();
    updateMuteLabel();
}
function renderPauseSoundButton() {
    if (!pauseSoundBtn) return;
    const iconId = muted ? "i-volume-x" : "i-volume-high";
    const label = muted ? "SOUND OFF" : "SOUND ON";
    pauseSoundBtn.innerHTML = `<svg class="icon" aria-hidden="true" id="pause-sound-icon"><use href="#${iconId}"></use></svg> ${label}`;
}
function updateMuteLabel() {
    if (muteBtn) muteBtn.innerHTML = muted ? "PRESS S FOR SOUND" : "PRESS S TO MUTE";
    const st = document.getElementById("sound-toggle");
    if (st) {
        setButtonIconText(st, muted ? "i-volume-x" : "i-volume-high", muted ? "SOUND OFF" : "SOUND ON");
        st.classList.toggle("off", muted);
    }
}

// ── Audio Engine ──
let audioCtx = null;
let muted = true;
function getAudio() {
    if (!audioCtx)
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
}
function mkNoise(ctx, dur) {
    const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
}
function playSound(type, speed = 1) {
    if (muted) return;
    const ctx = getAudio();
    const t = ctx.currentTime;
    const out = ctx.destination;
    if (type === "hit") {
        const n = mkNoise(ctx, 0.07);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 900 + speed * 180 + Math.random() * 400;
        bp.Q.value = 2 + Math.random() * 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5 + Math.min(speed / 18, 0.35), t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        n.connect(bp);
        bp.connect(g);
        g.connect(out);
        n.start(t);
        n.stop(t + 0.07);
    }
    if (type === "wall") {
        const n = mkNoise(ctx, 0.04);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1400 + Math.random() * 600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        n.connect(hp);
        hp.connect(g);
        g.connect(out);
        n.start(t);
        n.stop(t + 0.04);
    }
    if (type === "goal") {
        const sub = ctx.createOscillator(),
            sg = ctx.createGain();
        sub.type = "sine";
        sub.frequency.setValueAtTime(60, t);
        sub.frequency.exponentialRampToValueAtTime(28, t + 0.25);
        sg.gain.setValueAtTime(0.6, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        sub.connect(sg);
        sg.connect(out);
        sub.start(t);
        sub.stop(t + 0.3);
        [
            [0, "sawtooth", 233],
            [0.01, "sawtooth", 220],
            [0.02, "sawtooth", 246]
        ].forEach(([dt, wv, f]) => {
            const o = ctx.createOscillator(),
                g = ctx.createGain();
            o.type = wv;
            o.frequency.value = f;
            g.gain.setValueAtTime(0.15, t + dt);
            g.gain.setValueAtTime(0.15, t + 0.5);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
            o.connect(g);
            g.connect(out);
            o.start(t + dt);
            o.stop(t + 0.71);
        });
    }
    if (type === "victory") {
        [
            [0, 392, 0.12],
            [0.13, 392, 0.12],
            [0.26, 392, 0.12],
            [0.39, 523, 0.45],
            [0.58, 494, 0.18],
            [0.77, 440, 0.18],
            [0.96, 523, 0.6]
        ].forEach(([dt, f, dur]) => {
            [-4, 0, 4].forEach((cents) => {
                const o = ctx.createOscillator(),
                    g = ctx.createGain();
                o.type = "sawtooth";
                o.frequency.value = f * Math.pow(2, cents / 1200);
                const lp = ctx.createBiquadFilter();
                lp.type = "lowpass";
                lp.frequency.value = 1800;
                g.gain.setValueAtTime(0, t + dt);
                g.gain.linearRampToValueAtTime(0.08, t + dt + 0.02);
                g.gain.setValueAtTime(0.08, t + dt + dur - 0.03);
                g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur);
                o.connect(lp);
                lp.connect(g);
                g.connect(out);
                o.start(t + dt);
                o.stop(t + dt + dur + 0.01);
            });
        });
    }
    if (type === "speedup") {
        const n = mkNoise(ctx, 0.4);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 5;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(3000, t + 0.38);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        n.connect(bp);
        bp.connect(g);
        g.connect(out);
        n.start(t);
        n.stop(t + 0.4);
    }
    if (type === "slomo_in") {
        const o = ctx.createOscillator(),
            g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(100, t);
        o.frequency.exponentialRampToValueAtTime(36, t + 0.65);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + 0.7);
    }
}
// ── Confetti ──
const confetti = [];
const CONF_COLORS = [
    "#00d4ff",
    "#ff2d55",
    "#ffc940",
    "#ffffff",
    "#a855f7",
    "#22c55e",
    "#fb923c"
];
function spawnConfetti() {
    for (let i = 0; i < 160; i++) {
        confetti.push({
            x: Math.random() * W,
            y: -10 - Math.random() * 120,
            vx: (Math.random() - 0.5) * 5,
            vy: 2 + Math.random() * 4,
            rot: Math.random() * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 0.22,
            w: 6 + Math.random() * 8,
            h: 3 + Math.random() * 4,
            col: CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
            life: 1
        });
    }
}
function updateConfetti() {
    for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.x += c.vx;
        c.y += c.vy;
        c.vy += 0.08;
        c.vx *= 0.99;
        c.rot += c.rotV;
        if (c.y > H + 20) c.life -= 0.05;
        if (c.life <= 0) confetti.splice(i, 1);
    }
}
function drawConfetti() {
    confetti.forEach((c) => {
        G.save();
        G.globalAlpha = c.life;
        G.translate(c.x, c.y);
        G.rotate(c.rot);
        G.fillStyle = c.col;
        G.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        G.restore();
    });
}

// ── Slo-mo state ──
let sloMo = false;
let sloMoAlpha = 0;
let sloMoIntro = 0;
let confettiInterval = null;
let showSadFace = false; // counts down for big entrance flash
let sloMoLabelTimer = 0; // counts down before label fades
const TABLE_X = 30,
    TABLE_Y = 30,
    TABLE_W = W - 60,
    TABLE_H = H - 60;
const CX = W / 2,
    CY = H / 2;
const GOAL_W = 160,
    GOAL_DEPTH = 20;
const GOAL_Y1 = CY - GOAL_W / 2,
    GOAL_Y2 = CY + GOAL_W / 2;
const PUCK_R = 14;
const MALLET_R = 24;
const MAX_SCORE = 7;
const FRICTION = 0.995;
const WALL_BOUNCE = 0.82;



// ── Match stats ──
const stats = {
    p: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
    cpu: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
    rallyHits: 0,
    totalHits: 0
};
function resetStats() {
    stats.p = { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 };
    stats.cpu = { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 };
    stats.rallyHits = 0;
    stats.totalHits = 0;
}

// ── Score ──
const score = { p: 0, cpu: 0 };


// ── Puck ──
const puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R };
const trail = [];

// ── Mallets ──
const player = {
    x: TABLE_X + 130,
    y: CY,
    tx: TABLE_X + 130,
    ty: CY,
    r: MALLET_R,
    pvx: 0,
    pvy: 0
};
const cpu = {
    x: W - TABLE_X - 130,
    y: CY,
    r: MALLET_R,
    vx: 0,
    vy: 0,
    mistakeTimer: 0,
    errorY: 0,
    hitCool: 0
};

// ══════════════════════════════════════
//  POWER-UP SYSTEM
// ══════════════════════════════════════
const POWERUP_TYPES = {
    speed: { icon: "SPD", label: "SPEED BOOST", col: "#ffe34d" },
    shield: { icon: "SHD", label: "SHIELD", col: "#4dd2ff" },
    fire: { icon: "FIR", label: "FIRE BALL", col: "#ff5a2d" },
    freeze: { icon: "ICE", label: "FREEZE ENEMY", col: "#7fe8ff" }
};
const POWERUP_SPAWN_MIN = 360; // ~6s @60fps
const POWERUP_SPAWN_MAX = 660; // ~11s
const POWERUP_LIFE = 480; // ~8s on table before vanishing
const POWERUP_DURATION = 300; // ~5s effect duration
const powerUps = []; // { type, x, y, life, r }
let powerUpSpawnTimer = POWERUP_SPAWN_MIN;
const effects = {
    p: { speedBoost: 0, shield: 0, frozen: 0 },
    cpu: { speedBoost: 0, shield: 0, frozen: 0 }
};
let fireBallTimer = 0;
let goalSloMoTimer = 0;

function spawnPowerUp() {
    const keys = Object.keys(POWERUP_TYPES);
    const type = keys[Math.floor(Math.random() * keys.length)];
    powerUps.push({
        type,
        x: TABLE_X + 90 + Math.random() * (TABLE_W - 180),
        y: TABLE_Y + 50 + Math.random() * (TABLE_H - 100),
        life: POWERUP_LIFE,
        r: 17
    });
}

function updatePowerUps() {
    if (powerUpSpawnTimer > 0) powerUpSpawnTimer--;
    if (powerUpsEnabled && state === "play" && powerUpSpawnTimer <= 0 && powerUps.length < 2) {
        spawnPowerUp();
        powerUpSpawnTimer = POWERUP_SPAWN_MIN + Math.random() * (POWERUP_SPAWN_MAX - POWERUP_SPAWN_MIN);
    }
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const pu = powerUps[i];
        pu.life--;
        if (pu.life <= 0) {
            powerUps.splice(i, 1);
            continue;
        }
        if (state !== "play") continue;
        checkPowerUpPickup(pu, player, "p", i) ||
            checkPowerUpPickup(pu, cpu, "cpu", i);
    }

    // tick down active effect timers
    ["p", "cpu"].forEach((who) => {
        ["speedBoost", "shield", "frozen"].forEach((k) => {
            if (effects[who][k] > 0) effects[who][k]--;
        });
    });
    if (fireBallTimer > 0) fireBallTimer--;
}

function checkPowerUpPickup(pu, mallet, who, idx) {
    const dist = Math.hypot(pu.x - mallet.x, pu.y - mallet.y);
    if (dist >= pu.r + mallet.r) return false;
    powerUps.splice(idx, 1);
    activatePowerUp(pu.type, who);
    burst(pu.x, pu.y, POWERUP_TYPES[pu.type].col, "#ffffff", 30);
    playSound("speedup");
    powerUpToastQueue.push({ text: `${who === "p" ? (gameMode === "2p" ? "P1" : "YOU") : (gameMode === "2p" ? "P2" : "CPU")} GOT ${POWERUP_TYPES[pu.type].label}!`, col: POWERUP_TYPES[pu.type].col });
    return true;
}

function activatePowerUp(type, who) {
    const enemy = who === "p" ? "cpu" : "p";
    if (type === "speed") {
        effects[who].speedBoost = POWERUP_DURATION;
    } else if (type === "shield") {
        effects[who].shield = POWERUP_DURATION;
    } else if (type === "fire") {
        fireBallTimer = POWERUP_DURATION;
    } else if (type === "freeze") {
        effects[enemy].frozen = POWERUP_DURATION;
    }
}

let powerUpToastQueue = [];
let powerUpToastTimer = 0;
let powerUpToastText = "";
let powerUpToastCol = "#fff";

function drawPowerUps() {
    powerUps.forEach((pu) => {
        const def = POWERUP_TYPES[pu.type];
        const pulse = 0.85 + Math.sin(tick * 0.12) * 0.15;
        const fade = pu.life < 90 ? Math.max(0, (pu.life / 90) * (Math.sin(tick * 0.4) * 0.5 + 0.5)) : 1;
        G.save();
        G.globalAlpha = fade;
        G.shadowColor = def.col;
        G.shadowBlur = 22 * pulse;
        G.fillStyle = `${def.col}33`;
        G.beginPath();
        G.arc(pu.x, pu.y, pu.r * pulse, 0, Math.PI * 2);
        G.fill();
        G.strokeStyle = def.col;
        G.lineWidth = 2;
        G.beginPath();
        G.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
        G.stroke();
        G.shadowBlur = 0;
        G.font = "16px sans-serif";
        G.textAlign = "center";
        G.textBaseline = "middle";
        G.fillText(def.icon, pu.x, pu.y + 1);
        G.restore();
    });
}

function drawActiveEffectRings() {
    ["p", "cpu"].forEach((who) => {
        const m = who === "p" ? player : cpu;
        const e = effects[who];
        if (e.shield > 0) {
            G.save();
            G.globalAlpha = 0.7;
            G.strokeStyle = POWERUP_TYPES.shield.col;
            G.shadowColor = POWERUP_TYPES.shield.col;
            G.shadowBlur = 14;
            G.lineWidth = 2;
            G.setLineDash([4, 4]);
            G.beginPath();
            G.arc(m.x, m.y, m.r + 10, 0, Math.PI * 2);
            G.stroke();
            G.setLineDash([]);
            G.restore();
        }
        if (e.speedBoost > 0) {
            G.save();
            G.globalAlpha = 0.6;
            G.strokeStyle = POWERUP_TYPES.speed.col;
            G.shadowColor = POWERUP_TYPES.speed.col;
            G.shadowBlur = 12;
            G.lineWidth = 2;
            G.beginPath();
            G.arc(m.x, m.y, m.r + 6, 0, Math.PI * 2);
            G.stroke();
            G.restore();
        }
        if (e.frozen > 0) {
            G.save();
            G.globalAlpha = 0.55;
            G.strokeStyle = POWERUP_TYPES.freeze.col;
            G.shadowColor = POWERUP_TYPES.freeze.col;
            G.shadowBlur = 12;
            G.lineWidth = 2;
            G.beginPath();
            G.arc(m.x, m.y, m.r + 13, 0, Math.PI * 2);
            G.stroke();
            G.restore();
        }
    });
    // shield also shown over the goal it protects
    if (effects.p.shield > 0) drawShieldGoal(TABLE_X, POWERUP_TYPES.shield.col);
    if (effects.cpu.shield > 0) drawShieldGoal(TABLE_X + TABLE_W, POWERUP_TYPES.shield.col);
}
function drawShieldGoal(x, col) {
    G.save();
    G.globalAlpha = 0.5 + Math.sin(tick * 0.15) * 0.15;
    G.strokeStyle = col;
    G.shadowColor = col;
    G.shadowBlur = 16;
    G.lineWidth = 3;
    G.beginPath();
    G.moveTo(x, GOAL_Y1 - 6);
    G.lineTo(x, GOAL_Y2 + 6);
    G.stroke();
    G.restore();
}

function drawPowerUpToast() {
    if (powerUpToastTimer <= 0 && powerUpToastQueue.length) {
        const next = powerUpToastQueue.shift();
        powerUpToastText = next.text;
        powerUpToastCol = next.col;
        powerUpToastTimer = 110;
    }
    if (powerUpToastTimer <= 0) return;
    const t = powerUpToastTimer / 110;
    const alpha = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
    G.save();
    G.globalAlpha = alpha;
    G.textAlign = "center";
    G.font = '700 18px "Orbitron"';
    G.fillStyle = "#000";
    G.fillText(powerUpToastText, W / 2 + 1, 70 + 1);
    G.fillStyle = powerUpToastCol;
    G.shadowColor = powerUpToastCol;
    G.shadowBlur = 18;
    G.fillText(powerUpToastText, W / 2, 70);
    G.restore();
    powerUpToastTimer--;
}

function drawAchvToast() {
    if (achvToastTimer <= 0 && achvToastQueue.length) {
        achvToastText = achvToastQueue.shift();
        achvToastTimer = 150;
    }
    if (achvToastTimer <= 0) return;
    const t = achvToastTimer / 150;
    const alpha = t < 0.12 ? t / 0.12 : t > 0.85 ? (1 - t) / 0.15 : 1;
    G.save();
    G.globalAlpha = alpha;
    G.textAlign = "center";
    G.font = '700 15px "Orbitron"';
    G.fillStyle = "#000";
    G.fillText("UNLOCKED: " + achvToastText, W / 2 + 1, 98 + 1);
    G.fillStyle = "#ffc940";
    G.shadowColor = "#ffc940";
    G.shadowBlur = 16;
    G.fillText("UNLOCKED: " + achvToastText, W / 2, 98);
    G.restore();
    achvToastTimer--;
}

// ── Particles ──
const particles = [];
function burst(x, y, col1, col2, n = 22) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2,
            s = 2 + Math.random() * 7;
        particles.push({
            x,
            y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: 1,
            col: Math.random() > 0.5 ? col1 : col2,
            size: 2 + Math.random() * 4,
            glow: Math.random() > 0.4,
            gravity: 0.08 + Math.random() * 0.12
        });
    }
}
function sparkLine(x1, y1, x2, y2, col, n = 8) {
    for (let i = 0; i < n; i++) {
        const t = Math.random();
        const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 10;
        const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 10;
        const a = Math.random() * Math.PI * 2,
            s = 1 + Math.random() * 3;
        particles.push({
            x,
            y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: 1,
            col,
            size: 1.5 + Math.random() * 2,
            glow: true,
            gravity: 0.1
        });
    }
}

// ── Input ──
// Track raw pointer; clamp inside updatePlayer so mallet stays on table regardless
let rawMouseX = TABLE_X + 120,
    rawMouseY = H / 2;
let prevRawX = TABLE_X + 120,
    prevRawY = H / 2;
let mouseVX = 0,
    mouseVY = 0;

function pointerToCanvas(clientX, clientY) {
    const r = CV.getBoundingClientRect();
    const scaleX = W / r.width,
        scaleY = H / r.height;
    const nx = (clientX - r.left) * scaleX;
    const ny = (clientY - r.top) * scaleY;
    // clamp to player's half of the table
    rawMouseX = clamp(nx, TABLE_X + MALLET_R + 2, CX - 10);
    rawMouseY = clamp(
        ny,
        TABLE_Y + MALLET_R + 2,
        TABLE_Y + TABLE_H - MALLET_R - 2
    );
}

CV.addEventListener("mousemove", (e) => pointerToCanvas(e.clientX, e.clientY));
document.addEventListener("mousemove", (e) =>
    pointerToCanvas(e.clientX, e.clientY)
);

CV.addEventListener(
    "touchmove",
    (e) => {
        e.preventDefault();
        pointerToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false }
);

CV.addEventListener(
    "touchstart",
    (e) => {
        e.preventDefault();
        pointerToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false }
);

document.addEventListener("keydown", (e) => {
    // Pause toggle — Escape or P
    if (e.code === "Escape" || (e.code === "KeyP" && gameMode !== "2p")) {
        if (state === "play") { setPaused(true); return; }
        if (state === "paused") { setPaused(false); return; }
    }
    if (e.code === "KeyS" && gameMode !== "2p" && state !== "paused") toggleMute();
    if (e.code === "Space" && state === "over") startGame();
    if (e.code in p2Keys) {
        p2Keys[e.code] = true;
        e.preventDefault();
    }
    if (e.code in p1Keys && gameMode === "2p") {
        p1Keys[e.code] = true;
        e.preventDefault();
    }
});
document.addEventListener("keyup", (e) => {
    if (e.code in p2Keys) p2Keys[e.code] = false;
    if (e.code in p1Keys) p1Keys[e.code] = false;
});

// ── Game flow ──
function startGame() {
    // Re-stamp canvas size in case it was zero while display:none
    CV.width = W;
    CV.height = H;

    score.p = 0;
    score.cpu = 0;
    resetStats();
    puckSpeedMult = 1.0;
    lastSpeedUpAt = 0;
    speedUpMsg = "";
    speedUpTimer = 0;
    sloMo = false;
    sloMoAlpha = 0;
    sloMoIntro = 0;
    sloMoLabelTimer = 0;
    confetti.length = 0;
    if (confettiInterval) {
        clearInterval(confettiInterval);
        confettiInterval = null;
    }
    showSadFace = false;
    powerUps.length = 0;
    powerUpSpawnTimer = POWERUP_SPAWN_MIN + Math.random() * (POWERUP_SPAWN_MAX - POWERUP_SPAWN_MIN);
    effects.p = { speedBoost: 0, shield: 0, frozen: 0 };
    effects.cpu = { speedBoost: 0, shield: 0, frozen: 0 };
    fireBallTimer = 0;
    matchStartTime = Date.now();
    lastGoalTime = Date.now();
    minScoreDiffForPlayer = 0;
    resetRound("p");
    state = "play";
    if (readyEl) readyEl.classList.remove("on");
    gameoverEl.classList.remove("on", "lose-state");
    particles.length = 0;
    updateStatDOM();
}

function resetRound(server) {
    trail.length = 0;
    puck.x = CX;
    puck.y = CY;
    puck.vx = 0;
    puck.vy = 0;
    player.x = TABLE_X + 120;
    player.y = CY;
    player.pvx = 0;
    player.pvy = 0;
    cpu.x = W - TABLE_X - 120;
    cpu.y = CY;
    cpu.vx = 0;
    cpu.vy = 0;
    cpu.mistakeTimer = 0;
    stats.rallyHits = 0;
    if (server === "p") {
        puck.vx = -(3.5 + Math.random() * 1.5) * puckSpeedMult;
        puck.vy = (Math.random() - 0.5) * 3.5 * puckSpeedMult;
    } else {
        puck.vx = (3.5 + Math.random() * 1.5) * puckSpeedMult;
        puck.vy = (Math.random() - 0.5) * 3.5 * puckSpeedMult;
    }
}

function goalScored(who) {
    if (state !== "play") return;
    // Shield blocks the goal entirely instead of scoring
    const defender = who === "p" ? "cpu" : "p";
    if (effects[defender].shield > 0) {
        effects[defender].shield = 0;
        puck.vx *= -1.4;
        puck.vy *= 1.1;
        burst(puck.x, puck.y, "#ffffff", P1_COLOR, 24);
        shake(6);
        return;
    }

    state = "goal";
    goalWho = who;
    goalFlash = 160;
    goalMsgScale = 0;

    // Fastest goal tracking (lifetime)
    const goalElapsed = Date.now() - lastGoalTime;
    lastGoalTime = Date.now();
    if (lifetime.fastestGoalMs === null || goalElapsed < lifetime.fastestGoalMs) {
        lifetime.fastestGoalMs = goalElapsed;
    }
    lifetime.totalGoals++;

    const ws = stats[who],
        ls = stats[who === "p" ? "cpu" : "p"];
    ws.goals++;
    ws.streak++;
    ws.bestStreak = Math.max(ws.bestStreak, ws.streak);
    ls.streak = 0;

    score[who]++;
    minScoreDiffForPlayer = Math.min(minScoreDiffForPlayer, score.p - score.cpu);

    const totalGoals = score.p + score.cpu;
    if (totalGoals % 2 === 0 && totalGoals > lastSpeedUpAt) {
        lastSpeedUpAt = totalGoals;
        puckSpeedMult = Math.min(puckSpeedMult + 0.14, 2.0);
        const msgs = [
            "SPEEDING UP!",
            "FASTER!!",
            "KICK IT UP!",
            "NO MERCY!",
            "LIGHT SPEED!",
            "HOLD ON!!"
        ];
        speedUpMsg = msgs[Math.min(Math.floor(totalGoals / 2 - 1), msgs.length - 1)];
        speedUpTimer = 130;
    }
    if (who === "p") burst(TABLE_X, CY, P1_COLOR, "#ffffff", 40);
    else burst(W - TABLE_X, CY, P2_COLOR, "#ffffff", 40);
    burst(puck.x, puck.y, "#ffc940", "#ffffff", 30);
    shake(8);

    // Brief slow-motion on every goal (separate from game-point slo-mo)
    goalSloMoTimer = 55;
    // Trigger instant replay after goal flash
    setTimeout(triggerReplay, 1600);

    updateStatDOM();

    // Slo-mo triggers when either player is now at game point (MAX_SCORE - 1)
    const newP = score.p,
        newCPU = score.cpu;
    if ((newP === MAX_SCORE - 1 || newCPU === MAX_SCORE - 1) && !sloMo) {
        sloMo = true;
        sloMoIntro = 80;
        sloMoLabelTimer = 80 + 90; // intro (80) + hold (90) then fade
    }
    // Cancel slo-mo only when a new game starts, not on game over
    // if newP >= MAX_SCORE keep sloMo running for dramatic effect

    setTimeout(() => {
        if (score.p >= MAX_SCORE || score.cpu >= MAX_SCORE) {
            state = "over";
            const playerWon = score.p >= MAX_SCORE;
            goWho.textContent = playerWon ? (gameMode === "2p" ? "P1 WINS" : "YOU WIN") : (gameMode === "2p" ? "P2 WINS" : "CPU WINS");
            goWho.style.color = playerWon ? P1_COLOR : P2_COLOR;
            goWho.style.textShadow = playerWon
                ? `0 0 30px ${P1_COLOR}, 0 0 60px ${P1_COLOR}66`
                : `0 0 30px ${P2_COLOR}, 0 0 60px ${P2_COLOR}66`;
            goWinsEl.textContent = playerWon
                ? "GAME · SET · MATCH"
                : "BETTER LUCK NEXT TIME";
            const goFaceEl = document.getElementById("go-face");
            goFaceEl.innerHTML = playerWon
                ? iconHTML("i-face-win", "icon-xl")
                : iconHTML("i-face-lose", "icon-xl");
            goFinal.textContent = `${score.p} – ${score.cpu}`;
            gameoverEl.classList.remove("lose-state");
            if (!playerWon) gameoverEl.classList.add("lose-state");
            burst(CX, CY, "#ffc940", "#ffffff", 80);
            if (playerWon) {
                playSound("victory");
                spawnConfetti();
                setTimeout(spawnConfetti, 400);
                setTimeout(spawnConfetti, 800);
                setTimeout(spawnConfetti, 1400);
                confettiInterval = setInterval(spawnConfetti, 1400);
            }
            gameoverEl.classList.add("on");

            // ── Lifetime stats + achievements ──
            const matchMs = Date.now() - matchStartTime;
            lifetime.gamesPlayed++;
            lifetime.totalPlayTimeMs += matchMs;
            lifetime.longestMatchMs = Math.max(lifetime.longestMatchMs, matchMs);
            if (playerWon) {
                lifetime.wins++;
                unlockAchievement("first_win");
                if (score.cpu === 0) { unlockAchievement("no_damage"); checkDailyChallenge("shutout"); }
                if (minScoreDiffForPlayer <= -3) { unlockAchievement("comeback"); checkDailyChallenge("comeback3"); }
                if (matchMs < 180000) checkDailyChallenge("speedRun");
                if (difficulty === "insane") checkDailyChallenge("insaneWin");
                if (stats.totalHits >= 50) checkDailyChallenge("rally50");
            }
            lifetime.bestWinStreak = Math.max(lifetime.bestWinStreak, stats.p.bestStreak);
            if (stats.p.bestStreak >= 5) { unlockAchievement("streak5"); checkDailyChallenge("streak5goals"); }
            if (stats.p.topSpeed >= 60) unlockAchievement("speed_demon");
            saveLifetimeStats();

            // ── Tournament mode hook ──
            if (gameMode === "tournament" && tournamentData.active) {
                onTournamentMatchEnd(playerWon, score.p, score.cpu);
                const nr = document.getElementById("btn-next-round");
                if (nr) nr.classList.add("hidden");
            } else if (gameMode === "tournament" && tournamentData.round < TOURNAMENT_ROUNDS.length) {
                // Next round available
                const nr = document.getElementById("btn-next-round");
                if (nr) nr.classList.remove("hidden");
            }
        } else {
            resetRound(who === "p" ? "cpu" : "p");
            state = "play";
        }
    }, 1500);
}

function shake(amt) {
    shakeAmt = Math.max(shakeAmt, amt);
}

// ── Update stat DOM ──
function updateStatDOM() {
    DOM.scoreP.textContent = score.p;
    DOM.scoreCPU.textContent = score.cpu;
    DOM.pStreak.textContent = stats.p.bestStreak;
    DOM.pSpeed.textContent = stats.p.topSpeed;
    DOM.pPower.textContent = stats.p.powerHits;
    DOM.cpuStreak.textContent = stats.cpu.bestStreak;
    DOM.cpuSpeed.textContent = stats.cpu.topSpeed;
    DOM.cpuPower.textContent = stats.cpu.powerHits;
}

// ── Player 2 (local multiplayer, keyboard Arrow Keys) ──
const p2Keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};
// ── Player 1 keyboard (WASD — used in 2P mode only; mouse still works in 1P) ──
const p1Keys = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false
};
const P2_SPEED = 7.4;
const P1_WASD_SPEED = 7.4;
function updatePlayer2(ts = 1) {
    const minX = W / 2 + 10,
        maxX = W - TABLE_X - cpu.r - 2;
    const minY = TABLE_Y + cpu.r + 2,
        maxY = TABLE_Y + TABLE_H - cpu.r - 2;
    const prevX = cpu.x,
        prevY = cpu.y;
    let dx = 0,
        dy = 0;
    if (p2Keys.ArrowUp) dy -= 1;
    if (p2Keys.ArrowDown) dy += 1;
    if (p2Keys.ArrowLeft) dx -= 1;
    if (p2Keys.ArrowRight) dx += 1;
    if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
    }
    let spdMul = 1;
    if (effects.cpu.speedBoost > 0) spdMul *= 1.55;
    if (effects.cpu.frozen > 0) spdMul *= 0.4;
    cpu.x = clamp(cpu.x + dx * P2_SPEED * spdMul * ts, minX, maxX);
    cpu.y = clamp(cpu.y + dy * P2_SPEED * spdMul * ts, minY, maxY);
    cpu.vx = cpu.x - prevX;
    cpu.vy = cpu.y - prevY;
}

// ── CPU AI ──
function updateCPU(ts = 1) {
    const halfW = W / 2;
    const homeX = W - TABLE_X - 110;
    const minX = halfW + 10,
        maxX = W - TABLE_X - cpu.r - 2;
    const minY = TABLE_Y + cpu.r + 2,
        maxY = TABLE_Y + TABLE_H - cpu.r - 2;

    if (
        Math.random() < CPU_MISTAKE_CHANCE &&
        cpu.mistakeTimer === 0 &&
        puck.vx > 0
    ) {
        cpu.mistakeTimer = CPU_MISTAKE_DUR;
        cpu.errorY = (Math.random() - 0.5) * CPU_ERROR_Y * 2;
    }
    if (cpu.mistakeTimer > 0) cpu.mistakeTimer--;
    if (cpu.hitCool > 0) cpu.hitCool--;

    const err = cpu.mistakeTimer > 0 ? cpu.errorY : 0;
    const puckOnMySide = puck.x > halfW;
    const puckHeadingToMe = puck.vx > 0;

    // Corner escape: if CPU is near a corner and puck isn't coming, go home immediately
    const nearTopWall = cpu.y < minY + 20;
    const nearBottomWall = cpu.y > maxY - 20;
    const nearSideWall = cpu.x > maxX - 20;
    const cornered = (nearTopWall || nearBottomWall) && nearSideWall;
    const farFromHome = Math.hypot(cpu.x - homeX, cpu.y - CY) > 150;

    let tx, ty;

    if (cornered || (farFromHome && !puckHeadingToMe)) {
        // Escape directly to home — ignore puck
        tx = homeX;
        ty = CY;
    } else if (puckOnMySide && puckHeadingToMe) {
        const frames = Math.max(
            1,
            Math.min((cpu.x - puck.x) / Math.max(0.5, puck.vx), 60)
        );
        tx = clamp(puck.x + puck.vx * frames * CPU_REACT, minX, maxX);
        ty = clamp(puck.y + puck.vy * frames * CPU_REACT + err, minY, maxY);
    } else if (puckOnMySide) {
        // Puck on my side drifting away — chase but don't go past the side wall corner
        tx = clamp(puck.x - 8, minX, maxX - 30);
        ty = clamp(puck.y + err, minY, maxY);
    } else {
        // Puck on player side — hold home, track Y loosely
        tx = homeX;
        ty = clamp(puck.y * 0.5 + CY * 0.5 + err * 0.3, minY, maxY);
    }

    const prevX = cpu.x,
        prevY = cpu.y;
    const dx = tx - cpu.x,
        dy = ty - cpu.y;
    const dist = Math.hypot(dx, dy);
    let cpuSpdMul = 1;
    if (effects.cpu.speedBoost > 0) cpuSpdMul *= 1.55;
    if (effects.cpu.frozen > 0) cpuSpdMul *= 0.4;
    if (dist > 0.1) {
        const step = Math.min(dist, CPU_SPEED * cpuSpdMul * ts);
        cpu.x += (dx / dist) * step;
        cpu.y += (dy / dist) * step;
    }
    cpu.x = clamp(cpu.x, minX, maxX);
    cpu.y = clamp(cpu.y, minY, maxY);
    cpu.vx = cpu.x - prevX;
    cpu.vy = cpu.y - prevY;
}

// ── Physics ──
function updatePuck() {
    if (state !== "play") return;

    const spd = Math.hypot(puck.vx, puck.vy);
    trail.push({ x: puck.x, y: puck.y, spd });
    if (trail.length > 18) trail.shift();

    if (spd < 0.8) {
        puck.vx += (Math.random() - 0.5) * 0.18;
        puck.vy += (Math.random() - 0.5) * 0.18;
    } else if (spd < 2.5) {
        puck.vx += (Math.random() - 0.5) * 0.06;
        puck.vy += (Math.random() - 0.5) * 0.06;
    }

    puck.x += puck.vx;
    puck.y += puck.vy;
    puck.vx *= FRICTION;
    puck.vy *= FRICTION;

    const tx = TABLE_X,
        ty = TABLE_Y,
        tw = TABLE_W,
        th = TABLE_H;

    if (puck.y - puck.r < ty) {
        puck.y = ty + puck.r;
        puck.vy = Math.abs(puck.vy) * WALL_BOUNCE;
        sparkLine(puck.x - 20, ty, puck.x + 20, ty, "#00d4ff");
    }
    if (puck.y + puck.r > ty + th) {
        puck.y = ty + th - puck.r;
        puck.vy = -Math.abs(puck.vy) * WALL_BOUNCE;
        sparkLine(puck.x - 20, ty + th, puck.x + 20, ty + th, "#00d4ff");
    }
    if (puck.x - puck.r < tx) {
        if (puck.y > GOAL_Y1 && puck.y < GOAL_Y2) {
            goalScored("cpu");
            return;
        }
        puck.x = tx + puck.r;
        puck.vx = Math.abs(puck.vx) * WALL_BOUNCE;
        sparkLine(tx, puck.y - 20, tx, puck.y + 20, "#ff2d55");
    }
    if (puck.x + puck.r > tx + tw) {
        if (puck.y > GOAL_Y1 && puck.y < GOAL_Y2) {
            goalScored("p");
            return;
        }
        puck.x = tx + tw - puck.r;
        puck.vx = -Math.abs(puck.vx) * WALL_BOUNCE;
        sparkLine(tx + tw, puck.y - 20, tx + tw, puck.y + 20, "#ff2d55");
    }

    circleMalletCollide(puck, player, true);
    circleMalletCollide(puck, cpu, false);
}

function circleMalletCollide(pk, mallet, isPlayer) {
    const dx = pk.x - mallet.x,
        dy = pk.y - mallet.y;
    const dist = Math.hypot(dx, dy);
    const minDist = pk.r + mallet.r;
    if (dist >= minDist || dist < 0.01) return;

    // CPU hit cooldown — prevents corner spam loop
    if (!isPlayer && cpu.hitCool > 0) {
        const nx2 = dx / dist,
            ny2 = dy / dist;
        pk.x += nx2 * (minDist - dist);
        pk.y += ny2 * (minDist - dist);
        return;
    }

    const nx = dx / dist,
        ny = dy / dist;
    pk.x += nx * (minDist - dist);
    pk.y += ny * (minDist - dist);

    const mvx = isPlayer ? player.pvx * 1.8 : mallet.vx;
    const mvy = isPlayer ? player.pvy * 1.8 : mallet.vy;

    const relVX = pk.vx - mvx;
    const relVY = pk.vy - mvy;
    const dot = relVX * nx + relVY * ny;
    if (dot >= 0) return;

    const restitution = isPlayer ? 1.3 : 1.1;
    const impulse = -(1 + restitution) * dot;
    pk.vx += impulse * nx;
    pk.vy += impulse * ny;

    const spd = Math.hypot(pk.vx, pk.vy);
    const cap = (isPlayer ? 20 : 16) * puckSpeedMult * (fireBallTimer > 0 ? 1.3 : 1);
    if (spd > cap) {
        pk.vx = (pk.vx / spd) * cap;
        pk.vy = (pk.vy / spd) * cap;
    }

    if (!isPlayer) cpu.hitCool = 20;

    const who = isPlayer ? "p" : "cpu";
    stats.rallyHits++;
    const mphSpd = Math.round(spd * 4);
    if (mphSpd > stats[who].topSpeed) stats[who].topSpeed = mphSpd;
    if (spd > 14) stats[who].powerHits++;
    updateStatDOM();

    if (spd > 3) {
        const col = isPlayer ? P1_COLOR : P2_COLOR;
        burst(pk.x, pk.y, col, "#ffffff", Math.floor(spd * 1.5));
        if (spd > 19) shake(Math.min((spd - 19) * 0.4, 3));
    }
}

function updatePlayer(ts = 1) {
    const dx = rawMouseX - prevRawX;
    const dy = rawMouseY - prevRawY;
    mouseVX = mouseVX * 0.4 + dx * 0.6;
    mouseVY = mouseVY * 0.4 + dy * 0.6;
    prevRawX = rawMouseX;
    prevRawY = rawMouseY;

    const frozen = effects.p.frozen > 0;
    const minX = TABLE_X + MALLET_R + 2, maxX = CX - 10;
    const minY = TABLE_Y + MALLET_R + 2, maxY = TABLE_Y + TABLE_H - MALLET_R - 2;

    if (gameMode === "2p") {
        // WASD keyboard control for P1
        const prevX = player.x, prevY = player.y;
        let kx = 0, ky = 0;
        if (p1Keys.KeyW) ky -= 1;
        if (p1Keys.KeyS) ky += 1;
        if (p1Keys.KeyA) kx -= 1;
        if (p1Keys.KeyD) kx += 1;
        if (kx !== 0 && ky !== 0) { kx *= 0.7071; ky *= 0.7071; }
        let spdMul = 1;
        if (effects.p.speedBoost > 0) spdMul *= 1.55;
        if (frozen) spdMul *= 0.4;
        player.x = clamp(player.x + kx * P1_WASD_SPEED * spdMul * ts, minX, maxX);
        player.y = clamp(player.y + ky * P1_WASD_SPEED * spdMul * ts, minY, maxY);
        player.pvx = (player.x - prevX);
        player.pvy = (player.y - prevY);
    } else {
        // Mouse / touch for P1 in 1P mode
        if (ts === 1 && !frozen) {
            player.x = rawMouseX;
            player.y = rawMouseY;
        } else {
            const lerpSpeed = frozen ? 0.12 : ts * 3;
            player.x += (rawMouseX - player.x) * lerpSpeed;
            player.y += (rawMouseY - player.y) * lerpSpeed;
            player.x = clamp(player.x, minX, maxX);
            player.y = clamp(player.y, minY, maxY);
        }
        const boostMul = effects.p.speedBoost > 0 ? 1.35 : 1;
        player.pvx = mouseVX * ts * boostMul;
        player.pvy = mouseVY * ts * boostMul;
    }
}

// ══════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════

function grd(x, y, r0, r1, c0, c1) {
    const g = G.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
}
function lgrad(x0, y0, x1, y1, stops) {
    const g = G.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    return g;
}

function drawTable() {
    const tx = TABLE_X,
        ty = TABLE_Y,
        tw = TABLE_W,
        th = TABLE_H;

    // outer glow
    G.save();
    G.shadowColor = "rgba(0,180,255,0.2)";
    G.shadowBlur = 28;
    G.strokeStyle = "rgba(0,180,255,0.25)";
    G.lineWidth = 3;
    G.beginPath();
    G.roundRect(tx - 4, ty - 4, tw + 8, th + 8, 14);
    G.stroke();
    G.restore();

    // table surface
    G.fillStyle = lgrad(tx, ty, tx, ty + th, [
        [0, THEME_COLORS.tableA],
        [0.5, THEME_COLORS.tableB],
        [1, THEME_COLORS.tableA]
    ]);
    G.beginPath();
    G.roundRect(tx, ty, tw, th, 10);
    G.fill();

    // air holes
    G.save();
    G.globalAlpha = 0.055;
    G.fillStyle = THEME_COLORS.accent;
    for (let gx = tx + 18; gx < tx + tw - 10; gx += 18)
        for (let gy = ty + 18; gy < ty + th - 10; gy += 18) {
            G.beginPath();
            G.arc(gx, gy, 1.8, 0, Math.PI * 2);
            G.fill();
        }
    G.restore();

    // center circle
    G.save();
    G.strokeStyle = `${THEME_COLORS.accent}29`;
    G.lineWidth = 2;
    G.setLineDash([6, 6]);
    G.beginPath();
    G.arc(CX, CY, 60, 0, Math.PI * 2);
    G.stroke();
    G.setLineDash([]);
    G.restore();

    // center line
    G.save();
    G.strokeStyle = `${THEME_COLORS.accent}1f`;
    G.lineWidth = 2;
    G.setLineDash([8, 8]);
    G.beginPath();
    G.moveTo(CX, ty + 2);
    G.lineTo(CX, ty + th - 2);
    G.stroke();
    G.setLineDash([]);
    G.restore();

    // center dot
    G.save();
    G.shadowColor = THEME_COLORS.accent;
    G.shadowBlur = 8;
    G.fillStyle = `${THEME_COLORS.accent}66`;
    G.beginPath();
    G.arc(CX, CY, 5, 0, Math.PI * 2);
    G.fill();
    G.restore();

    // rails
    const rt = lgrad(0, ty, 0, ty + 12, [
        [0, THEME_COLORS.rail],
        [0.6, THEME_COLORS.tableB],
        [1, THEME_COLORS.tableA]
    ]);
    G.fillStyle = rt;
    G.fillRect(tx, ty, tw, 8);
    const rb = lgrad(0, ty + th - 8, 0, ty + th, [
        [0, THEME_COLORS.tableA],
        [0.4, THEME_COLORS.tableB],
        [1, THEME_COLORS.rail]
    ]);
    G.fillStyle = rb;
    G.fillRect(tx, ty + th - 8, tw, 8);

    // rail glow lines
    G.save();
    G.shadowColor = "#00d4ff";
    G.shadowBlur = 10;
    G.strokeStyle = "rgba(0,212,255,0.7)";
    G.lineWidth = 2;
    G.beginPath();
    G.moveTo(tx + 2, ty + 2);
    G.lineTo(tx + tw - 2, ty + 2);
    G.stroke();
    G.beginPath();
    G.moveTo(tx + 2, ty + th - 2);
    G.lineTo(tx + tw - 2, ty + th - 2);
    G.stroke();
    G.restore();

    // left goal
    G.save();
    G.shadowColor = P1_COLOR;
    G.shadowBlur = 14;
    G.strokeStyle = P1_COLOR;
    G.lineWidth = 2.5;
    G.beginPath();
    G.moveTo(tx, GOAL_Y1);
    G.lineTo(tx - GOAL_DEPTH, GOAL_Y1);
    G.stroke();
    G.beginPath();
    G.moveTo(tx, GOAL_Y2);
    G.lineTo(tx - GOAL_DEPTH, GOAL_Y2);
    G.stroke();
    G.strokeStyle = `${P1_COLOR}4d`;
    G.lineWidth = 1.5;
    G.beginPath();
    G.moveTo(tx - GOAL_DEPTH, GOAL_Y1);
    G.lineTo(tx - GOAL_DEPTH, GOAL_Y2);
    G.stroke();
    G.restore();

    // right goal
    G.save();
    G.shadowColor = P2_COLOR;
    G.shadowBlur = 14;
    G.strokeStyle = P2_COLOR;
    G.lineWidth = 2.5;
    G.beginPath();
    G.moveTo(tx + tw, GOAL_Y1);
    G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y1);
    G.stroke();
    G.beginPath();
    G.moveTo(tx + tw, GOAL_Y2);
    G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y2);
    G.stroke();
    G.strokeStyle = `${P2_COLOR}4d`;
    G.lineWidth = 1.5;
    G.beginPath();
    G.moveTo(tx + tw + GOAL_DEPTH, GOAL_Y1);
    G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y2);
    G.stroke();
    G.restore();

    // goal posts
    [GOAL_Y1, GOAL_Y2].forEach((gy) => {
        G.save();
        G.shadowColor = P1_COLOR;
        G.shadowBlur = 12;
        G.fillStyle = P1_COLOR;
        G.beginPath();
        G.arc(tx, gy, 5, 0, Math.PI * 2);
        G.fill();
        G.restore();
        G.save();
        G.shadowColor = P2_COLOR;
        G.shadowBlur = 12;
        G.fillStyle = P2_COLOR;
        G.beginPath();
        G.arc(tx + tw, gy, 5, 0, Math.PI * 2);
        G.fill();
        G.restore();
    });
}

function drawPuck() {
    const onFire = fireBallTimer > 0;
    const puckCol = onFire ? "255,90,45" : "0,212,255";
    const puckHex = onFire ? "#ff5a2d" : "#00d4ff";

    if (onFire && tick % 2 === 0) {
        sparkLine(puck.x - 6, puck.y - 6, puck.x + 6, puck.y + 6, "#ff8a3d", 2);
    }

    trail.forEach((t, i) => {
        const prog = i / trail.length;
        const r = prog * 9 * Math.min(t.spd / 6, 1);
        if (r < 0.5) return;
        G.save();
        G.globalAlpha = prog * 0.55 * Math.min(t.spd / 5, 1);
        G.fillStyle = grd(t.x, t.y, 0, r * 2, `rgba(${puckCol},0.9)`, "transparent");
        G.beginPath();
        G.arc(t.x, t.y, r * 2.2, 0, Math.PI * 2);
        G.fill();
        G.restore();
    });

    const bx = puck.x,
        by = puck.y,
        br = puck.r;
    const spd = Math.hypot(puck.vx, puck.vy);

    G.save();
    G.shadowColor = puckHex;
    G.shadowBlur = 24 + spd * 1.5;
    G.fillStyle = grd(bx, by, 0, br + 8, `rgba(${puckCol},0.18)`, "transparent");
    G.beginPath();
    G.arc(bx, by, br + 14, 0, Math.PI * 2);
    G.fill();
    G.restore();

    G.fillStyle = grd(
        bx - br * 0.3,
        by - br * 0.3,
        br * 0.1,
        br,
        "#ffffff",
        onFire ? "#ffcfa8" : "#cccccc"
    );

    G.beginPath();
    G.arc(bx, by, br, 0, Math.PI * 2);
    G.fill();

    G.save();
    G.shadowColor = puckHex;
    G.shadowBlur = 8;
    G.strokeStyle = puckHex;
    G.lineWidth = 2.5;
    G.beginPath();
    G.arc(bx, by, br - 1, 0, Math.PI * 2);
    G.stroke();
    G.restore();

    G.strokeStyle = `rgba(${puckCol},0.32)`;
    G.lineWidth = 1;
    G.beginPath();
    G.arc(bx, by, br * 0.55, 0, Math.PI * 2);
    G.stroke();

    G.fillStyle = "rgba(255,255,255,0.17)";
    G.beginPath();
    G.ellipse(
        bx - br * 0.28,
        by - br * 0.3,
        br * 0.38,
        br * 0.22,
        -0.4,
        0,
        Math.PI * 2
    );
    G.fill();
}

// ── Paddle shape path helper ──
function shapePath(cx, cy, r, shape) {
    G.beginPath();
    if (shape === "hexagon") {
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            i === 0 ? G.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
                     : G.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        G.closePath();
    } else if (shape === "triangle") {
        for (let i = 0; i < 3; i++) {
            const a = (Math.PI * 2 / 3) * i - Math.PI / 2;
            i === 0 ? G.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
                     : G.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        G.closePath();
    } else if (shape === "diamond") {
        G.moveTo(cx, cy - r);
        G.lineTo(cx + r * 0.75, cy);
        G.lineTo(cx, cy + r);
        G.lineTo(cx - r * 0.75, cy);
        G.closePath();
    } else {
        G.arc(cx, cy, r, 0, Math.PI * 2);
    }
}

function drawMallet(m, col, glowCol) {
    const mx = m.x,
        my = m.y,
        mr = m.r;
    const gi = glowIntensity;
    const sh = paddleShape;

    // outer neon glow halo
    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 32 * gi;
    const halo = G.createRadialGradient(mx, my, mr * 0.6, mx, my, mr + 18);
    halo.addColorStop(0, "transparent");
    halo.addColorStop(0.6, `${glowCol}22`);
    halo.addColorStop(1, "transparent");
    G.fillStyle = halo;
    G.beginPath();
    G.arc(mx, my, mr + 18, 0, Math.PI * 2);
    G.fill();
    G.restore();

    // base shadow — makes it look raised off the table
    G.save();
    G.globalAlpha = 0.45;
    G.fillStyle = "rgba(0,0,0,0.7)";
    G.save(); G.translate(3, 4);
    shapePath(mx, my, mr, sh);
    G.restore();
    G.fill();
    G.restore();

    // outer plastic skirt — slightly darker, full radius
    const skirtG = G.createRadialGradient(mx - mr * 0.2, my - mr * 0.2, mr * 0.1, mx, my, mr);
    skirtG.addColorStop(0, lighten(col, 0.12));
    skirtG.addColorStop(0.65, col);
    skirtG.addColorStop(1, darken(col, 0.45));
    G.fillStyle = skirtG;
    shapePath(mx, my, mr, sh);
    G.fill();

    // neon glowing outer rim ring
    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 12 * gi;
    G.strokeStyle = glowCol;
    G.lineWidth = 2.5;
    shapePath(mx, my, mr - 1.5, sh);
    G.stroke();
    G.restore();

    // recessed groove ring
    const grooveR = mr * 0.72;
    G.strokeStyle = `rgba(0,0,0,0.55)`;
    G.lineWidth = 3;
    shapePath(mx, my, grooveR, sh);
    G.stroke();
    G.strokeStyle = `rgba(255,255,255,0.08)`;
    G.lineWidth = 1;
    shapePath(mx, my, grooveR + 1.5, sh);
    G.stroke();

    // raised dome center
    const domeR = mr * 0.62;
    const domeG = G.createRadialGradient(mx - domeR * 0.3, my - domeR * 0.35, 0, mx, my, domeR);
    domeG.addColorStop(0, lighten(col, 0.35));
    domeG.addColorStop(0.5, lighten(col, 0.1));
    domeG.addColorStop(1, darken(col, 0.2));
    G.fillStyle = domeG;
    shapePath(mx, my, domeR, sh);
    G.fill();

    // glowing center dot
    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 14 * gi;
    G.fillStyle = glowCol;
    G.beginPath();
    G.arc(mx, my, 4.5, 0, Math.PI * 2);
    G.fill();
    G.restore();

    // top-left specular highlight — sells the dome shape
    G.fillStyle = "rgba(255,255,255,0.28)";
    G.beginPath();
    G.ellipse(
        mx - domeR * 0.3,
        my - domeR * 0.32,
        domeR * 0.32,
        domeR * 0.18,
        -0.5,
        0,
        Math.PI * 2
    );
    G.fill();

    // secondary smaller highlight
    G.fillStyle = "rgba(255,255,255,0.12)";
    G.beginPath();
    G.ellipse(
        mx - domeR * 0.15,
        my - domeR * 0.5,
        domeR * 0.14,
        domeR * 0.08,
        -0.3,
        0,
        Math.PI * 2
    );
    G.fill();
}

function darken(hex, amt) {
    const c = parseColor(hex);
    return `#${clamp01(c[0] - amt).toString(16).padStart(2,"0")}${clamp01(c[1] - amt).toString(16).padStart(2,"0")}${clamp01(c[2] - amt).toString(16).padStart(2,"0")}`;
}
function lighten(hex, amt) {
    const c = parseColor(hex);
    return `#${clamp01(c[0] + amt).toString(16).padStart(2,"0")}${clamp01(c[1] + amt).toString(16).padStart(2,"0")}${clamp01(c[2] + amt).toString(16).padStart(2,"0")}`;
}
function clamp01(v) { return Math.max(0, Math.min(255, Math.round(v * 255))); }
function parseColor(s) {
    if (s && s[0] === "#") {
        const h = s.slice(1);
        if (h.length === 3) return [parseInt(h[0]+h[0],16)/255, parseInt(h[1]+h[1],16)/255, parseInt(h[2]+h[2],16)/255];
        return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
    }
    const m = s && s.match(/(\d+)/g);
    if (m) return [+m[0]/255, +m[1]/255, +m[2]/255];
    return [0, 0, 0];
}

function drawParticles() {
    particles.forEach((p) => {
        G.save();
        G.globalAlpha = Math.pow(p.life, 1.4) * 0.9;
        if (p.glow) {
            G.shadowColor = p.col;
            G.shadowBlur = 10;
        }
        G.fillStyle = p.col;
        G.beginPath();
        G.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        G.fill();
        G.restore();
    });
}
function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.96;
        p.life -= 0.028;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawGoalFlash() {
    if (goalFlash <= 0 || state !== "goal") return;
    const prog = goalFlash / 160,
        isP = goalWho === "p";
    G.save();
    G.globalAlpha = Math.min(prog * 3, 0.16);
    G.fillStyle = isP ? P1_COLOR : P2_COLOR;
    G.fillRect(0, 0, W, H);
    G.restore();

    goalMsgScale = Math.min(goalMsgScale + 0.12, 1);
    const ease = 1 - Math.pow(1 - goalMsgScale, 3);
    G.save();
    G.globalAlpha = Math.min(1, prog * 3) * Math.min(1, goalFlash / 40);
    G.translate(W / 2, H / 2);
    G.scale(ease, ease);
    G.textAlign = "center";
    G.font = '900 64px "Orbitron"';
    G.fillStyle = isP ? P1_COLOR : P2_COLOR;
    G.shadowColor = isP ? P1_COLOR : P2_COLOR;
    G.shadowBlur = 40;
    G.fillText("GOAL!", 0, -10);
    G.shadowBlur = 0;
    G.font = '500 13px "Rajdhani"';
    G.letterSpacing = "6px";
    G.fillStyle = isP ? `${P1_COLOR}bf` : `${P2_COLOR}bf`;
    G.fillText(isP ? "YOU SCORE" : (gameMode === "2p" ? "P2 SCORES" : "CPU SCORES"), 0, 22);
    G.restore();
    goalFlash--;
}

// ══════════════════════════════════════
//  REPLAY HIGHLIGHT SYSTEM
// ══════════════════════════════════════
const REPLAY_BUFFER_SEC = 3.5;        // seconds of history kept
const REPLAY_FPS = 60;
const REPLAY_MAX_FRAMES = Math.ceil(REPLAY_BUFFER_SEC * REPLAY_FPS);
const replayBuffer = [];              // circular buffer of snapshots
let replayState = "off";              // "off" | "playing"
let replayIndex = 0;
let replayFrames = [];                // frozen copy for playback
let replayTick = 0;
let replayTimer = 0;                  // ticks left in playback

function captureReplayFrame() {
    if (state !== "play") return;
    const snap = {
        puck: { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy },
        player: { x: player.x, y: player.y },
        cpu: { x: cpu.x, y: cpu.y },
        trail: trail.map((t) => ({ ...t }))
    };
    replayBuffer.push(snap);
    if (replayBuffer.length > REPLAY_MAX_FRAMES) replayBuffer.shift();
}

function triggerReplay() {
    if (replayBuffer.length < 20) return; // not enough footage
    replayFrames = [...replayBuffer];
    replayIndex = 0;
    replayState = "playing";
    replayTick = 0;
    replayTimer = replayFrames.length + 60; // extra 60 ticks fade-out
}

function drawReplay() {
    if (replayState !== "playing") return;
    // Vignette + scanlines overlay
    G.save();
    G.globalAlpha = 0.72;
    G.fillStyle = "rgba(0,0,0,0.62)";
    G.fillRect(0, 0, W, H);
    G.restore();

    if (replayIndex < replayFrames.length) {
        const f = replayFrames[replayIndex];
        // Draw replay puck
        G.save();
        G.shadowColor = "#ffc940";
        G.shadowBlur = 22;
        G.fillStyle = "#ffc940";
        G.beginPath();
        G.arc(f.puck.x, f.puck.y, PUCK_R, 0, Math.PI * 2);
        G.fill();
        G.restore();
        // Draw replay ghost mallets
        [{ m: f.player, col: P1_COLOR }, { m: f.cpu, col: P2_COLOR }].forEach(({ m, col }) => {
            G.save();
            G.globalAlpha = 0.55;
            G.shadowColor = col;
            G.shadowBlur = 14;
            G.strokeStyle = col;
            G.lineWidth = 2.5;
            G.beginPath();
            G.arc(m.x, m.y, MALLET_R, 0, Math.PI * 2);
            G.stroke();
            G.restore();
        });
    }

    // Label
    const fade = replayTimer < 40 ? replayTimer / 40 : replayIndex < 30 ? replayIndex / 30 : 1;
    G.save();
    G.globalAlpha = fade;
    G.textAlign = "center";
    G.font = '900 20px "Orbitron"';
    G.fillStyle = "#000";
    G.fillText("⏮  INSTANT REPLAY", W / 2 + 1, 55);
    G.fillStyle = "#ffc940";
    G.shadowColor = "#ffc940";
    G.shadowBlur = 14;
    G.fillText("⏮  INSTANT REPLAY", W / 2, 55);
    G.restore();

    replayIndex += 2; // 2× playback speed
    replayTick++;
    replayTimer--;
    if (replayTimer <= 0 || replayIndex >= replayFrames.length + 30) {
        replayState = "off";
        replayBuffer.length = 0;
    }
}

function updatePuckScaled(ts) {
    if (ts !== 1) {
        puck.vx *= ts;
        puck.vy *= ts;
    }
    updatePuck();
    if (ts !== 1 && state === "play") {
        puck.vx /= ts;
        puck.vy /= ts;
    }
}

// ── Utils ──
function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}
// ── Main Loop ──
function drawSadFace() {
    const cx = W / 2,
        cy = H / 2 - 30;
    const r = 52;
    const pulse = 0.85 + Math.sin(tick * 0.05) * 0.15;
    G.save();
    G.globalAlpha = 0.82 * pulse;

    // Face circle
    G.fillStyle = "#1a0a0a";
    G.beginPath();
    G.arc(cx, cy, r, 0, Math.PI * 2);
    G.fill();
    G.strokeStyle = "#ff2d55";
    G.lineWidth = 3;
    G.shadowColor = "#ff2d55";
    G.shadowBlur = 18;
    G.beginPath();
    G.arc(cx, cy, r, 0, Math.PI * 2);
    G.stroke();
    G.shadowBlur = 0;

    // Eyes (X marks)
    G.strokeStyle = "#ff2d55";
    G.lineWidth = 3.5;
    G.lineCap = "round";
    [
        [-18, -12],
        [18, -12]
    ].forEach(([ex, ey]) => {
        G.beginPath();
        G.moveTo(cx + ex - 7, cy + ey - 7);
        G.lineTo(cx + ex + 7, cy + ey + 7);
        G.stroke();
        G.beginPath();
        G.moveTo(cx + ex + 7, cy + ey - 7);
        G.lineTo(cx + ex - 7, cy + ey + 7);
        G.stroke();
    });

    // Sad mouth
    G.strokeStyle = "#ff2d55";
    G.lineWidth = 3.5;
    G.beginPath();
    G.arc(cx, cy + 28, 20, Math.PI * 0.15, Math.PI * 0.85, false);
    G.stroke();

    G.restore();
}

function loop() {
    tick++;
    try {
    G.clearRect(0, 0, W, H);
    G.fillStyle = THEME_COLORS.bg;
    G.fillRect(0, 0, W, H);

    // Slo-mo: fade vignette in/out
    if (sloMo) sloMoAlpha = Math.min(sloMoAlpha + 0.055, 1);
    else sloMoAlpha = Math.max(sloMoAlpha - 0.07, 0);
    if (sloMoIntro > 0) sloMoIntro--;
    if (sloMoLabelTimer > 0) sloMoLabelTimer--;
    if (goalSloMoTimer > 0) goalSloMoTimer--;

    const timeScale = sloMo ? 0.55 : goalSloMoTimer > 0 ? 0.35 : 1;

    if (shakeAmt > 0.3) {
        shakeX = (Math.random() - 0.5) * shakeAmt * 2;
        shakeY = (Math.random() - 0.5) * shakeAmt * 2;
        shakeAmt *= 0.72;
    } else {
        shakeX = 0;
        shakeY = 0;
        shakeAmt = 0;
    }

    G.save();
    G.translate(shakeX, shakeY);

    drawTable();

    if (state === "play" || state === "goal") {
        // Run physics sub-steps scaled by timeScale
        const steps = sloMo ? 1 : 1;
        for (let s = 0; s < steps; s++) {
            updatePlayer(timeScale);
            if (gameMode === "2p") updatePlayer2(timeScale);
            else updateCPU(timeScale);
            updatePuckScaled(timeScale);
            updateParticles();
            updatePowerUps();
            captureReplayFrame();
        }
    }
    // Paused: keep rendering but freeze everything — overlay handles UI
    if (state === "paused") {
        updateParticles(); // let particles fade naturally
    }
    updateConfetti();

    drawPowerUps();
    drawParticles();
    drawPuck();
    drawMallet(cpu, darken(P2_COLOR, 0.85), P2_COLOR);
    drawMallet(player, darken(P1_COLOR, 0.85), P1_COLOR);
    drawActiveEffectRings();
    drawGoalFlash();
    drawSpeedUpMsg();
    drawPowerUpToast();
    drawAchvToast();
    drawConfetti();
    if (showSadFace) drawSadFace();
    drawReplay();

    // ── Slo-mo cinematic overlay ──
    if (sloMoAlpha > 0) {
        // Vignette
        const vig = G.createRadialGradient(
            W / 2,
            H / 2,
            H * 0.15,
            W / 2,
            H / 2,
            H * 0.75
        );
        vig.addColorStop(0, "transparent");
        vig.addColorStop(1, `rgba(0,0,0,${0.65 * sloMoAlpha})`);
        G.fillStyle = vig;
        G.fillRect(0, 0, W, H);

        // Letterbox bars
        const barH = 32 * sloMoAlpha;
        G.fillStyle = `rgba(0,0,0,${0.88 * sloMoAlpha})`;
        G.fillRect(0, 0, W, barH);
        G.fillRect(0, H - barH, W, barH);

        // Chromatic edges
        G.save();
        G.globalAlpha = 0.15 * sloMoAlpha;
        G.fillStyle = "#ff0040";
        G.fillRect(0, 0, 5, H);
        G.fillRect(W - 5, 0, 5, H);
        G.fillStyle = "#0080ff";
        G.fillRect(5, 0, 5, H);
        G.fillRect(W - 10, 0, 5, H);
        G.restore();

        // GAME POINT — only show while label timer is active, pinned to top bar
        if (sloMoLabelTimer > 0) {
            const fadeIn = Math.min(sloMoLabelTimer / 20, 1);
            const fadeOut = sloMoLabelTimer < 30 ? sloMoLabelTimer / 30 : 1;
            const alpha = fadeIn * fadeOut * sloMoAlpha;
            const pulse = 0.88 + Math.sin(tick * 0.12) * 0.12;

            G.save();
            G.globalAlpha = alpha * pulse;
            G.textAlign = "center";
            G.font = '900 16px "Orbitron"';
            G.fillStyle = "rgba(0,0,0,0.5)";
            G.fillText("GAME POINT", W / 2 + 1, barH * 0.72 + 1);
            G.fillStyle = "#ffc940";
            G.shadowColor = "#ffc940";
            G.shadowBlur = 14;
            G.fillText("GAME POINT", W / 2, barH * 0.72);
            G.shadowBlur = 0;
            G.restore();
        }
    }

    } catch(err) {
        console.error("Loop draw error:", err);
        G.restore && G.restore();
    }
    requestAnimationFrame(loop);
}

function safeDraw(fn) {
    try { fn(); } catch(e) { /* swallow individual draw errors so loop keeps running */ }
}

function drawSpeedUpMsg() {
    if (speedUpTimer <= 0) return;
    const t = speedUpTimer / 130;
    // Slam in fast, hold, then fade
    const scale = t > 0.85 ? 0.5 + (1 - (t - 0.85) / 0.15) * 0.5 : 1;
    const alpha = t < 0.2 ? t / 0.2 : 1;
    G.save();
    G.globalAlpha = alpha;
    G.translate(W / 2, H / 2 - 60);
    G.scale(scale, scale);
    G.textAlign = "center";
    // Chunky outline
    G.font = '900 34px "Orbitron"';
    G.fillStyle = "#000";
    G.fillText(speedUpMsg, 2, 2);
    // Gradient fill — gold to orange
    const grd = G.createLinearGradient(-100, -30, 100, 10);
    grd.addColorStop(0, "#ffc940");
    grd.addColorStop(1, "#ff6820");
    G.fillStyle = grd;
    G.shadowColor = "#ffc940";
    G.shadowBlur = 24;
    G.fillText(speedUpMsg, 0, 0);
    G.restore();
    speedUpTimer--;
}

// ══════════════════════════════════════
//  INIT — wire up all UI event listeners
//  (called after all functions are defined)
// ══════════════════════════════════════
function initMenu() {
    document.body.classList.add("menu-open");

    // Gameover screen buttons
    document.getElementById("btn-again").onclick = startGame;
    document.getElementById("btn-menu").onclick  = backToMenu;

    // Color swatches
    buildSwatches(document.getElementById("p1-swatches"), P1_COLOR, c => (P1_COLOR = c));
    buildSwatches(document.getElementById("p2-swatches"), P2_COLOR, c => (P2_COLOR = c));

    // Mode buttons
    document.getElementById("mode-1p").onclick         = () => setMode("1p");
    document.getElementById("mode-2p").onclick         = () => setMode("2p");
    document.getElementById("mode-tournament").onclick = () => setMode("tournament");
    setMode("1p");

    // Difficulty buttons
    document.querySelectorAll(".diff-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            difficulty = btn.dataset.diff;
            applyDifficulty(difficulty);
        };
    });
    applyDifficulty(difficulty);

    // Theme buttons
    const themeBtnsEl = document.getElementById("theme-buttons");
    THEMES.forEach(t => {
        const b = document.createElement("button");
        b.className = "theme-btn" + (t.id === currentTheme ? " active" : "");
        b.type = "button"; b.dataset.theme = t.id;
        b.innerHTML = `<span class="theme-icon">${iconHTML(t.icon)}</span>${t.label}`;
        b.onclick = () => setTheme(t.id);
        themeBtnsEl.appendChild(b);
    });
    document.body.setAttribute("data-theme", "cyber");
    readThemeColors();

    // Paddle shape buttons
    const shapeBtnsEl = document.getElementById("shape-buttons");
    if (shapeBtnsEl) {
        PADDLE_SHAPES.forEach(s => {
            const b = document.createElement("button");
            b.className = "theme-btn shape-btn" + (s.id === paddleShape ? " active" : "");
            b.type = "button"; b.dataset.shape = s.id;
            b.innerHTML = `<span class="theme-emoji">${s.icon}</span>${s.label}`;
            b.onclick = () => {
                document.querySelectorAll(".shape-btn").forEach(sb => sb.classList.remove("active"));
                b.classList.add("active"); paddleShape = s.id; savePrefs();
            };
            shapeBtnsEl.appendChild(b);
        });
    }

    // Glow slider
    const glowSlider = document.getElementById("glow-slider");
    const glowValEl  = document.getElementById("glow-val");
    if (glowSlider) {
        glowSlider.value = glowIntensity;
        if (glowValEl) glowValEl.textContent = glowIntensity.toFixed(1) + "×";
        glowSlider.oninput = () => {
            glowIntensity = parseFloat(glowSlider.value);
            if (glowValEl) glowValEl.textContent = glowIntensity.toFixed(1) + "×";
            savePrefs();
        };
    }

    // Sound toggle
    const soundToggleEl = document.getElementById("sound-toggle");
    if (soundToggleEl) {
        soundToggleEl.onclick = () => {
            toggleMute();
            setButtonIconText(soundToggleEl, muted ? "i-volume-x" : "i-volume-high", muted ? "SOUND OFF" : "SOUND ON");
            soundToggleEl.classList.toggle("off", muted);
        };
        setButtonIconText(soundToggleEl, muted ? "i-volume-x" : "i-volume-high", muted ? "SOUND OFF" : "SOUND ON");
    }

    // Power-ups toggle
    const powerUpsToggleEl = document.getElementById("powerups-toggle");
    if (powerUpsToggleEl) {
        powerUpsToggleEl.onclick = () => {
            powerUpsEnabled = !powerUpsEnabled;
            setButtonIconText(powerUpsToggleEl, "i-bolt", powerUpsEnabled ? "POWER-UPS ON" : "POWER-UPS OFF");
            powerUpsToggleEl.classList.toggle("active", powerUpsEnabled);
            powerUpsToggleEl.classList.toggle("off", !powerUpsEnabled);
        };
        setButtonIconText(powerUpsToggleEl, "i-bolt", powerUpsEnabled ? "POWER-UPS ON" : "POWER-UPS OFF");
    }

    // Stats modal
    const statsBtnEl = document.getElementById("stats-btn");
    if (statsBtnEl)  statsBtnEl.onclick  = () => { renderStats(); statsModalEl.classList.remove("hidden"); };
    const statsCloseEl = document.getElementById("stats-close");
    if (statsCloseEl) statsCloseEl.onclick = () => statsModalEl.classList.add("hidden");

    // Tournament bracket
    const tbCont = document.getElementById("tb-continue");
    if (tbCont) tbCont.onclick = () => { bracketEl.classList.add("hidden"); startGame(); };
    if (btnNextRound) btnNextRound.onclick = () => { gameoverEl.classList.remove("on","lose-state"); startGame(); };

    // Start game button
    document.getElementById("btn-start").onclick = () => {
        menuEl.classList.add("hidden");
        document.body.classList.remove("menu-open");
        gameRootEl.classList.remove("hidden-init");
        applyColorsToDOM();
        if (gameMode === "tournament") startTournament();
        else startGame();
    };

    // Pause buttons
    document.getElementById("pause-resume").onclick  = () => setPaused(false);
    document.getElementById("pause-restart").onclick = () => { setPaused(false); startGame(); };
    document.getElementById("pause-menu").onclick    = () => { setPaused(false); backToMenu(); };
    document.getElementById("pause-replay").onclick  = () => { setPaused(false); triggerReplay(); };
    document.getElementById("pause-sound").onclick = () => {
        toggleMute();
        renderPauseSoundButton();
    };

    // Pause button icon (⏸ button visible in arena)
    const pauseBtnIcon = document.getElementById("pause-btn-icon");
    if (pauseBtnIcon) {
        pauseBtnIcon.onclick = () => {
            if (state === "play") setPaused(true);
            else if (state === "paused") setPaused(false);
        };
    }

    // In-game mute button
    if (muteBtn) {
        muteBtn.style.cursor = "pointer";
        muteBtn.style.pointerEvents = "all";
        muteBtn.onclick = toggleMute;
    }
    updateMuteLabel();

    // Load prefs + daily challenge
    loadPrefs();
    loadDailyChallenge();
}

initMenu();
loop();
