/* ============================================================
   SLOWLIGHT — the world. One fragment shader, six states,
   rendered at half resolution and composited with grain.
   Raw WebGL2. No libraries.
   ============================================================ */

const VERT = `#version 300 es
layout(location=0) in vec2 p;
out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;

/* ---------- the world shader (half-res) ---------- */
const WORLD_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;      // 0..1, damped
uniform float uPtrStr;       // per-chapter pointer perturbation
uniform float uBloom;        // scripted flare
uniform float uIntro;        // 0 before first flash

uniform float uWarp;
uniform float uDensity;
uniform float uBright;
uniform float uRadial;
uniform float uGran;         // voronoi granulation mix
uniform float uStar;         // starfield mix
uniform float uSky;          // rayleigh dome mix
uniform float uEye;          // retina mix
uniform float uConv;         // convergence 0..1 inside the eye
uniform float uSunY;         // receding sun position (chapter 4)
uniform float uLambda;       // 380..700 nm
uniform vec3  uPalA;
uniform vec3  uPalB;
uniform vec3  uPalC;

/* -- noise kit -- */
float hash21(vec2 p){
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for(int i = 0; i < 4; i++){
    v += a * vnoise(p);
    p = rot * p * 2.02 + 11.5;
    a *= 0.55;
  }
  return v;
}
/* cheap single-iteration F2-F1 voronoi (solar granulation) */
float voro(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float f1 = 8., f2 = 8.;
  for(int y = -1; y <= 1; y++)
  for(int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = g + 0.5 + 0.45 * sin(uTime * 0.12 + 6.2831 * vec2(hash21(i + g), hash21(i + g + 19.7))) - f;
    float d = dot(o, o);
    if(d < f1){ f2 = f1; f1 = d; }
    else if(d < f2){ f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
/* approximate wavelength (nm) -> linear RGB */
vec3 wl2rgb(float l){
  vec3 c =
    (l < 440.) ? vec3((440. - l) / 60., 0., 1.) :
    (l < 490.) ? vec3(0., (l - 440.) / 50., 1.) :
    (l < 510.) ? vec3(0., 1., (510. - l) / 20.) :
    (l < 580.) ? vec3((l - 510.) / 70., 1., 0.) :
    (l < 645.) ? vec3(1., (645. - l) / 65., 0.) :
                 vec3(1., 0., 0.);
  float fade = (l < 420.) ? 0.4 + 0.6 * (l - 380.) / 40. :
               (l > 660.) ? 0.4 + 0.6 * (700. - l) / 40. : 1.;
  return clamp(c, 0., 1.) * fade;
}

void main(){
  vec2 uv = vUv;
  vec2 p = (uv * 2. - 1.);
  p.x *= uRes.x / uRes.y;
  float t = uTime * 0.3;

  /* pointer perturbation field */
  vec2 pp = uPointer * 2. - 1.;
  pp.x *= uRes.x / uRes.y;
  float pd = exp(-dot(p - pp, p - pp) * 2.6) * uPtrStr;

  /* ---- base plasma: fbm with two-level domain warp ----
     skipped entirely in the dark chapters (star/sky/eye at full mix
     discard it anyway) — the emptiest pages become the cheapest */
  float rad = 1. - length(p) * uRadial * 0.55;
  vec2 r = vec2(0.);
  vec3 col = vec3(0.);
  if (uStar + uSky + uEye < 0.999) {
    vec2 q = vec2(fbm(p * 1.35 + t * 0.16),
                  fbm(p * 1.35 - t * 0.12 + 5.2));
    vec2 warped = p * 1.35 + q * uWarp;
    warped += pd * 0.9 * vec2(sin(t * 1.7 + p.y * 3.), cos(t * 1.9 + p.x * 3.));
    r = vec2(fbm(warped + vec2(1.7, 9.2) + t * 0.11),
             fbm(warped + vec2(8.3, 2.8) - t * 0.13));
    float f = fbm(p * 1.35 + r * uWarp);

    float v = f * f * (0.9 + 0.55 * q.x) * uDensity * max(rad, 0.);

    col = mix(uPalA, uPalB, smoothstep(0.08, 0.5, v));
    col = mix(col, uPalC, smoothstep(0.42, 0.85, v));
    col *= uBright;
  }

  /* ---- solar granulation (photosphere): incandescent gold cells,
          near-black lanes — never beige ---- */
  if(uGran > 0.001){
    float g = voro(p * 3.4 + r * 0.4);
    float cell = smoothstep(0.01, 0.38, g);
    vec3 gc = mix(vec3(0.055, 0.024, 0.012), mix(uPalB, uPalC, cell * 0.45), cell);
    gc *= 0.88 + 0.28 * fbm(p * 2.4 + t * 0.2);
    float luma = dot(gc, vec3(0.299, 0.587, 0.114));
    gc = mix(vec3(luma), gc, 1.15);              /* mild saturation lift */
    gc *= 1. - length(p) * 0.3;                  /* darkened edges keep chrome legible */
    col = mix(col, gc * uBright, uGran * 0.94);
  }

  /* ---- vacuum: starfield + receding sun ---- */
  if(uStar > 0.001){
    vec3 space = vec3(0.028, 0.024, 0.02);
    /* two-tier stars, one per sparse grid cell; domain is
       resolution-independent so stars never teleport on resize */
    vec2 g = vec2(uv.x * uRes.x / uRes.y, uv.y) * 24.;
    vec2 id = floor(g);
    float h = hash21(id);
    vec2 spos = vec2(fract(h * 13.7), fract(h * 71.3)) * 0.7 + 0.15;
    float sd2 = length(fract(g) - spos);
    float tier = fract(h * 57.9);
    /* 85% sharp 1px cores sell vacuum; rare soft halo stars for depth */
    float star = step(0.8, h) * (0.3 + 0.7 * fract(h * 771.7)) *
      mix(1. - smoothstep(0.0, 0.045, sd2),
          (1. - smoothstep(0.0, 0.13, sd2)) * 1.3,
          step(0.85, tier));
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + fract(h * 91.3) * 2.2) + h * 40.);
    space += vec3(0.86, 0.9, 0.94) * star * 1.5;
    /* the sun, receding */
    vec2 sunP = vec2(0., uSunY);
    float sd = length(p - sunP);
    float sunR = mix(0.16, 0.035, clamp(uSunY, 0., 1.2) / 1.2);
    space += vec3(1., 0.72, 0.4) * (1. - smoothstep(sunR * 0.55, sunR * 1.35, sd));
    space += vec3(1., 0.65, 0.35) * exp(-sd * 5.5) * 0.22;
    col = mix(col, space, uStar);
  }

  /* ---- rayleigh sky dome ---- */
  if(uSky > 0.001){
    float lam = uLambda;
    float scat = pow(500. / lam, 4.0);           /* ~1/lambda^4, normalized near mid-spectrum */
    vec3 lightC = wl2rgb(lam);
    float y = clamp(uv.y, 0., 1.);
    /* zenith carries the scattered wavelength, desaturated toward powder; horizon whitens with haze */
    vec3 zenith = lightC * clamp(scat, 0., 2.1);
    zenith = mix(vec3(0.6, 0.69, 0.8) * clamp(scat * 0.5 + 0.35, 0.3, 1.1), zenith, 0.42);
    vec3 sky = mix(vec3(0.88, 0.88, 0.85), zenith * 0.8, clamp(y * 1.35 + 0.05, 0., 1.));
    sky = 1. - exp(-sky * 1.6);                   /* soft exposure */
    /* faint cirrus */
    float cir = fbm(vec2(uv.x * 3. + t * 0.05, uv.y * 6.)) * 0.08 * smoothstep(0.2, 0.8, y);
    sky += cir * (0.5 + 0.5 * lightC);
    sky += pd * 0.06;                             /* gentle haze swirl */
    col = mix(col, sky, uSky);
  }

  /* ---- the eye: converging filaments, warm vignette ---- */
  if(uEye > 0.001){
    float rr = length(p) * mix(1., 5.5, uConv);
    float ang = atan(p.y, p.x + 1e-5);
    float fil = fbm(vec2(ang * 2.2, pow(max(rr, 1e-5), 0.72) * 3.4 - t * 0.4));
    vec3 filC = mix(vec3(0.055, 0.016, 0.012), vec3(0.42, 0.12, 0.07),
                    smoothstep(0.35, 0.85, fil) * (1. - smoothstep(0.15, 1.9, rr)));
    vec3 eye = filC * (1. - uConv * 0.88);
    eye = mix(eye, vec3(0.078, 0.02, 0.016), smoothstep(0.7, 1.6, length(p))); /* warm edge */
    eye *= 1. - smoothstep(0.5, 1.5, length(p)) * 0.75;                        /* vignette */
    /* the single arriving point, with a faint warm halo */
    float dotR = length(p);
    float arrive = smoothstep(0.55, 0.95, uConv);
    eye += vec3(1., 0.72, 0.42) * exp(-dotR * 30.) * 0.38 * arrive;
    eye = mix(eye, vec3(0.96, 0.94, 0.9),
              (1. - smoothstep(0.004, 0.014, dotR)) * arrive);
    col = mix(col, eye, uEye);
  }

  /* ---- scripted flare + intro ---- */
  col += uBloom * vec3(1., 0.94, 0.85) * (0.45 + 0.55 * max(rad, 0.));
  col *= uIntro;

  outColor = vec4(col, 1.);
}`;

