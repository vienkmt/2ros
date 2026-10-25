/* Turtle Control - client
 * Luong du lieu:
 *   SSE  /api/stream  -> pose lien tuc -> ve canvas, cap nhat bang so
 *   POST /api/cmd_vel -> gui Twist (goi lap 10Hz khi dang giu phim / joystick)
 *   POST /api/...     -> cac service: spawn, kill, clear, set_pen, teleport, background
 */
'use strict';

const $ = (id) => document.getElementById(id);
const WORLD = 11.0;                       // turtlesim world 11x11
const map = $('map');                 // lop chinh: WebGL (hoac 2D neu khong co WebGL)
const overlay = $('overlay');         // lop chu: ten rua, so truc (canvas 2D trong suot)
const octx = overlay.getContext('2d');
const GL = (window.TurtleGL && !location.search.includes('no-gl')) ? TurtleGL.create(map) : null;
const ctx = GL ? null : map.getContext('2d');
const trailCv = document.createElement('canvas');   // lop vet cho che do 2D
const tctx = trailCv.getContext('2d');
let SIZE = 560;                                     // kich thuoc logic (CSS px) cua ban do
let DPR = 1;
const trails = {};                                  // name -> [{x0,y0,x1,y1,color,w}]  (toa do the gioi)
const MAX_SEG = 20000;
$('renderer').textContent = GL ? 'GPU · WebGL' : 'Canvas 2D';
$('renderer').className = 'badge ' + (GL ? 'gpu' : 'cpu');

// Co ban do sao cho pin + ban do vua trong 1 man hinh, khong phai cuon.
// Do that vi tri dinh ban do roi lay phan con lai cua cua so, tru chu thich va dem.
const mapWrap = document.querySelector('.map-wrap');
const mapCard = mapWrap.closest('.card');
let lastFit = 0;
function fitMap() {
  const twoCols = window.innerWidth > 1000;
  const colW = mapCard.clientWidth - 32;                     // padding card 16 x 2
  let size = colW;
  if (twoCols) {
    const top = mapWrap.getBoundingClientRect().top + window.scrollY;
    // moi thu nam duoi ban do trong card (pose strip, hint...) + padding card + padding main + du phong
    let below = 14 + 16 + 4;
    for (let el = mapWrap.nextElementSibling; el; el = el.nextElementSibling) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      below += el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
    }
    const avail = window.innerHeight - top - below;
    size = Math.min(colW, avail);
  }
  size = Math.max(200, Math.floor(size));
  if (size !== lastFit) { lastFit = size; mapWrap.style.width = size + 'px'; }
}

