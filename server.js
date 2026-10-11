// Monopoli multiplayer - server otoritatif (Express + Socket.IO)
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// CORS: frontend di Netlify beda domain dengan backend Railway.
// Default: hanya situs Netlify-mu. Bisa ditimpa lewat variabel FRONTEND_ORIGIN di Railway (pisah koma kalau lebih dari satu).
const DEFAULT_ORIGIN = 'https://lovely-cocada-cdec95.netlify.app';
const ORIGINS = (process.env.FRONTEND_ORIGIN || DEFAULT_ORIGIN)
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: 10000, pingTimeout: 20000,
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/healthz', (req, res) => res.send('ok'));

// ====== SAFETY NET ======
// Jangan biarkan satu error tak terduga mematikan seluruh server (semua room hilang).
// Cukup log ke console; room lain tetap jalan.
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});

// ====== DATA PAPAN ======
// t: type (go, prop, rr, util, tax, chance, chest, jail, free, gotojail)
const B = [
  { n: 'START', t: 'go' },
  { n: 'Kuala Lumpur', t: 'prop', p: 60, g: 0 },
  { n: 'Dana Umum', t: 'chest' },
  { n: 'Bangkok', t: 'prop', p: 60, g: 0 },
  { n: 'Pajak Pemasukan', t: 'tax', p: 200 },
  { n: 'Bandara Chang-i', t: 'rr', p: 200 },
  { n: 'Singapura', t: 'prop', p: 100, g: 1 },
  { n: 'Kesempatan', t: 'chance' },
  { n: 'Manila', t: 'prop', p: 100, g: 1 },
  { n: 'Seoul', t: 'prop', p: 120, g: 1 },
  { n: 'Penjara', t: 'jail' },
  { n: 'Tokyo', t: 'prop', p: 140, g: 2 },
  { n: 'Perusahaan Listrik', t: 'util', p: 150 },
  { n: 'Taipei', t: 'prop', p: 140, g: 2 },
  { n: 'Hongkong', t: 'prop', p: 160, g: 2 },
  { n: 'Narita', t: 'rr', p: 200 },
  { n: 'New Delhi', t: 'prop', p: 180, g: 3 },
  { n: 'Dana Umum', t: 'chest' },
  { n: 'Riyadh', t: 'prop', p: 180, g: 3 },
  { n: 'Moskow', t: 'prop', p: 180, g: 3 },
  { n: 'Parkir Bebas', t: 'free' },
  { n: 'Beijing', t: 'prop', p: 220, g: 4 },
  { n: 'Kesempatan', t: 'chance' },
  { n: 'Brazilia', t: 'prop', p: 220, g: 4 },
  { n: 'London', t: 'prop', p: 240, g: 4 },
  { n: 'JFK', t: 'rr', p: 200 },
  { n: 'Amsterdam', t: 'prop', p: 260, g: 5 },
  { n: 'Paris', t: 'prop', p: 260, g: 5 },
  { n: 'Perusahaan Air', t: 'util', p: 150 },
  { n: 'Roma', t: 'prop', p: 280, g: 5 },
  { n: 'Masuk Penjara', t: 'gotojail' },
  { n: 'Mexico City', t: 'prop', p: 300, g: 6 },
  { n: 'Ottawa', t: 'prop', p: 300, g: 6 },
  { n: 'Dana Umum', t: 'chest' },
  { n: 'Washington', t: 'prop', p: 320, g: 6 },
  { n: 'Soekarno-Hatta', t: 'rr', p: 200 },
  { n: 'Kesempatan', t: 'chance' },
  { n: 'Canberra', t: 'prop', p: 350, g: 7 },
  { n: 'Pajak Tertinggi', t: 'tax', p: 100 },
  { n: 'Jakarta', t: 'prop', p: 400, g: 7 },
];
const GROUPS = [[1, 3], [6, 8, 9], [11, 13, 14], [16, 18, 19], [21, 23, 24], [26, 27, 29], [31, 32, 34], [37, 39]];
const HOUSE_COST = [50, 50, 100, 100, 150, 150, 200, 200];
const RENT_MULT = [1, 5, 15, 40, 55, 70];
const START_CASH = 1500, GO_SALARY = 200, JAIL_FEE = 50, JAIL_POS = 10;
const TURN_MS = 60000, DISC_MS = 60000;
const ABANDON_MS = 5 * 60 * 1000; // pemain putus > 5 menit dianggap menyerah (bangkrut)