/* ---------- composite pass (full-res): upscale + grain + vignette ---------- */
const COMP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uTime;
uniform float uGrain;

float hash21(vec2 p){
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main(){
  vec3 col = texture(uTex, vUv).rgb;
  /* animated grain / dither — kills banding, unifies the world */
  float g = hash21(gl_FragCoord.xy + fract(uTime * 13.7) * 971.);
  col += (g - 0.5) * uGrain;
  /* gentle corner shading */
  vec2 c = vUv - 0.5;
  col *= 1. - dot(c, c) * 0.35;
  outColor = vec4(col, 1.);
}`;

/* ---------- chapter keyframe states ----------
   [warp, density, bright, radial, gran, star, sky, eye,
    palA(3), palB(3), palC(3), grain, ptrStr]              */
const hx = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const S = (o) => ({
  warp: o.warp, density: o.density, bright: o.bright, radial: o.radial,
  gran: o.gran ?? 0, star: o.star ?? 0, sky: o.sky ?? 0, eye: o.eye ?? 0,
  palA: hx(o.palA), palB: hx(o.palB), palC: hx(o.palC),
  grain: o.grain ?? 0.055, ptrStr: o.ptrStr ?? 0,
});

export const STATES = [
  /* S1 CORE — dense white-gold plasma */
  S({ warp: 1.6, density: 1.25, bright: 1.05, radial: 0.8,
      palA: '#070604', palB: '#FFB35C', palC: '#F5F0E6', grain: 0.06, ptrStr: 0.7 }),
  /* S2 RADIATIVE — thicker, darker ember churn */
  S({ warp: 2.2, density: 1.15, bright: 0.55, radial: 0.55,
      palA: '#070604', palB: '#8A2E14', palC: '#FF5C38', grain: 0.075, ptrStr: 1.0 }),
  /* S3 PHOTOSPHERE — boiling granulation */
  S({ warp: 1.4, density: 0.9, bright: 1.0, radial: 0.35, gran: 1,
      palA: '#3A1A08', palB: '#E08A34', palC: '#FFE2B0', grain: 0.05, ptrStr: 0.5 }),
  /* S4 CROSSING — near-empty starfield */
  S({ warp: 0.8, density: 0.05, bright: 0.4, radial: 0.2, star: 1,
      palA: '#070604', palB: '#0D0B08', palC: '#141210', grain: 0.07, ptrStr: 0.0 }),
  /* S5 SKY — rayleigh dome */
  S({ warp: 0.7, density: 0.05, bright: 0.5, radial: 0.1, sky: 1,
      palA: '#070604', palB: '#3E4C5E', palC: '#9DC1E4', grain: 0.045, ptrStr: 0.3 }),
  /* S6 EYE — warm dark convergence */
  S({ warp: 1.0, density: 0.1, bright: 0.4, radial: 0.5, eye: 1,
      palA: '#070604', palB: '#140505', palC: '#3A0E08', grain: 0.065, ptrStr: 0.0 }),
];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

const SCALARS = ['warp', 'density', 'bright', 'radial', 'gran', 'star', 'sky', 'eye', 'grain', 'ptrStr'];
const VECS = ['palA', 'palB', 'palC'];

/* interpolate keyframe states: hold most of the chapter,
   blend across the last 30% into the next state.
   Writes into `out` — zero allocation on the frame path. */
export function blendStatesInto(mix, out) {
  const idx = Math.min(Math.floor(mix), STATES.length - 1);
  const f = mix - idx;
  const a = STATES[idx];
  const b = STATES[Math.min(idx + 1, STATES.length - 1)];
  const t = smooth(Math.min(Math.max((f - 0.7) / 0.3, 0), 1));
  for (const k of SCALARS) out[k] = lerp(a[k], b[k], t);
  for (const k of VECS) {
    for (let i = 0; i < 3; i++) out[k][i] = lerp(a[k][i], b[k][i], t);
  }
  return out;
}

export function blendStates(mix) {
  return blendStatesInto(mix, { palA: [0, 0, 0], palB: [0, 0, 0], palC: [0, 0, 0] });
}

/* ============================================================ */
export class World {
  constructor(canvas, { reduced = false } = {}) {
    this.canvas = canvas;
    this.reduced = reduced;
    this.ok = false;
    this.time = Math.random() * 90 + 10;
    this.fboScale = 0.5;
    this.dprCap = 1.5;

    this.pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    this.uni = { bloom: 0, intro: 0, conv: 0, sunY: 0.1, lambda: 450, mix: 0 };
    this.state = blendStates(0);

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return;
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.initGL()) {
        this.resize();
        this.ok = true;
      }
    });

    if (!this.initGL()) return;
    this.resize();
    this.ok = true;
  }

  initGL() {
    const gl = this.gl;
    const mk = (fragSrc) => {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[slowlight/gl]', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[slowlight/gl]', gl.getProgramInfoLog(prog));
        return null;
      }
      const u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        u[info.name] = gl.getUniformLocation(prog, info.name);
      }
      return { prog, u };
    };

    this.world = mk(WORLD_FRAG);
    this.comp = mk(COMP_FRAG);
    if (!this.world || !this.comp) return false;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.fbo = gl.createFramebuffer();
    this.tex = gl.createTexture();
    return true;
  }

  resize() {
    if (!this.gl) return;
    const dpr = Math.min(devicePixelRatio || 1, this.dprCap);
    this.w = Math.max(2, Math.round(innerWidth * dpr));
    this.h = Math.max(2, Math.round(innerHeight * dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.fw = Math.max(2, Math.round(this.w * this.fboScale));
    this.fh = Math.max(2, Math.round(this.h * this.fboScale));
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.fw, this.fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(dt) {
    if (!this.ok || document.hidden || this.uni.intro <= 0) return;
    const gl = this.gl;
    const P = this.pointer;
    P.x += (P.tx - P.x) * Math.min(1, dt * 3.2);
    P.y += (P.ty - P.y) * Math.min(1, dt * 3.2);
    if (!this.reduced) this.time += dt;

    const st = this.state;
    const un = this.uni;

    /* pass 1: the world, half-res */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fw, this.fh);
    gl.useProgram(this.world.prog);
    const w = this.world.u;
    gl.uniform2f(w.uRes, this.fw, this.fh);
    gl.uniform1f(w.uTime, this.time);
    gl.uniform2f(w.uPointer, P.x, P.y);
    gl.uniform1f(w.uPtrStr, st.ptrStr);
    gl.uniform1f(w.uBloom, un.bloom);
    gl.uniform1f(w.uIntro, un.intro);
    gl.uniform1f(w.uWarp, st.warp);
    gl.uniform1f(w.uDensity, st.density);
    gl.uniform1f(w.uBright, st.bright);
    gl.uniform1f(w.uRadial, st.radial);
    gl.uniform1f(w.uGran, st.gran);
    gl.uniform1f(w.uStar, st.star);
    gl.uniform1f(w.uSky, st.sky);
    gl.uniform1f(w.uEye, st.eye);
    gl.uniform1f(w.uConv, un.conv);
    gl.uniform1f(w.uSunY, un.sunY);
    gl.uniform1f(w.uLambda, un.lambda);
    gl.uniform3fv(w.uPalA, st.palA);
    gl.uniform3fv(w.uPalB, st.palB);
    gl.uniform3fv(w.uPalC, st.palC);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* pass 2: composite full-res with grain */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.comp.prog);
    const c = this.comp.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(c.uTex, 0);
    gl.uniform1f(c.uTime, this.time);
    gl.uniform1f(c.uGrain, st.grain * un.intro);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