// Ve canvas theo mat do diem anh man hinh (Retina) de khong bi mo
function resizeCanvas() {
  fitMap();
  const rect = map.getBoundingClientRect();
  const css = Math.max(100, Math.round(rect.width));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (css === SIZE && dpr === DPR && map.width === Math.round(css * dpr)) return;
  SIZE = css; DPR = dpr;
  map.style.height = css + 'px';
  overlay.width = Math.round(css * dpr); overlay.height = Math.round(css * dpr);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (GL) { GL.resize(css, dpr); return; }
  for (const cv of [map, trailCv]) { cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawTrails();
}
const FADE_SEC = 60;                 // moi phut, vet cu mo di mot nua (san 12%)
function fadeAlpha(t) { return Math.max(0.12, Math.pow(0.5, Math.floor((performance.now() - t) / 1000 / FADE_SEC))); }
function redrawTrails() {            // chi dung cho che do 2D
  tctx.clearRect(0, 0, SIZE, SIZE);
  tctx.lineCap = 'round'; tctx.lineJoin = 'round';
  for (const segs of Object.values(trails)) {
    for (const sg of segs) {
      const a = toPx(sg.x0, sg.y0), b = toPx(sg.x1, sg.y1);
      tctx.globalAlpha = fadeAlpha(sg.t);
      tctx.strokeStyle = sg.color; tctx.lineWidth = sg.w;
      tctx.beginPath(); tctx.moveTo(a.x, a.y); tctx.lineTo(b.x, b.y); tctx.stroke();
    }
  }
  tctx.globalAlpha = 1;
}
if (!GL) setInterval(redrawTrails, FADE_SEC * 1000);
function addSegment(name, sg) {
  if (GL) { GL.addSegment(sg); return; }
  sg.t = performance.now();
  (trails[name] = trails[name] || []).push(sg);
  if (trails[name].length > MAX_SEG) trails[name].shift();
  const a = toPx(sg.x0, sg.y0), b = toPx(sg.x1, sg.y1);
  tctx.strokeStyle = sg.color; tctx.lineWidth = sg.w; tctx.lineCap = 'round';
  tctx.beginPath(); tctx.moveTo(a.x, a.y); tctx.lineTo(b.x, b.y); tctx.stroke();
}
function clearTrails() {
  for (const k in trails) delete trails[k];
  if (GL) GL.clearTrails(); else tctx.clearRect(0, 0, SIZE, SIZE);
}
window.addEventListener('resize', resizeCanvas);

const state = {
  turtles: {},        // name -> pose
  selected: 'turtle1',
  bg: '#212445',
  lastPose: {},       // name -> {x,y}  de ve vet
  hz: { count: 0, t: performance.now(), value: 0 },
  penColor: {},       // name -> css color
  penWidth: {},       // name -> px
  samples: {},        // name -> [{t, x, y, theta, v, w}]  (t = dong ho server, ms)
  smooth: {},         // name -> pose da noi suy, dung de ve
  clockOffset: null,  // performance.now() - t_server  (uoc luong, ms)
  fps: { count: 0, t: performance.now(), value: 0 },
  goals: {},          // name -> {x, y}  muc tieu go-to-goal dang chay
  battery: {},        // name -> ban tin pin moi nhat
  battHist: {},       // name -> {volt:[], cur:[], temp:[]}
};

// ---------------------------------------------------------------- noi suy
// Pose den ~62 Hz qua mang voi do tre khong deu. Neu ve ngay khi nhan thi khung hinh
// nao thieu mau rua dung, khung sau rua nhay -> giat. Giai phap (giong game online):
//   - giu bo dem vai mau, ve o thoi diem lui lai RENDER_DELAY ms, noi suy giua 2 mau
//   - neu mau moi chua toi, ngoai suy bang v, w (dead reckoning) toi da MAX_EXTRAP ms
const RENDER_DELAY = 60;    // ms, ~4 mau o 62 Hz
const MAX_EXTRAP = 150;     // ms
const MAX_SAMPLES = 32;

function pushSample(d) {
  const now = performance.now(), tms = d.t * 1000;
  // uoc luong lech dong ho: lay min(now - t) de loai bo tre mang, cho troi dan theo thoi gian
  const o = now - tms;
  if (state.clockOffset === null || o < state.clockOffset) state.clockOffset = o;
  else state.clockOffset += (o - state.clockOffset) * 0.002;
  const arr = state.samples[d.name] || (state.samples[d.name] = []);
  arr.push({ t: tms, x: d.x, y: d.y, theta: d.theta, v: d.v, w: d.w });
  if (arr.length > MAX_SAMPLES) arr.shift();
}

function lerpAngle(a, b, k) {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * k;
}

// Tinh pose de ve cho tat ca rua tai thoi diem hien tai
function updateSmooth() {
  if (state.clockOffset === null) return;
  const target = performance.now() - state.clockOffset - RENDER_DELAY;   // theo dong ho server
  for (const [name, arr] of Object.entries(state.samples)) {
    if (!arr.length || !(name in state.turtles)) { delete state.smooth[name]; continue; }
    let out;
    const last = arr[arr.length - 1];
    if (target >= last.t) {
      // ngoai suy tu mau moi nhat
      const dt = Math.min(target - last.t, MAX_EXTRAP) / 1000;
      if (Math.abs(last.w) > 1e-6) {
        // chuyen dong cung tron
        const th = last.theta + last.w * dt, R = last.v / last.w;
        out = { x: last.x + R * (Math.sin(th) - Math.sin(last.theta)),
                y: last.y - R * (Math.cos(th) - Math.cos(last.theta)), theta: th };
      } else {
        out = { x: last.x + last.v * Math.cos(last.theta) * dt,
                y: last.y + last.v * Math.sin(last.theta) * dt, theta: last.theta };
      }
    } else {
      // tim 2 mau bao quanh target
      let i = arr.length - 1;
      while (i > 0 && arr[i - 1].t > target) i--;
      if (i === 0) out = arr[0];
      else {
        const a = arr[i - 1], b = arr[i];
        const k = b.t > a.t ? (target - a.t) / (b.t - a.t) : 1;
        out = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, theta: lerpAngle(a.theta, b.theta, k) };
      }
    }
    // gioi han trong ban do
    out.x = Math.min(WORLD, Math.max(0, out.x)); out.y = Math.min(WORLD, Math.max(0, out.y));
    state.smooth[name] = out;
  }
  for (const name of Object.keys(state.smooth)) if (!(name in state.turtles)) delete state.smooth[name];
}

