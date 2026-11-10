const $ = (s) => document.querySelector(s);
const video = $('#video'), cv = $('#canvas'), ctx = cv.getContext('2d');
const panel = $('#panel'), showBtn = $('#show'), cursorEl = $('#cursor'), msg = $('#msg');
const layer = document.createElement('canvas'), lx = layer.getContext('2d');

/* ---------- options (edit these lists to add your own) ---------- */
const COLORS = ['#00e5ff', '#ff4d6d', '#ffd166', '#06d6a0', '#c77dff', '#ffffff', '#1e1e2e'];
const PENS = [['glow', '✨ Glow'], ['marker', '🖊 Marker'], ['hi', '🖍 Highlight'], ['rainbow', '🌈 Rainbow'], ['eraser', '🧽 Eraser']];
const BGS = [['black', 'Black'], ['white', 'White'], ['board', 'Chalkboard'], ['paper', 'Paper'], ['blue', 'Blueprint'], ['sunset', 'Sunset'], ['cam', '📷 Camera']];
const BG_KEYS = BGS.map((b) => b[0]);
const HELP = 'Pinch thumb + index to draw (or hold Shift)\nHold fingertip over a button 0.7s to press it\nSpace clear · Z undo · C color · B background · [ ] size · S save · F fullscreen · H menu';

/* ---------- state ---------- */
let W = 0, H = 0;
let color = COLORS[0], tool = 'glow', bgName = 'black', size = 6;
let strokes = [], cur = null, shift = false, pinching = false, hand = false, tracked = false;
let sx = 0, sy = 0, hue = 0, dw = { el: null, t: 0, done: false }, lastT = 0, status = '';

function setStatus(s) { status = s; msg.textContent = (s ? s + '\n' : '') + HELP; }

/* ---------- build the control panel ---------- */
panel.innerHTML =
  `<div class="g">${COLORS.map((c) => `<button class="sw" data-act="color" data-val="${c}" style="background:${c}"></button>`).join('')}</div>` +
  `<div class="g">${PENS.map(([k, l]) => `<button data-act="pen" data-val="${k}">${l}</button>`).join('')}` +
  `<button data-act="size" data-val="-1">−</button><span id="sz"></span><button data-act="size" data-val="1">+</button></div>` +
  `<div class="g">${BGS.map(([k, l]) => `<button data-act="bg" data-val="${k}">${l}</button>`).join('')}</div>` +
  `<div class="g"><button data-act="undo">↶ Undo</button><button data-act="clear">🗑 Clear</button>` +
  `<button data-act="save">⤓ Save</button><button data-act="full">⛶</button><button data-act="hide">▲ Hide</button></div>`;

function sync() {
  document.querySelectorAll('button[data-act]').forEach((b) => {
    const a = b.dataset.act, v = b.dataset.val;
    b.classList.toggle('on', (a === 'color' && v === color && tool !== 'eraser') || (a === 'pen' && v === tool) || (a === 'bg' && v === bgName));
  });
  $('#sz').textContent = size;
}

function autoColor() {
  const light = bgName === 'white' || bgName === 'paper';
  if (light && ['#ffffff', '#00e5ff', '#ffd166'].includes(color)) color = '#1e1e2e';
  if (!light && color === '#1e1e2e') color = '#00e5ff';
}

/* ---------- actions ---------- */
function act(a, val) {
  if (a === 'color') { color = val; if (tool === 'eraser') tool = 'glow'; }
  else if (a === 'pen') tool = val;
  else if (a === 'bg') { bgName = val; autoColor(); }
  else if (a === 'size') size = Math.min(40, Math.max(2, size + Number(val) * 2));
  else if (a === 'undo') undo();
  else if (a === 'clear') clearAll();
  else if (a === 'save') save();
  else if (a === 'full') toggleFullscreen();
  else if (a === 'hide') { panel.hidden = !panel.hidden; showBtn.hidden = !panel.hidden; }
  sync();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act, b.dataset.val);
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
}

