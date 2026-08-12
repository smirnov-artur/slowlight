/* ============================================================
   SLOWLIGHT — orchestration.
   Native scroll only; all weight lives in lerped uniforms.
   ============================================================ */
import { World, blendStatesInto } from './gl.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const smooth = (t) => t * t * (3 - 2 * t);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const doc = document.documentElement;
if (REDUCED) doc.classList.add('reduced');

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const C = 299792.458; // km per second of light
const SUN_TRANSIT = 499; // light-seconds to Earth

/* ------------------------------------------------------------
   split text into masked lines (keeps <br> and inline <em>)
   ------------------------------------------------------------ */
function splitText(el) {
  if (!el.dataset.orig) el.dataset.orig = el.innerHTML;
  el.classList.remove('split', 'in');
  el.innerHTML = el.dataset.orig;
  const words = [];
  const walk = (node, inline) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(' '); continue; }
          const w = document.createElement('span');
          w.className = 'w';
          if (inline) {
            const tag = document.createElement(inline.tagName.toLowerCase());
            tag.textContent = part;
            w.append(tag);
          } else w.textContent = part;
          frag.append(w);
          words.push(w);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
        walk(child, child);
        child.replaceWith(...child.childNodes);
      }
    }
  };
  walk(el, null);
  const lines = [];
  let line = null, lastTop = null;
  for (const w of words) {
    const top = w.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 3) { line = []; lines.push(line); lastTop = top; }
    line.push(w);
  }
  el.innerHTML = '';
  lines.forEach((ws, li) => {
    const outer = document.createElement('span');
    outer.className = 'line';
    const inner = document.createElement('span');
    inner.className = 'line-in';
    inner.style.setProperty('--l', li);
    ws.forEach((w, wi) => { inner.append(w); if (wi < ws.length - 1) inner.append(' '); });
    outer.append(inner);
    el.append(outer);
  });
  el.classList.add('split');
}