// ---------------------------------------------------------------- log
function log(msg, cls = '') {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  el.innerHTML += `<span class="${cls}">[${t}] ${msg}</span>\n`;
  el.scrollTop = el.scrollHeight;
}
$('btnClearLog').onclick = () => ($('log').innerHTML = '');

// ---------------------------------------------------------------- API
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  try {
    const r = await fetch(path, opt);
    const j = await r.json();
    if (!j.ok) log(`${path}: ${j.error}`, 'err');
    return j;
  } catch (e) {
    log(`${path}: ${e}`, 'err');
    return { ok: false };
  }
}

// ---------------------------------------------------------------- SSE
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('dot').className = 'dot on'; $('conn').textContent = 'Đã kết nối'; };
  es.onerror = () => { $('dot').className = 'dot off'; $('conn').textContent = 'Mất kết nối, thử lại…'; };
  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'pose') onPose(d);
    else if (d.type === 'battery') onBattery(d);
    else if (d.type === 'goal') {
      const prev = state.goals[d.name] || {};
      state.goals[d.name] = { x: d.x, y: d.y, path: d.path !== undefined ? d.path : prev.path, loop: d.loop !== undefined ? d.loop : prev.loop, label: d.label };
      if (d.path) log(`${d.name}: ${d.label} ${d.path.length} điểm${d.loop ? ', lặp' : ''}`);
      else if (!prev.path) log(`${d.name} → (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`);
    }
    else if (d.type === 'goal_done') {
      delete state.goals[d.name];
      if (d.reached) log(`${d.name} đã tới đích`, 'ok');
      else if (d.reason !== 'manual') log(`${d.name} huỷ mục tiêu`);
    }
    else if (d.type === 'removed') { delete state.turtles[d.name]; delete state.lastPose[d.name]; delete state.samples[d.name]; delete state.smooth[d.name]; delete state.goals[d.name]; delete state.battery[d.name]; delete state.battHist[d.name]; refreshSelect(); }
  };
}

function onPose(d) {
  const isNew = !(d.name in state.turtles);
  state.turtles[d.name] = d;
  pushSample(d);
  if (isNew) {
    refreshSelect(); log(`Phát hiện rùa ${d.name}`, 'ok');
    // but mac dinh cua turtlesim day 3 -> dat lai 2 cho moi rua moi
    state.penWidth[d.name] = 2;
    api('/api/set_pen', { name: d.name, r: 179, g: 184, b: 255, width: 2, off: 0 });
  }

  // ve vet: noi diem truoc -> diem hien tai
  if ($('trail').checked) {
    const prev = state.lastPose[d.name];
    const color = state.penColor[d.name] || '#b3b8ff';
    if (prev && color !== 'transparent' && (prev.x !== d.x || prev.y !== d.y)) {
      addSegment(d.name, { x0: prev.x, y0: prev.y, x1: d.x, y1: d.y, color, w: (state.penWidth[d.name] || 2) });
    }
  }
  state.lastPose[d.name] = { x: d.x, y: d.y };

  if (d.name === state.selected) {
    $('px').textContent = d.x.toFixed(2);
    $('py').textContent = d.y.toFixed(2);
    $('pth').textContent = d.theta.toFixed(2);
    $('pv').textContent = d.v.toFixed(2);
    $('pw').textContent = d.w.toFixed(2);
    // tan so pose
    state.hz.count++;
    const now = performance.now();
    if (now - state.hz.t > 1000) {
      state.hz.value = Math.round(state.hz.count * 1000 / (now - state.hz.t));
      state.hz.count = 0; state.hz.t = now;
      $('phz').textContent = state.hz.value;
    }
  }
}

function refreshSelect() {
  const sel = $('turtleSel');
  const names = Object.keys(state.turtles).sort();
  sel.innerHTML = names.map(n => `<option ${n === state.selected ? 'selected' : ''}>${n}</option>`).join('');
  if (!names.includes(state.selected) && names.length) { state.selected = names[0]; sel.value = names[0]; }
}
$('turtleSel').onchange = (e) => { state.selected = e.target.value; log(`Chọn ${state.selected}`); renderBattery(); };