/* ---------- backgrounds ---------- */
function drawBg(c, w, h) {
  const grad = (a, b) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const fills = { black: '#000', white: '#fff', board: '#1f3a2e', paper: '#fbf7ee', blue: '#0b2a5b', sunset: grad('#ff7e5f', '#6a3093'), cam: '#000' };
  c.fillStyle = fills[bgName];
  c.fillRect(0, 0, w, h);

  if (bgName === 'paper' || bgName === 'blue') {
    c.strokeStyle = bgName === 'paper' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < w; x += 40) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = 0; y < h; y += 40) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
  }
  if (bgName === 'cam' && video.videoWidth) {
    const k = Math.max(w / video.videoWidth, h / video.videoHeight);
    const vw = video.videoWidth * k, vh = video.videoHeight * k;
    c.save(); c.globalAlpha = 0.85; c.translate(w, 0); c.scale(-1, 1);
    c.drawImage(video, (w - vw) / 2, (h - vh) / 2, vw, vh);
    c.restore();
  }
}

/* ---------- strokes ---------- */
function drawStroke(c, s) {
  const p = s.pts; if (!p.length) return;
  const X = (i) => p[i].x * W, Y = (i) => p[i].y * H;
  const wd = s.type === 'hi' ? s.size * 3 : s.size;
  c.save();
  c.lineCap = c.lineJoin = 'round';
  c.lineWidth = wd;
  if (s.type === 'hi') c.globalAlpha = 0.35;
  if (s.type === 'glow' || s.type === 'rainbow') c.shadowBlur = s.size * 2.5;

  if (p.length < 2) {
    c.fillStyle = c.shadowColor = s.type === 'rainbow' ? `hsl(${s.hue},100%,60%)` : s.color;
    c.beginPath(); c.arc(X(0), Y(0), wd / 2, 0, 7); c.fill();
  } else if (s.type === 'rainbow') {
    for (let i = 1; i < p.length; i++) {
      c.strokeStyle = c.shadowColor = `hsl(${(s.hue + i * 3) % 360},100%,60%)`;
      c.beginPath(); c.moveTo(X(i - 1), Y(i - 1)); c.lineTo(X(i), Y(i)); c.stroke();
    }
  } else {
    c.strokeStyle = c.shadowColor = s.color;
    c.beginPath(); c.moveTo(X(0), Y(0));
    for (let i = 1; i < p.length - 1; i++)
      c.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    c.lineTo(X(p.length - 1), Y(p.length - 1));
    c.stroke();
  }
  c.restore();
}

function redraw() { lx.clearRect(0, 0, W, H); strokes.forEach((s) => drawStroke(lx, s)); }
function endStroke() { if (cur) { strokes.push(cur); drawStroke(lx, cur); cur = null; } }
function undo() { endStroke(); strokes.pop(); redraw(); }
function clearAll() { strokes = []; cur = null; redraw(); }

function eraseAt(px, py, r) {
  const before = strokes.length;
  strokes = strokes.filter((s) => !s.pts.some((q) => Math.hypot(q.x * W - px, q.y * H - py) < r));
  if (strokes.length !== before) redraw();
}

function save() {
  const o = document.createElement('canvas'); o.width = W; o.height = H;
  const c = o.getContext('2d'); drawBg(c, W, H); c.drawImage(layer, 0, 0);
  o.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'air-pen-' + Date.now() + '.png'; a.click();
  });
}

/* ---------- render loop ---------- */
function frame(t) {
  const dt = lastT ? t - lastT : 0; lastT = t;
  drawBg(ctx, W, H);
  ctx.drawImage(layer, 0, 0);
  if (cur) drawStroke(ctx, cur);

  const drawingNow = pinching || shift;
  const col = tool === 'rainbow' ? `hsl(${(t / 8) % 360},100%,60%)` : color;
  cursorEl.style.setProperty('--c', col);
  cursorEl.style.display = hand ? 'block' : 'none';

  if (hand) {
    const r = tool === 'eraser' ? size * 3 + 12 : (drawingNow ? Math.max(8, size / 2 + 2) : 12);
    cursorEl.style.width = cursorEl.style.height = r * 2 + 'px';
    cursorEl.style.transform = `translate(${sx * W - r - 3}px, ${sy * H - r - 3}px)`;
    cursorEl.classList.toggle('drawing', drawingNow && tool !== 'eraser');

    /* hover-to-press: hold fingertip over any button */
    let el = null;
    if (!drawingNow) {
      const hit = document.elementFromPoint(sx * W, sy * H);
      el = hit && hit.closest('[data-act]');
    }
    if (el !== dw.el) dw = { el, t: 0, done: false };
    else if (el && !dw.done) {
      dw.t += dt;
      if (dw.t > 700) { el.click(); dw.done = true; }
    }
    cursorEl.style.setProperty('--p', el && !dw.done ? Math.min(100, dw.t / 7) : 0);
  }
  requestAnimationFrame(frame);
}