// Kartu: [teks, jenis, nilai]
// jenis: cash (+/-), goto (maju ke petak), back (mundur n), jail, allpay, allget
const CHANCE = [
  ['Maju ke START, terima 200', 'goto', 0],
  ['Maju ke Tokyo', 'goto', 11],
  ['Maju ke Jakarta', 'goto', 39],
  ['Mundur 3 petak', 'back', 3],
  ['Masuk Penjara', 'jail', 0],
  ['Dividen saham, terima 50', 'cash', 50],
  ['Denda ngebut, bayar 15', 'cash', -15],
  ['Menang lomba, terima 100', 'cash', 100],
  ['Perbaikan rumah, bayar 40', 'cash', -40],
  ['Maju ke Bandara Soekarno-Hatta', 'goto', 35],
  ['Ulang tahun! Terima 10 dari tiap pemain', 'allget', 10],
  ['Traktir semua, bayar 10 ke tiap pemain', 'allpay', 10],
];
const CHEST = [
  ['Kesalahan bank, terima 200', 'cash', 200],
  ['Biaya dokter, bayar 50', 'cash', -50],
  ['Warisan, terima 100', 'cash', 100],
  ['Jual saham, terima 45', 'cash', 45],
  ['Biaya sekolah, bayar 100', 'cash', -100],
  ['Masuk Penjara', 'jail', 0],
  ['Maju ke START, terima 200', 'goto', 0],
  ['Restitusi pajak, terima 20', 'cash', 20],
  ['Hadiah kontes kecantikan, terima 10', 'cash', 10],
  ['Biaya rumah sakit, bayar 100', 'cash', -100],
  ['Mundur 3 petak', 'back', 3],
  ['Asuransi jatuh tempo, terima 100', 'cash', 100],
];

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1'];
const EMOJIS = ['😎', '🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🚀', '👑', '🔥'];

const rooms = new Map();