// ---------------------------------------------------------------- canvas
function toPx(x, y) { return { x: x / WORLD * SIZE, y: (WORLD - y) / WORLD * SIZE }; }
function toWorld(px, py) { return { x: px / SIZE * WORLD, y: WORLD - py / SIZE * WORLD }; }

// Rua vector: than huong +x, kich thuoc ~1 don vi, scale theo r
function drawTurtle(cx, cy, theta, r, selected, name) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-theta);                 // canvas y huong xuong nen dao chieu goc
  const shell = selected ? '#2ecc8f' : '#7fb77e';
  const shellDark = selected ? '#1b8f62' : '#4f7f4e';
  const skin = selected ? '#9be7c4' : '#b9d8a8';
  const skinDark = 'rgba(0,0,0,.35)';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // Bong do
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(r * 0.08, r * 0.12, r * 1.02, r * 0.86, 0, 0, Math.PI * 2); ctx.fill();

  // 4 chan + duoi (ve truoc de mai de len)
  ctx.fillStyle = skin; ctx.strokeStyle = skinDark; ctx.lineWidth = r * 0.08;
  const legs = [[0.55, 0.62, 0.6], [0.55, -0.62, -0.6], [-0.55, 0.62, 2.4], [-0.55, -0.62, -2.4]];
  for (const [lx, ly, ang] of legs) {
    ctx.save(); ctx.translate(lx * r, ly * r); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.34, r * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();                    // duoi
  ctx.moveTo(-r * 0.85, -r * 0.12); ctx.lineTo(-r * 1.3, 0); ctx.lineTo(-r * 0.85, r * 0.12);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Dau + mat
  ctx.beginPath(); ctx.ellipse(r * 1.05, 0, r * 0.36, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(r * 1.18, -r * 0.12, r * 0.06, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 1.18, r * 0.12, r * 0.06, 0, Math.PI * 2); ctx.fill();

  // Mai
  ctx.fillStyle = shell; ctx.strokeStyle = shellDark; ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Hoa van luc giac tren mai
  ctx.strokeStyle = shellDark; ctx.lineWidth = r * 0.07;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.42, r * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.34);
    ctx.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.77);
    ctx.stroke();
  }
  // Diem sang
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.3, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();

  // Vong chon
  if (selected) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();

}

function drawLabels(r) {
  octx.clearRect(0, 0, SIZE, SIZE);
  const cell = SIZE / WORLD;
  octx.fillStyle = 'rgba(255,255,255,.45)'; octx.font = '10px ui-monospace, monospace';
  octx.textAlign = 'left'; octx.textBaseline = 'top';
  for (let i = 1; i < WORLD; i++) {
    octx.fillText(i, Math.round(i * cell) + 3, SIZE - 13);
    octx.fillText(i, 3, Math.round((WORLD - i) * cell) + 3);
  }
  // muc tieu go-to-goal: duong net dut tu rua -> dich, vong tron + tam
  const posesG = Object.keys(state.smooth).length ? state.smooth : state.turtles;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
  for (const [name, g] of Object.entries(state.goals)) {
    const t = toPx(g.x, g.y), p = posesG[name];
    if (g.path && g.path.length > 1) {
      octx.strokeStyle = 'rgba(255,209,102,.45)'; octx.lineWidth = 1.5; octx.setLineDash([3, 5]);
      octx.beginPath();
      g.path.forEach(([x, y], i) => { const q = toPx(x, y); i ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y); });
      if (g.loop) octx.closePath();
      octx.stroke(); octx.setLineDash([]);
    }
    octx.strokeStyle = 'rgba(255,255,255,.55)'; octx.lineWidth = 1.5;
    if (p) { const c = toPx(p.x, p.y); octx.setLineDash([6, 6]); octx.beginPath(); octx.moveTo(c.x, c.y); octx.lineTo(t.x, t.y); octx.stroke(); octx.setLineDash([]); }
    octx.strokeStyle = '#ffd166'; octx.lineWidth = 2;
    octx.beginPath(); octx.arc(t.x, t.y, 9 + pulse * 4, 0, Math.PI * 2); octx.stroke();
    octx.beginPath(); octx.moveTo(t.x - 5, t.y); octx.lineTo(t.x + 5, t.y); octx.moveTo(t.x, t.y - 5); octx.lineTo(t.x, t.y + 5); octx.stroke();
  }
  octx.font = '600 12px system-ui, sans-serif'; octx.textAlign = 'center'; octx.textBaseline = 'bottom';
  octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.55)'; octx.fillStyle = '#fff';
  const poses = Object.keys(state.smooth).length ? state.smooth : state.turtles;
  for (const [name, p] of Object.entries(poses)) {
    const c = toPx(p.x, p.y);
    octx.strokeText(name, c.x, c.y - r * 1.75); octx.fillText(name, c.x, c.y - r * 1.75);
  }
}