/* decode effect for mono instrument lines */
const GLYPHS = '▓▒░<>|=+*#0123456789';
function decode(el, duration = 600) {
  const orig = el.dataset.text ?? (el.dataset.text = el.textContent);
  const t0 = performance.now();
  const tick = (now) => {
    const p = clamp((now - t0) / duration, 0, 1);
    const n = Math.floor(orig.length * p);
    let out = orig.slice(0, n);
    for (let i = n; i < orig.length; i++) {
      out += orig[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* superscript exponents for the photon counter */
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((d) => SUP[d] ?? d).join('');
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/* ------------------------------------------------------------
   scroll geometry
   ------------------------------------------------------------ */
const sections = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => $('#' + id));
const NAMES = ['THE CORE', 'THE WALK', 'PHOTOSPHERE', 'THE CROSSING', 'THE SKY', 'THE EYE'];
let bounds = [];       // 7 entries: section tops + max scroll
let scrubC3 = { top: 0, len: 1 };
let convC6 = { top: 0, len: 1 };
let sunC4 = { top: 0, len: 1 };
let walkC2 = { top: 0, len: 1 };
let vh = innerHeight;

function measure() {
  vh = innerHeight;
  const y = scrollY;
  const top = (el) => el.getBoundingClientRect().top + y;
  bounds = sections.map(top);
  bounds.push(Math.max(document.documentElement.scrollHeight - vh, bounds[5] + 1));
  const c3s = $('.c3-scrub');
  scrubC3 = { top: top(c3s), len: Math.max(1, c3s.offsetHeight - vh) };
  const cv = $('#converge');
  convC6 = { top: top(cv) - vh, len: cv.offsetHeight + vh * 0.4 };
  sunC4 = { top: bounds[3], len: Math.max(1, bounds[4] - bounds[3]) };
  walkC2 = { top: bounds[1], len: Math.max(1, bounds[2] - bounds[1] - vh * 0.5) };
  railH = Math.max(1, ($('.rail-line')?.offsetHeight ?? 1) - 5);
}

function mixOf(u) {
  if (u <= bounds[0]) return 0;
  for (let i = 0; i < 6; i++) {
    if (u < bounds[i + 1]) return i + (u - bounds[i]) / Math.max(1, bounds[i + 1] - bounds[i]);
  }
  return 6;
}

/* ------------------------------------------------------------
   odometer
   ------------------------------------------------------------ */
const odo = $('#odo'), odoDigits = $('#odoDigits'), odoUnit = $('#odoUnit');
let odoCols = [], odoSeps = [], odoMode = '';

/* fixed slot layouts so digits always roll (never rebuilt at 999→1,000):
   YR = [d][d][d][,][d][d][d], MIN:SEC = [d][d][:][d][d].
   Each column has rows 0-9 plus a blank row for leading positions. */
function odoBuild(mode) {
  odoMode = mode;
  odoDigits.textContent = '';
  odoCols = [];
  odoSeps = [];
  const layout = mode === 'yr' ? 'ddd,ddd' : 'dd:dd';
  for (const ch of layout) {
    if (ch === 'd') {
      const col = document.createElement('span');
      col.className = 'col';
      const inner = document.createElement('span');
      inner.className = 'col-in';
      inner.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>&nbsp;';
      col.append(inner);
      odoDigits.append(col);
      odoCols.push(inner);
    } else {
      const s = document.createElement('span');
      s.textContent = ch;
      odoDigits.append(s);
      odoSeps.push(s);
    }
  }
  /* start every column on the blank row, flush, then let the first
     odoRender set targets — the flip visibly rolls into place */
  for (const inner of odoCols) inner.style.transform = 'translateY(-12em)';
  void odoDigits.offsetHeight;
}

function odoRender(mode, chars) {
  if (mode !== odoMode) odoBuild(mode);
  /* chars: array of digit-or-null per column, most significant first */
  for (let i = 0; i < odoCols.length; i++) {
    const d = chars[i];
    odoCols[i].style.transform = d == null ? 'translateY(-12em)' : `translateY(${-d * 1.2}em)`;
  }
  if (mode === 'yr') {
    const anyLead = chars[0] != null || chars[1] != null || chars[2] != null;
    odoSeps[0].style.opacity = anyLead ? '' : '0';
  }
}

let flipped = false, rollTimer = 0;
function odoFlip(toMinutes) {
  flipped = toMinutes;
  odo.classList.add('rolling');
  clearTimeout(rollTimer);
  rollTimer = setTimeout(() => odo.classList.remove('rolling'), 650);
  odoUnit.textContent = toMinutes ? 'MIN:SEC' : 'YR';
}

function yearsAt(m) {
  if (m <= 1) return 300 * smooth(clamp(m, 0, 1));
  if (m <= 2) return 300 + 95700 * Math.pow(m - 1, 1.2);
  return 96000 + 4000 * clamp((m - 2) / 0.85, 0, 1);
}

function odoUpdate(m, c3p) {
  const shouldFlip = c3p > 0.85;
  if (shouldFlip !== flipped) odoFlip(shouldFlip);
  if (!flipped) {
    const v = Math.round(yearsAt(m));
    const s = String(v).padStart(6, ' ');
    odoRender('yr', [...s].map((ch) => (ch === ' ' ? null : +ch)));
  } else {
    const sec = Math.round(SUN_TRANSIT * clamp(m - 3, 0, 1));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    odoRender('min', [+mm[0], +mm[1], +ss[0], +ss[1]]);
  }
}

/* ------------------------------------------------------------
   HUD lines
   ------------------------------------------------------------ */
const hudDepth = $('#hudDepth'), hudTemp = $('#hudTemp'), hudSection = $('#hudSection');
let lastDepth = '', lastTemp = '', lastSection = '';

const fmtK = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}×10⁶ K` : `${fmt(v)} K`;

function hudUpdate(m) {
  let depth, temp;
  if (m < 1) { depth = `DEPTH ${fmt(lerp(696000, 500000, smooth(m)))} KM`; temp = fmtK(15700000); }
  else if (m < 2) { depth = `DEPTH ${fmt(lerp(500000, 1000, Math.pow(m - 1, 0.8)))} KM`; temp = fmtK(lerp(15700000, 2000000, m - 1)); }
  else if (m < 3) { depth = m < 2.85 ? `DEPTH ${fmt(lerp(1000, 0, (m - 2) / 0.85))} KM` : 'SURFACE · LAST SCATTERING'; temp = fmtK(lerp(2000000, 5772, smooth(clamp((m - 2) / 0.85, 0, 1)))); }
  else if (m < 4) { depth = `TO EARTH: ${fmt(149597870 * (1 - (m - 3)))} KM`; temp = '2.7 K'; }
  else if (m < 5) { depth = `ALTITUDE: ${fmt(lerp(100, 0, m - 4))} KM`; temp = '288 K'; }
  else { depth = 'RETINA · 0 M'; temp = '310 K'; }
  if (depth !== lastDepth) { hudDepth.textContent = depth; lastDepth = depth; }
  if (temp !== lastTemp) { hudTemp.textContent = temp; lastTemp = temp; }
  const i = clamp(Math.floor(m + 0.04), 0, 5);
  const label = `0${i + 1} / ${NAMES[i]}`;
  if (label !== lastSection) { hudSection.textContent = label; lastSection = label; }
}

/* ------------------------------------------------------------
   clocks
   ------------------------------------------------------------ */
const zone = (() => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (tz && !/^Etc\//i.test(tz)) return tz.toUpperCase().replace(/_/g, ' ');
  const off = -new Date().getTimezoneOffset() / 60;
  return `UTC${off >= 0 ? '+' : '−'}${Math.abs(off)}`;
})();
$('#clockZone').textContent = zone;
const clockTime = $('#clockTime'), footClock = $('#footClock');

function clockStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return [p(d.getHours()), p(d.getMinutes()), p(d.getSeconds())];
}
function tickClocks() {
  const [h, m, s] = clockStr();
  clockTime.innerHTML = `${h}<span class="colon">:</span>${m}<span class="colon">:</span>${s}`;
  footClock.textContent = `${h}:${m}:${s} — ${zone}`;
}
tickClocks();
setInterval(tickClocks, 1000);

/* ------------------------------------------------------------
   journey rail
   ------------------------------------------------------------ */
const railDot = $('#railDot');
const railTicks = $$('.rail-tick');
let scrollGen = 0;
/* first real user input cancels any programmatic glide — never fight the wheel */
for (const ev of ['wheel', 'touchstart', 'keydown']) {
  addEventListener(ev, () => { scrollGen++; }, { passive: true });
}
function easeScrollTo(target, duration = 1200, after) {
  if (REDUCED) { scrollTo(0, target); if (after) after(); return; }
  const id = ++scrollGen;
  const start = scrollY, delta = target - start, t0 = performance.now();
  const ease = (t) => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  const step = (now) => {
    if (id !== scrollGen) return;
    const p = clamp((now - t0) / duration, 0, 1);
    scrollTo(0, start + delta * ease(p));
    if (p < 1) requestAnimationFrame(step);
    else if (after) after();
  };
  requestAnimationFrame(step);
}
railTicks.forEach((a, i) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', a.getAttribute('href'));
    easeScrollTo(bounds[i] + 2, 1200, () => {
      sections[i].setAttribute('tabindex', '-1');
      sections[i].focus({ preventScroll: true });
    });
  });
});
$('#again').addEventListener('click', () => easeScrollTo(0, 1200));

/* ------------------------------------------------------------
   world + fx + cursor canvases
   ------------------------------------------------------------ */
const world = new World($('#gl'), { reduced: REDUCED });
if (!world.ok) doc.classList.add('no-gl');

const fx = $('#fx'), fctx = fx.getContext('2d');
const cur = $('#cursorCanvas'), cctx = cur.getContext('2d');
let fxDpr = 1, curDpr = 1;

function sizeCanvases() {
  fxDpr = Math.min(devicePixelRatio || 1, 1.25);
  curDpr = Math.min(devicePixelRatio || 1, 1.5);
  fx.width = Math.round(innerWidth * fxDpr);
  fx.height = Math.round(innerHeight * fxDpr);
  cur.width = Math.round(innerWidth * curDpr);
  cur.height = Math.round(innerHeight * curDpr);
}

/* particles */
const EMBERS = 800, WALKERS = 2000;
let quality = 1;
const embers = Array.from({ length: EMBERS }, () => ({
  x: Math.random(), y: Math.random(),
  vx: (Math.random() - 0.5) * 0.012, vy: -0.004 - Math.random() * 0.012,
  r: 0.6 + Math.random() * 1.7, ph: Math.random() * 7,
}));
const walkers = Array.from({ length: WALKERS }, () => ({
  x: Math.random(), y: Math.random(),
  a: Math.random() * Math.PI * 2, n: (8 + Math.random() * 14) | 0, c: 0,
}));
const photonTrail = [];
const mouse = { x: innerWidth / 2, y: innerHeight / 2, vx: 0, vy: 0, seen: false };
addEventListener('mousemove', (e) => {
  mouse.vx = e.clientX - mouse.x; mouse.vy = e.clientY - mouse.y;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (!mouse.seen) { mouse.seen = true; doc.classList.add('cursor-live'); }
  /* single listener feeds the shader too */
  world.pointer.tx = e.clientX / innerWidth;
  world.pointer.ty = 1 - e.clientY / innerHeight;
}, { passive: true });
document.addEventListener('mouseleave', () => {
  mouse.seen = false;
  doc.classList.remove('cursor-live');
});

function drawParticles(dt, m, c2p) {
  const w = fx.width, h = fx.height;
  const emberW = 1 - smooth(clamp((m - 0.8) / 0.5, 0, 1));
  const walkerW = smooth(clamp((m - 0.75) / 0.35, 0, 1)) * (1 - smooth(clamp((m - 2.1) / 0.7, 0, 1)));
  const photonW = smooth(clamp((m - 0.75) / 0.35, 0, 1)) * (1 - smooth(clamp((m - 2.55) / 0.35, 0, 1)));
  if (emberW < 0.01 && walkerW < 0.01 && photonW < 0.01) {
    if (fctx.lastCleared !== true) { fctx.clearRect(0, 0, w, h); fctx.lastCleared = true; }
    return;
  }
  fctx.lastCleared = false;
  fctx.clearRect(0, 0, w, h);
  fctx.globalCompositeOperation = 'lighter';

  const mx = mouse.x * fxDpr, my = mouse.y * fxDpr;

  if (emberW > 0.01) {
    const n = (EMBERS * quality) | 0;
    const tNow = performance.now() * 0.001;
    for (let i = 0; i < n; i++) {
      const p = embers[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      if (p.x < -0.02) p.x = 1.02; else if (p.x > 1.02) p.x = -0.02;
      fctx.globalAlpha = (0.25 + 0.3 * Math.abs(Math.sin(p.ph + tNow * (1 + p.r)))) * emberW;
      fctx.fillStyle = i % 7 === 0 ? '#FF5C38' : '#FFB35C';
      fctx.fillRect(p.x * w, p.y * h, p.r * fxDpr, p.r * fxDpr);
    }
    fctx.globalAlpha = 1;
  }

  if (walkerW > 0.01) {
    const n = (WALKERS * quality) | 0;
    const rep = 90 * fxDpr;
    fctx.fillStyle = `rgba(255,150,100,${0.52 * walkerW})`;
    for (let i = 0; i < n; i++) {
      const p = walkers[i];
      if (++p.c >= p.n) { p.c = 0; p.a = Math.random() * Math.PI * 2; }
      let sx = Math.cos(p.a) * 0.0009, sy = Math.sin(p.a) * 0.0009;
      if (mouse.seen && !TOUCH) {
        const dx = p.x * w - mx, dy = p.y * h - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < rep * rep && d2 > 1) {
          const d = Math.sqrt(d2), f = (1 - d / rep) * 0.004;
          sx += (dx / d) * f; sy += (dy / d) * f;
        }
      }
      p.x = (p.x + sx + 1) % 1; p.y = (p.y + sy + 1) % 1;
      fctx.fillRect(p.x * w, p.y * h, 1.4 * fxDpr, 1.4 * fxDpr);
    }
  }

  if (photonW > 0.01) {
    const ax = lerp(0.1, 0.9, smooth(c2p)) * w;
    const ay = h * (0.42 + 0.1 * Math.sin(performance.now() * 0.0006));
    const jx = (Math.random() - 0.5) * 14 * fxDpr, jy = (Math.random() - 0.5) * 14 * fxDpr;
    photonTrail.push({ x: ax + jx, y: ay + jy });
    if (photonTrail.length > 42) photonTrail.shift();
    fctx.strokeStyle = '#F5F0E6';
    fctx.lineWidth = 1.1 * fxDpr;
    for (let i = 1; i < photonTrail.length; i++) {
      fctx.globalAlpha = (i / photonTrail.length) * 0.55 * photonW;
      fctx.beginPath();
      fctx.moveTo(photonTrail[i - 1].x, photonTrail[i - 1].y);
      fctx.lineTo(photonTrail[i].x, photonTrail[i].y);
      fctx.stroke();
    }
    /* the protagonist: bone core in a soft amber glow */
    const head = photonTrail[photonTrail.length - 1];
    fctx.globalAlpha = photonW;
    fctx.shadowColor = 'rgba(255,179,92,0.9)';
    fctx.shadowBlur = 14 * fxDpr;
    fctx.fillStyle = '#F5F0E6';
    fctx.beginPath();
    fctx.arc(head.x, head.y, 3 * fxDpr, 0, 7);
    fctx.fill();
    fctx.shadowBlur = 0;
    fctx.globalAlpha = 1;
  } else photonTrail.length = 0;

  fctx.globalCompositeOperation = 'source-over';
}

/* photon cursor */
const cursorHistory = [];
let hoverT = 0, hoverTarget = 0, lastDir = { x: 1, y: 0 };
document.addEventListener('mouseover', (e) => {
  hoverTarget = e.target.closest('a, button, [role="slider"]') ? 1 : 0;
});

function drawCursor(dt, m) {
  const w = cur.width, h = cur.height;
  cctx.clearRect(0, 0, w, h);
  if (TOUCH || REDUCED || !mouse.seen) return;
  const x = mouse.x * curDpr, y = mouse.y * curDpr;
  hoverT = damp(hoverT, hoverTarget, 14, dt);

  const speed = Math.hypot(mouse.vx, mouse.vy);
  if (speed > 1.5) {
    const inv = 1 / speed;
    lastDir.x = damp(lastDir.x, mouse.vx * inv, 8, dt);
    lastDir.y = damp(lastDir.y, mouse.vy * inv, 8, dt);
  }
  mouse.vx *= 0.86; mouse.vy *= 0.86;

  cursorHistory.push({ x, y });
  if (cursorHistory.length > 26) cursorHistory.shift();

  const jitterAmp = (1 - smooth(clamp((m - 2.3) / 0.6, 0, 1))) * 5 * curDpr;
  const beamW = smooth(clamp((m - 3.1) / 0.4, 0, 1)) * (1 - smooth(clamp((m - 5.35) / 0.4, 0, 1)));
  const trailW = 1 - smooth(clamp((m - 5.35) / 0.4, 0, 1));

  /* interior: jittering random-walk trail */
  if (jitterAmp > 0.3 && trailW > 0.01 && cursorHistory.length > 2) {
    cctx.lineWidth = 1 * curDpr;
    cctx.strokeStyle = '#F5F0E6';
    for (let i = 1; i < cursorHistory.length; i++) {
      const a = cursorHistory[i - 1], b = cursorHistory[i];
      cctx.globalAlpha = (i / cursorHistory.length) * 0.4 * trailW;
      cctx.beginPath();
      cctx.moveTo(a.x + (Math.random() - 0.5) * jitterAmp, a.y + (Math.random() - 0.5) * jitterAmp);
      cctx.lineTo(b.x + (Math.random() - 0.5) * jitterAmp, b.y + (Math.random() - 0.5) * jitterAmp);
      cctx.stroke();
    }
    cctx.globalAlpha = 1;
  }

  /* vacuum / sky: straight beam, refracting at the atmosphere line */
  if (beamW > 0.01) {
    const skyW = smooth(clamp((m - 4.4) / 0.4, 0, 1)) * beamW;
    const len = 130 * curDpr;
    const bx = -lastDir.x, by = -lastDir.y;
    const grad = cctx.createLinearGradient(x, y, x + bx * len, y + by * len);
    grad.addColorStop(0, `rgba(245,240,230,${0.5 * beamW})`);
    grad.addColorStop(1, 'rgba(245,240,230,0)');
    cctx.strokeStyle = grad;
    cctx.lineWidth = 1.2 * curDpr;
    cctx.beginPath();
    cctx.moveTo(x, y);
    if (skyW > 0.35) {
      /* kink the beam mid-way: light bending into the atmosphere */
      const kx = x + bx * len * 0.45, ky = y + by * len * 0.45;
      const ang = Math.atan2(by, bx) + 0.22;
      cctx.lineTo(kx, ky);
      cctx.lineTo(kx + Math.cos(ang) * len * 0.55, ky + Math.sin(ang) * len * 0.55);
    } else {
      cctx.lineTo(x + bx * len, y + by * len);
    }
    cctx.stroke();
  }

  /* the photon itself */
  const coreT = 1 - smooth(clamp((m - 1.6) / 0.9, 0, 1));
  const rC = Math.round(lerp(245, 255, coreT)), gC = Math.round(lerp(240, 122, coreT)), bC = Math.round(lerp(230, 76, coreT));
  const dotR = (3 - hoverT * 1.2) * curDpr;
  cctx.fillStyle = `rgba(${rC},${gC},${bC},0.96)`;
  cctx.beginPath();
  cctx.arc(x, y, dotR, 0, 7);
  cctx.fill();
  if (hoverT > 0.02) {
    cctx.strokeStyle = `rgba(${rC},${gC},${bC},${0.85 * hoverT})`;
    cctx.lineWidth = 1 * curDpr;
    cctx.beginPath();
    cctx.arc(x, y, (5 + 7 * hoverT) * curDpr, 0, 7);
    cctx.stroke();
  }
}

/* ------------------------------------------------------------
   press-and-hold light meter
   ------------------------------------------------------------ */
const hold = $('#hold'), holdTime = $('#holdTime'), holdDist = $('#holdDist'), holdNote = $('#holdNote');
const MILESTONES = [
  [40075, 'ONCE AROUND THE EARTH'],
  [384400, 'TO THE MOON'],
  [768800, 'THE MOON AND BACK'],
  [4000000, 'TEN ROUND TRIPS TO THE MOON'],
  [77000000, 'TO MARS, AT ITS CLOSEST'],
  [149597870, 'TO THE SUN'],
];
let holdStart = 0, holdActive = false, holdTimer = 0, holdOrigin = null;

function holdBegin(e) {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.clientX > innerWidth - 24) return; /* scrollbar drags are not holds */
  if (e.target.closest('a, button, [role="slider"], .rail')) return;
  holdOrigin = { x: e.clientX, y: e.clientY };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdActive = true;
    holdStart = performance.now();
    hold.classList.add('on');
    document.body.classList.add('holding');
  }, 300);
}
function holdEnd() {
  clearTimeout(holdTimer);
  if (holdActive) { holdActive = false; hold.classList.remove('on'); }
  document.body.classList.remove('holding');
  holdOrigin = null;
}
addEventListener('pointerdown', holdBegin);
addEventListener('pointerup', holdEnd);
addEventListener('pointercancel', holdEnd);
addEventListener('pointermove', (e) => {
  if (holdOrigin && !holdActive &&
      Math.hypot(e.clientX - holdOrigin.x, e.clientY - holdOrigin.y) > 10) holdEnd();
}, { passive: true });
addEventListener('contextmenu', (e) => { if (holdActive) e.preventDefault(); });

function holdUpdate() {
  if (!holdActive) return;
  const s = (performance.now() - holdStart) / 1000;
  const km = s * C;
  holdTime.textContent = `YOU HELD FOR ${s.toFixed(2)} S`;
  holdDist.textContent = `LIGHT WENT ${fmt(km)} KM`;
  let note = `EARTH'S WAISTLINE IS ${fmt(MILESTONES[0][0])} KM — ALMOST THERE`;
  for (const [d, label] of MILESTONES) if (km >= d) note = `${fmt(d)} KM — ${label}`;
  holdNote.textContent = note;
}

/* ------------------------------------------------------------
   spectrum widget (chapter 5)
   ------------------------------------------------------------ */
const spectrum = $('#spectrum'), specCanvas = $('#specCanvas'), specMarker = $('#specMarker'), specOut = $('#specOut');
let lambda = 450, lambdaTarget = 450;

function wl2css(l) {
  let r, g, b;
  if (l < 440) { r = (440 - l) / 60; g = 0; b = 1; }
  else if (l < 490) { r = 0; g = (l - 440) / 50; b = 1; }
  else if (l < 510) { r = 0; g = 1; b = (510 - l) / 20; }
  else if (l < 580) { r = (l - 510) / 70; g = 1; b = 0; }
  else if (l < 645) { r = 1; g = (645 - l) / 65; b = 0; }
  else { r = 1; g = 0; b = 0; }
  const fade = l < 420 ? 0.4 + 0.6 * (l - 380) / 40 : l > 660 ? 0.4 + 0.6 * (700 - l) / 40 : 1;
  return [r * fade * 255, g * fade * 255, b * fade * 255];
}

function drawSpectrum() {
  const r = spectrum.getBoundingClientRect();
  if (r.width < 10) return;
  specCanvas.width = Math.round(r.width);
  specCanvas.height = 44;
  const ctx = specCanvas.getContext('2d', { willReadFrequently: true });
  /* tone-mapped into the world: samples pulled 35% toward bone,
     peak compressed — a graded strip, not a screen-calibration bar */
  for (let x = 0; x < specCanvas.width; x++) {
    const l = 380 + (x / specCanvas.width) * 320;
    const [cr, cg, cb] = wl2css(l);
    const tr = (cr * 0.65 + 245 * 0.35) * 0.85;
    const tg = (cg * 0.65 + 240 * 0.35) * 0.85;
    const tb = (cb * 0.65 + 230 * 0.35) * 0.85;
    ctx.fillStyle = `rgb(${tr | 0},${tg | 0},${tb | 0})`;
    ctx.fillRect(x, 0, 1, specCanvas.height);
  }
  const fade = ctx.createLinearGradient(0, 0, 0, specCanvas.height);
  fade.addColorStop(0, 'rgba(7,6,4,0)');
  fade.addColorStop(1, 'rgba(7,6,4,0.45)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, specCanvas.width, specCanvas.height);
  /* the site's film stock, so the strip lives in the world */
  const img = ctx.getImageData(0, 0, specCanvas.width, specCanvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function setLambda(l, announce = true) {
  lambdaTarget = clamp(Math.round(l), 380, 700);
  specMarker.style.left = `${((lambdaTarget - 380) / 320) * 100}%`;
  const ratio = Math.pow(700 / lambdaTarget, 4);
  specOut.textContent = `λ ${lambdaTarget} NM — SCATTERS ×${ratio.toFixed(1)} VS 700 NM`;
  if (announce) {
    spectrum.setAttribute('aria-valuenow', lambdaTarget);
    spectrum.setAttribute('aria-valuetext', `${lambdaTarget} nanometers`);
  }
}
function pointerLambda(e) {
  const r = spectrum.getBoundingClientRect();
  setLambda(380 + ((e.clientX - r.left) / r.width) * 320);
}
spectrum.addEventListener('pointerdown', (e) => {
  spectrum.setPointerCapture(e.pointerId);
  pointerLambda(e);
});
spectrum.addEventListener('pointermove', (e) => { if (e.buttons) pointerLambda(e); });
spectrum.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -10, ArrowRight: 10, ArrowDown: -10, ArrowUp: 10 }[e.key];
  if (step) { e.preventDefault(); setLambda(lambdaTarget + step); }
  if (e.key === 'Home') { e.preventDefault(); setLambda(380); }
  if (e.key === 'End') { e.preventDefault(); setLambda(700); }
});
setLambda(450, false);

/* ------------------------------------------------------------
   waypoints, ink migration, typed reveal, instruments
   ------------------------------------------------------------ */
const waypointEls = $$('.waypoints li');
const WAYPOINT_SECS = [0, 193, 361, 498, 499];
function waypointsUpdate(m) {
  const sec = SUN_TRANSIT * clamp(m - 3, 0, 1.001);
  waypointEls.forEach((li, i) => {
    li.classList.toggle('now', sec >= WAYPOINT_SECS[i] - 2 && (i === waypointEls.length - 1 || sec < WAYPOINT_SECS[i + 1]));
  });
}

const BONE = [245, 240, 230], SOOT = [20, 17, 12], AMBER = [255, 179, 92], RAYL = [157, 193, 228], GRAY = [138, 133, 123];
let lastInk = '', lastAccent = '', lastHud = '', lastStrong = '';
const snap = (x, a, b) => smooth(clamp((x - a) / (b - a), 0, 1));
function migrate(state) {
  /* content ink follows the sky, snapped through the mid-band so text is
     never mid-gray on a mid-gray blend; chrome follows overall world
     brightness — sky OR boiling photosphere (full soot on the hot ground) */
  const tPage = snap(state.sky, 0.35, 0.65);
  const tHud = clamp(Math.max(snap(state.sky, 0.35, 0.65), state.gran * 1.8), 0, 1);
  const ink = BONE.map((b, i) => Math.round(lerp(b, SOOT[i], tPage)));
  const inkStr = `rgb(${ink.join(',')})`;
  if (inkStr !== lastInk) { doc.style.setProperty('--ink', inkStr); lastInk = inkStr; }
  const hud = GRAY.map((g, i) => Math.round(lerp(g, SOOT[i], tHud * 0.9)));
  const hudStr = `rgb(${hud.join(',')})`;
  if (hudStr !== lastHud) { doc.style.setProperty('--hud-ink', hudStr); lastHud = hudStr; }
  const strong = BONE.map((b, i) => Math.round(lerp(b, SOOT[i], tHud)));
  const strongStr = `rgb(${strong.join(',')})`;
  if (strongStr !== lastStrong) { doc.style.setProperty('--hud-strong', strongStr); lastStrong = strongStr; }
  const a = clamp((worldMix - 2.7) / 1.6, 0, 1);
  const acc = AMBER.map((b, i) => Math.round(lerp(lerp(b, RAYL[i], smooth(a)), SOOT[i], tHud * 0.55)));
  const accStr = `rgb(${acc.join(',')})`;
  if (accStr !== lastAccent) { doc.style.setProperty('--accent', accStr); lastAccent = accStr; }
}

const typedText = $('#typedText'), typedMsg = 'YOUR SCREEN IS A SMALL STAR.';
let typedStarted = false;
function typeOn() {
  if (typedStarted) return;
  typedStarted = true;
  world.uni.bloom = Math.max(world.uni.bloom, 0.4); /* the arrival glows once */
  if (REDUCED) { typedText.textContent = typedMsg; return; }
  let i = 0;
  const t = setInterval(() => {
    typedText.textContent = typedMsg.slice(0, ++i);
    if (i >= typedMsg.length) clearInterval(t);
  }, 90);
}

const litFor = $('#litFor'), photons = $('#photons');
const t0 = performance.now();
const PHOTON_RATE = 5e17; // est. visible photons per second from a laptop display
let photonTick = 0;
function instruments(now) {
  const s = (now - t0) / 1000;
  if (now - photonTick > 100) {
    photonTick = now;
    const total = s * PHOTON_RATE;
    const exp = Math.floor(Math.log10(total));
    const mant = (total / Math.pow(10, exp)).toFixed(1);
    photons.textContent = `PHOTONS RECEIVED FROM THIS PAGE (EST.): ${mant}×10${sup(exp)}`;
    const p = (n) => String(n).padStart(2, '0');
    litFor.textContent = `YOU HAVE BEEN LIT FOR ${p(Math.floor(s / 60))}:${p(Math.floor(s % 60))}`;
  }
}

/* lights out */
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    doc.classList.toggle('lights-off');
  }
});