/* ---------- hand tracking ---------- */
const dist = (a, b) => Math.hypot((a.x - b.x) * 1.78, a.y - b.y);

function onResults(r) {
  const lm = r.multiHandLandmarks && r.multiHandLandmarks[0];
  if (!lm) {
    if (hand || status.startsWith('Camera on')) setStatus('No hand detected. Show your hand to the camera.');
    hand = tracked = pinching = false; endStroke(); return;
  }
  if (!hand) setStatus('');
  hand = true;

  const ratio = dist(lm[4], lm[8]) / dist(lm[0], lm[9]);
  pinching = pinching ? ratio < 0.4 : ratio < 0.28;

  let nx = 1 - (lm[4].x + lm[8].x) / 2, ny = (lm[4].y + lm[8].y) / 2;
  if (bgName === 'cam' && video.videoWidth) {
    const k = Math.max(W / video.videoWidth, H / video.videoHeight);
    const vw = video.videoWidth * k, vh = video.videoHeight * k;
    nx = ((W - vw) / 2 + nx * vw) / W; ny = ((H - vh) / 2 + ny * vh) / H;
  }
  nx = Math.min(1, Math.max(0, nx)); ny = Math.min(1, Math.max(0, ny));

  if (!tracked) { sx = nx; sy = ny; tracked = true; }
  else {
    const a = Math.min(0.85, 0.18 + Math.hypot(nx - sx, ny - sy) * 14);
    sx += (nx - sx) * a; sy += (ny - sy) * a;
  }

  const barBottom = panel.hidden ? 0 : panel.getBoundingClientRect().bottom;
  const active = (pinching || shift) && sy * H > barBottom + 6;

  if (active && tool === 'eraser') { endStroke(); eraseAt(sx * W, sy * H, size * 3 + 12); }
  else if (active) {
    if (!cur) { hue = (hue + 47) % 360; cur = { color, size, type: tool, hue, pts: [] }; }
    const l = cur.pts[cur.pts.length - 1];
    if (!l || Math.hypot((sx - l.x) * W, (sy - l.y) * H) > 2) cur.pts.push({ x: sx, y: sy });
  } else endStroke();
}

/* ---------- keyboard ---------- */
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'Shift') shift = true;
  else if (e.code === 'Space') { e.preventDefault(); clearAll(); }
  else if (k === 'z') undo();
  else if (k === 'c') { tool = tool === 'eraser' ? 'glow' : tool; color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]; }
  else if (k === 'b') { bgName = BG_KEYS[(BG_KEYS.indexOf(bgName) + 1) % BG_KEYS.length]; autoColor(); }
  else if (k === '[') act('size', -1);
  else if (k === ']') act('size', 1);
  else if (k === 's') save();
  else if (k === 'h') act('hide');
  else if (k === 'f' && !e.repeat) toggleFullscreen();
  sync();
});
addEventListener('keyup', (e) => { if (e.key === 'Shift') { shift = false; endStroke(); } });
addEventListener('blur', () => { shift = false; endStroke(); });

function resize() {
  W = cv.width = layer.width = innerWidth;
  H = cv.height = layer.height = innerHeight;
  redraw();
}
addEventListener('resize', resize);

/* ---------- start ---------- */
resize(); sync(); setStatus('Starting...');
requestAnimationFrame(frame);

if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
  setStatus('MediaPipe failed to load. Check internet and turn off ad blockers or VPN.');
} else {
  const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  hands.onResults(onResults);
  setStatus('Loading hand model (10-30 seconds)...');
  hands.initialize()
    .then(() => {
      setStatus('Starting camera...');
      const cam = new Camera(video, { onFrame: async () => { await hands.send({ image: video }); }, width: 1280, height: 720 });
      return cam.start();
    })
    .then(() => setStatus('Camera on. Show your hand to the webcam.'))
    .catch((err) => setStatus('Failed: ' + (err && err.message ? err.message : err)));
}