function tickFps() {
  state.fps.count++;
  const now = performance.now();
  if (now - state.fps.t > 1000) {
    state.fps.value = Math.round(state.fps.count * 1000 / (now - state.fps.t));
    state.fps.count = 0; state.fps.t = now;
    $('pfps').textContent = state.fps.value;
  }
}

function draw() {
  resizeCanvas();
  tickFps();
  updateSmooth();
  const cell = SIZE / WORLD;
  const r = Math.max(12, cell * 0.45);
  const poses = Object.keys(state.smooth).length ? state.smooth : state.turtles;

  if (GL) {
    GL.render(poses, state.selected);
    drawLabels(r);
    requestAnimationFrame(draw);
    return;
  }

  // ---- che do du phong Canvas 2D
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.lineWidth = 1;
  for (let i = 1; i < WORLD; i++) {
    const p = Math.round(i * cell) + 0.5;
    ctx.strokeStyle = i === 5 || i === 6 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.11)';
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke();
  }
  ctx.drawImage(trailCv, 0, 0, SIZE, SIZE);
  for (const [name, p] of Object.entries(poses)) {
    const c = toPx(p.x, p.y);
    drawTurtle(c.x, c.y, p.theta, r, name === state.selected, name);
  }
  drawLabels(r);
  requestAnimationFrame(draw);
}
resizeCanvas();
requestAnimationFrame(draw);

$('btnClearTrail').onclick = async () => {
  clearTrails();                                   // vet tren web
  if ((await api('/api/clear', {})).ok) log('Đã xoá vết (web + /clear)', 'ok');
};
map.addEventListener('click', (e) => {
  const rect = map.getBoundingClientRect();
  const w = toWorld((e.clientX - rect.left) * SIZE / rect.width, (e.clientY - rect.top) * SIZE / rect.height);
  const name = state.selected;
  if (e.shiftKey) {
    api('/api/teleport', { name, x: w.x, y: w.y, theta: (state.turtles[name] || {}).theta || 0 })
      .then(r => r.ok && log(`Teleport ${name} -> (${w.x.toFixed(2)}, ${w.y.toFixed(2)})`));
    return;
  }
  stopAuto();
  api('/api/goto', { name, x: w.x, y: w.y, speed: parseFloat($('lin').value) });
});


// ---------------------------------------------------------------- pin AGV
// Di dong: panel pin mac dinh thu gon, cham mui ten (hoac tieu de) de mo rong
const battCard = document.querySelector('.batt-card');
function toggleBatt() {
  battCard.classList.toggle('expanded');
  try { localStorage.setItem('battExpanded', battCard.classList.contains('expanded') ? '1' : '0'); } catch (e) {}
  renderBattery();
}
$('battToggle').onclick = toggleBatt;
battCard.querySelector('h2').onclick = () => { if (window.innerWidth <= 1000) toggleBatt(); };
try { if (localStorage.getItem('battExpanded') === '1') battCard.classList.add('expanded'); } catch (e) {}
const HIST_N = 90;   // 2 Hz * 45 s
function onBattery(d) {
  d.rx = Date.now();
  state.battery[d.name] = d;
  const h = state.battHist[d.name] || (state.battHist[d.name] = { volt: [], cur: [], temp: [] });
  h.volt.push(d.voltage); h.cur.push(-d.current); h.temp.push(d.temp);
  for (const k of ['volt', 'cur', 'temp']) if (h[k].length > HIST_N) h[k].shift();
  if (d.name === state.selected) renderBattery();
}