/* ------------------------------------------------------------
   reveals
   ------------------------------------------------------------ */
/* fade the HUD odometer while any text block occupies the top band —
   kills every text-on-text collision at every breakpoint */
function initHudGuard() {
  const overlapState = new Map();
  const guard = new IntersectionObserver((entries) => {
    for (const en of entries) overlapState.set(en.target, en.isIntersecting);
    let any = false;
    overlapState.forEach((v) => { any = any || v; });
    doc.classList.toggle('hud-hidden', any);
  }, { rootMargin: '0px 0px -86% 0px', threshold: 0 });
  const wide = matchMedia('(min-width: 901px)').matches;
  for (const el of $$('.voice, .typed, .display')) {
    /* on desktop the chapter padding protects the HUD column except for
       full-width displays; on mobile everything can collide */
    if (!wide || el.classList.contains('display')) guard.observe(el);
  }
}

function initObservers() {
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      el.classList.add('in');
      if (el.hasAttribute('data-decode')) {
        if (REDUCED) el.textContent = el.dataset.text ?? el.textContent;
        else decode(el);
      }
      if (el.closest('.c6-reveal')) typeOn();
      io.unobserve(el);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  $$('[data-reveal], .split, [data-decode]').forEach((el) => io.observe(el));
  const revealIo = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { typeOn(); revealIo.disconnect(); }
  }, { threshold: 0.5 });
  revealIo.observe($('#typed'));
}