// ====== UTIL ======
const rnd = n => crypto.randomInt(n);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, n);
const token = () => crypto.randomBytes(16).toString('hex');
function roomCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let k = 0; k < 200; k++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += L[rnd(L.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function newPlayer(tok, name, emoji, color, sid) {
  return {
    id: crypto.randomBytes(4).toString('hex'), tok, sid, name, emoji, color,
    ready: false, connected: true, discAt: 0,
    cash: START_CASH, pos: 0, jail: 0, jailTurns: 0, alive: true,
    props: [], rentPaid: 0, doubles: 0, hasJailCard: false,
  };
}

function makeRoom(code) {
  return {
    code, players: [], hostId: null, phase: 'lobby', // lobby | roll | act | buy | over
    turn: 0, owner: {}, houses: {}, dice: [0, 0], log: [], logc: 0, seq: 0, lastActive: Date.now(),
    chanceDeck: [], chestDeck: [], deadline: 0,
    timer: null, discTimer: null, autoPlaying: false,
    pendingBuy: null,
    winnerId: null, stats: null, busyUntil: 0, extraTurn: false,
    lastReact: {},
  };
}
function resetGame(r) {
  r.owner = {}; r.houses = {}; r.turn = 0; r.dice = [0, 0]; r.log = []; r.pendingBuy = null;
  r.winnerId = null; r.stats = null; r.extraTurn = false;
  r.chanceDeck = shuffle([...CHANCE.keys()]); r.chestDeck = shuffle([...CHEST.keys()]);
  r.players.forEach(p => {
    Object.assign(p, { cash: START_CASH, pos: 0, jail: 0, jailTurns: 0, alive: true, props: [], rentPaid: 0, doubles: 0, hasJailCard: false });
  });
}

// ====== LOGIKA HARGA ======
const groupOf = i => B[i].g;
function ownsSet(r, pid, g) { return GROUPS[g].every(i => r.owner[i] === pid); }
function countOwned(r, pid, type) { return B.reduce((n, s, i) => n + (s.t === type && r.owner[i] === pid ? 1 : 0), 0); }
function rentFor(r, i, diceTotal) {
  const s = B[i], o = r.owner[i];
  if (!o) return 0;
  if (s.t === 'prop') {
    const h = r.houses[i] || 0;
    const base = Math.round(s.p / 16) * RENT_MULT[h];
    return (h === 0 && ownsSet(r, o, s.g)) ? base * 2 : base;
  }
  if (s.t === 'rr') return 25 << (countOwned(r, o, 'rr') - 1);
  if (s.t === 'util') return (countOwned(r, o, 'util') === 2 ? 10 : 4) * diceTotal;
  return 0;
}
const assetValue = (r, p) => p.cash + p.props.reduce((n, i) => n + B[i].p + (r.houses[i] || 0) * HOUSE_COST[B[i].g] , 0);

// ====== EVENT & BROADCAST ======
// Event: dice, mv, tp, $, card, own, bk, log -> diputar berurutan di klien
function publicState(r) {
  return {
    code: r.code, phase: r.phase, turn: r.turn, hostId: r.hostId, dice: r.dice,
    owner: r.owner, houses: r.houses, deadline: r.deadline, pendingBuy: r.pendingBuy,
    winnerId: r.winnerId, stats: r.stats, log: r.log.slice(-60), logc: r.logc,
    players: r.players.map(p => ({
      id: p.id, name: p.name, emoji: p.emoji, color: p.color, ready: p.ready, connected: p.connected,
      cash: p.cash, pos: p.pos, jail: p.jail, alive: p.alive, props: p.props, total: assetValue(r, p),
    })),
    cur: r.players[r.turn] ? r.players[r.turn].id : null,
  };
}
function emitState(r, events, evMs) {
  r.seq++;
  r.lastActive = Date.now();
  const ms = Math.min(evMs || 0, 20000);
  r.busyUntil = Date.now() + ms * 0.45; // toleransi; klien otomatis mencoba lagi kalau terlalu cepat
  io.to(r.code).emit('state', { s: publicState(r), ev: events || [], seq: r.seq, ms, t: Date.now() });
}
function addLog(r, text) { r.log.push(text); r.logc++; if (r.log.length > 200) r.log.shift(); }
const boardInfo = () => ({ B, GROUPS, HOUSE_COST, RENT_MULT });
const rp = n => 'Rp ' + (n * 1000).toLocaleString('id-ID');

// Estimasi durasi animasi event (ms) supaya server tahu kapan aksi baru boleh
function evDuration(evs) {
  let t = 0;
  for (const e of evs) {
    if (e.k === 'dice') t += 1400;
    else if (e.k === 'mv') t += 260 * Math.max(1, e.steps || 1) + 200;
    else if (e.k === 'tp') t += 900;
    else if (e.k === '$') t += 700;
    else if (e.k === 'card') t += 2600;
    else if (e.k === 'own') t += 900;
    else if (e.k === 'bk') t += 1100;
  }
  return t;
}

// ====== TIMER GILIRAN ======
function clearTimer(r) {
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  if (r.discTimer) { clearTimeout(r.discTimer); r.discTimer = null; }
}
function armTimer(r, extraMs) {
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  if (r.phase === 'lobby' || r.phase === 'over') { r.deadline = 0; return; }
  const cur = r.players[r.turn];
  const wait = (cur && !cur.connected && Date.now() - cur.discAt >= DISC_MS) ? 1200 : TURN_MS;
  r.deadline = Date.now() + wait + (extraMs || 0);
  r.timer = setTimeout(() => autoPlay(r), wait + (extraMs || 0) + 100);
}
// autoPlay dibungkus guard supaya timer giliran & discTimer tidak memanggil bersamaan
function autoPlay(r) {
  if (r.phase === 'lobby' || r.phase === 'over') return;
  if (r.autoPlaying) return;
  r.autoPlaying = true;
  try { autoPlayInner(r); }
  finally { r.autoPlaying = false; }
}
function autoPlayInner(r) {
  const p = r.players[r.turn];
  if (!p || !p.alive) return;
  // pemain putus lebih dari 60 detik: giliran dilewati
  if (!p.connected && Date.now() - p.discAt >= DISC_MS - 500) {
    const ev0 = [];
    r.pendingBuy = null; r.extraTurn = false;
    addLog(r, `${p.name} tidak terhubung, giliran dilewati`);
    // kalau sudah benar-benar lama (abandon), anggap menyerah → bangkrut ke bank
    if (Date.now() - p.discAt >= ABANDON_MS) {
      addLog(r, `${p.name} dinyatakan menyerah (lama tidak kembali)`);
      bankrupt(r, p, null, ev0);
      if (checkWin(r, ev0)) { emitState(r, ev0, evDuration(ev0)); return; }
    }
    endTurn(r, ev0); finish(r, ev0); return;
  }
  // habis waktu: lempar otomatis dan selesai tanpa membeli
  const evs = [];
  if (r.phase === 'roll') {
    doRoll(r, p, evs);
  }
  if (r.phase === 'buy') { r.pendingBuy = null; r.phase = 'act'; }
  if (r.phase === 'act' || r.phase === 'roll') {
    let guard = 0;
    while (r.phase === 'roll' && guard++ < 4 && r.players[r.turn] === p && p.alive) {
      doRoll(r, p, evs);
      if (r.phase === 'buy') { r.pendingBuy = null; r.phase = 'act'; }
    }
    if (r.phase === 'act' && r.players[r.turn] === p) endTurn(r, evs);
  }
  finish(r, evs);
}

// ====== INTI GAME ======
function transfer(r, from, to, amt, evs, why) {
  if (amt <= 0) return true;
  if (from && from.cash < amt) {
    const got = from.cash;
    if (to && got > 0) { to.cash += got; evs.push({ k: '$', p: to.id, v: got }); }
    if (from) { evs.push({ k: '$', p: from.id, v: -got }); from.cash = 0; }
    addLog(r, `${from.name} tidak mampu bayar ${rp(amt)} (${why}) dan bangkrut`);
    bankrupt(r, from, to, evs);
    return false;
  }
  if (from) { from.cash -= amt; evs.push({ k: '$', p: from.id, v: -amt }); }
  if (to) { to.cash += amt; evs.push({ k: '$', p: to.id, v: amt }); }
  return true;
}
function bankrupt(r, p, creditor, evs) {
  p.alive = false;
  evs.push({ k: 'bk', p: p.id });
  p.props.forEach(i => {
    r.houses[i] = 0;
    if (creditor && creditor.alive) { r.owner[i] = creditor.id; creditor.props.push(i); evs.push({ k: 'own', i, p: creditor.id }); }
    else { delete r.owner[i]; evs.push({ k: 'own', i, p: null }); }
  });
  p.props = [];
  if (p.hasJailCard) p.hasJailCard = false;
  r.pendingBuy = null;
}
function nextAlive(r, from) {
  const n = r.players.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (r.players[i].alive) return i; }
  return from;
}
function checkWin(r, evs) {
  const alive = r.players.filter(p => p.alive);
  if (alive.length <= 1 && r.phase !== 'over') {
    r.phase = 'over'; r.winnerId = alive[0] ? alive[0].id : null;
    clearTimer(r); r.deadline = 0;
    r.stats = {
      rows: r.players.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, total: p.alive ? assetValue(r, p) : 0, props: p.props.length, rent: p.rentPaid, alive: p.alive })),
    };
    evs.push({ k: 'win', p: r.winnerId });
    addLog(r, `🏆 ${alive[0] ? alive[0].name : '-'} menang!`);
    return true;
  }
  return false;
}
function moveTo(r, p, target, evs, forward, collect) {
  if (forward) {
    const steps = (target - p.pos + 40) % 40;
    const passGo = p.pos + steps >= 40;
    evs.push({ k: 'mv', p: p.id, from: p.pos, to: target, steps });
    p.pos = target;
    if (passGo && collect) { p.cash += GO_SALARY; evs.push({ k: '$', p: p.id, v: GO_SALARY }); addLog(r, `${p.name} lewat START, terima ${rp(GO_SALARY)}`); }
  } else {
    evs.push({ k: 'tp', p: p.id, from: p.pos, to: target });
    p.pos = target;
  }
}
function sendJail(r, p, evs) {
  evs.push({ k: 'tp', p: p.id, from: p.pos, to: JAIL_POS });
  p.pos = JAIL_POS; p.jail = 1; p.jailTurns = 0; p.doubles = 0;
  addLog(r, `${p.name} masuk penjara`);
}
function landOn(r, p, evs, diceTotal) {
  const i = p.pos, s = B[i];
  if (s.t === 'prop' || s.t === 'rr' || s.t === 'util') {
    const o = r.owner[i];
    if (!o) {
      r.phase = 'buy'; r.pendingBuy = { i, price: s.p };
      return;
    }
    if (o !== p.id) {
      const owner = r.players.find(x => x.id === o);
      const rent = rentFor(r, i, diceTotal);
      if (owner && owner.alive && rent > 0) {
        const ok = transfer(r, p, owner, rent, evs, 'sewa ' + s.n);
        if (ok) { p.rentPaid += rent; addLog(r, `${p.name} bayar sewa ${rp(rent)} ke ${owner.name}`); }
      }
    }
  } else if (s.t === 'tax') {
    if (transfer(r, p, null, s.p, evs, s.n)) addLog(r, `${p.name} bayar ${s.n} ${rp(s.p)}`);
  } else if (s.t === 'gotojail') {
    sendJail(r, p, evs);
  } else if (s.t === 'chance' || s.t === 'chest') {
    drawCard(r, p, s.t, evs, diceTotal);
  }
}
function drawCard(r, p, kind, evs, diceTotal) {
  const deck = kind === 'chance' ? r.chanceDeck : r.chestDeck;
  const list = kind === 'chance' ? CHANCE : CHEST;
  if (!deck.length) deck.push(...shuffle([...list.keys()]));
  const [txt, type, val] = list[deck.shift()];
  evs.push({ k: 'card', kind, text: txt, p: p.id });
  addLog(r, `${p.name} ambil kartu: ${txt}`);
  if (type === 'cash') {
    if (val > 0) { p.cash += val; evs.push({ k: '$', p: p.id, v: val }); }
    else transfer(r, p, null, -val, evs, 'kartu');
  } else if (type === 'goto') {
    const passGo = val === 0 || val < p.pos;
    moveTo(r, p, val, evs, false);
    if (passGo) { p.cash += GO_SALARY; evs.push({ k: '$', p: p.id, v: GO_SALARY }); addLog(r, `${p.name} terima gaji ${rp(GO_SALARY)}`); }
    if (val !== 0) landOn(r, p, evs, diceTotal);
  } else if (type === 'back') {
    const t = (p.pos - val + 40) % 40;
    moveTo(r, p, t, evs, false);
    landOn(r, p, evs, diceTotal);
  } else if (type === 'jail') {
    sendJail(r, p, evs);
  } else if (type === 'allget') {
    r.players.filter(x => x.alive && x.id !== p.id).forEach(x => { if (p.alive) transfer(r, x, p, val, evs, 'kartu'); });
  } else if (type === 'allpay') {
    r.players.filter(x => x.alive && x.id !== p.id).forEach(x => { if (p.alive) transfer(r, p, x, val, evs, 'kartu'); });
  }
}