function sparkline(id, data, color) {
  const cv = $(id); if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = cv.clientWidth || 120, H = 26;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  if (data.length < 2) return;
  let mn = Math.min(...data), mx = Math.max(...data); if (mx - mn < 1e-6) { mn -= 0.5; mx += 0.5; }
  const pad = (mx - mn) * 0.15; mn -= pad; mx += pad;
  c.beginPath();
  data.forEach((v, i) => { const x = i / (HIST_N - 1) * W, y = H - (v - mn) / (mx - mn) * (H - 2) - 1; i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.strokeStyle = color; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
  c.lineTo(((data.length - 1) / (HIST_N - 1)) * W, H); c.lineTo(0, H); c.closePath();
  c.fillStyle = color.replace(')', ',.15)').replace('rgb', 'rgba'); c.fill();
}

function fmtEta(hours) {
  if (!isFinite(hours) || hours <= 0) return '–';
  if (hours > 48) return '>48 h';
  const h = Math.floor(hours), m = Math.round((hours - h) * 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

function renderBattery() {
  const d = state.battery[state.selected];
  const hist = state.battHist[state.selected];
  if (!d) {
    $('socPct').textContent = '–'; $('socFill').style.width = '0%';
    for (const id of ['bVolt', 'bCur', 'bPow', 'bTemp', 'bCell', 'socAh', 'socEta']) $(id).textContent = '–';
    $('battSerial').textContent = 'không có dữ liệu pin'; $('battHealth').textContent = '–'; $('battHealth').className = 'badge'; $('battMini').textContent = '–';
    return;
  }
  const pct = d.soc * 100, cur = -d.current;
  $('socPct').textContent = pct.toFixed(1) + ' %';
  const fill = $('socFill'); fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const chg = d.status === 'charging', full = d.status === 'full';
  fill.className = 'soc-fill' + (chg ? ' chg' : full ? ' full' : pct < 10 ? ' crit' : pct < 25 ? ' warn' : '');
  $('socAh').textContent = `${d.charge_ah.toFixed(1)} / ${d.capacity_ah} Ah`;
  // ETA: dung dong trung binh 45 s gan nhat, chia theo time_scale 30 cua sim -> hien thi gio "sim"
  const avgI = hist && hist.cur.length ? hist.cur.reduce((s, v) => s + v, 0) / hist.cur.length : cur;
  // ETA: dang sac -> thoi gian den day theo dong nap; xa -> thoi gian con lai theo dong xa trung binh
  if (chg) $('socEta').textContent = 'đầy sau ' + fmtEta((d.capacity_ah - d.charge_ah) / Math.max(0.1, -cur));
  else if (full) $('socEta').textContent = 'đã đầy';
  else $('socEta').textContent = 'còn ' + fmtEta(d.charge_ah / Math.max(0.1, avgI));
  $('battMini').innerHTML = `${chg ? '⚡ ' : ''}${d.voltage.toFixed(1)}<span>V</span> ${cur.toFixed(1)}<span>A</span> ${d.temp.toFixed(0)}<span>°C</span>`;
  $('bVolt').textContent = d.voltage.toFixed(2);
  $('bCur').textContent = cur.toFixed(2);
  $('bPow').textContent = (d.voltage * cur).toFixed(0);
  $('bTemp').textContent = d.temp.toFixed(1);
  $('bCell').textContent = d.cell_min != null ? `${d.cell_min.toFixed(2)} / ${d.cell_max.toFixed(2)}` : '–';
  $('battSerial').textContent = d.serial || '–';
  const hb = $('battHealth');
  if (chg) { hb.textContent = '⚡ đang sạc'; hb.className = 'badge chg'; }
  else if (full) { hb.textContent = 'đầy'; hb.className = 'badge gpu'; }
  else { hb.textContent = d.health; hb.className = 'badge ' + (d.health === 'good' ? 'gpu' : d.health === 'overheat' || d.health === 'dead' ? 'bad' : 'warn'); }
  if (chg && !(state.battChgLogged || {})[state.selected]) { (state.battChgLogged = state.battChgLogged || {})[state.selected] = true; log(`${state.selected}: hết pin, đang sạc`, 'ok'); }
  if (!chg && state.battChgLogged && state.battChgLogged[state.selected]) { state.battChgLogged[state.selected] = false; log(`${state.selected}: sạc đầy`, 'ok'); }
  if (hist) {
    sparkline('spVolt', hist.volt, 'rgb(90,169,255)');
    sparkline('spCur', hist.cur, 'rgb(240,192,96)');
    sparkline('spTemp', hist.temp, 'rgb(255,107,107)');
  }
}

// ---------------------------------------------------------------- dieu khien van toc
// Nguyen tac: UI quyet dinh (lin, ang) mong muon; mot vong lap 10Hz gui xuong.
// Giong turtle_teleop_key, turtlesim se tu dung sau ~1s neu khong nhan lenh moi.
const vel = { lin: 0, ang: 0, active: false };
const keyMap = {
  w: [1, 0], s: [-1, 0], a: [0, 1], d: [0, -1],
  q: [1, 1], e: [1, -1], z: [-1, 1], c: [-1, -1], x: [0, 0],
  ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1], ' ': [0, 0],
};
const held = new Set();
const TURN_STEP_DEG = 5;                       // moi lan nhan mui ten trai/phai xoay 5 do
const TURN_KEYS = { a: -1, d: 1, ArrowLeft: -1, ArrowRight: 1 };   // dau theo cam nhan nguoi dung (da dao)
function turnStep(dir) {
  stopAutoQuiet();
  api('/api/turn', { name: state.selected, delta_deg: dir * TURN_STEP_DEG, speed: parseFloat($('ang').value) });
}

function recompute() {
  let l = 0, a = 0;
  for (const k of held) { const m = keyMap[k]; if (m) { l += m[0]; a += m[1]; } }
  vel.lin = Math.sign(l) * parseFloat($('lin').value);
  vel.ang = Math.sign(a) * parseFloat($('ang').value);
  vel.active = held.size > 0;
  document.querySelectorAll('.dpad button').forEach(b => b.classList.toggle('active', held.has(b.dataset.k)));
}

let joyActive = false;
setInterval(() => {
  if (vel.active || joyActive) api('/api/cmd_vel', { name: state.selected, linear: vel.lin, angular: vel.ang });
}, 100);

function sendStop() { held.clear(); recompute(); api('/api/cmd_vel', { name: state.selected, linear: 0, angular: 0 }); }

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (!(e.key in keyMap)) return;
  e.preventDefault();
  if (e.key === 'x' || e.key === ' ') { stopAuto(); sendStop(); return; }
  if (e.key in TURN_KEYS) { turnStep(TURN_KEYS[e.key]); return; }   // auto-repeat cua OS -> cong don
  held.add(e.key); recompute();
});
window.addEventListener('keyup', (e) => { if (held.delete(e.key)) recompute(); });
window.addEventListener('blur', sendStop);

document.querySelectorAll('.dpad button').forEach(b => {
  const k = b.dataset.k;
  let rep = null;
  const down = (e) => {
    e.preventDefault();
    if (k === 'x') { stopAuto(); sendStop(); return; }
    if (k in TURN_KEYS) {                       // xoay tung buoc, giu thi lap
      turnStep(TURN_KEYS[k]); b.classList.add('active');
      clearInterval(rep); rep = setInterval(() => turnStep(TURN_KEYS[k]), 150);
      return;
    }
    held.add(k); recompute();
  };
  const up = () => {
    if (rep) { clearInterval(rep); rep = null; b.classList.remove('active'); }
    if (held.delete(k)) { recompute(); if (!held.size) sendStop(); }
  };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
});

$('lin').oninput = (e) => { $('linVal').textContent = e.target.value; recompute(); };
$('ang').oninput = (e) => { $('angVal').textContent = e.target.value; recompute(); };

// ---------------------------------------------------------------- joystick
const joy = $('joy'), jctx = joy.getContext('2d');
const jc = joy.width / 2, jr = jc - 10;
let knob = { x: 0, y: 0 };
function drawJoy() {
  jctx.clearRect(0, 0, joy.width, joy.height);
  jctx.strokeStyle = '#2a3650'; jctx.lineWidth = 2;
  jctx.beginPath(); jctx.arc(jc, jc, jr, 0, Math.PI * 2); jctx.stroke();
  jctx.beginPath(); jctx.moveTo(jc, 10); jctx.lineTo(jc, joy.height - 10); jctx.stroke();
  jctx.beginPath(); jctx.moveTo(10, jc); jctx.lineTo(joy.width - 10, jc); jctx.stroke();
  jctx.fillStyle = joyActive ? '#4fd1a5' : '#5aa9ff';
  jctx.beginPath(); jctx.arc(jc + knob.x, jc + knob.y, 22, 0, Math.PI * 2); jctx.fill();
}
function joyMove(e) {
  const rect = joy.getBoundingClientRect();
  let dx = (e.clientX - rect.left) * joy.width / rect.width - jc;
  let dy = (e.clientY - rect.top) * joy.height / rect.height - jc;
  const d = Math.hypot(dx, dy);
  if (d > jr) { dx *= jr / d; dy *= jr / d; }
  knob = { x: dx, y: dy };
  // len = tien, trai = xoay trai (ang duong)
  vel.lin = -dy / jr * parseFloat($('lin').value);
  vel.ang = -dx / jr * parseFloat($('ang').value);
  drawJoy();
}
joy.addEventListener('pointerdown', (e) => { joyActive = true; joy.setPointerCapture(e.pointerId); joyMove(e); });
joy.addEventListener('pointermove', (e) => { if (joyActive) joyMove(e); });
const joyEnd = () => { if (!joyActive) return; joyActive = false; knob = { x: 0, y: 0 }; drawJoy(); sendStop(); };
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);
drawJoy();