/* ------------------------------------------------------------
   preloader
   ------------------------------------------------------------ */
const loader = $('#loader'), loadK = $('#loadK'), loadStatus = $('#loadStatus'), loadLine = $('#loadLine');
const n1 = $('#n1'), n2 = $('#n2'), flash = $('#flash');
const escapeEl = $('#escape');
const arrival = $('.c6-arrival');
let loaded = false;

function boot() {
  sizeCanvases();
  measure();
  /* split only once real glyph metrics exist — fallback-font splits leave orphan lines */
  document.fonts.ready.then(() => {
    $$('[data-split]').forEach((el) => splitText(el));
    measure();
    drawSpectrum();
  });

  let real = 0;
  const promises = [
    document.fonts.ready,
    new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
  ];
  promises.forEach((p) => Promise.resolve(p).finally(() => { real += 1 / promises.length; }));

  const minTime = REDUCED ? 400 : 2300;
  const start = performance.now();
  let shown = 0;
  const step = (now) => {
    const t = clamp((now - start) / minTime, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    shown = Math.max(shown, Math.min(eased, real < 1 ? 0.92 : 1));
    loadK.textContent = `${fmt(shown * 15700000)} K`;
    loadStatus.textContent = shown < 0.4 ? 'IGNITING FRAGMENT SHADER'
      : shown < 0.75 ? 'SEEDING NOISE FIELD' : 'COMPRESSING HYDROGEN';
    const gap = (1 - shown) * 92;
    n1.style.transform = `translateX(${-gap}px)`;
    n2.style.transform = `translateX(${gap}px)`;
    if (shown >= 1 && real >= 1) { ignite(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function ignite() {
  const d = new Date(Date.now() - SUN_TRANSIT * 1000);
  const p = (n) => String(n).padStart(2, '0');
  loadLine.textContent = `THE SUNLIGHT AROUND YOU LEFT THE SUN AT ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  loadLine.classList.add('on');
  setTimeout(() => {
    if (!REDUCED) {
      flash.classList.add('on');
      world.uni.bloom = 3;
      setTimeout(() => flash.classList.remove('on'), 90);
    }
    world.uni.intro = REDUCED ? 1 : 0.001;
    doc.classList.add('loaded');
    document.body.classList.add('loaded');
    loaded = true;
    measure();
    initObservers();
    initHudGuard();
  }, REDUCED ? 200 : 1000);
}

/* ------------------------------------------------------------
   the loop
   ------------------------------------------------------------ */
let sSmooth = 0, lastNow = performance.now();
let worldMix = 0;
let escFlareDone = false;
let lastWg = 0, lastWd = 0, lastLs = '', lastEt = -1, lastDotY = -1, lastArrOp = -1;
let railH = 1;

/* adaptive quality, calibrated against the display's own refresh:
   baseline = median dt of the first clean frames after load; degrade
   only after two consecutive slow windows; recover after ten clean ones */
let frameAcc = 0, frameCount = 0, frameBase = 0, badWindows = 0, cleanWindows = 0, windowDirty = false;
const baseSamples = [];
addEventListener('resize', () => { windowDirty = true; });
document.addEventListener('visibilitychange', () => { windowDirty = true; });

function loop(now) {
  const dt = clamp((now - lastNow) / 1000, 0.001, 1 / 20);
  lastNow = now;

  const u = scrollY;
  sSmooth = REDUCED ? u : damp(sSmooth, u, 5, dt);
  if (Math.abs(sSmooth - u) < 0.3) sSmooth = u;

  const m = mixOf(sSmooth);
  worldMix = m;
  const c3p = clamp((sSmooth - scrubC3.top) / scrubC3.len, 0, 1);
  const convP = clamp((sSmooth - convC6.top) / convC6.len, 0, 1);
  const c4p = clamp((sSmooth - sunC4.top) / sunC4.len, 0, 1);
  const c2p = clamp((sSmooth - walkC2.top) / walkC2.len, 0, 1);

  /* world uniforms */
  blendStatesInto(m, world.state);
  if (TOUCH) {
    const v = Math.abs(u - sSmooth);
    world.state.ptrStr *= clamp(v / 600, 0, 1);
    world.pointer.tx = 0.5; world.pointer.ty = 0.4;
  }
  world.uni.conv = smooth(convP);
  world.uni.sunY = 0.15 + c4p * 1.15;
  world.uni.lambda += (lambdaTarget - world.uni.lambda) * Math.min(1, dt * 10);
  world.uni.bloom *= Math.exp(-dt * 2.4);
  if (world.uni.intro > 0 && world.uni.intro < 1) {
    world.uni.intro = clamp(world.uni.intro + dt * 2.4, 0, 1);
  }

  /* escape scrub + flare — quantized, written only on change */
  if (loaded) {
    const sp = smooth(c3p);
    const wg = Math.round(lerp(900, 200, sp) / 4) * 4;
    const wd = Math.round(lerp(62, 125, sp) * 2) / 2;
    if (wg !== lastWg) { escapeEl.style.setProperty('--wg', wg); lastWg = wg; }
    if (wd !== lastWd) { escapeEl.style.setProperty('--wd', wd); lastWd = wd; }
    const ls = (lerp(-0.01, 0.07, sp)).toFixed(3);
    if (ls !== lastLs) { escapeEl.style.setProperty('--esc-ls', ls + 'em'); lastLs = ls; }
    /* the word darkens as it decompresses into the bright photosphere */
    const et = Math.round(clamp(world.state.gran * 1.8, 0, 1) * 40) / 40;
    if (et !== lastEt) {
      lastEt = et;
      escapeEl.style.color = `rgb(${BONE.map((b, i) => Math.round(lerp(b, SOOT[i], et))).join(',')})`;
    }
    if (c3p > 0.85 && !escFlareDone) { escFlareDone = true; if (!REDUCED) world.uni.bloom = Math.max(world.uni.bloom, 1.2); }
    if (c3p < 0.7 && escFlareDone) escFlareDone = false;

    odoUpdate(m, c3p);
    hudUpdate(m);
    waypointsUpdate(m);
    migrate(world.state);
    const dotY = Math.round((m / 6) * railH * 10) / 10;
    if (dotY !== lastDotY) { railDot.style.transform = `translateY(${dotY}px)`; lastDotY = dotY; }
    const active = clamp(Math.floor(m + 0.04), 0, 5);
    railTicks.forEach((a, i) => a.classList.toggle('now', i === active));
    const arrOp = Math.round(clamp(1 - convP * 1.9, 0, 1) * 100) / 100;
    if (arrOp !== lastArrOp) { arrival.style.opacity = String(arrOp); lastArrOp = arrOp; }
    holdUpdate();
    instruments(now);
  }

  world.render(dt);
  if (!REDUCED && loaded) {
    drawParticles(dt, m, c2p);
    drawCursor(dt, m);
  }

  /* adaptive quality — never starts before the world is actually visible */
  if (loaded && world.uni.intro >= 1) {
    if (frameBase === 0) {
      baseSamples.push(dt);
      if (baseSamples.length >= 40) {
        baseSamples.sort((a, b) => a - b);
        frameBase = baseSamples[Math.floor(baseSamples.length / 2)];
      }
    } else {
      frameAcc += dt; frameCount++;
      if (frameCount >= 60) {
        const avg = frameAcc / frameCount;
        const threshold = Math.max(frameBase * 1.5, 0.021);
        if (windowDirty) {
          windowDirty = false;
        } else if (avg > threshold) {
          cleanWindows = 0;
          if (++badWindows >= 2 && quality > 0.25) {
            badWindows = 0;
            quality *= 0.5;
            if (world.ok && world.fboScale > 0.4) { world.fboScale = 0.4; world.resize(); }
          }
        } else {
          badWindows = 0;
          if (avg < Math.max(frameBase * 1.1, 0.017) && quality < 1 && ++cleanWindows >= 10) {
            cleanWindows = 0;
            quality = Math.min(1, quality * 2);
            if (world.ok && quality === 1 && world.fboScale < 0.5) { world.fboScale = 0.5; world.resize(); }
          }
        }
        frameAcc = 0; frameCount = 0;
      }
    }
  }

  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------
   resize
   ------------------------------------------------------------ */
let resizeTimer = 0, resizeRaf = 0;
let lastW = innerWidth, lastH = innerHeight;
addEventListener('resize', () => {
  /* mobile URL-bar show/hide fires resize mid-scroll: ignore height-only
     jitter, and coalesce the expensive canvas realloc to one per frame */
  const wChanged = innerWidth !== lastW;
  const hDelta = Math.abs(innerHeight - lastH);
  if (!wChanged && hDelta < 150) return;
  lastW = innerWidth; lastH = innerHeight;
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    world.resize();
    sizeCanvases();
  });
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    $$('[data-split]').forEach((el) => {
      const wasIn = el.classList.contains('in');
      splitText(el);
      if (wasIn) el.classList.add('in');
    });
    measure();
    drawSpectrum();
  }, 250);
});

/* go */
boot();
requestAnimationFrame((n) => {
  lastNow = n;
  sSmooth = scrollY; /* mid-page reload: no involuntary fast-forward recap */
  requestAnimationFrame(loop);
});