function doRoll(r, p, evs) {
  const d1 = 1 + rnd(6), d2 = 1 + rnd(6), tot = d1 + d2, dbl = d1 === d2;
  r.dice = [d1, d2];
  evs.push({ k: 'dice', p: p.id, d: [d1, d2] });
  addLog(r, `${p.name} lempar dadu: ${d1} + ${d2}`);
  r.extraTurn = false;

  if (p.jail > 0) {
    if (dbl) {
      p.jail = 0; p.jailTurns = 0; p.doubles = 0;
      addLog(r, `${p.name} keluar penjara dengan dadu kembar`);
      stepMove(r, p, tot, evs);
      afterMove(r, p, evs, tot, false);
    } else {
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        const ok = transfer(r, p, null, JAIL_FEE, evs, 'denda penjara');
        if (ok) {
          p.jail = 0; p.jailTurns = 0;
          addLog(r, `${p.name} wajib bayar ${rp(JAIL_FEE)} dan keluar penjara`);
          stepMove(r, p, tot, evs);
          afterMove(r, p, evs, tot, false);
        } else { r.phase = 'act'; }
      } else {
        addLog(r, `${p.name} gagal keluar penjara (${p.jailTurns}/3)`);
        r.phase = 'act';
      }
    }
    return;
  }
  if (dbl) {
    p.doubles++;
    if (p.doubles >= 3) { addLog(r, `${p.name} 3x kembar beruntun!`); sendJail(r, p, evs); r.phase = 'act'; return; }
  } else p.doubles = 0;
  stepMove(r, p, tot, evs);
  afterMove(r, p, evs, tot, dbl);
}
function stepMove(r, p, tot, evs) {
  const target = (p.pos + tot) % 40;
  moveTo(r, p, target, evs, true, true);
}
function afterMove(r, p, evs, tot, dbl) {
  r.phase = 'act';
  r.pendingBuy = null;
  landOn(r, p, evs, tot);
  if (!p.alive) return;
  r.extraTurn = dbl && p.jail === 0 && p.alive;
}
function endTurn(r, evs) {
  const p = r.players[r.turn];
  r.pendingBuy = null;
  if (p && p.alive && r.extraTurn && p.jail === 0) {
    r.extraTurn = false; r.phase = 'roll'; addLog(r, `${p.name} jalan lagi (kembar)`);
    return;
  }
  if (p) p.doubles = 0;
  r.extraTurn = false;
  r.turn = nextAlive(r, r.turn);
  r.phase = 'roll';
  const np = r.players[r.turn];
  addLog(r, `Giliran ${np.name}`);
}
function finish(r, evs) {
  if (checkWin(r, evs)) { emitState(r, evs, evDuration(evs)); return; }
  const cur = r.players[r.turn];
  if (!cur.alive) { r.extraTurn = false; r.turn = nextAlive(r, r.turn); r.phase = 'roll'; addLog(r, `Giliran ${r.players[r.turn].name}`); }
  const ms = evDuration(evs);
  armTimer(r, ms);
  emitState(r, evs, ms);
  notifyTurn(r);
  scheduleDiscSkip(r);
}
function notifyTurn(r) {
  const cur = r.players[r.turn];
  if (cur && cur.sid && r.phase === 'roll') io.to(cur.sid).emit('yourTurn');
}
function scheduleDiscSkip(r) {
  const cur = r.players[r.turn];
  if (cur && !cur.connected && r.phase !== 'over' && r.phase !== 'lobby') {
    const wait = Math.max(0, DISC_MS - (Date.now() - cur.discAt));
    if (r.discTimer) clearTimeout(r.discTimer);
    r.discTimer = setTimeout(() => {
      const c = r.players[r.turn];
      if (c && !c.connected && r.phase !== 'over') { autoPlay(r); }
    }, wait + 200);
  } else if (r.discTimer) {
    clearTimeout(r.discTimer); r.discTimer = null;
  }
}

// ====== HANDLER AKSI ======
function getCtx(sock) {
  const r = rooms.get(sock.data && sock.data.room);
  if (!r) return {};
  const p = r.players.find(x => x.tok === sock.data.tok);
  return { r, p };
}
function myTurnGuard(r, p, phases) {
  if (!r || !p || r.phase === 'lobby' || r.phase === 'over') return 'Game tidak sedang berjalan';
  if (r.players[r.turn] !== p) return 'Bukan giliranmu';
  if (!p.alive) return 'Kamu sudah bangkrut';
  if (!phases.includes(r.phase)) return 'Aksi tidak sesuai fase';
  if (Date.now() < r.busyUntil - 150) return 'Tunggu animasi selesai';
  return null;
}
const rate = new Map(); // anti spam per socket
function limited(sock, key, ms) {
  const k = sock.id + key, now = Date.now();
  if ((rate.get(k) || 0) > now) return true;
  rate.set(k, now + ms); return false;
}

io.on('connection', sock => {
  const err = m => s