// ---------------------------------------------------------------- auto (hinh vuong / vong tron)
let autoTimer = null;
function stopAutoQuiet() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }
function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; log('Dừng auto'); }
  if (state.goals[state.selected]) api('/api/goto/cancel', { name: state.selected });
}
$('btnStopAuto').onclick = () => { stopAuto(); sendStop(); };

document.querySelectorAll('.shapes button').forEach(b => {
  b.onclick = async () => {
    stopAuto();
    // da giac: so canh ngau nhien 3..9, tru 4 (da co nut Vuong)
    let sides = parseInt($('sides').value) || 5;
    if (b.dataset.shape === 'polygon') { const pool = [3, 5, 6, 7, 8, 9]; sides = pool[Math.floor(Math.random() * pool.length)]; }
    const body = { name: state.selected, shape: b.dataset.shape, size: parseFloat($('shapeSize').value),
                   sides, speed: parseFloat($('lin').value), loop: $('shapeLoop').checked };
    const r = await api('/api/shape', body);
    if (r.ok) log(`Hình ${b.textContent.toLowerCase()}${b.dataset.shape === 'polygon' ? ' ' + sides + ' cạnh' : ''} (${r.points} điểm)`, 'ok');
  };
});
$('shapeSize').oninput = (e) => { $('shapeSizeVal').textContent = parseFloat(e.target.value).toFixed(1); };

// ---------------------------------------------------------------- service buttons
$('btnHome').onclick = () => api('/api/teleport', { name: state.selected, x: 5.544, y: 5.544, theta: 0 }).then(r => r.ok && log('Về giữa', 'ok'));
$('btnKill').onclick = async () => {
  const n = state.selected;
  if (!confirm(`Kill ${n}?`)) return;
  if ((await api('/api/kill', { name: n })).ok) log(`Đã kill ${n}`, 'ok');
};
$('btnSpawn').onclick = async () => {
  const name = $('spawnName').value.trim();
  const r = await api('/api/spawn', { x: 1 + Math.random() * 9, y: 1 + Math.random() * 9, theta: Math.random() * 6.28, name });
  if (r.ok) { log(`Spawn ${r.name}`, 'ok'); $('spawnName').value = ''; state.selected = r.name; }
};

function hexToRgb(h) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
$('btnPen').onclick = async () => {
  const c = hexToRgb($('penColor').value);
  const r = await api('/api/set_pen', { name: state.selected, ...c, width: parseInt($('penWidth').value), off: $('penOff').checked ? 1 : 0 });
  if (r.ok) { state.penColor[state.selected] = $('penOff').checked ? 'transparent' : $('penColor').value; state.penWidth[state.selected] = Math.max(1, Math.min(10, parseInt($('penWidth').value) || 3)); log(`set_pen ${state.selected}`, 'ok'); }
};
$('btnBg').onclick = async () => {
  const c = hexToRgb($('bgColor').value);
  const r = await api('/api/background', c);
  if (r.ok) { state.bg = $('bgColor').value; if (GL) GL.setBackground(state.bg); clearTrails(); log(`Nền -> ${state.bg}`, 'ok'); }
};

// ---------------------------------------------------------------- init
(async () => {
  const st = await api('/api/state');
  if (st.ok && st.goals) Object.assign(state.goals, st.goals);
  if (st.ok && st.battery) { for (const d of Object.values(st.battery)) onBattery(d); }
  renderBattery();
  const r = await api('/api/background');
  if (r.ok) {
    state.bg = '#' + [r.r, r.g, r.b].map(v => v.toString(16).padStart(2, '0')).join('');
    $('bgColor').value = state.bg;
    if (GL) GL.setBackground(state.bg);
  }
  connect();
  log(`UI sẵn sàng. Renderer: ${GL ? 'WebGL (GPU)' : 'Canvas 2D'}. Thêm ?no-gl vào URL để ép Canvas 2D.`);
})();
