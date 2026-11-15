// =====================================================================
//  ELEMENTS CLASH  v3 (mobile-first, third-person, 5 elements, 2 playable fighters)
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from './jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './jsm/libs/meshopt_decoder.module.js';
const newGLTF = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
import * as SkeletonUtils from './jsm/utils/SkeletonUtils.js';

// ---------------------------------------------------------------- CONFIG
const CFG = {
  UNLIMITED_MANA: true,          // unlimited mana for now — set to false later
  MANA_MAX: 100, MANA_REGEN: 9,
  ARENA_R: 24,
  ROUND_TIME: 99, ROUNDS_TO_WIN: 2,
  GRAVITY: 30,
  CHAIN_WINDOW: 1.1,             // fusion chain window: element, then another element
};
const IS_TOUCH = (matchMedia('(pointer:coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const SETTINGS = { quality: IS_TOUCH ? 'medium' : 'high', camDist: 'mid', volume: .7, sens: 1, vibrate: true };
try { const s = JSON.parse(localStorage.getItem('ea_settings') || '{}'); for (const k of ['quality', 'camDist', 'volume', 'sens', 'vibrate']) if (s[k] != null) SETTINGS[k] = s[k]; } catch (e) { }
function qualityDerive() { const q = SETTINGS.quality, dpr = devicePixelRatio || 1; SETTINGS.bloom = q === 'high'; SETTINGS.pixelRatio = Math.min(dpr, q === 'low' ? 1 : q === 'medium' ? (IS_TOUCH ? 1.35 : 1.5) : 2); SETTINGS.shadows = q !== 'low'; }
qualityDerive();
function saveSettings() { try { localStorage.setItem('ea_settings', JSON.stringify({ quality: SETTINGS.quality, camDist: SETTINGS.camDist, volume: SETTINGS.volume, sens: SETTINGS.sens, vibrate: SETTINGS.vibrate })); } catch (e) { } }
function applySettings(gfx) {
  if (Sfx.master) Sfx.master.gain.value = .75 * SETTINGS.volume;
  if (!gfx) return;
  const hadSh = renderer.shadowMap.enabled; qualityDerive();
  renderer.setPixelRatio(SETTINGS.pixelRatio);
  if (hadSh !== SETTINGS.shadows) { renderer.shadowMap.enabled = SETTINGS.shadows; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); }
  setupComposer(); onResize();
}

// ---------------------------------------------------------------- UTILS
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const V3 = THREE.Vector3;
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3();
const $ = s => document.querySelector(s);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// ---------------------------------------------------------------- ELEMENTS
const EL = {
  fire:      { name: 'Fire',      color: 0xff6a1a, c: [1, .42, .08], icon: '🔥' },
  water:     { name: 'Water',     color: 0x3fa8ff, c: [.2, .58, 1], icon: '💧' },
  wind:      { name: 'Wind',      color: 0xdff4ff, c: [.82, .93, 1], icon: '🌪️' },
  earth:     { name: 'Earth',     color: 0xc09058, c: [.62, .46, .28], icon: '🪨' },
  lightning: { name: 'Lightning', color: 0xb59cff, c: [.72, .62, 1], icon: '⚡' },
};
const ELS = ['fire', 'water', 'wind', 'earth', 'lightning'];
// clash rules: water douses fire, fire eats wind, wind scatters earth, earth grounds lightning, lightning electrifies water
const BEATS = { water: 'fire', fire: 'wind', wind: 'earth', earth: 'lightning', lightning: 'water' };
const FUSION_NAMES = { 'fire+wind': 'Firestorm', 'earth+fire': 'Meteor', 'water+wind': 'Ice Shards', 'earth+water': 'Mud Wave', 'fire+water': 'Steam Burst', 'earth+wind': 'Stone Barrage',
  'fire+lightning': 'Plasma Beam', 'lightning+water': 'Storm Surge', 'lightning+wind': 'Thunderstorm', 'earth+lightning': 'Rail Stone' };
const fusionKey = (a, b) => [a, b].sort().join('+');

// ---------------------------------------------------------------- AUDIO
const Sfx = {
  ctx: null, master: null, nb: null,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C();
      this.master = this.ctx.createGain(); this.master.gain.value = .75 * SETTINGS.volume; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.nb = b;
    } catch (e) { this.ctx = null; }
  },
  noise({ dur = .3, type = 'lowpass', f = 800, f2, q = 1, vol = .5, at = .005, delay = 0 }) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.nb;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + .05);
  },
  tone({ f = 200, f2, dur = .2, type = 'sine', vol = .3, at = .005, delay = 0 }) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  },
  play(n) {
    if (!this.ctx) return;
    switch (n) {
      case 'fire': this.noise({ dur: .45, type: 'bandpass', f: 1400, f2: 250, q: .6, vol: .45 }); this.tone({ f: 110, f2: 45, dur: .3, type: 'sawtooth', vol: .1 }); break;
      case 'water': this.noise({ dur: .4, type: 'bandpass', f: 450, f2: 1900, q: 4, vol: .5 }); this.tone({ f: 700, f2: 260, dur: .22, vol: .12 }); break;
      case 'wind': this.noise({ dur: .55, type: 'bandpass', f: 350, f2: 2600, q: 1.4, vol: .45 }); break;
      case 'earth': this.tone({ f: 130, f2: 32, dur: .5, type: 'triangle', vol: .55 }); this.noise({ dur: .4, type: 'lowpass', f: 600, f2: 70, vol: .5 }); break;
      case 'hit': this.tone({ f: 170, f2: 55, dur: .14, type: 'square', vol: .18 }); this.noise({ dur: .12, type: 'lowpass', f: 2400, f2: 200, vol: .5 }); break;
      case 'heavy': this.tone({ f: 120, f2: 30, dur: .35, type: 'square', vol: .25 }); this.noise({ dur: .3, type: 'lowpass', f: 1800, f2: 90, vol: .7 }); break;
      case 'block': this.tone({ f: 950, f2: 620, dur: .12, type: 'triangle', vol: .2 }); this.noise({ dur: .08, type: 'highpass', f: 2600, vol: .25 }); break;
      case 'perfect': this.tone({ f: 900, f2: 1900, dur: .3, type: 'triangle', vol: .25 }); this.tone({ f: 1350, f2: 2700, dur: .35, vol: .15, delay: .05 }); break;
      case 'swing': this.noise({ dur: .14, type: 'bandpass', f: 700, f2: 2200, q: 1.2, vol: .25 }); break;
      case 'jump': this.noise({ dur: .22, type: 'bandpass', f: 300, f2: 1000, q: 1, vol: .18 }); break;
      case 'dash': this.noise({ dur: .28, type: 'bandpass', f: 500, f2: 3200, q: 1, vol: .35 }); break;
      case 'land': this.noise({ dur: .12, type: 'lowpass', f: 400, f2: 80, vol: .25 }); break;
      case 'clash': this.tone({ f: 400, f2: 90, dur: .4, type: 'sawtooth', vol: .15 }); this.noise({ dur: .45, type: 'bandpass', f: 1200, f2: 200, q: .8, vol: .6 }); break;
      case 'explode': this.tone({ f: 85, f2: 28, dur: .9, type: 'triangle', vol: .6 }); this.noise({ dur: 1, type: 'lowpass', f: 1400, f2: 60, vol: .75 }); break;
      case 'gong': { const base = 98; [1, 2.31, 2.97, 4.12, 5.43, 6.8].forEach((m, i) => this.tone({ f: base * m, f2: base * m * .995, dur: 4 - i * .4, vol: .22 / (i + 1), at: .003 })); this.noise({ dur: .3, type: 'lowpass', f: 900, vol: .3 }); break; }
      case 'ko': this.play('explode'); this.tone({ f: 260, f2: 50, dur: 1.4, type: 'sawtooth', vol: .12 }); break;
      case 'ult': this.tone({ f: 90, f2: 720, dur: 1.2, type: 'sawtooth', vol: .1 }); this.noise({ dur: 1.3, type: 'bandpass', f: 200, f2: 3000, q: .7, vol: .4 }); break;
      case 'chain': this.tone({ f: 520, f2: 1040, dur: .18, type: 'triangle', vol: .18 }); this.tone({ f: 780, f2: 1560, dur: .22, type: 'sine', vol: .12, delay: .05 }); break;
      case 'lightning': this.noise({ dur: .18, type: 'highpass', f: 2500, vol: .55, at: .001 }); this.tone({ f: 1800, f2: 120, dur: .25, type: 'square', vol: .12 }); this.noise({ dur: .7, type: 'lowpass', f: 300, f2: 60, vol: .35, delay: .05 }); break;
      case 'thunder': this.noise({ dur: .12, type: 'highpass', f: 2000, vol: .6, at: .001 }); this.noise({ dur: 1.4, type: 'lowpass', f: 500, f2: 40, vol: .7, delay: .03 }); this.tone({ f: 60, f2: 30, dur: 1, type: 'triangle', vol: .4 }); break;
      case 'select': this.tone({ f: 660, f2: 880, dur: .08, type: 'triangle', vol: .15 }); break;
    }
  }
};

// ---------------------------------------------------------------- RENDERER / SCENE
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(SETTINGS.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = SETTINGS.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x95707e, 70, 260);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 4, 16);

let composer = null;
function setupComposer() {
  if (!SETTINGS.bloom) { composer = null; return; }
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bs = IS_TOUCH ? .5 : 1;
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth * bs, innerHeight * bs), .42, .45, .86));
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
}
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 72 : 58; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  const s = innerHeight * SETTINGS.pixelRatio / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  if (PADD) { PADD.mat.uniforms.uScale.value = s; PNORM.mat.uniforms.uScale.value = s; }
}
addEventListener('resize', onResize);

// ---------------------------------------------------------------- TEXTURES
const T = {};
const texList = ['floor.jpg', 'sky.jpg', 'gong.jpg', 'banner.jpg', 'rock_dark.jpg', 'rock_sand.jpg', 'rock_brown.jpg', 'column.jpg'];
function loadTextures(onProgress) {
  const loader = new THREE.TextureLoader(); let done = 0;
  return Promise.all(texList.map(n => new Promise(res => {
    loader.load('assets/' + n, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; T[n.split('.')[0]] = t; onProgress(++done / texList.length); res(); },
      undefined, () => { onProgress(++done / texList.length); res(); });
  })));
}
function rep(t, x, y) { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(x, y); c.needsUpdate = true; return c; }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const SOFT = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.65)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false);

// ---------------------------------------------------------------- PARTICLES
const PVS = `attribute float size; attribute float alpha; attribute vec3 pcolor; varying vec3 vC; varying float vA; uniform float uScale;
void main(){ vC=pcolor; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(size*uScale/max(.1,-mv.z), 280.); gl_Position=projectionMatrix*mv; }`;
const PFS = `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); float a=t.a*vA; if(a<.004) discard; gl_FragColor=vec4(vC*t.rgb,a); }`;
class PSys {
  constructor(max, blending, scn = scene) {
    this.max = max; this.i = 0; const n = max;
    this.p = new Float32Array(n * 3); this.c = new Float32Array(n * 3); this.s = new Float32Array(n); this.a = new Float32Array(n);
    this.v = new Float32Array(n * 3); this.l = new Float32Array(n); this.ml = new Float32Array(n); this.gr = new Float32Array(n); this.dr = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: SOFT }, uScale: { value: 600 } }, vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false, blending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; scn.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0, size1 = null, alpha = 1) {
    const i = this.i; this.i = (i + 1) % this.max; const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.c[j] = r; this.c[j + 1] = g; this.c[j + 2] = b; this.s0[i] = size; this.s1[i] = size1 == null ? size * .2 : size1;
    this.l[i] = life; this.ml[i] = life; this.gr[i] = grav; this.dr[i] = drag; this.a0[i] = alpha; this.s[i] = size; this.a[i] = alpha;
  }
  update(dt) {
    const { p, v, l, ml, gr, dr, s, s0, s1, a, a0 } = this;
    for (let i = 0; i < this.max; i++) {
      if (l[i] <= 0) { if (a[i] !== 0) { a[i] = 0; s[i] = 0; } continue; }
      l[i] -= dt; if (l[i] <= 0) { a[i] = 0; s[i] = 0; continue; }
      const k = l[i] / ml[i], j = i * 3, d = Math.max(0, 1 - dr[i] * dt);
      v[j + 1] -= gr[i] * dt; v[j] *= d; v[j + 1] *= d; v[j + 2] *= d;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      s[i] = s1[i] + (s0[i] - s1[i]) * k; a[i] = a0[i] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + .15);
    }
    const at = this.geo.attributes; at.position.needsUpdate = at.size.needsUpdate = at.alpha.needsUpdate = at.pcolor.needsUpdate = true;
  }
}
let PADD = null, PNORM = null;

// ---------------------------------------------------------------- GEOMETRY HELPERS
function rockGeo(r, detail = 1, seed = 1, sx = 1, sy = 1, sz = 1, jag = .28) {
  const g = new THREE.IcosahedronGeometry(r, detail); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + jag * (Math.sin(x * 6.1 / r + seed) * Math.sin(y * 5.3 / r + seed * 1.7) * Math.sin(z * 6.7 / r + seed * 2.3) + .45 * Math.sin((x * 3 + y * 2.3 - z * 1.7) / r + seed * 3.1));
    p.setXYZ(i, x * n * sx, y * n * sy, z * n * sz);
  }
  g.computeVertexNormals(); return g;
}
function lathe(pts, seg = 16) { const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg, Math.PI, Math.PI * 2); return g; }
const MATS = {};
function mat(color, rough = .8, metal = 0, extra = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra)); }
function M(geo, m, x = 0, y = 0, z = 0, parent = null) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; if (parent) parent.add(o); return o; }
function J(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function glowSprite(color, scale, opacity = .9) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity })); s.scale.setScalar(scale); return s; }

// merge static meshes by material (fewer draw calls on phones)
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse(o => { if (o.isMesh && !o.userData.dynamic && !Array.isArray(o.material)) { const k = o.material; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(o); } });
  const out = new THREE.Group();
  for (const [m, list] of buckets) {
    const geos = list.map(o => { let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = list.some(o => o.castShadow); mesh.receiveShadow = true; out.add(mesh);
    list.forEach(o => o.parent && o.parent.remove(o));
  }
  scene.add(out);
}

// ---------------------------------------------------------------- COLLIDERS (circles + rotated boxes)
const ARENA = { faders: [], braziers: [], banners: [], gong: null, sun: null, dummySpot: new V3(-5.7, 0, -17.6), lobbySpot: new V3(0, 0, 3), lobbyPad: null, lobbyTop: .3 };
const OBS = []; // {type:'c',x,z,r,top,walk} | {type:'b',x,z,hw,hd,c,s,top,walk}
function addCircle(x, z, r, top, walk = false, kind = '') { const o = { type: 'c', x, z, r, top, walk, kind }; OBS.push(o); return o; }
function addBox(x, z, w, d, rot, top, walk = false, kind = '') { const o = { type: 'b', x, z, hw: w / 2, hd: d / 2, c: Math.cos(rot), s: Math.sin(rot), top, walk, kind, r: Math.hypot(w, d) / 2 }; OBS.push(o); return o; }
function obsInside(o, x, z, pad = 0) {
  const dx = x - o.x, dz = z - o.z;
  if (o.type === 'c') return dx * dx + dz * dz < (o.r + pad) ** 2;
  const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c; return Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad;
}
function groundAt(x, z, y = 99) { let g = 0; for (const o of OBS) if (o.walk && o.top <= y + .5 && obsInside(o, x, z, 0)) g = Math.max(g, o.top); return g; }
function pushOut(pos, rad) {
  for (const o of OBS) {
    if (pos.y >= o.top - .5 || !obsInside(o, pos.x, pos.z, rad)) continue;
    const dx = pos.x - o.x, dz = pos.z - o.z;
    if (o.type === 'c') { const d = Math.hypot(dx, dz) || 1e-4, R = o.r + rad; pos.x = o.x + dx / d * R; pos.z = o.z + dz / d * R; }
    else {
      let lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c; const px = o.hw + rad - Math.abs(lx), pz = o.hd + rad - Math.abs(lz);
      if (px < pz) lx = Math.sign(lx || 1) * (o.hw + rad); else lz = Math.sign(lz || 1) * (o.hd + rad);
      pos.x = o.x + lx * o.c - lz * o.s; pos.z = o.z + lx * o.s + lz * o.c;
    }
  }
}
function obstacleHit(pos, rad) { for (const o of OBS) if (pos.y < o.top - .05 && obsInside(o, pos.x, pos.z, rad * .4)) return o; return null; }
function losBlocked(a, b, minTop = 1.3) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / .5);
  for (let i = 1; i < n; i++) { const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; for (const o of OBS) if (o.top >= minTop && obsInside(o, x, z, 0)) return o; }
  return null;
}
function camClip(from, to) { // fraction of the way the camera can go before hitting scenery
  const n = 24;
  for (let i = 1; i <= n; i++) { const t = i / n; const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t; for (const o of OBS) if (y < o.top + .2 && obsInside(o, x, z, .35) && !o.noCam) return Math.max(.15, (i - 1.5) / n); }
  return 1;
}

// ---------------------------------------------------------------- PROPS (user's 3D models)
const PROPS = {}; const PROP_NAMES = ['pedestal', 'archway', 'column', 'cauldron', 'gong', 'boulder', 'banner', 'obelisk', 'rock'];
function loadProps(onP) {
  const L = newGLTF(); let done = 0;
  return Promise.all(PROP_NAMES.map(n => new Promise(res => L.load(`assets/props/${n}.glb`, g => { g.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 4; } }); PROPS[n] = g.scene; onP(++done / PROP_NAMES.length); res(); }, undefined, e => { console.warn('prop failed', n, e); onP(++done / PROP_NAMES.length); res(); }))));
}
function prop(name, parent, x, y, z, { h, w, rot = 0, sy = 1 } = {}) {
  const src = PROPS[name]; if (!src) return null;
  const o = src.clone(true); const b = new THREE.Box3().setFromObject(o); const sz = b.getSize(new V3());
  const s = h ? h / sz.y : w ? w / Math.max(sz.x, sz.z) : 1; o.scale.set(s, s * sy, s);
  o.position.set(x, y, z); o.rotation.y = rot; parent.add(o); o.userData.size = sz.multiplyScalar(s).setY(sz.y * sy); return o;
}

// ---------------------------------------------------------------- FLIPBOOK VFX (video-based effects, pooled)
const FB_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const FB_FS = `uniform sampler2D map; uniform float frame; uniform float grid; uniform vec3 tint; uniform float opacity; uniform float desat; uniform float loopf; varying vec2 vUv;
vec4 cellc(float f){ vec2 cell=vec2(mod(f,grid), grid-1.-floor(f/grid)); return texture2D(map,(cell+clamp(vUv,.004,.996))/grid); }
void main(){ float f=floor(frame), n=grid*grid; float g=f+1.; if(g>=n) g=loopf>.5?0.:f; vec4 c=mix(cellc(f),cellc(g),fract(frame)); float a=c.a*opacity; if(a<.01) discard; vec3 col=mix(c.rgb,vec3(dot(c.rgb,vec3(.3,.59,.11))),desat); gl_FragColor=vec4(col*tint,a); }`;
const FLIP = { tex: {}, active: [], pool: [], geo: null };
const FLIP_DEF = { // name: [additive, fps] — every atlas is cut from the user's videos
  fire_loop: [1, 18], fireball: [1, 20], fire_burst: [1, 26], explosion: [0, 22], fire_wall: [1, 18], fire_ring: [1, 20],
  water_orb: [1, 16], water_splash: [0, 24], water_wave: [1, 18], water_vortex: [1, 18], water_stream: [1, 20],
  tornado: [0, 16], dust_tornado: [0, 14], dust_puff: [0, 18], dust_wave: [0, 18],
  rock_burst: [0, 20], crater: [0, 14], rocks_float: [0, 12],
  lightning_orb: [1, 22], bolt: [1, 30], bolt_branch: [1, 26], lightning_beam: [1, 24],
  ice_spike: [1, 15], ice_burst: [1, 24], ice_orb: [1, 16],
};
function loadFlipbooks(onP, only) {
  const L = new THREE.TextureLoader(); const names = only || Object.keys(FLIP_DEF).filter(n => !FLIP.tex[n]); let done = 0; if (!names.length) { onP(1); return Promise.resolve(); }
  return Promise.all(names.map(n => new Promise(res => L.load(`assets/vfx/${n}${SETTINGS.quality === 'high' ? '_hi' : ''}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; FLIP.tex[n] = t; onP(++done / names.length); res(); }, undefined, () => { onP(++done / names.length); res(); }))));
}
function fbMesh() {
  if (!FLIP.geo) FLIP.geo = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(FLIP.geo, new THREE.ShaderMaterial({ uniforms: { map: { value: null }, frame: { value: 0 }, grid: { value: 4 }, tint: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 }, desat: { value: 0 }, loopf: { value: 0 } }, vertexShader: FB_VS, fragmentShader: FB_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; m.renderOrder = 6; return m;
}
// opts: pos, size (number or [w,h]), dur, loop, life, mode ('bill'|'up'|'flat'|'dir'), dir (V3 for 'dir'), follow(fn->V3), tint, opacity, fade, scene, speed, grow, rot
function fb(name, o = {}) {
  const tex = FLIP.tex[name]; if (!tex) return null;
  const m = FLIP.pool.pop() || fbMesh(); const def = FLIP_DEF[name];
  const u = m.material.uniforms; u.map.value = tex; u.tint.value.set(o.tint ?? 0xffffff); if (o.boost) u.tint.value.multiplyScalar(o.boost); u.opacity.value = o.opacity ?? 1; u.desat.value = o.desat || 0; u.loopf.value = o.loop ? 1 : 0;
  const bl = def[0] ? THREE.AdditiveBlending : THREE.NormalBlending; if (m.material.blending !== bl) { m.material.blending = bl; m.material.needsUpdate = true; }
  const sz = Array.isArray(o.size) ? o.size : [o.size || 2, o.size || 2]; m.scale.set(sz[0], sz[1], 1);
  const h = { m, name, t: 0, fps: (o.speed || 1) * def[1], loop: !!o.loop, life: o.life ?? (o.loop ? 1e9 : 16 / def[1] / (o.speed || 1)), mode: o.mode || 'bill', dir: o.dir, follow: o.follow, off: o.off || new V3(), base: sz, grow: o.grow || 0, fade: o.fade ?? .2, op: o.opacity ?? 1, rot: o.rot || 0, dead: false, anchorY: o.anchorY ?? 0 };
  if (o.pos) m.position.copy(o.pos);
  (o.scene || scene).add(m); h.scene = o.scene || scene; FLIP.active.push(h); fbOrient(h); return h;
}
function fbKill(h) { if (!h || h.dead) return; h.dead = true; h.scene.remove(h.m); FLIP.pool.push(h.m); }
const _fbA = new V3(), _fbB = new V3();
function fbOrient(h, cam = camera) {
  const m = h.m;
  if (h.mode === 'bill') { m.quaternion.copy(cam.quaternion); if (h.rot) m.rotateZ(h.rot); }
  else if (h.mode === 'up') { m.rotation.set(0, Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z), 0); }
  else if (h.mode === 'flat') { m.rotation.set(-Math.PI / 2, 0, h.rot); }
  else if (h.mode === 'beam' && h.dir) { m.quaternion.copy(cam.quaternion); const A = _fbA.copy(m.position).project(cam), B = _fbB.copy(m.position).add(h.dir).project(cam); m.rotateZ(Math.atan2(B.y - A.y, (B.x - A.x) * cam.aspect)); }
  else if (h.mode === 'dir' && h.dir) { const a = Math.atan2(h.dir.x, h.dir.z); m.rotation.set(0, a + Math.PI / 2, 0); }
}
function updateFlipbooks(dt, cam = camera) {
  for (let i = FLIP.active.length - 1; i >= 0; i--) {
    const h = FLIP.active[i]; if (h.dead) { FLIP.active.splice(i, 1); continue; }
    h.t += dt; const n = 16;
    const f = h.loop ? (h.t * h.fps) % n : Math.min(n - 1.001, h.t * h.fps);
    h.m.material.uniforms.frame.value = f;
    if (h.follow) { const p = h.follow(); if (p) h.m.position.copy(p).add(h.off); else h.life = Math.min(h.life, h.t + h.fade); }
    if (h.grow) { const g = 1 + h.grow * h.t; h.m.scale.set(h.base[0] * g, h.base[1] * g, 1); }
    if (h.anchorY) h.m.position.y += 0;
    const fadeOut = clamp((h.life - h.t) / h.fade, 0, 1), fadeIn = h.loop ? clamp(h.t / .12, 0, 1) : 1;
    h.m.material.uniforms.opacity.value = h.op * Math.min(fadeOut, fadeIn);
    fbOrient(h, cam);
    if (h.t >= h.life || (!h.loop && h.t * h.fps >= n)) { fbKill(h); FLIP.active.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- ARENA
function buildArena() {
  const S = new THREE.Group(); scene.add(S);
  const sky = T.sky; sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky; scene.backgroundRotation.set(0, Math.PI * .62, 0);
  const pm = new THREE.PMREMGenerator(renderer); ENV_TEX = pm.fromEquirectangular(sky).texture; scene.environment = ENV_TEX; scene.environmentIntensity = .6; scene.environmentRotation.set(0, Math.PI * .62, 0);
  ARENA.hemi = new THREE.HemisphereLight(0xcab6e2, 0x50382a, 1.1); scene.add(ARENA.hemi);
  const sun = new THREE.DirectionalLight(0xffc48a, 2.8); sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  const sc = sun.shadow.camera; sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 100; sun.shadow.bias = -.0005; sun.shadow.normalBias = .04;
  scene.add(sun, sun.target); ARENA.sun = sun;
  const fill = new THREE.DirectionalLight(0xc6ccff, .8); fill.position.set(12, 10, 22); scene.add(fill);
  const gold = mat(0xd2a64c, .32, .95); MATS.gold = gold;
  const stoneTop = new THREE.MeshStandardMaterial({ map: rep(T.floor, 12, 12), roughness: .88, color: 0xe2d6c6 }); MATS.floor = stoneTop;
  const stoneSide = new THREE.MeshStandardMaterial({ map: rep(T.floor, 34, .5), roughness: .95, color: 0xc6bba9 });
  const stoneDark = new THREE.MeshStandardMaterial({ map: rep(T.floor, 2, 2), roughness: .95, color: 0x8f877c });
  const stoneBlock = new THREE.MeshStandardMaterial({ map: rep(T.floor, 1, 1), roughness: .9, color: 0xb9b1a6 }); MATS.stoneBlock = stoneBlock;
  MATS.rocks = [new THREE.MeshStandardMaterial({ map: rep(T.rock_dark, 1.5, 1.5), roughness: .9 }), new THREE.MeshStandardMaterial({ map: rep(T.rock_brown, 1.5, 1.5), roughness: .95 }), new THREE.MeshStandardMaterial({ map: rep(T.rock_sand, 1.5, 1.5), roughness: .95 })];
  const R = CFG.ARENA_R;
  // floor + edge
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(R + 3.5, R + 3.7, .9, 112), [stoneSide, stoneTop, stoneTop]); plat.position.y = -.45; plat.receiveShadow = true; S.add(plat);
  for (let i = 0; i < 3; i++) { const r = R + 4.4 + i * 1.0, top = -.4 * (i + 1); const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r + .1, 4, 112), [stoneSide, stoneDark, stoneDark]); t.position.y = top - 2; t.receiveShadow = true; S.add(t); }
  const ringM = mat(0xd8a84a, .35, .9, { emissive: 0x3a2000 });
  for (const [a, b] of [[R + .2, R + .45], [9, 9.15], [16, 16.12], [4.4, 4.55]]) { const m = M(new THREE.RingGeometry(a, b, 160), ringM, 0, .012, 0, S); m.rotation.x = -Math.PI / 2; m.castShadow = false; }
  const emblem = canvasTex(1024, 1024, (g, w) => {
    g.translate(w / 2, w / 2); g.strokeStyle = 'rgba(214,165,72,.95)'; g.lineWidth = 10;
    [480, 440, 250].forEach(r => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); });
    g.lineWidth = 5; for (let i = 0; i < 30; i++) { g.save(); g.rotate(i * Math.PI / 15); g.beginPath(); g.moveTo(0, 445); g.lineTo(0, 475); g.stroke(); g.restore(); }
    const cols = ['#ff7a2a', '#3fa8ff', '#c79a5e', '#cfeee0', '#b59cff'];
    for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * Math.PI * 2 / 5); g.fillStyle = cols[i]; g.globalAlpha = .8; g.beginPath(); g.arc(0, -345, 52, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; g.strokeStyle = 'rgba(214,165,72,.95)'; g.lineWidth = 6; g.stroke(); g.restore(); }
    g.lineWidth = 8; g.beginPath(); for (let a = 0; a <= Math.PI * 2 + .01; a += .02) { const r = 120 + 70 * Math.sin(a * 2.5); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke();
  });
  const em = M(new THREE.CircleGeometry(4.4, 64), new THREE.MeshStandardMaterial({ map: emblem, transparent: true, roughness: .5, metalness: .6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 0, .015, 0, S);
  em.rotation.x = -Math.PI / 2; em.castShadow = false; em.receiveShadow = true;
  // low balustrade wall around the arena (clear boundary)
  const wallM = stoneBlock;
  const nSeg = 36;
  for (let i = 0; i < nSeg; i++) {
    const a0 = i / nSeg * Math.PI * 2, a1 = (i + 1) / nSeg * Math.PI * 2, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, -Math.PI / 2)) < .2) continue; // opening for the gate
    const r = R + 1.6, len = 2 * r * Math.sin((a1 - a0) / 2) - .15;
    const b = M(new THREE.BoxGeometry(len, .85, .55), wallM, Math.cos(am) * r, .42, Math.sin(am) * r, S); b.rotation.y = -am + Math.PI / 2; b.receiveShadow = true;
    const cap = M(new THREE.BoxGeometry(len + .08, .12, .7), gold, Math.cos(am) * r, .9, Math.sin(am) * r, S); cap.rotation.y = -am + Math.PI / 2;
  }
  // gate (archway) + gong behind it, north side
  const gate = prop('archway', scene, 0, 0, -(R + 1.8), { w: 8.5 });
  if (gate) { addBox(-3.35, -(R + 1.8), 1.7, 2.4, 0, 6, false, 'gate'); addBox(3.35, -(R + 1.8), 1.7, 2.4, 0, 6, false, 'gate'); }
  const gong = prop('gong', scene, 0, 0, -(R + 6.5), { h: 5.2 });
  ARENA.gong = gong ? { obj: gong, swing: 0, vel: 0 } : null;
  // columns on the edge
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + Math.PI / 12; if (Math.abs(angDiff(a, -Math.PI / 2)) < .3) continue;
    const r = R + 1.6; const c = prop('column', scene, Math.cos(a) * r, 0, Math.sin(a) * r, { h: 7.5, rot: -a });
    if (c) { addCircle(Math.cos(a) * r, Math.sin(a) * r, .95, 7.5, false, 'column'); ARENA.faders.push({ g: c, pos: new V3(Math.cos(a) * r, 0, Math.sin(a) * r), r: 1, op: 1, mats: fadeMats(c) }); }
  }
  // braziers between columns (cauldron model + video fire)
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8, r = R + .3; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const c = prop('cauldron', scene, x, 0, z, { h: 1.6, rot: -a }); addCircle(x, z, .8, 1.6, false, 'brazier');
    const pos = new V3(x, 1.55, z);
    fb('fire_loop', { pos: pos.clone().setY(2.15), size: 1.6, loop: true, mode: 'up', boost: 1.4 });
    let light = null; if (i % 2 === 0) { light = new THREE.PointLight(0xff7a2a, 34, 16, 1.7); light.position.copy(pos).setY(2.8); scene.add(light); }
    const gl = glowSprite(0xff8a3a, 3.4, .45); gl.position.copy(pos).setY(2.2); scene.add(gl);
    ARENA.braziers.push({ pos, light, ph: rand(0, 9), glow: gl });
  }
  // banners
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3, r = R + 4.6; prop('banner', scene, Math.cos(a) * r, -.4, Math.sin(a) * r, { h: 5.4, rot: -a - Math.PI / 2 }); }
  // element obelisks (5) inner ring — cover pieces
  ELS.forEach((e, i) => {
    const a = i / 5 * Math.PI * 2, r = 12.5, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const o = prop('obelisk', scene, x, 0, z, { h: 4.2, rot: -a + Math.PI / 2 });
    addCircle(x, z, .95, 4.2, false, 'obelisk');
    const g = glowSprite(EL[e].color, 3, .5); g.position.set(x, .6, z); scene.add(g);
    const ring = M(new THREE.RingGeometry(1.15, 1.3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(EL[e].color).multiplyScalar(1.4), transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }), x, .02, z, scene); ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
    if (o) ARENA.faders.push({ g: o, pos: new V3(x, 0, z), r: 1, op: 1, mats: fadeMats(o) });
  });
  // boulders: low cover you can jump on (high ground)
  [[45, 18], [135, 18.5], [225, 18], [315, 18.5]].forEach(([deg, r], i) => {
    const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const b = prop('boulder', scene, x, 0, z, { w: 4.6, rot: rand(0, 6), sy: .62 });
    addCircle(x, z, 1.95, 1.45, true, 'boulder');
  });
  // tall rocks: full cover
  [[0, 20.5], [180, 20.5], [100, 21], [260, 21.5]].forEach(([deg, r]) => {
    const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const o = prop('rock', scene, x, 0, z, { h: 4.4, rot: rand(0, 6) }); addCircle(x, z, 1.25, 4.4, false, 'rock');
    if (o) ARENA.faders.push({ g: o, pos: new V3(x, 0, z), r: 1.4, op: 1, mats: fadeMats(o) });
  });
  // training pad
  const ls = ARENA.lobbySpot; ARENA.lobbyPad = prop('pedestal', scene, ls.x, 0, ls.z, { w: 3.4 }); if (ARENA.lobbyPad) { ARENA.lobbyTop = ARENA.lobbyPad.userData.size.y * .97; ARENA.lobbyPad.visible = false; }
  const dp = ARENA.dummySpot; prop('pedestal', scene, dp.x, 0, dp.z, { w: 4.6 }); addCircle(dp.x, dp.z, 2.3, .38, true, 'pad');
  // terrain + distant scenery
  const tg = new THREE.PlaneGeometry(300, 300, IS_TOUCH ? 80 : 120, IS_TOUCH ? 80 : 120); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), r = Math.hypot(x, z);
    let h = -1.45 + .6 * Math.sin(x * .21) * Math.cos(z * .19) + .4 * Math.sin(x * .7 + z * .5) + .25 * Math.sin(x * 1.7 - z * 1.3);
    h += THREE.MathUtils.smoothstep(r, 48, 80) * 7 * (Math.sin(Math.atan2(z, x) * 5) * .5 + .5);
    h -= THREE.MathUtils.smoothstep(r, 80, 135) * 60; if (r < R + 9) h = Math.min(h, -1.45); tp.setY(i, h);
  }
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: rep(T.rock_sand, 44, 44), roughness: 1, color: 0x9a8c7e })); terrain.receiveShadow = true; scene.add(terrain);
  const bark = mat(0x3b2a20, .9), leaf = mat(0x2f4a33, .85), leaf2 = mat(0x3d5c3c, .85);
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), r = rand(R + 12, R + 32); if (Math.abs(angDiff(a, -Math.PI / 2)) < .35) continue;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * r, -1.6, Math.sin(a) * r); g.scale.setScalar(rand(1.4, 2.4)); g.rotation.y = rand(0, 6); S.add(g);
    const tr = M(new THREE.CylinderGeometry(.12, .25, 3.2, 7), bark, 0, 1.6, 0, g); tr.rotation.z = rand(-.25, .25);
    const br = M(new THREE.CylinderGeometry(.06, .1, 1.8, 6), bark, .6, 2.6, 0, g); br.rotation.z = -1.0;
    for (let k = 0; k < 4; k++) M(rockGeo(.8, 1, k + i * 3, 1.6, .45, 1.3, .2), k % 2 ? leaf : leaf2, rand(-.8, 1.4), 2.5 + k * .55, rand(-.6, .6), g);
  }
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2); if (Math.abs(angDiff(a, -Math.PI / 2)) < .25) continue;
    const r = rand(R + 10, R + 45);
    const o = prop(i % 2 ? 'rock' : 'boulder', scene, Math.cos(a) * r, -1.5, Math.sin(a) * r, { h: rand(2.5, 6), rot: rand(0, 6) });
  }
  mergeStatic(S);
}
function fadeMats(o) { const ms = []; o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; ms.push(m.material); } }); return ms; }
let ENV_TEX = null;

// ---------------------------------------------------------------- DEBRIS
class Debris {
  constructor(n) {
    this.n = n; this.i = 0;
    this.mesh = new THREE.InstancedMesh(rockGeo(.12, 0, 7), new THREE.MeshStandardMaterial({ map: T.rock_brown, roughness: .95 }), n);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.d = Array.from({ length: n }, () => ({ p: new V3(), v: new V3(), r: new THREE.Euler(), w: new V3(), s: 0, l: 0 }));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new V3();
    for (let i = 0; i < n; i++) { this.m4.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m4); }
  }
  spawn(p, v, s = 1, l = 1.6) { const d = this.d[this.i]; this.i = (this.i + 1) % this.n; d.p.copy(p); d.v.copy(v); d.s = s; d.l = l; d.w.set(rand(-9, 9), rand(-9, 9), rand(-9, 9)); }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const d = this.d[i]; if (d.l <= 0) continue; d.l -= dt;
      d.v.y -= 22 * dt; d.p.addScaledVector(d.v, dt);
      const floor = Math.hypot(d.p.x, d.p.z) < 25 ? groundAt(d.p.x, d.p.z, d.p.y) + .06 * d.s : -60;
      if (d.p.y < floor) { d.p.y = floor; d.v.y *= -.35; d.v.x *= .6; d.v.z *= .6; d.w.multiplyScalar(.6); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      const s = d.l <= 0 ? 0 : d.s * Math.min(1, d.l * 2);
      this.q.setFromEuler(d.r); this.sc.setScalar(s); this.m4.compose(d.p, this.q, this.sc); this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
let DEBRIS;

// ---------------------------------------------------------------- GROUND DECALS (scorch / cracks / wet)
const DECALS = [];
let DECAL_TEX = null;
function decalTex() {
  const mk = (draw) => canvasTex(256, 256, draw);
  return {
    scorch: mk((g) => { const r = g.createRadialGradient(128, 128, 10, 128, 128, 128); r.addColorStop(0, 'rgba(10,6,4,.9)'); r.addColorStop(.5, 'rgba(25,14,8,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); g.fillStyle = 'rgba(255,120,30,.6)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(128 + rand(-60, 60), 128 + rand(-60, 60), rand(1, 3), 0, 7); g.fill(); } }),
    crack: mk((g) => { g.strokeStyle = 'rgba(30,20,12,.9)'; g.lineCap = 'round'; for (let i = 0; i < 9; i++) { g.lineWidth = rand(3, 7); g.beginPath(); let x = 128, y = 128; g.moveTo(x, y); const a = i / 9 * Math.PI * 2 + rand(-.2, .2); for (let k = 0; k < 6; k++) { x += Math.cos(a + rand(-.5, .5)) * 18; y += Math.sin(a + rand(-.5, .5)) * 18; g.lineTo(x, y); g.lineWidth *= .8; } g.stroke(); } const r = g.createRadialGradient(128, 128, 5, 128, 128, 60); r.addColorStop(0, 'rgba(40,28,18,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); }),
    wet: mk((g) => { for (let i = 0; i < 14; i++) { const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); g.save(); g.translate(128 + rand(-60, 60), 128 + rand(-60, 60)); const s = rand(20, 60); g.scale(s, s * rand(.6, 1)); r.addColorStop(0, 'rgba(40,60,80,.55)'); r.addColorStop(1, 'rgba(40,60,80,0)'); g.fillStyle = r; g.fillRect(-1, -1, 2, 2); g.restore(); } }),
  };
}
function decal(pos, type, size = 2.4) {
  if (!DECAL_TEX) DECAL_TEX = decalTex();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: DECAL_TEX[type], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.set(-Math.PI / 2, 0, rand(0, 6)); m.position.set(pos.x, groundAt(pos.x, pos.z, pos.y + .3) + .02, pos.z); scene.add(m);
  DECALS.push({ m, t: 0 }); if (DECALS.length > 18) { const d = DECALS.shift(); scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }
}
function updateDecals(dt) { for (let i = DECALS.length - 1; i >= 0; i--) { const d = DECALS[i]; d.t += dt; if (d.t > 6) { d.m.material.opacity = Math.max(0, 1 - (d.t - 6) / 2); if (d.t > 8) { scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); DECALS.splice(i, 1); } } } }

// ---------------------------------------------------------------- FX
const FX = {
  fire(p, n = 6, sp = .2, v = null, sc = 1) {
    for (let i = 0; i < n; i++) { const t = Math.random(); PADD.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + rand(-.8, .8), (v ? v.y : 0) + rand(.4, 2.2), (v ? v.z : 0) + rand(-.8, .8), 1.8, 1.8 * (.28 + t * .45), .25 * t, rand(.4, .8) * sc, rand(.22, .5), -3, 2, .05); }
    if (Math.random() < .25) PNORM.emit(p.x, p.y + .3, p.z, rand(-.4, .4), rand(1, 2), rand(-.4, .4), .18, .15, .15, .5 * sc, rand(.6, 1.1), -1, 1, 1.2 * sc, .3);
  },
  water(p, n = 6, sp = .2, v = null, sc = 1) {
    for (let i = 0; i < n; i++) PADD.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + rand(-1.5, 1.5), (v ? v.y : 0) + rand(-.5, 2.5), (v ? v.z : 0) + rand(-1.5, 1.5), .35, .85, 1.6, rand(.12, .32) * sc, rand(.3, .6), 9, .5, .05);
    if (Math.random() < .5) PADD.emit(p.x, p.y, p.z, rand(-.3, .3), rand(-.3, .3), rand(-.3, .3), .15, .45, 1.1, .7 * sc, .3, 0, 2, .2, .5);
  },
  wind(p, n = 4, sp = .3, v = null, sc = 1) {
    for (let i = 0; i < n; i++) PADD.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + rand(-2, 2), (v ? v.y : 0) + rand(-1, 1.5), (v ? v.z : 0) + rand(-2, 2), .75, .85, .95, rand(.35, .7) * sc, rand(.25, .5), 0, 3, 1.1 * sc, .28);
  },
  earth(p, n = 5, sp = .3, v = null, sc = 1) {
    for (let i = 0; i < n; i++) PNORM.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + rand(-1.5, 1.5), (v ? v.y : 0) + rand(.2, 2), (v ? v.z : 0) + rand(-1.5, 1.5), .55, .44, .32, rand(.5, 1.0) * sc, rand(.5, .9), -.4, 1.8, 1.6 * sc, .55);
  },
  sparks(p, c, n = 10, spd = 7) { for (let i = 0; i < n; i++) { _v1.randomDirection().multiplyScalar(rand(.4, 1) * spd); PADD.emit(p.x, p.y, p.z, _v1.x, _v1.y, _v1.z, c[0] * 1.8, c[1] * 1.8, c[2] * 1.8, rand(.07, .14), rand(.2, .45), 9, 1.5, .02); } },
  burst(p, el, n = 30, spd = 6, sc = 1) {
    const e = EL[el] || EL.fire;
    for (let i = 0; i < n; i++) {
      _v1.randomDirection().multiplyScalar(rand(.3, 1) * spd);
      if (el === 'earth') PNORM.emit(p.x, p.y, p.z, _v1.x, _v1.y * .6 + 2, _v1.z, .55, .44, .32, rand(.6, 1.2) * sc, rand(.5, 1), 2, 2.5, 1.8 * sc, .6);
      else PADD.emit(p.x, p.y, p.z, _v1.x, _v1.y, _v1.z, e.c[0] * 1.4, e.c[1] * 1.4, e.c[2] * 1.4, rand(.3, .7) * sc, rand(.3, .6), el === 'water' ? 6 : 0, 3, .05);
    }
    if (el === 'earth') for (let i = 0; i < 8; i++) DEBRIS.spawn(p, _v2.randomDirection().multiplyScalar(rand(3, 7)).setY(rand(3, 8)), rand(.7, 1.8));
    if (el === 'lightning') for (let i = 0; i < 5; i++) boltFX(p, _v2.copy(p).add(_v3.randomDirection().multiplyScalar(rand(.8, 2) * sc)), 0xc8b8ff, .05, .15);
    if (el === 'fire') for (let i = 0; i < 6; i++) PNORM.emit(p.x, p.y, p.z, rand(-1, 1), rand(1, 2.5), rand(-1, 1), .15, .13, .13, 1, rand(.8, 1.4), -1, 1.2, 2.2 * sc, .35);
    PADD.emit(p.x, p.y, p.z, 0, 0, 0, e.c[0] * 1.2, e.c[1] * 1.2, e.c[2] * 1.2, 2.4 * sc, .18, 0, 0, 3.2 * sc, .7);
    if (sc >= 1.3) this.shock(p, el, sc * .7);
    if (p.y - groundAt(p.x, p.z, p.y) < 1.2 && sc >= .9) decal(p, el === 'fire' || el === 'lightning' ? 'scorch' : el === 'water' ? 'wet' : 'crack', 1.8 * sc);
  },
  shock(p, el, sc = 1) {
    const e = EL[el] || EL.fire;
    const m = new THREE.Mesh(new THREE.RingGeometry(.7, .8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.c[0], e.c[1], e.c[2]), transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(p); m.lookAt(camera.position); scene.add(m);
    TWEENS.push({ t: 0, d: .35, f: k => { m.scale.setScalar(1 + k * 1.8 * sc); m.material.opacity = .45 * (1 - k); }, end: () => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
  },
  lightning(p, n = 4, sp = .25, v = null, sc = 1) {
    for (let i = 0; i < n; i++) { _v1.randomDirection().multiplyScalar(rand(1, 5)); PADD.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + _v1.x, (v ? v.y : 0) + _v1.y, (v ? v.z : 0) + _v1.z, 1.3, 1.15, 1.9, rand(.08, .2) * sc, rand(.1, .25), 0, 4, .02); }
    if (Math.random() < .2 * n) PADD.emit(p.x, p.y, p.z, 0, 0, 0, .9, .75, 1.6, .7 * sc, .08, 0, 0, .9 * sc, .6);
  },
  el(name, p, n, sp, v, sc) { (this[name] || this.fire).call(this, p, n, sp, v, sc); },
};
const TWEENS = [];
function updateTweens(dt) { for (let i = TWEENS.length - 1; i >= 0; i--) { const tw = TWEENS[i]; tw.t += dt; const k = Math.min(1, tw.t / tw.d); tw.f(k); if (k >= 1) { tw.end && tw.end(); TWEENS.splice(i, 1); } } }
const TELES = [];
function telegraph(pos, radius, color, dur) {
  TELES.push({ x: pos.x, z: pos.z, r: radius, end: game.time + dur });
  const g = new THREE.Group(); g.position.set(pos.x, (pos.y || 0) + .04, pos.z);
  const m1 = new THREE.Mesh(new THREE.RingGeometry(radius * .88, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const m2 = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }));
  m1.rotation.x = m2.rotation.x = -Math.PI / 2; g.add(m1, m2); scene.add(g);
  TWEENS.push({ t: 0, d: dur, f: k => { m2.scale.setScalar(Math.max(.01, k)); m1.material.opacity = .5 + .5 * Math.sin(k * 30); }, end: () => { scene.remove(g); [m1, m2].forEach(m => { m.geometry.dispose(); m.material.dispose(); }); } });
}

// ---------------------------------------------------------------- CHARACTER TEXTURES
function noiseFill(g, w, h, base, amt, n = 4000) { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = rand(-amt, amt); g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3)); } }
function faceTex(kind) {
  return canvasTex(512, 256, (g, w, h) => {
    const skin = '#cf9878'; g.fillStyle = skin; g.fillRect(0, 0, w, h);
    const cx = w * .25, ey = h * .44; const S = 2; // pixels per "unit" scale factor
    // cheek/jaw shading
    let r = g.createRadialGradient(cx, h * .55, 10, cx, h * .55, 70); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(90,40,30,.25)'); g.fillStyle = r; g.fillRect(0, 0, w, h);
    if (kind === 'raven') { g.fillStyle = 'rgba(40,40,45,.25)'; g.fillRect(cx - 40, h * .55, 80, 40); }
    for (const s of [-1, 1]) {
      const x = cx + s * 15 * S;
      g.fillStyle = 'rgba(90,50,40,.35)'; g.beginPath(); g.ellipse(x, ey + 1, 13, 7, 0, 0, 7); g.fill();
      g.fillStyle = '#f2ece4'; g.beginPath(); g.ellipse(x, ey, 10, 4.6, 0, 0, 7); g.fill();
      g.fillStyle = kind === 'raven' ? '#2a2a2a' : '#3a2516'; g.beginPath(); g.arc(x - s * 1, ey, 4.2, 0, 7); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.arc(x - s * 1, ey, 2, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.fillRect(x - s * 1 + 1, ey - 2, 1.5, 1.5);
      g.strokeStyle = '#1a1210'; g.lineWidth = 2.4; g.beginPath(); g.ellipse(x, ey, 10.5, 5, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      // brows (angry)
      g.fillStyle = kind === 'raven' ? '#2a2a2e' : '#14141c'; g.beginPath(); g.moveTo(x - s * 13, ey - 6); g.lineTo(x + s * 12, ey - 14); g.lineTo(x + s * 12, ey - 10); g.lineTo(x - s * 13, ey - 2); g.closePath(); g.fill();
    }
    // nose
    g.strokeStyle = 'rgba(110,60,45,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 3, ey + 4); g.lineTo(cx - 5, ey + 22); g.lineTo(cx + 3, ey + 24); g.stroke();
    g.fillStyle = 'rgba(90,45,35,.5)'; g.beginPath(); g.arc(cx - 5, ey + 24, 2, 0, 7); g.arc(cx + 5, ey + 24, 2, 0, 7); g.fill();
    // mouth
    g.strokeStyle = '#7a3a30'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(cx - 12, ey + 37); g.quadraticCurveTo(cx, ey + 35, cx + 12, ey + 37); g.stroke();
    g.strokeStyle = 'rgba(120,60,50,.4)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 8, ey + 42); g.quadraticCurveTo(cx, ey + 45, cx + 8, ey + 42); g.stroke();
    if (kind === 'hero') { g.strokeStyle = 'rgba(150,30,25,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 34, ey + 8); g.lineTo(cx - 24, ey + 30); g.stroke(); }
    // ears hint
    for (const s of [-1, 1]) { g.fillStyle = 'rgba(120,60,45,.35)'; g.beginPath(); g.ellipse(cx + s * 58, ey + 8, 6, 12, 0, 0, 7); g.fill(); }
  });
}
function torsoTex(kind, part, base = '#2b2b31', trim = '#8a8680') {
  return canvasTex(512, 256, (g, w, h) => {
    if (kind === 'raven') {
      noiseFill(g, w, h, base, .06, 3000);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 2; for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 8); g.lineTo(x, y + 16); g.stroke(); }
      if (part === 'chest') { g.strokeStyle = trim; g.lineWidth = 7; g.beginPath(); g.moveTo(w * .62, 0); g.lineTo(w * .44, h); g.stroke(); g.strokeStyle = '#4a4a50'; g.lineWidth = 3; g.beginPath(); g.moveTo(w * .66, 0); g.lineTo(w * .48, h); g.stroke(); }
      return;
    }
    // hero bare torso: skin with muscle definition
    g.fillStyle = '#cf9878'; g.fillRect(0, 0, w, h);
    const cx = w * .5; g.filter = 'blur(3px)';
    g.strokeStyle = 'rgba(110,55,40,.5)'; g.lineWidth = 5;
    if (part === 'chest') {
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx, h * .25); g.quadraticCurveTo(cx + s * 70, h * .82, cx + s * 120, h * .3); g.stroke(); }
      g.beginPath(); g.moveTo(cx, h * .1); g.lineTo(cx, h); g.stroke();
      g.fillStyle = 'rgba(255,220,200,.18)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 52, h * .45, 40, 30, 0, 0, 7); g.fill(); }
      g.filter = 'none'; g.strokeStyle = 'rgba(160,35,30,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 70, h * .35); g.lineTo(cx - 20, h * .7); g.stroke(); g.beginPath(); g.moveTo(cx + 30, h * .2); g.lineTo(cx + 75, h * .5); g.stroke();
    } else {
      g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
      for (const y of [.3, .55, .78]) { g.beginPath(); g.moveTo(cx - 40, h * y); g.quadraticCurveTo(cx, h * y + 6, cx + 40, h * y); g.stroke(); }
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 44, h * .1); g.quadraticCurveTo(cx + s * 52, h * .6, cx + s * 30, h); g.stroke(); }
      g.fillStyle = 'rgba(255,220,200,.15)'; for (const y of [.42, .66]) for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 20, h * y, 16, 12, 0, 0, 7); g.fill(); }
      g.filter = 'none'; g.strokeStyle = 'rgba(160,35,30,.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 20, h * .3); g.lineTo(cx + 55, h * .7); g.stroke();
    }
    g.filter = 'none';
  });
}
function tattooTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#cf9878'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(35,28,30,.85)'; g.lineCap = 'round';
    for (let i = 0; i < 24; i++) { g.lineWidth = rand(2, 7); g.beginPath(); let x = rand(0, w), y = rand(0, h); g.moveTo(x, y); for (let k = 0; k < 3; k++) g.bezierCurveTo(x + rand(-60, 60), y + rand(-60, 60), x + rand(-60, 60), y + rand(-60, 60), x = rand(0, w), y = clamp(y + rand(-50, 50), 0, h)); g.stroke(); }
    for (let i = 0; i < 16; i++) { g.lineWidth = 3; g.beginPath(); g.arc(rand(0, w), rand(0, h), rand(8, 22), rand(0, 3), rand(3, 6.3)); g.stroke(); }
    g.fillStyle = 'rgba(35,28,30,.7)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rand(0, w), rand(0, h), rand(2, 5), 0, 7); g.fill(); }
  });
}
function coatTex(kind, base, trim = '#7d7a74') {
  return canvasTex(1024, 256, (g, w, h) => {
    if (kind === 'hero') {
      noiseFill(g, w, h, base || '#16161b', .05, 6000);
      const goldG = g.createLinearGradient(0, 0, 0, h); goldG.addColorStop(0, '#f2d27a'); goldG.addColorStop(1, '#a5741e');
      g.fillStyle = goldG; g.fillRect(0, h - 16, w, 12); g.fillRect(0, 0, 12, h); g.fillRect(w - 12, 0, 12, h);
      g.strokeStyle = '#d8ac4c'; g.lineWidth = 4; g.lineCap = 'round';
      const waves = (x0, dir) => { for (let k = 0; k < 4; k++) { const y = h - 30 - k * 24, x = x0 + dir * k * 14; g.beginPath(); g.arc(x, y, 16 + k * 2, Math.PI, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x + dir * 10, y + 2, 7, Math.PI, Math.PI * 2.6); g.stroke(); g.beginPath(); g.moveTo(x - 30, y + 14); g.quadraticCurveTo(x, y - 20 - k * 4, x + 34 * dir, y + 6); g.stroke(); } };
      waves(40, 1); waves(w - 40, -1); waves(w / 2 - 50, 1); waves(w / 2 + 50, -1);
    } else {
      noiseFill(g, w, h, base || '#2a2a30', .06, 5000);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 2; for (let x = 0; x < w; x += 10) for (let y = 0; y < h; y += 18) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5, y + 9); g.lineTo(x, y + 18); g.stroke(); }
      g.fillStyle = trim; g.fillRect(0, h - 12, w, 7); g.fillRect(w * .48, 0, 6, h); g.fillRect(w * .53, 0, 3, h);
    }
  });
}
function clothTex(color, folds = .12) {
  return canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, color, .05, 1500);
    g.filter = 'blur(4px)';
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(0,0,0,${rand(.05, folds)})`; g.lineWidth = rand(3, 8); g.beginPath(); const x = rand(0, w); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-30, 30), h * .3, x + rand(-30, 30), h * .6, x + rand(-20, 20), h); g.stroke(); }
    g.filter = 'none';
  });
}
function quiltTex() { return canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#1d1c1f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a383d'; g.lineWidth = 2; for (let x = -h; x < w + h; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); g.beginPath(); g.moveTo(x + h, 0); g.lineTo(x, h); g.stroke(); } g.fillStyle = '#6e6c66'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4); }); }
function hairTex(streak, base = '#121219') { return canvasTex(128, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { g.strokeStyle = streak && i % 3 === 0 ? 'rgba(170,170,180,.5)' : `rgba(${rand(40, 80)},${rand(40, 80)},${rand(70, 110)},.35)`; g.lineWidth = rand(.5, 1.6); g.beginPath(); const x = rand(0, w); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-10, 10), h * .3, x + rand(-10, 10), h * .7, x + rand(-6, 6), h); g.stroke(); } }); }

// ---------------------------------------------------------------- CHARACTER RIGS (v2: smoother, textured)
const CHAR_MATS = {};
function charMats() {
  if (CHAR_MATS.ready) return CHAR_MATS;
  const skin = new THREE.MeshStandardMaterial({ color: 0xcf9878, roughness: .55 });
  Object.assign(CHAR_MATS, {
    ready: true, skin,
    heroFace: new THREE.MeshStandardMaterial({ map: faceTex('hero'), roughness: .55 }),
    ravenFace: new THREE.MeshStandardMaterial({ map: faceTex('raven'), roughness: .55 }),
    heroChest: new THREE.MeshStandardMaterial({ map: torsoTex('hero', 'chest'), roughness: .5 }),
    heroAbs: new THREE.MeshStandardMaterial({ map: torsoTex('hero', 'abs'), roughness: .5 }),
    ravenChest: new THREE.MeshStandardMaterial({ map: torsoTex('raven', 'chest'), roughness: .85 }),
    ravenAbs: new THREE.MeshStandardMaterial({ map: torsoTex('raven', 'abs'), roughness: .85 }),
    tattoo: new THREE.MeshStandardMaterial({ map: tattooTex(), roughness: .55 }),
    heroCoat: new THREE.MeshStandardMaterial({ map: coatTex('hero'), roughness: .8, side: THREE.DoubleSide }),
    ravenSkirt: new THREE.MeshStandardMaterial({ map: coatTex('raven'), roughness: .85, side: THREE.DoubleSide }),
    vest: new THREE.MeshStandardMaterial({ map: clothTex('#17171c', .2), roughness: .85, side: THREE.DoubleSide }),
    cream: new THREE.MeshStandardMaterial({ map: clothTex('#d8cfbf', .18), roughness: .92 }),
    ravenPants: new THREE.MeshStandardMaterial({ map: clothTex('#2d2d33', .2), roughness: .9 }),
    boot: mat(0x2a221d, .45, .15), bootR: mat(0x161518, .4, .15),
    hairH: new THREE.MeshStandardMaterial({ map: hairTex(false), roughness: .5, side: THREE.DoubleSide }),
    hairR: new THREE.MeshStandardMaterial({ map: hairTex(true), roughness: .55 }),
    belt: new THREE.MeshStandardMaterial({ map: quiltTex(), roughness: .6 }),
    leather: mat(0x1b1a1d, .5, .1), trim: mat(0x8a867e, .35, .75), mask: mat(0x0f0f12, .32, .6), black: mat(0x141418, .7),
  });
  return CHAR_MATS;
}
const VAR_CACHE = {};
function mixHex(hex, color, t) { return '#' + new THREE.Color(hex).lerp(new THREE.Color(color), t).getHexString(); }
function variantMats(kind, el, variant) {
  const key = kind + el + variant; if (VAR_CACHE[key]) return VAR_CACHE[key];
  const o = {};
  if (kind === 'raven') {
    const ec = EL[el] ? EL[el].color : 0x888888;
    const base = mixHex(variant === 'b' ? '#4a4038' : '#2b2b31', ec, .16), trim = mixHex('#8a8680', ec, .6);
    o.ravenChest = new THREE.MeshStandardMaterial({ map: torsoTex('raven', 'chest', base, trim), roughness: .85 });
    o.ravenAbs = new THREE.MeshStandardMaterial({ map: torsoTex('raven', 'abs', base, trim), roughness: .85 });
    o.ravenSkirt = new THREE.MeshStandardMaterial({ map: coatTex('raven', base, trim), roughness: .85, side: THREE.DoubleSide });
    o.ravenPants = new THREE.MeshStandardMaterial({ map: clothTex(mixHex('#2d2d33', ec, .08), .2), roughness: .9 });
    o.trim = mat(new THREE.Color(trim), .32, .8, { emissive: new THREE.Color(ec), emissiveIntensity: .12 });
    if (variant === 'b') o.hairR = new THREE.MeshStandardMaterial({ map: hairTex(true, '#3a3a40'), roughness: .55 });
  } else if (variant === 'b') {
    o.heroCoat = new THREE.MeshStandardMaterial({ map: coatTex('hero', '#e4ddcf'), roughness: .8, side: THREE.DoubleSide });
    o.vest = new THREE.MeshStandardMaterial({ map: clothTex('#e2dccd', .15), roughness: .85, side: THREE.DoubleSide });
    o.cream = new THREE.MeshStandardMaterial({ map: clothTex('#2a2630', .2), roughness: .92 });
    o.hairH = new THREE.MeshStandardMaterial({ map: hairTex(false, '#c4c4cc'), roughness: .5, side: THREE.DoubleSide });
  }
  return (VAR_CACHE[key] = o);
}
function buildRig(kind, elColor, el = null, variant = 'a') {
  const C = Object.assign({}, charMats(), variantMats(kind, el, variant)); const R = { kind };
  const root = new THREE.Group(); const body = J(root); const hips = J(body, 0, 1, 0);
  const spine = J(hips, 0, .08, 0), chest = J(spine, 0, .2, 0), neck = J(chest, 0, .37, 0), head = J(neck, 0, .09, 0);
  const shL = J(chest, .24, .27, 0), shR = J(chest, -.24, .27, 0);
  const elL = J(shL, 0, -.29, 0), elR = J(shR, 0, -.29, 0);
  const handL = J(elL, 0, -.27, .01), handR = J(elR, 0, -.27, .01);
  const thL = J(hips, .12, -.04, 0), thR = J(hips, -.12, -.04, 0);
  const knL = J(thL, 0, -.45, 0), knR = J(thR, 0, -.45, 0);
  const skirt = J(hips, 0, 0, 0);
  Object.assign(R, { root, body, hips, spine, chest, neck, head, shL, shR, elL, elR, handL, handR, thL, thR, knL, knR, skirt });
  const hero = kind === 'hero';
  // --- torso (lathe, elliptical)
  const absG = lathe([[0, -.08], [.145, -.07], [.15, 0], [.145, .08], [.155, .16], [.165, .24], [0, .25]], 20);
  M(absG, hero ? C.heroAbs : C.ravenAbs, 0, 0, 0, spine).scale.set(1.18, 1, .76);
  const chG = lathe([[0, -.04], [.16, -.03], [.18, .06], [.2, .15], [.205, .23], [.19, .3], [.15, .35], [.08, .38], [0, .385]], 22);
  M(chG, hero ? C.heroChest : C.ravenChest, 0, 0, 0, chest).scale.set(1.32, 1, .78);
  // traps/neck
  M(lathe([[0, -.02], [.075, -.02], [.065, .06], [.06, .12], [0, .12]], 12), C.skin, 0, -.02, 0, neck);
  for (const s of [-1, 1]) M(new THREE.SphereGeometry(.08, 10, 8), hero ? C.skin : C.ravenChest, s * .1, .34, -.02, chest).scale.set(1.3, .55, .9);
  // --- head
  const headG = new THREE.SphereGeometry(.115, 24, 18);
  M(headG, hero ? C.heroFace : C.ravenFace, 0, .07, .005, head).scale.set(.86, 1.1, .97);
  for (const s of [-1, 1]) M(new THREE.SphereGeometry(.025, 8, 6), C.skin, s * .1, .065, -.005, head).scale.set(.5, 1, .8);
  M(new THREE.ConeGeometry(.018, .05, 6), C.skin, 0, .06, .118, head).rotation.x = Math.PI / 2 + .3;
  // --- arms (muscular lathe)
  const upG = lathe([[0, -.3], [.06, -.29], [.072, -.24], [.088, -.16], [.09, -.09], [.096, -.03], [.08, .03], [0, .07]], 14);
  const foG = lathe([[0, -.27], [.044, -.26], [.05, -.22], [.064, -.12], [.072, -.05], [.066, 0], [0, .03]], 12);
  for (const [sh, el, hd, s] of [[shL, elL, handL, 1], [shR, elR, handR, -1]]) {
    const am = hero && s < 0 ? C.tattoo : C.skin;
    M(new THREE.SphereGeometry(.105, 14, 10), hero && s < 0 ? C.tattoo : C.skin, s * .012, -.02, 0, sh).scale.set(1.05, .95, 1.05);
    M(upG, am, 0, 0, 0, sh).scale.set(1.05, 1, 1);
    M(foG, am, 0, 0, 0, el);
    M(new THREE.SphereGeometry(.055, 10, 8), C.skin, 0, 0, 0, el);
    // fist
    M(new THREE.BoxGeometry(.078, .085, .06, 2, 2, 2), C.skin, 0, -.035, .005, hd);
    M(new THREE.BoxGeometry(.076, .03, .07), C.skin, 0, -.085, .012, hd);
    M(new THREE.CapsuleGeometry(.014, .03, 3, 6), C.skin, s * .04, -.05, .025, hd).rotation.z = s * .5;
    if (!hero) { M(lathe([[0, -.25], [.07, -.24], [.078, -.12], [.08, -.06], [0, -.05]], 12), C.leather, 0, 0, 0, el); for (const y of [-.08, -.14, -.2]) M(new THREE.TorusGeometry(.076, .006, 4, 14), C.trim, 0, y, 0, el).rotation.x = Math.PI / 2; }
  }
  // --- legs
  if (hero) {
    const thG = lathe([[0, -.47], [.1, -.46], [.135, -.36], [.155, -.22], [.155, -.08], [.14, .02], [0, .05]], 16);
    const shinP = lathe([[0, -.17], [.098, -.16], [.12, -.1], [.118, -.02], [.1, .03], [0, .04]], 14);
    for (const [th, kn] of [[thL, knL], [thR, knR]]) {
      M(thG, C.cream, 0, 0, 0, th); M(shinP, C.cream, 0, 0, 0, kn);
      M(lathe([[0, -.45], [.074, -.44], [.08, -.32], [.088, -.18], [.092, -.13], [0, -.12]], 14), C.boot, 0, 0, 0, kn);
      M(new THREE.TorusGeometry(.09, .008, 4, 16), MATS.gold, 0, -.13, 0, kn).rotation.x = Math.PI / 2;
      M(new THREE.SphereGeometry(.07, 12, 8), C.boot, 0, -.43, .07, kn).scale.set(.85, .55, 1.6);
      M(new THREE.BoxGeometry(.12, .018, .27), MATS.gold, 0, -.465, .05, kn);
    }
  } else {
    const thG = lathe([[0, -.47], [.095, -.46], [.12, -.34], [.135, -.2], [.135, -.06], [.125, .02], [0, .05]], 14);
    for (const [th, kn] of [[thL, knL], [thR, knR]]) {
      M(thG, C.ravenPants, 0, 0, 0, th);
      M(lathe([[0, -.46], [.078, -.45], [.084, -.3], [.098, -.12], [.1, .0], [.09, .04], [0, .04]], 14), C.bootR, 0, 0, 0, kn);
      M(new THREE.SphereGeometry(.072, 12, 8), C.bootR, 0, -.43, .07, kn).scale.set(.85, .55, 1.6);
      M(new THREE.BoxGeometry(.12, .018, .27), C.leather, 0, -.465, .05, kn);
    }
  }
  // --- belts / outfits
  if (hero) {
    M(new THREE.CylinderGeometry(.2, .2, .1, 20), C.black, 0, .05, 0, hips).scale.z = .74;
    const med = M(new THREE.CylinderGeometry(.045, .045, .02, 16), MATS.gold, 0, .05, .155, hips); med.rotation.x = Math.PI / 2;
    M(new THREE.BoxGeometry(.03, .3, .02), C.black, .05, -.14, .16, hips); M(new THREE.SphereGeometry(.022, 8, 6), MATS.gold, .05, -.28, .16, hips);
    M(lathe([[0, -.12], [.2, -.11], [.21, 0], [.2, .05], [0, .06]], 16), C.cream, 0, 0, 0, hips).scale.z = .8;
    // vest
    const vestG = new THREE.CylinderGeometry(.205, .19, .4, 22, 2, true, .95, Math.PI * 2 - 1.9);
    M(vestG, C.vest, 0, .16, -.005, chest).scale.set(1.34, 1, .82);
    const vtrim = new THREE.CylinderGeometry(.208, .208, .02, 22, 1, true, .95, Math.PI * 2 - 1.9);
    for (const s of [-1, 1]) { const e = M(new THREE.BoxGeometry(.012, .36, .02), MATS.gold, s * .155, .14, .148, chest); e.rotation.z = s * .05; }
    M(vtrim, MATS.gold, 0, -.04, -.005, chest).scale.set(1.34, 1, .82);
        M(new THREE.CylinderGeometry(.12, .155, .14, 18, 1, true, .95, Math.PI * 2 - 1.9), C.vest, 0, .41, -.01, chest);
    M(new THREE.CylinderGeometry(.122, .122, .018, 18, 1, true, .95, Math.PI * 2 - 1.9), MATS.gold, 0, .48, -.01, chest);
    // flowing open coat (vertex-animated)
    const gap = 1.25;
    const coatG = new THREE.CylinderGeometry(.27, .5, .95, 28, 8, true, gap / 2, Math.PI * 2 - gap); coatG.translate(0, -.475, 0);
    const coat = M(coatG, C.heroCoat, 0, .02, 0, skirt); R.cloth = { geo: coatG, base: Float32Array.from(coatG.attributes.position.array), h: .95 };
  } else {
    M(new THREE.CylinderGeometry(.215, .215, .14, 20), C.belt, 0, .06, 0, hips).scale.z = .76;
    M(new THREE.BoxGeometry(.1, .08, .03), C.trim, 0, .06, .165, hips);
    M(new THREE.CylinderGeometry(.11, .14, .14, 18), C.ravenChest, 0, .4, 0, chest);
    M(new THREE.CylinderGeometry(.112, .112, .02, 18), C.trim, 0, .47, 0, chest);
    const skG = new THREE.CylinderGeometry(.26, .4, .6, 24, 6, true); skG.translate(0, -.3, 0);
    M(skG, C.ravenSkirt, 0, .0, 0, skirt); R.cloth = { geo: skG, base: Float32Array.from(skG.attributes.position.array), h: .6 };
    const fp = M(new THREE.BoxGeometry(.22, .58, .02), C.ravenSkirt, .07, -.31, .34, skirt); fp.rotation.x = -.22;
    // shoulder pad (left)
    const pad = J(shL, .03, .03, 0);
    for (let k = 0; k < 3; k++) { const p = M(new THREE.SphereGeometry(.16 - k * .005, 16, 8, 0, Math.PI * 2, .2 + k * .35, .55), C.trim, .01 * k, -.035 * k, 0, pad); p.scale.set(1, .8, 1.12); }
    for (let k = 0; k < 4; k++) M(new THREE.SphereGeometry(.01, 6, 4), C.black, Math.cos(k) * .1, .05, Math.sin(k * 1.6) * .1, pad);
  }
  // --- hair
  R.hair = [];
  if (hero) {
    M(new THREE.SphereGeometry(.128, 18, 10, 0, Math.PI * 2, 0, 1.15), C.hairH, 0, .075, -.002, head).scale.set(.93, 1.08, 1.04);
    M(new THREE.SphereGeometry(.128, 18, 12, Math.PI, Math.PI, 0, 2.3), C.hairH, 0, .07, -.008, head).scale.set(.95, 1.08, 1.06);
    M(new THREE.SphereGeometry(.062, 12, 10), C.hairH, 0, .22, -.035, head);
    const rg = M(new THREE.TorusGeometry(.052, .016, 6, 18), MATS.gold, 0, .2, -.035, head); rg.rotation.x = Math.PI / 2 - .3;
    M(new THREE.CylinderGeometry(.005, .005, .18, 4), MATS.gold, 0, .23, -.035, head).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) { const st = J(head, s * .1, .06, .04); const m = M(new THREE.BoxGeometry(.024, .34, .022), C.hairH, 0, -.16, .01, st); m.rotation.z = s * .08; R.hair.push({ j: st, i: 0, side: true, ph: s }); }
    const N = IS_TOUCH ? 7 : 9;
    for (let n = 0; n < N; n++) {
      const a = Math.PI + (n / (N - 1) - .5) * 2.2;
      let prev = J(head, Math.sin(a) * .1, .06 - Math.abs(n - (N - 1) / 2) * .008, Math.cos(a) * .1);
      prev.rotation.y = a - Math.PI;
      const L = 5 + (n % 2);
      for (let k = 0; k < L; k++) {
        const seg = J(prev, 0, k === 0 ? 0 : -.13, 0);
        const w = (.075 - k * .008) * (1 + Math.sin(n * 2.1) * .2);
        M(new THREE.BoxGeometry(w, .145, .028), C.hairH, 0, -.065, 0, seg).rotation.y = Math.sin(n + k) * .2;
        R.hair.push({ j: seg, i: k, ph: n * .7 }); prev = seg;
      }
    }
  } else {
    M(new THREE.SphereGeometry(.126, 18, 10, 0, Math.PI * 2, 0, .95), C.hairR, 0, .078, -.004, head).scale.set(.95, 1.1, 1.05);
    M(new THREE.SphereGeometry(.123, 18, 12, Math.PI, Math.PI, 0, 1.75), C.hairR, 0, .07, -.008, head).scale.set(.95, 1.05, 1.03);
    const q = M(new THREE.BoxGeometry(.14, .06, .2, 2, 1, 2), C.hairR, 0, .2, 0, head); q.rotation.x = -.25;
    const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(elColor).multiplyScalar(1.6) }); R.eyeM = eyeM;
    for (const s of [-1, 1]) M(new THREE.BoxGeometry(.022, .008, .004), eyeM, s * .035, .088, .112, head);
    M(new THREE.SphereGeometry(.121, 18, 8, 0, Math.PI, 1.6, .98), C.mask, 0, .072, .012, head).scale.set(.94, 1.12, 1.06);
    M(new THREE.BoxGeometry(.012, .075, .02), C.trim, 0, .03, .13, head);
    for (const s of [-1, 1]) M(new THREE.BoxGeometry(.04, .006, .008), eyeM, s * .065, .03, .118, head).rotation.z = s * -.4;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) M(new THREE.BoxGeometry(.03, .004, .006), C.trim, s * .05, .02 - k * .012, .118, head);
    M(new THREE.TorusGeometry(.112, .008, 4, 24), C.leather, 0, .062, -.01, head).rotation.x = Math.PI / 2;
  }
  R.bodyMeshes = []; root.traverse(o => { if (o.isMesh) R.bodyMeshes.push(o); });
  // glows + shield
  R.glowL = glowSprite(0xffffff, .32, 0); handL.add(R.glowL); R.glowL.position.y = -.05;
  R.glowR = glowSprite(0xffffff, .32, 0); handR.add(R.glowR); R.glowR.position.y = -.05;
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); vP=position; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uA; uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f=pow(1.-abs(dot(vN,vV)),2.2); float h=.5+.5*sin(vP.y*18.-uT*6.)*sin(vP.x*14.+uT*3.); gl_FragColor=vec4(uColor*(f*1.6+h*.12),(f*.9+.06)*uA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  R.shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), shieldMat); R.shield.position.y = 1.0; R.shield.scale.set(.9, 1.05, .9); R.shield.visible = false; root.add(R.shield);
  // ground glow ring under feet (readability on phones)
  const ringM = new THREE.MeshBasicMaterial({ color: hero ? 0xffc860 : new THREE.Color(elColor), transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false });
  R.footRing = new THREE.Mesh(new THREE.RingGeometry(.55, .62, 40), ringM); R.footRing.rotation.x = -Math.PI / 2; R.footRing.position.y = .03; R.footRing.castShadow = false; root.add(R.footRing);
  root.traverse(o => { if (o.isMesh && o !== R.shield && o !== R.footRing) o.castShadow = true; });
  return R;
}

// ---------------------------------------------------------------- POSES
const JN = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'shR', 'elR', 'thL', 'knL', 'thR', 'knR', 'body'];
const BASE = {
  hipsY: .93, body: [0, 0, 0], hips: [0, .32, 0], spine: [.06, 0, 0], chest: [.04, -.28, 0], neck: [0, -.02, 0], head: [-.02, -.04, 0],
  shL: [-.7, .1, .28], elL: [-1.75, 0, .1], shR: [-.45, -.1, -.4], elR: [-2.05, 0, -.1],
  thL: [-.4, .02, .14], knL: [.48, 0, 0], thR: [.22, .04, -.13], knR: [.5, 0, 0],
};
function clonePose(p) { const o = {}; for (const k in p) o[k] = Array.isArray(p[k]) ? p[k].slice() : p[k]; return o; }
function ph(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function mix(A, B, k) { const o = {}; for (const key in A) { if (Array.isArray(A[key])) o[key] = A[key].map((v, i) => lerp(v, (B[key] || A[key])[i], k)); else o[key] = lerp(A[key], B[key] ?? A[key], k); } return o; }
function over(P, o) { for (const k in o) P[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; return P; }
const POSE_ANIMS = {
  punch(P, t, r) {
    const W = over(clonePose(P), { shR: [-.2, 0, -.35], elR: [-2.3, 0, 0], chest: [.05, .5, 0], hips: [0, .55, 0], hipsY: .88 });
    const S = over(clonePose(P), { shR: [-1.62, 0, -.06], elR: [-.06, 0, 0], chest: [.12, -.8, 0], hips: [0, -.15, 0], shL: [-.2, 0, .5], elL: [-1.7, 0, 0], thR: [.5, 0, -.1], knR: [.2, 0, 0], thL: [-.6, 0, .14], knL: [.6, 0, 0], body: [.12, 0, 0], hipsY: .88 });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  jab(P, t, r) { const S = over(clonePose(P), { shL: [-1.62, 0, .02], elL: [-.06, 0, 0], chest: [.1, -.65, 0], hips: [0, .55, 0], body: [.08, 0, 0] }); return mix(P, S, easeOut(ph(t, 0, r))); },
  cross(P, t, r) { return POSE_ANIMS.punch(P, t, r * .5); },
  push(P, t, r) {
    const W = over(clonePose(P), { shL: [.35, 0, .45], elL: [-1.9, 0, 0], shR: [.35, 0, -.45], elR: [-1.9, 0, 0], chest: [-.15, 0, 0], hips: [0, 0, 0], hipsY: .84 });
    const S = over(clonePose(P), { shL: [-1.5, -.15, .1], elL: [-.05, 0, 0], shR: [-1.5, .15, -.1], elR: [-.05, 0, 0], chest: [.25, 0, 0], hips: [0, 0, 0], thL: [-.75, 0, .1], knL: [.75, 0, 0], thR: [.55, 0, -.1], knR: [.15, 0, 0], hipsY: .84, body: [.1, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  kick(P, t, r) {
    const W = over(clonePose(P), { hips: [0, .9, 0], chest: [0, -.4, 0], shL: [-.3, 0, .9], shR: [-.3, 0, -.9], elL: [-.6, 0, 0], elR: [-.6, 0, 0], thR: [-.4, 0, -.2], knR: [1.2, 0, 0] });
    const S = over(clonePose(P), { hips: [0, -1.0, .1], chest: [-.1, .55, 0], body: [0, 0, .32], thR: [-1.5, 0, -.65], knR: [.1, 0, 0], thL: [0, 0, .05], knL: [.25, 0, 0], shL: [-.2, 0, 1.2], shR: [.2, 0, -1.1], elL: [-.3, 0, 0], elR: [-.3, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  lift(P, t, r) {
    const W = over(clonePose(P), { hipsY: .72, thL: [-1.25, 0, .2], knL: [1.5, 0, 0], shL: [.3, 0, .6], elL: [-.4, 0, 0], shR: [.3, 0, -.6], elR: [-.4, 0, 0], chest: [.3, 0, 0], hips: [0, 0, 0] });
    const U = over(clonePose(P), { hipsY: .78, thL: [-.6, 0, .35], knL: [.8, 0, 0], thR: [.3, 0, -.35], knR: [.7, 0, 0], shL: [-2.4, 0, .35], elL: [-.2, 0, 0], shR: [-2.4, 0, -.35], elR: [-.2, 0, 0], chest: [-.15, 0, 0], hips: [0, 0, 0] });
    const S = over(clonePose(U), { shL: [-1.45, 0, .15], shR: [-1.45, 0, -.15], elL: [0, 0, 0], elR: [0, 0, 0], chest: [.3, 0, 0], body: [.1, 0, 0] });
    if (t < r * .5) return mix(P, W, ease(t / (r * .5)));
    if (t < r) return mix(W, U, ease(ph(t, r * .5, r)));
    return mix(U, S, easeOut(ph(t, r, r + .12)));
  },
  stomp(P, t, r) {
    const W = over(clonePose(P), { hipsY: .95, thR: [-1.3, 0, -.2], knR: [1.6, 0, 0], shL: [-2.2, 0, .6], shR: [-2.2, 0, -.6], elL: [-.3, 0, 0], elR: [-.3, 0, 0], hips: [0, 0, 0], chest: [-.1, 0, 0] });
    const S = over(clonePose(P), { hipsY: .7, thR: [-.5, 0, -.45], knR: [.9, 0, 0], thL: [-.3, 0, .45], knL: [.8, 0, 0], shL: [.2, 0, .9], shR: [.2, 0, -.9], elL: [-.2, 0, 0], elR: [-.2, 0, 0], chest: [.45, 0, 0], hips: [0, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .08)));
  },
  spin(P, t, r) {
    const S = over(clonePose(P), { shL: [-.1, 0, 1.45], shR: [-.1, 0, -1.45], elL: [0, 0, 0], elR: [0, 0, 0], hips: [0, 0, 0], chest: [0, 0, 0], hipsY: .98, thL: [-.1, 0, .25], thR: [-.1, 0, -.25], knL: [.2, 0, 0], knR: [.2, 0, 0] });
    S.body = [0, t * Math.PI * 4, 0]; return mix(P, S, ease(ph(t, 0, .2)));
  },
  burst(P, t, r) {
    const W = over(clonePose(P), { hipsY: .7, shL: [-1.2, .6, -.4], shR: [-1.2, -.6, .4], elL: [-1.4, 0, 0], elR: [-1.4, 0, 0], chest: [.45, 0, 0], hips: [0, 0, 0], thL: [-.9, 0, .4], knL: [1.3, 0, 0], thR: [-.9, 0, -.4], knR: [1.3, 0, 0] });
    const S = over(clonePose(P), { hipsY: .98, shL: [-.2, 0, 2.2], shR: [-.2, 0, -2.2], elL: [0, 0, 0], elR: [0, 0, 0], chest: [-.25, 0, 0], head: [-.3, 0, 0], hips: [0, 0, 0], thL: [0, 0, .3], thR: [0, 0, -.3], knL: [0, 0, 0], knR: [0, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  uppercut(P, t, r) {
    const W = over(clonePose(P), { hipsY: .74, shR: [.2, 0, -.3], elR: [-1.9, 0, 0], chest: [.35, .4, 0], hips: [0, .4, 0], thL: [-.8, 0, .2], knL: [1.1, 0, 0], thR: [.3, 0, -.2], knR: [.9, 0, 0] });
    const S = over(clonePose(P), { hipsY: 1.0, shR: [-2.75, 0, -.15], elR: [-.25, 0, 0], shL: [-.3, 0, .6], elL: [-1.5, 0, 0], chest: [-.25, -.4, 0], hips: [0, -.2, 0], head: [-.3, 0, 0], thL: [-.2, 0, .1], knL: [.2, 0, 0], thR: [.1, 0, -.1], knR: [.6, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  sweep(P, t, r) {
    const W = over(clonePose(P), { hipsY: .62, hips: [0, .8, 0], thL: [-1.1, 0, .3], knL: [1.6, 0, 0], thR: [-.3, 0, -.4], knR: [1.2, 0, 0], shL: [-.6, 0, .9], shR: [-.6, 0, -.9], elL: [-.5, 0, 0], elR: [-.5, 0, 0], chest: [.35, 0, 0] });
    const S = over(clonePose(W), { thR: [-.2, 0, -1.35], knR: [.05, 0, 0], shL: [.1, 0, 1.3], shR: [.1, 0, -1.3], elL: [0, 0, 0], elR: [0, 0, 0] });
    S.body = [0, -ease(ph(t, r * .6, r + .25)) * Math.PI * 1.5, 0];
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .1)));
  },
  hammer(P, t, r) {
    const W = over(clonePose(P), { hipsY: .98, shL: [-2.9, 0, .25], shR: [-2.9, 0, -.25], elL: [-.6, 0, 0], elR: [-.6, 0, 0], chest: [-.35, 0, 0], head: [-.2, 0, 0], hips: [0, 0, 0], thR: [-1.0, 0, -.1], knR: [1.4, 0, 0] });
    const S = over(clonePose(P), { hipsY: .66, shL: [-.7, 0, .2], shR: [-.7, 0, -.2], elL: [-.1, 0, 0], elR: [-.1, 0, 0], chest: [.6, 0, 0], head: [.2, 0, 0], hips: [0, 0, 0], thL: [-.9, 0, .25], knL: [1.3, 0, 0], thR: [.4, 0, -.25], knR: [.7, 0, 0], body: [.15, 0, 0] });
    return t < r ? mix(P, W, ease(t / r)) : mix(W, S, easeOut(ph(t, r, r + .07)));
  },
  rapid(P, t, r) {
    const k = Math.floor(t * 12) % 2, s = (t * 12) % 1;
    const A = over(clonePose(P), { shL: [-1.6, 0, .05], elL: [-.05, 0, 0], shR: [-.4, 0, -.4], elR: [-2.1, 0, 0], chest: [.1, -.35, 0], hips: [0, 0, 0] });
    const B = over(clonePose(P), { shR: [-1.6, 0, -.05], elR: [-.05, 0, 0], shL: [-.4, 0, .4], elL: [-2.1, 0, 0], chest: [.1, .35, 0], hips: [0, 0, 0] });
    return k ? mix(B, A, s) : mix(A, B, s);
  },
  ult(P, t, r) {
    const S = over(clonePose(P), { hipsY: 1, shL: [-.3, 0, 2.5], shR: [-.3, 0, -2.5], elL: [-.2, 0, 0], elR: [-.2, 0, 0], head: [-.35, 0, 0], chest: [-.2, 0, 0], hips: [0, 0, 0], thL: [-.2, 0, .1], knL: [.5, 0, 0], thR: [.1, 0, -.1], knR: [.8, 0, 0] });
    const F = over(clonePose(S), { shL: [-1.55, 0, .1], shR: [-1.55, 0, -.1], elL: [0, 0, 0], elR: [0, 0, 0], head: [0, 0, 0], chest: [.2, 0, 0] });
    return t < r ? mix(P, S, ease(ph(t, 0, .3))) : mix(S, F, easeOut(ph(t, r, r + .08)));
  },
};

// ---------------------------------------------------------------- BALANCE (edit freely — every number used in combat lives here)
const BAL = {
  hp: 1000,
  combo: [35, 35, 50], comboReset: 1.2,          // normal 3-hit combo damage; chain breaks after 1.2 s
  dashCD: 5, dashSpeed: 21, dashTime: .3,        // same dash for everyone
  blockChip: .15, perfectWindow: .22,            // % of damage that gets through a shield; reflect window (s)
  superPerDealt: .14, superPerTaken: .09,        // super meter gained per damage point dealt / taken (no passive charge)
  ccImmunity: 1.0,                               // seconds of immunity to forced displacement after a lift/pull
  moveSpeed: 6.4, accel: 11, decel: 18,
  el: {
    fire:      { perk: { kind: 'lifesteal', pct: .08, cap: 15 },
                 s1: { name: 'Flame Shot', dmg: 90, cd: 7 }, s2: { name: 'Flame Burst', dmg: 120, cd: 11, range: 5.5 }, su: { name: 'Inferno Blast', dmg: 220, warn: 1.0, radius: 3.6 } },
    water:     { perk: { kind: 'soak', pct: .10, dur: 5, icd: 8 },
                 s1: { name: 'Water Whip', dmg: 75, cd: 7, range: 7 }, s2: { name: 'Wave', dmg: 95, cd: 11, push: 7 }, su: { name: 'Tidal Wave', dmg: 180, slow: .2, slowDur: 2 } },
    earth:     { perk: { kind: 'fortify', pct: .20, dur: 5 },
                 s1: { name: 'Rock Shot', dmg: 90, cd: 8, speed: 15 }, s2: { name: 'Stone Wall', dmg: 0, cd: 14, hp: 250, dur: 4 }, su: { name: 'Earth Shock', dmg: 190, lift: .6, radius: 3.4, warn: .8 } },
    wind:      { perk: { kind: 'haste', pct: .12, dur: 3, icd: 7 },
                 s1: { name: 'Air Blade', dmg: 70, cd: 6 }, s2: { name: 'Gust', dmg: 85, cd: 10, push: 11, range: 7 }, su: { name: 'Cyclone', dmg: 170, dur: 3, pull: 5 } },
    lightning: { perk: { kind: 'static', bonus: 30, dur: 4, icd: 9 },
                 s1: { name: 'Lightning Bolt', dmg: 70, cd: 7, stun: .2, speed: 44 }, s2: { name: 'Chain Lightning', dmg: 90, cd: 13, stun: .35, range: 11 }, su: { name: 'Thunderstorm', dmg: 200, strikes: 5 } },
  },
  ai: { // difficulty changes reactions, aim and decisions — not health
    easy:   { react: .55, aimErr: .22, blockP: .2, dodgeP: .15, aggr: .45, follow: .25 },
    normal: { react: .32, aimErr: .09, blockP: .42, dodgeP: .38, aggr: .72, follow: .5 },
    hard:   { react: .18, aimErr: .03, blockP: .6, dodgeP: .6, aggr: .95, follow: .75 },
  },
};
const PERK_TEXT = {
  fire: 'Skill hits heal 8% of damage dealt (max 15 per use).',
  water: '3rd combo hit soaks the enemy: +10% damage taken for 5 s (every 8 s).',
  earth: 'Stone Wall grants 20% damage reduction for 5 s.',
  wind: 'Skill hits grant +12% move speed for 3 s (every 7 s).',
  lightning: 'Skill hits charge the enemy with static: your next combo hit deals +30 (every 9 s).',
};

// ---------------------------------------------------------------- ABILITIES
const AB = {};
function def(name, o) { const a = AB[name] = Object.assign({ name, anim: 'punch', dur: .45, rel: .16, cd: .45, cost: 8, power: 1 }, o); if (o.hit != null) a.rel = o.hit; }
function aimDir(f, from, target, lead = 0) { const tp = target.pos.clone().addScaledVector(target.vel, lead); tp.y += 1.0; return tp.sub(from).normalize(); }
function handPos(f, side = 'R') { const v = new V3(); const G = f.rig.glb; (G ? (side === 'R' ? G.b.RightHand : G.b.LeftHand) : (side === 'R' ? f.rig.handR : f.rig.handL)).getWorldPosition(v); return v; }
function frontPos(f, d = .8, y = 1.2) { return new V3(f.pos.x + Math.sin(f.yaw) * d, f.pos.y + y, f.pos.z + Math.cos(f.yaw) * d); }
let AB_CUR_POWER = 1;
def('fire', { el: 'fire', anim: 'punch', dur: .38, rel: .13, cd: .38, fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, .9, 1.35), speed: 27, radius: .36, dmg: 8, kb: 3, burn: 1.2, vis: 'fire', life: 2 }); Sfx.play('fire'); } });
def('water', { el: 'water', anim: 'push', dur: .46, rel: .17, cd: .42, fn(f, t) { spawnBall(f, t, { el: 'water', pos: frontPos(f, .9, 1.3), speed: 19, radius: .46, dmg: 9, kb: 5, homing: 1.8, vis: 'water', life: 2.2 }); Sfx.play('water'); } });
def('wind', { el: 'wind', anim: 'kick', dur: .44, rel: .16, cd: .42, fn(f, t) { spawnBall(f, t, { el: 'wind', pos: frontPos(f, .9, 1.1), speed: 32, radius: .85, dmg: 5, kb: 12, launch: 3, life: .6, vis: 'wind' }); Sfx.play('wind'); } });
def('earth', { el: 'earth', anim: 'lift', dur: .6, rel: .28, cd: .5, cost: 10, fn(f, t) { const p = frontPos(f, 1.1, -.4); spawnBall(f, t, { el: 'earth', pos: p, speed: 21, radius: .6, dmg: 13, kb: 6, knockdown: true, rise: .15, riseTo: 1.3, vis: 'rock', life: 2 }); Sfx.play('earth'); FX.earth(p.clone().setY(f.pos.y + .1), 10, .5); decal(f.pos.clone().add(new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw)).multiplyScalar(1.1)), 'crack', 1.4); } });
def('fire+wind', { el: 'fire', anim: 'spin', dur: .7, rel: .4, cd: 2.0, cost: 22, power: 2, label: 'Firestorm', fn(f, t) { spawnTornado(f, t, { el: 'fire', speed: 10, life: 2.8, radius: 1.2, tick: 2.6 }); Sfx.play('fire'); Sfx.play('wind'); } });
def('earth+fire', { el: 'fire', anim: 'lift', dur: .72, rel: .3, cd: 2.2, cost: 22, power: 2, label: 'Meteor', fn(f, t) { spawnMeteor(f, t, { dmg: 18, radius: 2.6 }); Sfx.play('earth'); Sfx.play('fire'); } });
def('water+wind', { el: 'water', anim: 'push', dur: .52, rel: .18, cd: 1.3, cost: 18, label: 'Ice Shards', fn(f, t) { const p = frontPos(f, .9, 1.3); for (let i = -2; i <= 2; i++) spawnBall(f, t, { el: 'water', pos: p.clone(), speed: 29, radius: .26, dmg: 4, kb: 1.5, slow: 1.6, spread: i * .12, vis: 'ice', life: 1.6 }); Sfx.play('water'); Sfx.play('wind'); } });
def('earth+water', { el: 'earth', anim: 'stomp', dur: .68, rel: .28, cd: 1.7, cost: 20, power: 2, label: 'Mud Wave', fn(f, t) { spawnWave(f, t, { el: 'water', speed: 15, width: 2.8, height: 1.05, dmg: 12, launch: 9, life: 1.8, vis: 'mud' }); Sfx.play('earth'); Sfx.play('water'); } });
def('fire+water', { el: 'water', anim: 'burst', dur: .52, rel: .15, cd: 2.2, cost: 20, power: 2, label: 'Steam Burst', fn(f, t) { steamBurst(f, t); } });
def('earth+wind', { el: 'earth', anim: 'rapid', dur: .78, rel: .1, cd: 1.7, cost: 18, label: 'Stone Barrage', fn(f, t) { for (let i = 0; i < 7; i++) later(i * .065, () => { if (f.state === 'cast') { spawnBall(f, t, { el: 'earth', pos: frontPos(f, .8, 1.35), speed: 34, radius: .27, dmg: 3, kb: 1, spread: rand(-.07, .07), vis: 'pebble', life: 1.5 }); Sfx.play('swing'); } }); Sfx.play('wind'); } });
def('avatar', { el: 'wind', anim: 'ult', dur: 2.1, rel: 1.05, cd: 1, cost: 0, power: 3, ult: true, label: 'Avatar State', fn(f, t) { ultRelease(f, t); } });
def('lightning', { el: 'lightning', anim: 'punch', dur: .42, rel: .15, cd: .48, fn(f, t) { spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.35), speed: 52, radius: .32, dmg: 7, kb: 2, stun: .45, vis: 'bolt', life: 1 }); Sfx.play('lightning'); } });
def('fire+lightning', { el: 'lightning', anim: 'push', dur: .7, rel: .3, cd: 2.2, cost: 22, power: 2, label: 'Plasma Beam', fn(f, t) { plasmaBeam(f, t); } });
def('lightning+water', { el: 'water', anim: 'push', dur: .55, rel: .2, cd: 2.0, cost: 20, power: 2, label: 'Storm Surge', fn(f, t) { spawnBall(f, t, { el: 'water', pos: frontPos(f, .9, 1.3), speed: 18, radius: .5, dmg: 3, kb: 2, homing: 1.6, vis: 'ewater', life: 2.4, aoe: { r: 3.4, dmg: 10, stun: .9, el: 'lightning' } }); Sfx.play('water'); Sfx.play('lightning'); } });
def('lightning+wind', { el: 'lightning', anim: 'burst', dur: .6, rel: .2, cd: 2.6, cost: 22, power: 2, label: 'Thunderstorm', fn(f, t) { thunderStrikes(f, t, 3, .32, 7, .6); Sfx.play('wind'); } });
def('earth+lightning', { el: 'earth', anim: 'lift', dur: .62, rel: .28, cd: 2.0, cost: 20, power: 2, label: 'Rail Stone', fn(f, t) { const p = frontPos(f, 1.1, -.4); spawnBall(f, t, { el: 'earth', pos: p, speed: 58, radius: .5, dmg: 16, kb: 9, knockdown: true, rise: .14, riseTo: 1.3, vis: 'railrock', life: 1.2 }); Sfx.play('earth'); later(.14, () => Sfx.play('lightning')); } });
def('r_chain', { el: 'lightning', anim: 'push', dur: .55, rel: .25, cd: 2.4, fn(f, t) { chainLightning(f, t); } });
def('r_blink', { el: 'lightning', anim: 'punch', dur: .22, rel: .06, cd: 3.2, fn(f, t) { blink(f, t); } });
def('r_storm', { el: 'lightning', anim: 'burst', dur: 1.0, rel: .4, cd: 1, power: 3, super: true, label: 'Thunder God', fn(f, t) { thunderStrikes(f, t, 8, .26, 6, .6, 2.2); Sfx.play('thunder'); } });
// ---- same-element combos: press the same element again → step 2 → step 3
def('fire2', { el: 'fire', anim: 'rapid', dur: .5, rel: .08, cd: .5, hint: 'Twin Flames', fn(f, t) { const sh = s => spawnBall(f, t, { el: 'fire', pos: frontPos(f, .9, 1.35).add(new V3(Math.cos(f.yaw) * s * .25, 0, -Math.sin(f.yaw) * s * .25)), speed: 28, radius: .32, dmg: 6, kb: 2.5, burn: .8, vis: 'fire', life: 2, spread: s * .05 }); sh(1); Sfx.play('fire'); later(.16, () => { if (f.state === 'cast') { sh(-1); Sfx.play('fire'); } }); } });
def('fire3', { el: 'fire', anim: 'kick', dur: .62, rel: .2, cd: 1.0, power: 2, hint: 'Flame Wave', fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, 1, .8), speed: 21, radius: 1.35, dmg: 12, kb: 8, knockdown: true, burn: 1.5, life: .95, vis: 'crescent', big: true }); Sfx.play('fire'); Sfx.play('wind'); shake(.15); } });
def('water2', { el: 'water', anim: 'jab', dur: .5, rel: .16, cd: .6, hint: 'Water Whip', fn(f, t) { waterWhip(f, t, 'L'); } });
def('water3', { el: 'water', anim: 'uppercut', dur: .66, rel: .24, cd: 1.1, power: 2, hint: 'Geyser', fn(f, t) { spawnGeyser(f, t); } });
def('wind2', { el: 'wind', anim: 'sweep', dur: .56, rel: .2, cd: .6, hint: 'Air Slicers', fn(f, t) { for (const sp of [-.17, .17]) spawnBall(f, t, { el: 'wind', pos: frontPos(f, .9, .7), speed: 30, radius: .7, dmg: 5, kb: 4, spread: sp, life: .9, vis: 'crescent' }); Sfx.play('wind'); } });
def('wind3', { el: 'wind', anim: 'spin', dur: .7, rel: .34, cd: 1.1, power: 2, hint: 'Gale Burst', fn(f, t) { spawnBall(f, t, { el: 'wind', pos: frontPos(f, 1, 1.1), speed: 25, radius: 1.7, dmg: 9, kb: 17, launch: 7, life: .6, vis: 'gale' }); for (let i = 0; i < 40; i++) { _v1.set(Math.sin(f.yaw), 0, Math.cos(f.yaw)).multiplyScalar(rand(8, 16)).add(_v2.randomDirection().multiplyScalar(3)); PADD.emit(f.pos.x, f.pos.y + rand(.3, 2), f.pos.z, _v1.x, _v1.y * .3, _v1.z, .8, .9, 1, rand(.5, 1), .5, 0, 2, 1.4, .3); } Sfx.play('wind'); shake(.2); } });
def('earth2', { el: 'earth', anim: 'rapid', dur: .5, rel: .1, cd: .6, hint: 'Rock Shards', fn(f, t) { const p = frontPos(f, .9, 1.25); for (const sp of [-.14, 0, .14]) spawnBall(f, t, { el: 'earth', pos: p.clone(), speed: 30, radius: .33, dmg: 4, kb: 2, spread: sp, vis: 'shard', life: 1.4 }); Sfx.play('earth'); } });
def('earth3', { el: 'earth', anim: 'hammer', dur: .72, rel: .3, cd: 1.2, power: 2, hint: 'Earth Pillars', fn(f, t) { spikeLine(f, t); } });
def('lightning2', { el: 'lightning', anim: 'push', dur: .46, rel: .14, cd: .55, hint: 'Twin Bolts', fn(f, t) { for (const sp of [-.06, .06]) spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.3), speed: 54, radius: .3, dmg: 5, kb: 1.5, stun: .3, spread: sp, vis: 'bolt', life: 1 }); Sfx.play('lightning'); } });
def('lightning3', { el: 'lightning', anim: 'lift', dur: .72, rel: .32, cd: 1.2, power: 2, hint: 'Lightning Lance', fn(f, t) { spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.6), speed: 62, radius: .5, dmg: 13, kb: 8, stun: .8, knockdown: true, vis: 'lance', life: 1 }); Sfx.play('thunder'); flashSky(); shake(.25); } });
def('r_flamekick', { el: 'fire', anim: 'kick', dur: .55, rel: .2, cd: 2.2, fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, .9, .9), speed: 21, radius: 1.0, dmg: 10, kb: 6, burn: 1.5, life: .8, vis: 'crescent' }); Sfx.play('fire'); } });
def('r_flamedash', { el: 'fire', anim: 'punch', dur: .1, rel: .05, cd: 3.5, fn(f, t) { f.startDash(aimDir(f, f.pos.clone().setY(1), t).setY(0).normalize(), 26, .32, 'fire'); } });
def('r_inferno', { el: 'fire', anim: 'burst', dur: 1.0, rel: .4, cd: 1, power: 3, super: true, label: 'Inferno Ring', fn(f, t) { spawnRing(f, t, { el: 'fire', dmg: 16, burn: 2, speed: 11, max: 26 }); Sfx.play('explode'); } });
def('r_ice', { el: 'water', anim: 'push', dur: .55, rel: .2, cd: 2.4, fn(f, t) { const p = frontPos(f, .9, 1.3); for (let i = -1; i <= 1; i++) spawnBall(f, t, { el: 'water', pos: p.clone(), speed: 26, radius: .26, dmg: 4, kb: 1.5, slow: 1.4, spread: i * .13, vis: 'ice', life: 1.6 }); Sfx.play('water'); } });
def('r_whip', { el: 'water', anim: 'push', dur: .5, rel: .2, cd: 2.6, fn(f, t) { waterWhip(f, t); } });
def('r_tsunami', { el: 'water', anim: 'stomp', dur: 1.0, rel: .4, cd: 1, power: 3, super: true, label: 'Tsunami', fn(f, t) { spawnWave(f, t, { el: 'water', speed: 12, width: 9, height: 1.25, dmg: 18, launch: 10, life: 2.6, vis: 'water' }); Sfx.play('water'); Sfx.play('explode'); } });
def('r_blades', { el: 'wind', anim: 'kick', dur: .5, rel: .18, cd: 1.8, fn(f, t) { for (const s of [-.15, .15]) spawnBall(f, t, { el: 'wind', pos: frontPos(f, .9, 1.1), speed: 28, radius: .7, dmg: 6, kb: 4, spread: s, life: 1.0, vis: 'crescent' }); Sfx.play('wind'); } });
def('r_vortex', { el: 'wind', anim: 'push', dur: .5, rel: .2, cd: 4, fn(f, t) { spawnVortex(f, t); Sfx.play('wind'); } });
def('r_hurricane', { el: 'wind', anim: 'spin', dur: 1.0, rel: .45, cd: 1, power: 3, super: true, label: 'Hurricane', fn(f, t) { spawnTornado(f, t, { el: 'wind', speed: 8, life: 4, radius: 1.8, tick: 3, big: true }); Sfx.play('wind'); Sfx.play('explode'); } });
def('r_spikes', { el: 'earth', anim: 'stomp', dur: .6, rel: .25, cd: 2.6, fn(f, t) { spawnSpikes(f, t, { delay: .7, radius: 1.6, dmg: 13 }); Sfx.play('earth'); } });
def('r_wall', { el: 'earth', anim: 'lift', dur: .6, rel: .3, cd: 5, fn(f, t) { spawnWall(f, t); Sfx.play('earth'); } });
def('r_quake', { el: 'earth', anim: 'stomp', dur: 1.4, rel: .35, cd: 1, power: 3, super: true, label: 'Earthquake', fn(f, t) { for (let i = 0; i < 3; i++) later(i * .45, () => { spawnRing(f, t, { el: 'earth', dmg: 10, speed: 12, knockdown: true, max: 24 }); Sfx.play('earth'); shake(.5); }); } });

// moves: [ability, ai-cooldown, ai-weight, min range, max range]
const RAVEN_KITS = {};
// mobility per element (as in the first version): wind is the most agile, earth the heaviest
const MOBILITY = { fire: { speed: 1, airJumps: 1, glide: false, jumpP: .3 }, water: { speed: .95, airJumps: 1, glide: false, jumpP: .3 }, wind: { speed: 1.12, airJumps: 2, glide: true, jumpP: .55 }, earth: { speed: .88, airJumps: 0, glide: false, jumpP: .12 }, lightning: { speed: 1.06, airJumps: 1, glide: false, jumpP: .35 } };
// AI usage per element: [min range, max range, weight]; pref = preferred distance
const AI_USE = { fire: { s1: [2, 22, 3], s2: [0, 5.2, 3], su: [0, 15], pref: 4.5 }, water: { s1: [1.2, 6.6, 3], s2: [2, 15, 2], su: [2, 14], pref: 5.5 }, earth: { s1: [3, 18, 3], s2: [6, 22, .4], su: [0, 14], pref: 6.5 }, wind: { s1: [2, 18, 3], s2: [0, 6.6, 2.6], su: [3, 14], pref: 6 }, lightning: { s1: [2, 24, 3], s2: [2, 12.5, 2.2], su: [3, 20], pref: 9 } };
function buildRavenKits() {
  for (const el of ELS) {
    const B = BAL.el[el], U = AI_USE[el];
    RAVEN_KITS[el] = { name: EL[el].name, basic: el, btn: [[el, EL[el].name + ' Attack'], [el + '_s1', B.s1.name], [el + '_s2', B.s2.name]], superAb: el + '_su', superR: U.su,
      desc: `<b>${B.s1.name}</b> · <b>${B.s2.name}</b> · Super: <b>${B.su.name}</b><br>Perk: ${PERK_TEXT[el]}`,
      moves: [[el, .15, 4, 2, 20], [el + '_s1', .5, U.s1[2], U.s1[0], U.s1[1]], [el + '_s2', .8, U.s2[2], U.s2[0], U.s2[1]]],
      pref: U.pref, speed: BAL.moveSpeed * MOBILITY[el].speed, aggr: .75, blockP: .45, jumpP: MOBILITY[el].jumpP, airJumps: MOBILITY[el].airJumps, glide: MOBILITY[el].glide, armor: 1, heal: 0 };
  }
}
const MASTER_KIT = { name: 'All', basic: 'mb', btn: [['mb', 'Element Attack'], ['m1', 'Skill 1'], ['m2', 'Skill 2']], superAb: 'm_su', fuse: 'mfuse', superR: [2, 12],
  desc: 'Commands all <b>six</b> elements. Normal attack (tap ×3): current element, then both, then a <b>fusion shot</b> of the current and the previous element. Every element has its <b>own</b> two skills with their own cooldowns — switch element to fire fresh ones. <b>Fusion</b> combines the last two elements you used (15 fusions).',
  moves: [['mb', .15, 3, 2.5, 18], ['m1', .5, 3, 2, 18], ['m2', .8, 2.4, 0, 12], ['mfuse', .9, 2, 0, 14]],
  pref: 6, speed: 6.4, aggr: .8, blockP: .5, jumpP: .35, airJumps: 1, glide: true, armor: 1 };

// ---------------------------------------------------------------- PROJECTILES
const PROJ = [], WALLS = [], TIMERS = [];
function later(d, fn) { TIMERS.push({ t: d, fn }); }
const VCACHE = {}; // projectile meshes are built once per look and reused (shared geometry/material)
function visMesh(vis, el) { const k = vis + ':' + el; if (!(k in VCACHE)) VCACHE[k] = buildVis(vis, el); const t = VCACHE[k]; if (!t) return null; const m = t.clone(); scene.add(m); return m; }
function buildVis(vis, el) {
  let m; const e = EL[el];
  switch (vis) {
    case 'fire': m = new THREE.Mesh(new THREE.SphereGeometry(.26, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, .95, .25) })); m.add(glowSprite(0xff7a20, 2.0, .9)); break;
    case 'water': m = new THREE.Mesh(new THREE.SphereGeometry(.36, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3d9cff, emissive: 0x0a3a7a, roughness: .08, metalness: .1, transparent: true, opacity: .85 })); m.add(glowSprite(0x3fa8ff, 1.8, .55)); break;
    case 'wind': m = new THREE.Mesh(new THREE.TorusGeometry(.55, .07, 6, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 1.8), transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })); break;
    case 'rock': m = new THREE.Mesh(rockGeo(.52, 1, rand(0, 9)), MATS.rocks[1]); break;
    case 'pebble': m = new THREE.Mesh(rockGeo(.17, 0, rand(0, 9)), MATS.rocks[0]); break;
    case 'ice_needle':
    case 'ice': m = new THREE.Mesh(new THREE.OctahedronGeometry(.17), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a6aa0, roughness: .1, metalness: .2, transparent: true, opacity: .9 })); m.scale.set(1, 1, 3.4); break;
    case 'crescent': m = new THREE.Mesh(new THREE.TorusGeometry(.85, .09, 6, 20, Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.c[0] * 1.5, e.c[1] * 1.5, e.c[2] * 1.5), transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.geometry.rotateZ(-Math.PI / 2); m.geometry.rotateY(Math.PI / 2); break;
    case 'bolt': m = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2, 2.6) })); m.add(glowSprite(0xb59cff, 1.8, .95)); break;
    case 'ewater': m = new THREE.Mesh(new THREE.SphereGeometry(.4, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3d7cff, emissive: 0x3a2a9a, roughness: .08, transparent: true, opacity: .85 })); m.add(glowSprite(0x9a8cff, 2.4, .8)); break;
    case 'railrock': m = new THREE.Mesh(rockGeo(.45, 1, rand(0, 9)), new THREE.MeshStandardMaterial({ map: T.rock_dark, emissive: 0x6a4aff, emissiveIntensity: .5, roughness: .8 })); m.add(glowSprite(0xb59cff, 2.2, .7)); break;
    case 'shard': m = new THREE.Mesh(new THREE.ConeGeometry(.16, .7, 5), MATS.rocks[0]); m.geometry.rotateX(Math.PI / 2); break;
    case 'lance': m = new THREE.Mesh(new THREE.CylinderGeometry(.06, .02, 2.2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2, 2.8) })); m.geometry.rotateX(Math.PI / 2); m.add(glowSprite(0xb59cff, 2.8, .9)); break;
    case 'gale': m = new THREE.Mesh(new THREE.TorusGeometry(1.2, .12, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 1.8), transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); break;
    case 'orb': m = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.c[0] * 1.6, e.c[1] * 1.6, e.c[2] * 1.6) })); m.add(glowSprite(e.color, 3, .8)); break;
  }
  if (m) m.castShadow = vis === 'rock' || vis === 'pebble' || vis === 'railrock';
  return m || null;
}
function killProj(p, fx = true) {
  if (p.dead) return; p.dead = true;
  if (p.fbh) { for (const h of p.fbh) if (h) h.life = Math.min(h.life, h.t + .15); p.fbh = null; }
  if (p.mesh) { scene.remove(p.mesh); if (p.kind !== 'ball') p.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (!MATS.rocks.includes(o.material)) o.material.dispose(); } else if (o.isSprite) o.material.dispose(); }); }
  if (fx && p.aoe) {
    const a = p.aoe, c = p.pos.clone(); FX.burst(c, a.el, 30, 7, 1.4); shake(.3);
    if (a.el === 'lightning') { FX.burst(c, 'water', 16, 5, 1.2); Sfx.play('lightning'); for (let i = 0; i < 7; i++) { const e = c.clone().add(_v1.randomDirection().multiplyScalar(a.r)); e.y = Math.max(e.y, groundAt(e.x, e.z) + .1); boltFX(c, e, 0xb59cff, .07, .25); } }
    else { impactFX(a.el, c, true, 1.3); Sfx.play(a.el === 'ice' ? 'water' : a.el); }
    for (const tgt of opps(p.owner)) if (capsuleDist(c, tgt) < a.r && !tgt.ghost()) applyHit(p.owner, tgt, { dmg: a.dmg, kb: 4, stun: a.stun, el: a.el, from: c });
  }
  if (fx && p.kind === 'ball') {
    const small = p.vis === 'pebble' || p.vis === 'ice' || p.vis === 'shard';
    impactFX(p.el, p.pos, p.dmg >= 45 || p.big, small ? .6 : 1);
    FX.burst(p.pos, p.el, small ? 5 : 12, 5, small ? .5 : .8);
    if (p.vis === 'rock' || p.vis === 'railrock') for (let i = 0; i < 10; i++) DEBRIS.spawn(p.pos, _v1.randomDirection().multiplyScalar(rand(3, 8)).setY(rand(2, 7)), rand(.8, 2));
  }
}
function spawnBall(f, t, o) {
  const p = Object.assign({ kind: 'ball', owner: f, target: t, t: 0, life: 1.8, homing: 0, kb: 3, launch: 0, power: AB_CUR_POWER, vis: 'fire' }, o);
  p.pos = o.pos.clone(); p.dir = aimDir(f, p.pos, t, .1);
  if (o.spread) p.dir.applyAxisAngle(_v1.set(0, 1, 0), o.spread);
  if (f.aimErr) p.dir.applyAxisAngle(_v1.set(0, 1, 0), rand(-1, 1) * f.aimErr);
  if (o.trail) p.fbh = [fb(o.trail, { follow: () => p.dead ? null : p.pos, size: o.trailSize || 1.4, loop: true })];
  if (p.rise) { p.riseFrom = p.pos.y; p.riseT = 0; }
  p.mesh = visMesh(p.vis, p.el); if (p.mesh) p.mesh.position.copy(p.pos);
  if (!o.noFx) projFX(p);
  PROJ.push(p); return p;
}
function spawnTornado(f, t, o) { const p = Object.assign({ kind: 'tornado', owner: f, target: t, t: 0, power: AB_CUR_POWER, tickT: 0 }, o); p.pos = frontPos(f, 1.4, 0); p.pos.y = f.pos.y; p.dir = aimDir(f, p.pos, t).setY(0).normalize(); PROJ.push(p); return p; }
function spawnMeteor(f, t, o) {
  const p = Object.assign({ kind: 'meteor', owner: f, target: t, t: 0, power: 2, el: 'fire' }, o);
  p.pos = f.pos.clone().setY(f.pos.y + 1.5); p.start = p.pos.clone(); p.dir = new V3();
  p.mesh = new THREE.Mesh(rockGeo(.65, 1, rand(0, 9)), new THREE.MeshStandardMaterial({ map: T.rock_dark, emissive: 0xff4a00, emissiveIntensity: .7, roughness: .9 }));
  p.mesh.add(glowSprite(0xff6a20, 3.4, .8)); p.mesh.castShadow = true; scene.add(p.mesh); PROJ.push(p);
}
function spawnWave(f, t, o) {
  const p = Object.assign({ kind: 'wave', owner: f, target: t, t: 0, power: AB_CUR_POWER }, o);
  p.pos = frontPos(f, 1.2, 0); p.pos.y = f.pos.y; p.dir = aimDir(f, p.pos, t).setY(0).normalize();
  const g = new THREE.CylinderGeometry(p.height * .6, p.height * .6, p.width, 20, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, p.vis === 'mud' ? new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: .3, metalness: .1, transparent: true, opacity: .92 }) : new THREE.MeshStandardMaterial({ color: 0x2f8cf0, emissive: 0x0a3060, roughness: .05, transparent: true, opacity: .75 }));
  m.castShadow = true; p.mesh = m; scene.add(m); PROJ.push(p); return p;
}
function spawnRing(f, t, o) {
  const p = Object.assign({ kind: 'ring', owner: f, target: t, t: 0, power: 3, R: .5, hit: false, max: 24 }, o);
  p.pos = f.pos.clone(); const e = EL[p.el];
  p.mesh = new THREE.Mesh(new THREE.TorusGeometry(1, .14, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.c[0] * 1.5, e.c[1] * 1.5, e.c[2] * 1.5), transparent: true, opacity: .9, blending: p.el === 'earth' ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false }));
  p.mesh.rotation.x = Math.PI / 2; p.mesh.position.copy(p.pos).setY(p.pos.y + .25); scene.add(p.mesh); PROJ.push(p);
}
function spawnSpikes(f, t, o) {
  const pos = t.pos.clone().addScaledVector(t.vel, .35);
  const r = Math.hypot(pos.x, pos.z); if (r > CFG.ARENA_R) pos.multiplyScalar(CFG.ARENA_R / r);
  pos.y = groundAt(pos.x, pos.z, t.pos.y + .1);
  telegraph(pos, o.radius, 0xff7a30, o.delay);
  later(o.delay, () => {
    if (game.state !== 'fight' && game.state !== 'ko') return;
    const g = new THREE.Group(); g.position.copy(pos); scene.add(g);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, rr = i ? o.radius * .55 : 0; const c = M(new THREE.ConeGeometry(.3, 1.9, 6), MATS.rocks[1], Math.cos(a) * rr, 0, Math.sin(a) * rr, g); c.rotation.set(rand(-.25, .25), 0, rand(-.25, .25)); }
    TWEENS.push({ t: 0, d: 1.1, f: k => { g.position.y = pos.y + (k < .15 ? lerp(-1.2, .8, k / .15) : k > .7 ? lerp(.8, -1.3, (k - .7) / .3) : .8) - .8; }, end: () => scene.remove(g) });
    FX.earth(pos.clone().setY(pos.y + .2), 18, o.radius); Sfx.play('earth'); shake(.35); decal(pos, 'crack', 3);
    for (const T of opps(f)) { const d = Math.hypot(T.pos.x - pos.x, T.pos.z - pos.z);
    if (d < o.radius + .3 && T.pos.y - pos.y < 1.2) applyHit(f, T, { dmg: o.dmg, kb: 2, launch: 11, el: 'earth', from: pos, heavy: true }); }
  });
}
function spawnWall(f, t, o = {}) {
  const dir = aimDir(f, f.pos.clone().setY(f.pos.y + 1), t).setY(0).normalize();
  const pos = f.pos.clone().addScaledVector(dir, 2.5); pos.y = groundAt(pos.x, pos.z, f.pos.y + .3);
  const m = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, .6, 4, 4, 1), new THREE.MeshStandardMaterial({ map: rep(T.rock_brown, 2, 1.5), roughness: .95 }));
  const pp = m.geometry.attributes.position; for (let i = 0; i < pp.count; i++) { pp.setX(i, pp.getX(i) + rand(-.06, .06)); pp.setY(i, pp.getY(i) + (pp.getY(i) > 1 ? rand(-.25, .1) : 0)); } m.geometry.computeVertexNormals();
  m.castShadow = m.receiveShadow = true; m.position.copy(pos).setY(pos.y - 1.3); m.rotation.y = Math.atan2(dir.x, dir.z); scene.add(m);
  WALLS.push({ owner: f, pos, dir, mesh: m, hp: o.hp || 30, t: 0, life: o.life || 4.5, half: 1.5, both: !!o.both }); FX.earth(pos.clone().setY(pos.y + .2), 20, 1.4); decal(pos, 'crack', 3); Sfx.play('earth'); shake(.25);
}
function spawnBlockWall(f, t, kind = 'earth') {
  if (kind === 'stone') { const w = spawnBlockWall(f, t, 'earth'); if (w) { w.mesh.scale.set(1.45, 1.35, 1.2); w.half = 1.6; w.hp = 60; fb('rock_burst', { pos: f.pos.clone().addScaledVector(new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), 1.3).setY(f.pos.y + .5), size: 2.6 }); fb('dust_puff', { pos: f.pos.clone().setY(f.pos.y + .4), size: 2.8, opacity: .8, speed: 1.6 }); } return w; }
  const dir = new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  const pos = f.pos.clone().addScaledVector(dir, 1.05); pos.y = f.pos.y;
  if (kind === 'water') {
    const geo = new THREE.CylinderGeometry(1.5, 1.7, 2.3, 28, 8, true, -1.05, 2.1); geo.translate(0, 0, -1.5);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a9cff, emissive: 0x0b3a80, emissiveIntensity: .8, roughness: .04, metalness: .1, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.y = f.yaw; m.position.copy(pos).setY(pos.y - 1.2); scene.add(m);
    const w = { owner: f, pos, dir, mesh: m, hp: 32, t: 0, life: 99, half: 1.3, h: 2.3, personal: true, water: true, base: Float32Array.from(geo.attributes.position.array) };
    WALLS.push(w); FX.burst(pos.clone().setY(pos.y + .4), 'water', 26, 5, 1.3); Sfx.play('water'); return w;
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, .45, 4, 4, 1), new THREE.MeshStandardMaterial({ map: rep(T.rock_brown, 1.5, 1.3), roughness: .95 }));
  const pp = m.geometry.attributes.position; for (let i = 0; i < pp.count; i++) { pp.setX(i, pp.getX(i) + rand(-.05, .05)); pp.setY(i, pp.getY(i) + (pp.getY(i) > .8 ? rand(-.25, .08) : 0)); pp.setZ(i, pp.getZ(i) + rand(-.05, .05)); } m.geometry.computeVertexNormals();
  m.castShadow = m.receiveShadow = true; m.rotation.y = f.yaw; m.position.copy(pos).setY(pos.y - 1.1); scene.add(m);
  const w = { owner: f, pos, dir, mesh: m, hp: 35, t: 0, life: 99, half: 1.1, h: 2.0, personal: true };
  WALLS.push(w); FX.earth(pos.clone().setY(pos.y + .2), 14, 1); Sfx.play('earth'); shake(.15); return w;
}
function spawnVortex(f, t) { const pos = t.pos.clone(); pos.y = groundAt(pos.x, pos.z, pos.y + .1); telegraph(pos, 3.4, 0xdff4ff, .45); later(.45, () => PROJ.push({ kind: 'vortex', owner: f, target: t, t: 0, life: 1.8, pos, power: 2, el: 'wind', tickT: 0 })); }
function spawnGeyser(f, t, dmg = 12) {
  const pos = t.pos.clone().addScaledVector(t.vel, .3); const r0 = Math.hypot(pos.x, pos.z); if (r0 > CFG.ARENA_R) pos.multiplyScalar(CFG.ARENA_R / r0);
  pos.y = groundAt(pos.x, pos.z, t.pos.y + .1); telegraph(pos, 1.4, 0x3fa8ff, .38); Sfx.play('water');
  later(.38, () => {
    if (game.state !== 'fight' && game.state !== 'ko') return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.55, .95, 4.5, 18, 6, true), new THREE.MeshStandardMaterial({ color: 0x3a9cff, emissive: 0x0a3070, roughness: .05, transparent: true, opacity: .75, side: THREE.DoubleSide }));
    m.position.copy(pos); scene.add(m);
    TWEENS.push({ t: 0, d: .9, f: k => { const up = k < .2 ? easeOut(k / .2) : 1; m.scale.set(1 + Math.sin(k * 40) * .05, Math.max(.01, up * (k > .7 ? 1 - (k - .7) / .3 : 1)), 1 + Math.cos(k * 40) * .05); m.position.y = pos.y + 2.25 * m.scale.y; m.material.opacity = .75 * (k > .7 ? 1 - (k - .7) / .3 : 1); m.rotation.y += .2; }, end: () => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
    for (let i = 0; i < 60; i++) PADD.emit(pos.x + rand(-.6, .6), pos.y + rand(0, 1), pos.z + rand(-.6, .6), rand(-2, 2), rand(8, 16), rand(-2, 2), .35, .8, 1.7, rand(.2, .45), rand(.5, 1), 14, .3, .05);
    FX.burst(pos.clone().setY(pos.y + .3), 'water', 12, 5, 1.2); Sfx.play('water'); shake(.3); fb('water_splash', { pos: pos.clone().setY(pos.y + 1.6), size: [2.6, 4], mode: 'up', speed: 1.2 }); fb('water_vortex', { pos: pos.clone().setY(pos.y + .1), size: 3, speed: 1.6 });
    if (Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) < 1.5 && t.pos.y - pos.y < 2) applyHit(f, t, { dmg, kb: 1, launch: 9, el: 'water', from: pos, heavy: true });
  });
}
function spikeLine(f, t, dmg = 12) {
  const dir = t.pos.clone().sub(f.pos).setY(0).normalize(); let hit = false;
  for (let i = 0; i < 9; i++) later(i * .055, () => {
    if (game.state !== 'fight' && game.state !== 'ko') return;
    const pos = f.pos.clone().addScaledVector(dir, 1.6 + i * 1.55); if (Math.hypot(pos.x, pos.z) > CFG.ARENA_R + 1) return;
    pos.y = groundAt(pos.x, pos.z, f.pos.y + .3);
    const g = new THREE.Group(); g.position.copy(pos); scene.add(g);
    for (let k = 0; k < 3; k++) { const c = M(new THREE.ConeGeometry(.32 - k * .06, 1.9 - k * .4, 6), MATS.rocks[k % 2], rand(-.35, .35), 0, rand(-.35, .35), g); c.rotation.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)); }
    TWEENS.push({ t: 0, d: 1.0, f: k => { g.position.y = pos.y + (k < .12 ? lerp(-1.6, 0, k / .12) : k > .65 ? lerp(0, -1.8, (k - .65) / .35) : 0); }, end: () => scene.remove(g) });
    FX.earth(pos.clone().setY(pos.y + .2), 4, .5); if (i % 2 === 0) { Sfx.play('earth'); decal(pos, 'crack', 1.6); fb('dust_puff', { pos: pos.clone().setY(pos.y + .5), size: 2, speed: 1.6, opacity: .8 }); }
    if (!hit && Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) < 1.2 && t.pos.y - pos.y < 1.3) { hit = true; applyHit(f, t, { dmg, kb: 3, launch: 8, el: 'earth', from: pos, heavy: true }); }
  });
  shake(.3);
}
function waterWhip(f, t, side = 'R', dmg = 9, extra = {}) {
  const from = handPos(f, side), to = t.pos.clone().setY(t.pos.y + 1); const dir = to.clone().sub(from).normalize(); const len = Math.min(from.distanceTo(to), 7);
  fb('water_stream', { pos: from.clone().addScaledVector(dir, len / 2), size: [len, 1.3], mode: 'beam', dir: dir.clone(), speed: 2.4 });
  for (let i = 0; i < 12; i++) { _v1.copy(from).addScaledVector(dir, i / 12 * len); _v1.y += Math.sin(i * .5) * .15; PADD.emit(_v1.x, _v1.y, _v1.z, rand(-.3, .3), rand(-.3, .3), rand(-.3, .3), .3, .75, 1.7, rand(.25, .4), rand(.25, .4), 3, 1, .05); }
  Sfx.play('water');
  const fwd = new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw)); const flat = t.pos.clone().sub(f.pos).setY(0); const fd = flat.length(); flat.normalize();
  if (fd < 7.1 && fwd.dot(flat) > .55) applyHit(f, t, Object.assign({ dmg, kb: -6, el: 'water', from: f.pos, pull: true }, extra));
}
function steamBurst(f, t) {
  const c = f.pos.clone().setY(f.pos.y + 1);
  for (let i = 0; i < 70; i++) { _v1.randomDirection(); _v1.y = Math.abs(_v1.y) * .6; _v1.multiplyScalar(rand(4, 9)); PADD.emit(c.x, c.y, c.z, _v1.x, _v1.y, _v1.z, 1.2, 1.2, 1.3, rand(.6, 1.2), rand(.5, .9), -1, 3, 2.2, .5); }
  FX.burst(c, 'fire', 20, 6); FX.burst(c, 'water', 20, 6, 1.4); Sfx.play('explode'); Sfx.play('water'); shake(.35);
  for (const p of PROJ) if (p.owner !== f && !p.dead && p.pos.distanceTo(c) < 3.8 && p.power < 3) killProj(p);
  f.invuln = Math.max(f.invuln, .25);
  if (t.pos.distanceTo(f.pos) < 3.8) applyHit(f, t, { dmg: 9, kb: 11, launch: 4, el: 'water', from: f.pos, heavy: true });
}
function ultRelease(f, t) {
  ELS.forEach((e, i) => {
    const a = i / 5 * Math.PI * 2; const pos = f.pos.clone().add(new V3(Math.cos(a) * 1.8, 2.2 + Math.sin(a) * .8, Math.sin(a) * 1.8));
    spawnBall(f, t, { el: e, pos, speed: 19, radius: .6, dmg: 9, kb: 5, homing: 5, power: 3, vis: 'orb', life: 3, delay: .1 + i * .12, burn: e === 'fire' ? 1.5 : 0, slow: e === 'water' ? 1.5 : 0, knockdown: i === 3 });
  });
  Sfx.play('explode');
}
// ---- lightning ribbons
const BOLTS = [];
function boltFX(a, b, color = 0xc8b8ff, width = .08, life = .18, jag = .35, seg = 0) {
  const d = _v4.copy(b).sub(a); const len = d.length(); if (len < .01) return;
  seg = seg || clamp(Math.round(len * 2.2), 3, 26); const jj = jag * Math.min(1, len / 2.5);
  const pts = []; for (let i = 0; i <= seg; i++) { const p = a.clone().addScaledVector(d, i / seg); if (i > 0 && i < seg) p.add(new V3(rand(-jj, jj), rand(-jj, jj), rand(-jj, jj))); pts.push(p); }
  const pos = new Float32Array(pts.length * 6), idx = [];
  const toCam = new V3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dir = new V3().subVectors(q, o).normalize(); toCam.subVectors(camera.position, p).normalize();
    const side = new V3().crossVectors(dir, toCam).normalize().multiplyScalar(width * (1 - .5 * Math.abs(i / seg - .5)));
    pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    if (i < pts.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; scene.add(m); BOLTS.push({ m, t: 0, life });
}
function updateBolts(dt) { for (let i = BOLTS.length - 1; i >= 0; i--) { const b = BOLTS[i]; b.t += dt; b.m.material.opacity = (1 - b.t / b.life) * (Math.random() < .25 ? .35 : 1); if (b.t >= b.life) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); BOLTS.splice(i, 1); } } }
function rayToObstacle(from, dir, maxLen) { // returns distance until an obstacle / wall / ground
  for (let d = .5; d < maxLen; d += .4) { _v4.copy(from).addScaledVector(dir, d); if (obstacleHit(_v4, .1) || _v4.y < groundAt(_v4.x, _v4.z, _v4.y) - .05) return d; for (const w of WALLS) if (wallHit(w, _v4, .1)) return d; }
  return maxLen;
}
function segDistToFighter(a, dir, len, f) { const c = f.pos.clone().setY(f.pos.y + 1); const t = clamp(c.clone().sub(a).dot(dir), 0, len); return c.distanceTo(a.clone().addScaledVector(dir, t)); }
function plasmaBeam(f, t) {
  const from = handPos(f, 'R'); const dir = aimDir(f, from, t, .05); const len = rayToObstacle(from, dir, 30); const end = from.clone().addScaledVector(dir, len);
  for (let k = 0; k < 3; k++) later(k * .07, () => { boltFX(from, end, 0xffb070, .22, .22, .12); boltFX(from, end, 0xe0d0ff, .09, .25, .3); });
  for (let i = 0; i < 40; i++) { _v1.copy(from).addScaledVector(dir, rand(0, len)); FX.fire(_v1, 1, .1, null, .8); }
  FX.burst(end, 'fire', 20, 6, 1.2); FX.lightning(end, 10, .3); Sfx.play('lightning'); Sfx.play('fire'); shake(.4);
  if (segDistToFighter(from, dir, len, t) < .8 && !t.ghost()) applyHit(f, t, { dmg: 15, kb: 9, launch: 3, burn: 1.5, stun: .3, el: 'fire', from, heavy: true, beam: true });
}
function chainLightning(f, t, o = {}) {
  const R = o.range || 15;
  const from = handPos(f, 'R'), to = t.pos.clone().setY(t.pos.y + 1.05); if (f.aimErr) { to.x += rand(-1, 1) * f.aimErr * 6; to.z += rand(-1, 1) * f.aimErr * 6; }
  const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
  const len = rayToObstacle(from, dir, Math.min(dist, R)); const end = from.clone().addScaledVector(dir, len);
  boltFX(from, end, 0xd0c4ff, .1, .3, .5); boltFX(from, end, 0x9a80ff, .05, .3, .7);
  FX.lightning(end, 12, .3); Sfx.play('lightning');
  if (len >= Math.min(dist, R) - .3 && dist <= R && segDistToFighter(from, dir, len + .3, t) < .9 && !t.ghost()) { applyHit(f, t, Object.assign({ dmg: 8, kb: 2, stun: .7, el: 'lightning', from, beam: true }, o)); fb('lightning_beam', { pos: end, size: 2 }); for (let i = 0; i < 3; i++) boltFX(end, end.clone().add(_v1.randomDirection().multiplyScalar(1.4)), 0xc8b8ff, .04, .2); }
}
function blink(f, t) {
  const from = f.pos.clone(); const toT = t.pos.clone().sub(f.pos).setY(0); const d = toT.length(); toT.normalize();
  const side = new V3(-toT.z, 0, toT.x).multiplyScalar(Math.random() < .5 ? -1 : 1);
  const dest = t.pos.clone().addScaledVector(side, 3.5).addScaledVector(toT, d > 6 ? -2 : 1.5);
  const r = Math.hypot(dest.x, dest.z); if (r > CFG.ARENA_R - .5) dest.multiplyScalar((CFG.ARENA_R - .5) / r);
  dest.y = groundAt(dest.x, dest.z, 9); pushOut(dest, .5); dest.y = groundAt(dest.x, dest.z, 9);
  boltFX(from.clone().setY(from.y + 1), dest.clone().setY(dest.y + 1), 0xd0c4ff, .12, .3, .5);
  FX.lightning(from.clone().setY(from.y + 1), 14, .5); FX.lightning(dest.clone().setY(dest.y + 1), 14, .5); FX.shock(dest.clone().setY(dest.y + 1), 'lightning', 1);
  f.pos.copy(dest); f.vel.set(0, 0, 0); f.invuln = Math.max(f.invuln, .25); f.onGround = true; Sfx.play('lightning');
}
function thunderStrikes(f, t, n, gap, dmg, stun, spread = 0, extra = {}) {
  const _bb = 1;
  const cid = f.castId;
  for (let i = 0; i < n; i++) later(i * gap, () => {
    if (game.state !== 'fight' && game.state !== 'ko') return;
    const pos = t.pos.clone().addScaledVector(t.vel, .35); if (i > 0 && spread) { pos.x += rand(-spread, spread); pos.z += rand(-spread, spread); }
    const r = Math.hypot(pos.x, pos.z); if (r > CFG.ARENA_R) pos.multiplyScalar(CFG.ARENA_R / r);
    pos.y = groundAt(pos.x, pos.z, t.pos.y + .1); telegraph(pos, 1.2, 0xb59cff, .5);
    later(.5, () => {
      const top = pos.clone().add(new V3(rand(-2, 2), 22, rand(-2, 2)));
      boltFX(top, pos, 0xd8ccff, .28, .3, 1.2); boltFX(top, pos, 0x8a70ff, .12, .35, 1.6);
      FX.burst(pos.clone().setY(pos.y + .3), 'lightning', 16, 6, 1.2); Sfx.play('thunder'); shake(.35); flashSky();
      if (Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) < 1.4 && t.pos.y - pos.y < 2.6) applyHit(f, t, Object.assign({ dmg, kb: 2, launch: 0, stun, el: 'lightning', from: pos.clone().setY(pos.y + 3), heavy: true, skill: true, castId: cid }, extra)); fb('bolt_branch', { pos: pos.clone().setY(pos.y + 3), size: [3.2, 6], mode: 'up', speed: 1.6, boost: 1.3 }); fb('lightning_orb', { pos: pos.clone().setY(pos.y + .4), size: 2.2, speed: 2 });
    });
  });
}
let SKY_FLASH = 0;
function flashSky() { SKY_FLASH = 1; }
function capsuleDist(p, f) { const y = clamp(p.y, f.pos.y + .25, f.pos.y + 1.7); return Math.hypot(p.x - f.pos.x, p.y - y, p.z - f.pos.z); }

function updateProjectiles(dt) {
  for (const p of PROJ) {
    if (p.dead) continue; p.t += dt;
    let tgt = FIGHTERS.length > 2 ? (nearestOpp(p.owner, p.pos) || p.target) : (p.owner === hero ? enemy : hero);
    if (!tgt || tgt.hp <= 0) tgt = p.owner === hero ? enemy : hero; p.target = tgt;
    if (p.kind === 'ball') {
      if (p.delay && p.t < p.delay) { FX.el(p.el, p.pos, 2, .3, null, .8); if (p.mesh) { p.mesh.position.copy(p.pos); p.mesh.scale.setScalar(p.t / p.delay); } continue; }
      if (p.rise && p.riseT < p.rise) { p.riseT += dt; p.pos.y = lerp(p.riseFrom, p.owner.pos.y + p.riseTo, ease(Math.min(1, p.riseT / p.rise))); if (p.mesh) p.mesh.position.copy(p.pos); if (p.riseT >= p.rise) p.dir = aimDir(p.owner, p.pos, tgt, .1); continue; }
      if (p.homing) { _v1.copy(tgt.pos); _v1.y += 1.0; _v1.sub(p.pos).normalize(); p.dir.lerp(_v1, Math.min(1, p.homing * dt)).normalize(); }
      p.pos.addScaledVector(p.dir, p.speed * dt);
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (p.vis === 'wind' || p.vis === 'gale' || p.vis === 'crescent' || p.vis === 'ice' || p.vis === 'shard' || p.vis === 'lance') { p.mesh.lookAt(_v1.copy(p.pos).add(p.dir)); if (p.vis === 'wind' || p.vis === 'gale') p.mesh.scale.setScalar(1 + p.t * 1.6); if (p.big && p.t < .05) p.mesh.scale.setScalar(1.6); }
        if (p.vis === 'rock' || p.vis === 'pebble') { p.mesh.rotation.x += dt * 9; p.mesh.rotation.y += dt * 5; }
        if (p.vis === 'water') { const s = 1 + Math.sin(p.t * 30) * .12; p.mesh.scale.set(s, 2 - s, s); }
      }
      const e = p.el;
      // the filmed flipbook is the projectile; code particles are only tiny accents (embers, droplets)
      if (p.vis === 'fire') { if (Math.random() < .6) PADD.emit(p.pos.x + rand(-.15, .15), p.pos.y + rand(-.15, .15), p.pos.z + rand(-.15, .15), -p.dir.x * 2 + rand(-1, 1), rand(0, 1.5), -p.dir.z * 2 + rand(-1, 1), 2, rand(.5, .9), .15, rand(.06, .12), rand(.3, .6), -1, 0, .05); }
      else if (p.vis === 'water') { if (Math.random() < .5) PADD.emit(p.pos.x, p.pos.y, p.pos.z, -p.dir.x * 2 + rand(-1, 1), rand(-1, 1), -p.dir.z * 2 + rand(-1, 1), .5, .85, 1.6, rand(.05, .1), rand(.3, .5), 6, 0, .05); }
      else if (p.vis === 'wind') { }
      else if (p.vis === 'rock') { if (Math.random() < .5) FX.earth(p.pos, 1, .3, null, .6); }
      else if (p.vis === 'ice') { if (Math.random() < .5) PADD.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, .8, 1.3, 1.8, .2, .25, 0, 0, .02, .8); }
      else if (p.vis === 'crescent') { if (p.big && e === 'fire' && Math.random() < .3) decal(p.pos, 'scorch', 1.4); }
      else if (p.vis === 'orb') FX.el(e, p.pos, 4, .35, _v1.copy(p.dir).multiplyScalar(-3), 1.3);
      else if (p.vis === 'gale') { }
      else if (p.vis === 'lance') { if (p.prev) { boltFX(p.prev, p.pos, 0xd8ccff, .16, .14, .3); boltFX(p.prev, p.pos, 0x8a70ff, .07, .16, .6); } FX.lightning(p.pos, 4, .3); }
      else if (p.vis === 'bolt' || p.vis === 'railrock') { if (p.prev) boltFX(p.prev, p.pos, 0xc8b8ff, p.vis === 'bolt' ? .06 : .09, .09, .25); if (Math.random() < .5) FX.lightning(p.pos, 2, .2); }
      else if (p.vis === 'ewater') { FX.water(p.pos, 2, .25, _v1.copy(p.dir).multiplyScalar(-3)); if (Math.random() < .35) boltFX(p.pos, _v2.copy(p.pos).add(_v3.randomDirection().multiplyScalar(.8)), 0xb59cff, .03, .08); }
      p.prev = (p.prev || new V3()).copy(p.pos);
      if (capsuleDist(p.pos, tgt) < p.radius + .36 && !tgt.ghost()) {
        const r = applyHit(p.owner, tgt, Object.assign({ dmg: p.dmg, kb: p.kb, launch: p.launch, knockdown: p.knockdown, burn: p.burn, slow: p.slow, stun: p.stun, el: p.el, from: p.pos.clone().sub(p.dir), proj: p, heavy: p.dmg >= 85 }, HX(p)));
        if (r !== 'reflect' && r !== 'deflect') killProj(p); continue;
      }
      for (const w of WALLS) if (!w.personal && (w.both || w.owner !== p.owner) && wallHit(w, p.pos, p.radius)) { w.hp -= p.dmg; w.flash = .12; FX.burst(p.pos, 'earth', 8, 4, .7); killProj(p); break; }
      if (p.dead) continue;
      if (obstacleHit(p.pos, p.radius)) { killProj(p); continue; }
      if (p.pos.y < groundAt(p.pos.x, p.pos.z, p.pos.y) - .1 && !p.rise) killProj(p);
      if (p.t > p.life || Math.hypot(p.pos.x, p.pos.z) > 40) killProj(p, false);
    } else if (p.kind === 'tornado') {
      _v1.copy(tgt.pos).setY(0).sub(_v2.copy(p.pos).setY(0)).normalize(); p.dir.lerp(_v1, Math.min(1, 1.1 * dt)).normalize();
      p.pos.addScaledVector(p.dir, p.speed * dt); p.pos.y = damp(p.pos.y, groundAt(p.pos.x, p.pos.z, p.pos.y + .6), 8, dt);
      const big = p.big ? 1.6 : 1;
      for (let i = 0; i < (p.big ? 14 : 12); i++) {
        const h = rand(0, 3.2 * big), a = p.t * 9 + rand(0, 6.28), r = (.25 + h * .32) * big, x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
        if (p.el === 'fire') PADD.emit(x, p.pos.y + h, z, -Math.sin(a) * 4, 1.5, Math.cos(a) * 4, 1.7, rand(.35, .8), .12, rand(.55, 1.0), rand(.3, .5), -2, 2, .15);
        else PADD.emit(x, p.pos.y + h, z, -Math.sin(a) * 5, 1.5, Math.cos(a) * 5, .8, .9, 1, rand(.6, 1.2), rand(.3, .5), 0, 2, 1.4, .35);
      }
      if (Math.random() < .3) FX.earth(p.pos.clone().setY(p.pos.y + .1), 1, .5, null, .7);
      const d = Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z); p.tickT -= dt;
      if (p.pull && d < p.radius * 2.2 && d > .35 && !tgt.ghost() && tgt.state !== 'dash' && tgt.pos.y - p.pos.y < 3.5) { const k = p.pull * dt * (1 - d / (p.radius * 2.2) * .5); tgt.pos.x += (p.pos.x - tgt.pos.x) / d * k; tgt.pos.z += (p.pos.z - tgt.pos.z) / d * k; }
      if (d < p.radius && tgt.pos.y - p.pos.y < 3.4 * big && p.tickT <= 0 && !tgt.ghost()) { p.tickT = p.tickRate || .2; applyHit(p.owner, tgt, Object.assign({ dmg: p.tick, kb: p.tickRate ? .3 : .5, launch: p.tickRate ? 0 : 6.5, el: p.el, from: p.pos, multi: true, noStagger: !!p.tickRate, burn: p.el === 'fire' ? .8 : 0 }, HX(p))); }
      if (p.t > p.life || Math.hypot(p.pos.x, p.pos.z) > CFG.ARENA_R + 2) killProj(p, false);
    } else if (p.kind === 'meteor') {
      const up = .5, fall = .6;
      if (p.t < up) { p.pos.lerpVectors(p.start, _v1.copy(p.start).setY(p.start.y + 10), ease(p.t / up)); FX.fire(p.pos, 4, .4, null, 1.2); }
      else {
        if (!p.land) { p.land = tgt.pos.clone().addScaledVector(tgt.vel, .55); const r = Math.hypot(p.land.x, p.land.z); if (r > CFG.ARENA_R) p.land.multiplyScalar(CFG.ARENA_R / r); p.land.y = groundAt(p.land.x, p.land.z, tgt.pos.y + .2); p.high = p.pos.clone(); telegraph(p.land, p.radius, 0xff5a20, fall); }
        const k = Math.min(1, (p.t - up) / fall); p.pos.lerpVectors(p.high, p.land, k * k); FX.fire(p.pos, 6, .45, _v1.set(0, 3, 0), 1.4);
        if (k >= 1) {
          const lp = p.land.clone().setY(p.land.y + .3);
          FX.burst(lp, 'fire', 40, 8, 1.6); FX.burst(lp, 'earth', 20, 6, 1.3); Sfx.play('explode'); shake(.7);
          const d = Math.hypot(tgt.pos.x - p.land.x, tgt.pos.z - p.land.z);
          if (d < p.radius && tgt.pos.y - p.land.y < 2) applyHit(p.owner, tgt, { dmg: p.dmg, kb: 8, launch: 7, knockdown: true, burn: 1.5, el: 'fire', from: p.land, heavy: true });
          killProj(p, false); continue;
        }
      }
      p.mesh.position.copy(p.pos); p.mesh.rotation.x += dt * 6; p.mesh.rotation.z += dt * 4;
    } else if (p.kind === 'wave') {
      p.pos.addScaledVector(p.dir, p.speed * dt); p.pos.y = damp(p.pos.y, groundAt(p.pos.x, p.pos.z, p.pos.y + .5), 10, dt);
      const grow = Math.min(1, p.t * 4), fade = p.t > p.life - .3 ? (p.life - p.t) / .3 : 1;
      p.mesh.position.copy(p.pos); p.mesh.rotation.y = Math.atan2(p.dir.x, p.dir.z); p.mesh.scale.set(1, grow * fade, 1);
      _v2.set(p.dir.z, 0, -p.dir.x);
      for (let i = 0; i < 12; i++) { const s = rand(-.5, .5) * p.width; _v1.copy(p.pos).addScaledVector(_v2, s); _v1.y = p.pos.y + rand(.2, p.height); if (p.vis === 'mud') FX.earth(_v1, 1, .2, _v3.copy(p.dir).multiplyScalar(4), .6); else FX.water(_v1, 1, .2, _v3.copy(p.dir).multiplyScalar(5).setY(2)); }
      if (Math.random() < .2) decal(p.pos, p.vis === 'mud' ? 'crack' : 'wet', 2);
      if (!p.hit && !tgt.ghost()) {
        _v1.copy(tgt.pos).sub(p.pos); const dy = _v1.y; _v1.y = 0; const along = _v1.dot(p.dir), side = Math.abs(_v1.dot(_v2));
        if (Math.abs(along) < .7 && side < p.width / 2 + .3 && dy < p.height * .85 && dy > -.5) { p.hit = true; applyHit(p.owner, tgt, Object.assign({ dmg: p.dmg, kb: p.kb ?? 6, launch: p.launch, slow: p.slow, el: p.el, from: p.pos.clone().sub(p.dir), heavy: true, push: true }, HX(p))); }
      }
      if (p.t > p.life) killProj(p, false);
    } else if (p.kind === 'ring') {
      p.R += p.speed * dt; p.mesh.scale.setScalar(p.R); p.mesh.material.opacity = .9 * (1 - p.R / p.max);
      for (let i = 0; i < 12; i++) { const a = rand(0, 6.28); _v1.set(p.pos.x + Math.cos(a) * p.R, p.pos.y + .2, p.pos.z + Math.sin(a) * p.R); FX.el(p.el, _v1, 1, .1, _v2.set(Math.cos(a) * 2, 1.5, Math.sin(a) * 2), .8); }
      const d = Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z);
      if (!p.hit && Math.abs(d - p.R) < .8 && tgt.pos.y - p.pos.y < .75 && !tgt.ghost()) { p.hit = true; applyHit(p.owner, tgt, { dmg: p.dmg, kb: 7, launch: 6, knockdown: p.knockdown, burn: p.burn, el: p.el, from: p.pos, heavy: true }); }
      if (p.R > p.max) killProj(p, false);
    } else if (p.kind === 'vortex') {
      for (let i = 0; i < 8; i++) { const a = p.t * 7 + i * .8, r = 3.4 * (1 - ((p.t * 2 + i * .13) % 1)); PADD.emit(p.pos.x + Math.cos(a) * r, p.pos.y + .2 + rand(0, 1.5), p.pos.z + Math.sin(a) * r, -Math.sin(a) * 3, .5, Math.cos(a) * 3, .8, .9, 1, .5, .25, 0, 1, .8, .35); }
      const dx = p.pos.x - tgt.pos.x, dz = p.pos.z - tgt.pos.z, d = Math.hypot(dx, dz);
      if (d < 3.6 && !tgt.ghost() && tgt.state !== 'dash') { tgt.vel.x += dx / Math.max(.3, d) * 22 * dt; tgt.vel.z += dz / Math.max(.3, d) * 22 * dt; p.tickT -= dt; if (p.tickT <= 0 && d < 1.2) { p.tickT = .35; applyHit(p.owner, tgt, { dmg: 2, kb: 0, el: 'wind', from: p.pos, multi: true, launch: 3 }); } }
      if (p.t > p.life) killProj(p, false);
    }
  }
  for (let i = 0; i < PROJ.length; i++) {
    const a = PROJ[i]; if (a.dead || a.kind !== 'ball' || (a.delay && a.t < a.delay)) continue;
    for (let j = i + 1; j < PROJ.length; j++) { const b = PROJ[j]; if (b.dead || b.kind !== 'ball' || b.owner === a.owner || (b.delay && b.t < b.delay)) continue; if (a.pos.distanceTo(b.pos) < a.radius + b.radius) clash(a, b); }
  }
  for (let i = PROJ.length - 1; i >= 0; i--) if (PROJ[i].dead) PROJ.splice(i, 1);
  for (let i = WALLS.length - 1; i >= 0; i--) {
    const w = WALLS[i]; w.t += dt; const hh = w.h || 2.5; w.mesh.position.y = w.pos.y + lerp(-hh / 2 - .05, hh / 2, ease(Math.min(1, w.t / (w.personal ? .12 : .25))));
    if (w.water) {
      const pa = w.mesh.geometry.attributes.position, b = w.base, tt = game.time;
      for (let k = 0; k < pa.count; k++) { const x = b[k * 3], y = b[k * 3 + 1], z = b[k * 3 + 2], hk = (y + 1.15) / 2.3; pa.setXYZ(k, x, y + Math.sin(tt * 6 + x * 3) * .06 * hk, z + Math.sin(tt * 5 + y * 3 + x * 2) * .08 + hk * hk * .35); }
      pa.needsUpdate = true; w.mesh.geometry.computeVertexNormals();
      for (let k = 0; k < 4; k++) { const a = rand(-1, 1), lx = Math.sin(a) * 1.55, lz = Math.cos(a) * 1.55 - 1.5 + .35; const cy = Math.cos(w.mesh.rotation.y), sy = Math.sin(w.mesh.rotation.y); PADD.emit(w.mesh.position.x + lx * cy + lz * sy, w.mesh.position.y + 1.15, w.mesh.position.z - lx * sy + lz * cy, rand(-.5, .5), rand(.5, 2), rand(-.5, .5), .7, .9, 1.5, rand(.2, .4), .4, 6, .5, .05); }
    }
    if (w.release) { w.relT = (w.relT || 0) + dt; w.mesh.position.y -= w.relT * 9; if (w.relT > .25) { scene.remove(w.mesh); w.mesh.geometry.dispose(); WALLS.splice(i, 1); continue; } }
    if (w.hp <= 0 || w.t > w.life) { if (w.personal && w.owner.blockWall === w) w.owner.blockWall = null; FX.burst(w.pos.clone().setY(w.pos.y + 1), 'earth', 30, 6, 1.5); Sfx.play('earth'); for (let k = 0; k < 12; k++) DEBRIS.spawn(w.pos.clone().setY(w.pos.y + rand(.3, 2.3)), _v1.randomDirection().multiplyScalar(rand(2, 6)).setY(rand(2, 6)), rand(1, 2.4)); scene.remove(w.mesh); w.mesh.geometry.dispose(); WALLS.splice(i, 1); }
  }
}
const HX = p => ({ skill: p.skill, castId: p.castId, slowPct: p.slowPct, seal: p.seal, freeze: p.freeze, root: p.root, needle: p.needle, wet: p.wet });
function wallHit(w, pos, r) { _v4.copy(pos).sub(w.pos); const along = _v4.dot(w.dir); const sx = w.dir.z, sz = -w.dir.x; const side = _v4.x * sx + _v4.z * sz; return Math.abs(along) < .3 + r && Math.abs(side) < w.half + r * .5 && _v4.y < 2.5 && w.t > .15; }
function clash(a, b) {
  let win = null;
  if (a.power !== b.power) win = a.power > b.power ? a : b;
  else if (a.el !== b.el) { if (BEATS[a.el] === b.el) win = a; else if (BEATS[b.el] === a.el) win = b; }
  const mid = a.pos.clone().add(b.pos).multiplyScalar(.5);
  FX.burst(mid, a.el, 16, 5); FX.burst(mid, b.el, 16, 5); Sfx.play('clash'); shake(.2);
  if (win) { const lose = win === a ? b : a; killProj(lose, false); win.dmg = Math.round(win.dmg * .75); popText(mid, `${EL[win.el].icon} ${EL[win.el].name} wins!`, '#ffe9a0', 20); }
  else { killProj(a, false); killProj(b, false); popText(mid, 'CLASH!', '#fff', 20); }
}

// ---------------------------------------------------------------- RAVEN ELEMENT KITS (numbers come from BAL)
let CAST_ID = 0;
const SK = (f, o) => Object.assign({ skill: true, castId: f.castId }, o);
const fwdOf = f => new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
function coneHit(f, t, range, half, dmg, extra = {}) {
  let any = false;
  for (const T of (FIGHTERS.length > 2 ? opps(f) : [t])) {
    if (!T || T.ghost()) continue;
    const to = T.pos.clone().sub(f.pos); const dy = to.y; to.y = 0; const d = to.length();
    if (d > range || Math.abs(dy) > 2.2) continue;
    if (d > .6 && fwdOf(f).dot(to.normalize()) < Math.cos(half)) continue;
    if (losBlocked(f.pos, T.pos, 1.3)) continue;
    applyHit(f, T, SK(f, Object.assign({ dmg, from: f.pos.clone() }, extra))); any = true;
  }
  return any;
}
function aimPoint(f, t, lead = 0) { // AI aim error makes targeted skills miss sometimes
  const p = t.pos.clone().addScaledVector(t.vel, lead); const e = f.aimErr || 0;
  if (e) { p.x += rand(-1, 1) * e * 9; p.z += rand(-1, 1) * e * 9; }
  const r = Math.hypot(p.x, p.z); if (r > CFG.ARENA_R) p.multiplyScalar(CFG.ARENA_R / r);
  p.y = groundAt(p.x, p.z, t.pos.y + .1); return p;
}
function buildKits() {
  buildRavenKits();
  const B = BAL.el;
  // fire
  def('fire_s1', { el: 'fire', clip: 'magic1h', anim: 'punch', hit: .3, speed: 1.7, dur: .72, cd: B.fire.s1.cd, label: B.fire.s1.name, fn(f, t) { spawnBall(f, t, SK(f, { el: 'fire', pos: frontPos(f, .9, 1.35), speed: 30, radius: .45, dmg: B.fire.s1.dmg, kb: 4, vis: 'fire', life: 2, trail: 'fire_loop' })); Sfx.play('fire'); } });
  def('fire_s2', { el: 'fire', clip: 'combo_punch', anim: 'rapid', hit: .22, speed: 1.8, dur: 1.3, cd: B.fire.s2.cd, label: B.fire.s2.name, fn(f, t) {
    const n = 4, per = B.fire.s2.dmg / n;
    for (let i = 0; i < n; i++) later(i * .2, () => {
      if (f.state !== 'cast' || !f.cast || f.cast.a.name !== 'fire_s2') return;
      const fw = fwdOf(f);
      for (let k = 1; k <= 3; k++) fb('fire_burst', { pos: f.pos.clone().addScaledVector(fw, k * 1.55).setY(f.pos.y + 1.25), size: .9 + k * .65, speed: 1.6, boost: 1.2 });
      for (let k = 0; k < 14; k++) PADD.emit(f.pos.x + fw.x, f.pos.y + 1.3, f.pos.z + fw.z, fw.x * rand(8, 14) + rand(-2, 2), rand(-1, 2), fw.z * rand(8, 14) + rand(-2, 2), 1.8, rand(.5, .9), .12, rand(.4, .8), rand(.25, .4), -2, 2, .1);
      coneHit(f, t, B.fire.s2.range, .7, per, { kb: 1.6, el: 'fire', heavy: i === n - 1 }); Sfx.play('fire');
    });
  } });
  def('fire_su', { el: 'fire', clip: 'magic2h3', anim: 'burst', hit: 1.0, speed: 1.9, dur: 1.75, cd: 1, super: true, power: 3, label: B.fire.su.name,
    onStart(f, t) { f.suP = aimPoint(f, t, .35); telegraph(f.suP, B.fire.su.radius, 0xff5a20, B.fire.su.warn); },
    fn(f, t) { const P = f.suP, s = B.fire.su;
      fb('explosion', { pos: P.clone().setY(P.y + 2.6), size: 8.5 }); fb('fire_burst', { pos: P.clone().setY(P.y + 1.4), size: 6.5, boost: 1.3 });
      FX.burst(P.clone().setY(P.y + .5), 'fire', 50, 9, 1.8); decal(P, 'scorch', 6); Sfx.play('explode'); shake(.8); flashSky();
      for (const T of opps(f)) if (Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < s.radius && T.pos.y - P.y < 2.5) applyHit(f, T, SK(f, { dmg: s.dmg, kb: 9, launch: 7, knockdown: true, el: 'fire', from: P, heavy: true })); } });
  // water
  def('water_s1', { el: 'water', clip: 'magic2h', anim: 'push', hit: .3, speed: 1.7, dur: .75, cd: B.water.s1.cd, label: B.water.s1.name, fn(f, t) {
    const from = handPos(f, 'R'), fw = fwdOf(f), len = B.water.s1.range;
    fb('water_stream', { pos: from.clone().addScaledVector(fw, len / 2), size: [len, 1.6], mode: 'beam', dir: fw.clone(), speed: 2.2 });
    for (let i = 0; i < 16; i++) { const k = i / 16 * len; _v1.copy(from).addScaledVector(fw, k); PADD.emit(_v1.x, _v1.y, _v1.z, rand(-.4, .4), rand(-.3, .5), rand(-.4, .4), .3, .78, 1.7, rand(.2, .35), rand(.2, .35), 3, 1, .05); }
    Sfx.play('water');
    if (coneHit(f, t, len, .34, B.water.s1.dmg, { kb: -4, el: 'water' })) fb('water_splash', { pos: t.pos.clone().setY(t.pos.y + 1.1), size: 2.6 });
  } });
  def('water_s2', { el: 'water', clip: 'magic_area', anim: 'stomp', hit: .36, speed: 1.6, dur: .9, cd: B.water.s2.cd, label: B.water.s2.name, fn(f, t) { const p = spawnWave(f, t, SK(f, { el: 'water', speed: 14, width: 3.2, height: 1.15, dmg: B.water.s2.dmg, kb: B.water.s2.push, launch: 0, life: 1.6, vis: 'water' })); p.fbh = [fb('water_wave', { follow: () => p.dead ? null : p.pos, off: new V3(0, 1.1, 0), size: 3.4, loop: true })]; Sfx.play('water'); } });
  def('water_su', { el: 'water', clip: 'magic2h3', anim: 'stomp', hit: 1.0, speed: 1.9, dur: 1.75, cd: 1, super: true, power: 3, label: B.water.su.name, fn(f, t) {
    const s = B.water.su, p = spawnWave(f, t, SK(f, { el: 'water', speed: 11, width: 10, height: 1.45, dmg: s.dmg, kb: 6, launch: 0, slow: s.slowDur, slowPct: s.slow, life: 2.4, vis: 'water' }));
    p.fbh = [-3.2, 0, 3.2].map(o => fb('water_wave', { follow: () => p.dead ? null : _v4.copy(p.pos).addScaledVector(_v3.set(p.dir.z, 0, -p.dir.x), o), off: new V3(0, 1.6, 0), size: 4.4, loop: true }));
    Sfx.play('water'); Sfx.play('explode'); shake(.3);
  } });
  // earth
  def('earth_s1', { el: 'earth', clip: 'magic2h', anim: 'lift', hit: .38, speed: 1.5, dur: .82, cd: B.earth.s1.cd, label: B.earth.s1.name, fn(f, t) { const p = frontPos(f, 1.1, -.4); spawnBall(f, t, SK(f, { el: 'earth', pos: p, speed: B.earth.s1.speed, radius: .62, dmg: B.earth.s1.dmg, kb: 6, rise: .15, riseTo: 1.4, vis: 'rock', life: 2.6 })); Sfx.play('earth'); FX.earth(p.clone().setY(f.pos.y + .1), 10, .5); } });
  def('earth_s2', { el: 'earth', clip: 'power_up', anim: 'lift', hit: .3, speed: 1.5, dur: .72, cd: B.earth.s2.cd, label: B.earth.s2.name, fn(f, t) { spawnWall(f, t, { hp: B.earth.s2.hp, life: B.earth.s2.dur, both: true }); f.sts.fort = BAL.el.earth.perk.dur; popText(f.pos.clone().setY(f.pos.y + 2.4), 'FORTIFIED', '#e8c890', 18); } });
  def('earth_su', { el: 'earth', clip: 'magic_area', anim: 'stomp', hit: .8, speed: 1.3, dur: 1.5, cd: 1, super: true, power: 3, label: B.earth.su.name,
    onStart(f, t) { f.suP = aimPoint(f, t, .3); telegraph(f.suP, B.earth.su.radius, 0xc08040, B.earth.su.warn); },
    fn(f, t) { const P = f.suP, s = B.earth.su; const g = new THREE.Group(); g.position.copy(P); scene.add(g);
      for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, rr = i ? rand(.5, 1) * s.radius * .8 : 0; const c = M(new THREE.ConeGeometry(rand(.3, .5), rand(1.6, 2.8), 6), MATS.rocks[i % 2], Math.cos(a) * rr, 0, Math.sin(a) * rr, g); c.rotation.set(rand(-.35, .35), 0, rand(-.35, .35)); }
      TWEENS.push({ t: 0, d: 1.3, f: k => { g.position.y = P.y + (k < .1 ? lerp(-2.4, 0, k / .1) : k > .7 ? lerp(0, -2.6, (k - .7) / .3) : 0); }, end: () => scene.remove(g) });
      FX.burst(P.clone().setY(P.y + .4), 'earth', 24, 8, 2); decal(P, 'crack', 6); Sfx.play('earth'); Sfx.play('explode'); shake(.8); fb('crater', { pos: P.clone().setY(P.y + .3), size: 6, speed: .9 }); fb('dust_wave', { pos: P.clone().setY(P.y + .8), size: [8, 3.5], mode: 'up', speed: 1.2 }); fb('rock_burst', { pos: P.clone().setY(P.y + 1), size: 5 });
      for (const T of opps(f)) if (Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < s.radius && T.pos.y - P.y < 1.6) applyHit(f, T, SK(f, { dmg: s.dmg, kb: 2, launch: 9, lift: true, el: 'earth', from: P, heavy: true })); } });
  // wind
  def('wind_s1', { el: 'wind', clip: 'kick2', anim: 'kick', hit: .22, speed: 1.8, dur: .58, cd: B.wind.s1.cd, label: B.wind.s1.name, fn(f, t) { spawnBall(f, t, SK(f, { el: 'wind', pos: frontPos(f, .9, 1.05), speed: 36, radius: .75, dmg: B.wind.s1.dmg, kb: 3, life: .9, vis: 'crescent' })); Sfx.play('wind'); } });
  def('wind_s2', { el: 'wind', clip: 'hurricane', anim: 'spin', hit: .32, speed: 1.6, dur: .85, cd: B.wind.s2.cd, label: B.wind.s2.name, fn(f, t) {
    const fw = fwdOf(f);
    for (let i = 0; i < 60; i++) { const a = rand(-.7, .7); const d = _v1.copy(fw).applyAxisAngle(_v2.set(0, 1, 0), a).multiplyScalar(rand(10, 18)); PADD.emit(f.pos.x, f.pos.y + rand(.3, 2), f.pos.z, d.x, rand(-.5, 1), d.z, .85, .92, 1, rand(.5, 1.1), rand(.3, .45), 0, 2.5, 1.3, .32); }
    FX.shock(f.pos.clone().addScaledVector(fw, 2).setY(f.pos.y + 1), 'wind', 1.6); Sfx.play('wind'); fb('dust_wave', { pos: f.pos.clone().addScaledVector(fw, 3).setY(f.pos.y + .6), size: [6, 3], mode: 'up', speed: 1.4, opacity: .8 }); for (let k = 1; k <= 3; k++) fb('water_vortex', { pos: f.pos.clone().addScaledVector(fw, k * 1.8).setY(f.pos.y + 1.1), size: 1.4 + k * .5, desat: 1, tint: 0xe8f4ff, opacity: .6, speed: 1.6 });
    coneHit(f, t, B.wind.s2.range, .7, B.wind.s2.dmg, { kb: B.wind.s2.push, launch: 2, el: 'wind', push: true });
  } });
  def('wind_su', { el: 'wind', clip: 'magic2h3', anim: 'spin', hit: 1.0, speed: 1.9, dur: 1.75, cd: 1, super: true, power: 3, label: B.wind.su.name, fn(f, t) { const s = B.wind.su; const ticks = Math.round(s.dur / .25); const p = spawnTornado(f, t, SK(f, { el: 'wind', speed: 4.2, life: s.dur, radius: 1.9, tick: s.dmg / ticks, tickRate: .25, pull: s.pull, big: true })); p.fbh = [fb('tornado', { follow: () => p.dead ? null : p.pos, off: new V3(0, 2.2, 0), size: [3.6, 5], loop: true, mode: 'up' })]; telegraph(p.pos, 1.9, 0xdff4ff, .4); Sfx.play('wind'); Sfx.play('explode'); } });
  // lightning
  def('lightning_s1', { el: 'lightning', clip: 'magic1h', anim: 'punch', hit: .3, speed: 1.7, dur: .7, cd: B.lightning.s1.cd, label: B.lightning.s1.name, fn(f, t) { spawnBall(f, t, SK(f, { el: 'lightning', pos: frontPos(f, .9, 1.35), speed: B.lightning.s1.speed, radius: .38, dmg: B.lightning.s1.dmg, kb: 2, stun: B.lightning.s1.stun, vis: 'bolt', life: 1, trail: 'lightning_orb', trailSize: 1.1 })); Sfx.play('lightning'); } });
  def('lightning_s2', { el: 'lightning', clip: 'magic2h', anim: 'push', hit: .45, speed: 1.5, dur: .9, cd: B.lightning.s2.cd, label: B.lightning.s2.name,
    onStart(f) { for (const s of ['L', 'R']) fb('lightning_orb', { follow: () => f.state === 'cast' ? handPos(f, s) : null, size: .8, loop: true, life: .5 }); },
    fn(f, t) { const s = B.lightning.s2; chainLightning(f, t, SK(f, { dmg: s.dmg, stun: s.stun, range: s.range })); } });
  def('lightning_su', { el: 'lightning', clip: 'magic2h3', anim: 'burst', hit: 1.0, speed: 1.9, dur: 1.75, cd: 1, super: true, power: 3, label: B.lightning.su.name, fn(f, t) { const s = B.lightning.su; thunderStrikes(f, t, s.strikes, .38, s.dmg / s.strikes, .35, 1.2); Sfx.play('thunder'); } });
}

// ---------------------------------------------------------------- KAZAN — Lord of Magma (legendary fighter; numbers from the user's sheet)
BAL.chars = {
  raven: { hp: BAL.hp, speedMul: 1, dashCD: 1.2, combo: BAL.combo, height: 1.85 },
  kazan: { hp: 1050, speedMul: .95, dashCD: 2, combo: [30, 35, 55], height: 1.95,
    heat: { max: 3, dur: 6, bonus: 20, slow: .15, slowDur: 2 },
    s1: { name: 'Magma Fist', dmg: 100, punch: 60, blast: 40, cd: 8, windup: .45, recover: .4, range: 2.8, blastR: 2.0 },
    s2: { name: 'Volcanic Fissure', dmg: 65, cd: 12, warn: .8, length: 11, width: 1.8, lavaDur: 3, lavaDps: 15 },
    su: { name: 'Crater of Wrath', dmg: 170, warn: 1.2, radius: 3.4, minDist: 3, maxDist: 8, lavaDur: 3, lavaDps: 20 },
    maxLava: 2, lavaTick: .5 },
};
const KZ = BAL.chars.kazan;
const KAZAN_PERK_TEXT = `Skill hits build <b>Magma Heat</b> (max 3, 6 s). At 3 stacks the 3rd combo hit becomes <b>Molten</b>: +${KZ.heat.bonus} damage and ${Math.round(KZ.heat.slow * 100)}% slow for ${KZ.heat.slowDur} s (stacks are spent even on a miss).`;
const KAZAN_KIT = { name: 'Magma', basic: 'magma', btn: [['magma', 'Magma Attack'], ['kz_s1', KZ.s1.name], ['kz_s2', KZ.s2.name]], superAb: 'kz_su', superR: [2.5, 8.5],
  desc: `<b>${KZ.s1.name}</b> · <b>${KZ.s2.name}</b> · Super: <b>${KZ.su.name}</b><br>Perk: ${KAZAN_PERK_TEXT}`,
  moves: [['magma', .15, 3.5, 2.5, 18], ['kz_s1', .6, 3, 0, 3.0], ['kz_s2', .9, 2.4, 3, 10.5]], pref: 2.8, speed: BAL.moveSpeed * KZ.speedMul, aggr: .85, blockP: .4, jumpP: .1, airJumps: 1, glide: false, armor: 1, heal: 0 };

// ---- lava zones (only hurt while standing inside; overlapping zones never stack; max 2 per Kazan)
const LAVA = [];
let LAVA_TEX = null;
function lavaTex() { if (!LAVA_TEX) { LAVA_TEX = new THREE.TextureLoader().load('assets/lava.jpg'); LAVA_TEX.wrapS = LAVA_TEX.wrapT = THREE.RepeatWrapping; LAVA_TEX.colorSpace = THREE.SRGBColorSpace; } return LAVA_TEX; }
const LAVA_FS = `uniform sampler2D map; uniform float t, fade, circ; uniform vec2 rep; uniform vec3 tintc; varying vec2 vUv;
void main(){ vec2 uv = vUv * rep; vec3 c = texture2D(map, uv + vec2(t * .03, t * .02)).rgb; vec3 c2 = texture2D(map, uv * 1.7 - vec2(t * .02, -t * .025)).rgb;
  vec3 col = mix(c, c2, .4); float hot = smoothstep(.25, .9, col.r - col.g * .5); col = (col * 1.4 + vec3(1., .35, .05) * hot * (1.2 + .4 * sin(t * 3.))) * tintc;
  float e; if (circ > .5) { e = 1. - smoothstep(.72, 1., length(vUv - .5) * 2.); } else { vec2 d = abs(vUv - .5) * 2.; e = (1. - smoothstep(.6, 1., d.y)) * (1. - smoothstep(.93, 1., d.x)); }
  gl_FragColor = vec4(col, e * fade); }`;
const LAVA_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
function lavaMesh(geo, rep, circ) {
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { map: { value: lavaTex() }, t: { value: 0 }, fade: { value: 0 }, circ: { value: circ ? 1 : 0 }, rep: { value: new THREE.Vector2(...rep) }, tintc: { value: new THREE.Color(1, 1, 1) } }, vertexShader: LAVA_VS, fragmentShader: LAVA_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.renderOrder = 3; scene.add(m); return m;
}
function addLava(owner, z) {
  const mine = LAVA.filter(l => l.owner === owner); if (!owner.isEnv && mine.length >= KZ.maxLava) removeLava(mine[0]);
  if (z.kind === 'line') {
    const len = z.a.distanceTo(z.b), geo = new THREE.PlaneGeometry(len, z.w); geo.rotateX(-Math.PI / 2);
    z.mesh = lavaMesh(geo, [len / 3, z.w / 3], false); z.mesh.position.set((z.a.x + z.b.x) / 2, Math.max(z.a.y, z.b.y) + .04, (z.a.z + z.b.z) / 2); z.mesh.rotation.y = -Math.atan2(z.b.z - z.a.z, z.b.x - z.a.x);
  } else { const geo = new THREE.CircleGeometry(z.r, 40); geo.rotateX(-Math.PI / 2); z.mesh = lavaMesh(geo, [z.r / 1.6, z.r / 1.6], true); z.mesh.position.set(z.c.x, z.c.y + .04, z.c.z); }
  Object.assign(z, { owner, t: 0 }); LAVA.push(z);
  later(0, () => { if (z.mud) z.mesh.material.uniforms.tintc.value.setRGB(.42, .3, .18); if (z.zap) z.mesh.material.uniforms.tintc.value.setRGB(.25, .55, 1.3); });
  return z;
}
function removeLava(z) { const i = LAVA.indexOf(z); if (i >= 0) LAVA.splice(i, 1); scene.remove(z.mesh); z.mesh.geometry.dispose(); z.mesh.material.dispose(); }
function inZone(z, p) {
  if (z.kind === 'line') { const ax = z.a.x, az = z.a.z, dx = z.b.x - ax, dz = z.b.z - az, L2 = dx * dx + dz * dz; const k = clamp(((p.x - ax) * dx + (p.z - az) * dz) / L2, 0, 1); return Math.hypot(p.x - ax - dx * k, p.z - az - dz * k) < z.w / 2 + .15 && p.y - z.a.y < .5; }
  return Math.hypot(p.x - z.c.x, p.z - z.c.z) < z.r && p.y - z.c.y < .5;
}
function updateLava(dt) {
  for (const z of [...LAVA]) {
    z.t += dt; const u = z.mesh.material.uniforms; u.t.value = game.time; u.fade.value = Math.min(1, z.t / .25) * Math.min(1, (z.dur - z.t) / .5);
    if (Math.random() < .5) { const p = z.kind === 'line' ? _v1.lerpVectors(z.a, z.b, Math.random()) : _v1.copy(z.c).add(_v2.set(rand(-1, 1) * z.r * .7, 0, rand(-1, 1) * z.r * .7)); FX.fire(_v3.copy(p).setY(p.y + .15), 1, .25, _v4.set(0, 1.5, 0), .7); }
    if (z.t >= z.dur) removeLava(z);
  }
  for (const tgt of FIGHTERS) {
    if (!tgt || tgt.hp <= 0 || tgt.ghost()) continue;
    let best = null; for (const z of LAVA) if (z.owner !== tgt && z.t > .15 && inZone(z, tgt.pos) && (!best || z.dps > best.dps)) best = z; // highest zone only, never summed
    if (!best) { tgt.lavaAcc = 0; continue; }
    if (best.slowPct) { tgt.slowT = Math.max(tgt.slowT, .35); tgt.slowPct = Math.min(.3, best.slowPct); }
    if (!best.dps) continue;
    tgt.lavaAcc = (tgt.lavaAcc || 0) + dt;
    if (tgt.lavaAcc >= KZ.lavaTick) { tgt.lavaAcc -= KZ.lavaTick; applyHit(best.owner, tgt, { dmg: best.dps * KZ.lavaTick, kb: 0, el: best.zap ? 'lightning' : 'fire', from: tgt.pos.clone().setY(tgt.pos.y - 1), multi: true, noStagger: true, unblockable: true, lava: true }); }
  }
}
function clearLava() { for (const z of [...LAVA]) removeLava(z); }
function telegraphLine(a, b, w, color, dur) {
  const len = a.distanceTo(b), g = new THREE.Group();
  const mk = (W, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, W), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; g.add(m); return m; };
  const fill = mk(w, .2), edge1 = mk(.08, .9), edge2 = mk(.08, .9); edge1.position.z = w / 2; edge2.position.z = -w / 2;
  g.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) + .05, (a.z + b.z) / 2); g.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); scene.add(g);
  TELES.push({ line: true, ax: a.x, az: a.z, bx: b.x, bz: b.z, w, end: game.time + dur });
  TWEENS.push({ t: 0, d: dur, f: k => { fill.scale.x = Math.max(.01, k); fill.position.x = -len / 2 * (1 - k); edge1.material.opacity = edge2.material.opacity = .5 + .5 * Math.sin(k * 30); }, end: () => { scene.remove(g); g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); } });
}
function teleHit(T, x, z, pad = .6) { if (!T.line) return Math.hypot(x - T.x, z - T.z) < T.r + pad; const dx = T.bx - T.ax, dz = T.bz - T.az, L2 = dx * dx + dz * dz || 1, k = clamp(((x - T.ax) * dx + (z - T.az) * dz) / L2, 0, 1); return Math.hypot(x - T.ax - dx * k, z - T.az - dz * k) < T.w / 2 + pad; }
function teleAway(T, x, z) { if (!T.line) return new V3(x - T.x, 0, z - T.z); const dx = T.bx - T.ax, dz = T.bz - T.az; const side = (x - T.ax) * dz - (z - T.az) * dx; return new V3(dz, 0, -dx).multiplyScalar(side >= 0 ? 1 : -1); }

function kazanFx(p, big) { fb('fire_burst', { pos: p.clone().setY(p.y + (big ? 1.4 : .9)), size: big ? 4.5 : 2.4, boost: 1.2 }); fb('fire_ring', { pos: p.clone().setY(p.y + .12), size: big ? 7 : 3.2, speed: 1.4 }); FX.burst(p.clone().setY(p.y + .4), 'fire', big ? 40 : 18, big ? 8 : 5, big ? 1.6 : 1); FX.earth(p.clone().setY(p.y + .2), big ? 20 : 8, big ? 2 : 1); for (let i = 0; i < (big ? 12 : 5); i++) DEBRIS.spawn(p.clone().setY(p.y + .3), _v1.randomDirection().multiplyScalar(rand(3, 7)).setY(rand(3, 8)), rand(.8, 1.8)); }
function buildKazanKit() {
  def('kz_s1', { el: 'fire', clip: 'magic1h', anim: 'punch', hit: KZ.s1.windup, speed: 1, dur: KZ.s1.windup + .3, cd: KZ.s1.cd, label: KZ.s1.name,
    onStart(f) { f.vel.addScaledVector(fwdOf(f), 3.5); fb('fire_loop', { follow: () => f.state === 'cast' ? handPos(f, 'L') : null, size: 1.1, loop: true, life: KZ.s1.windup + .1 }); },
    fn(f, t) {
      const fw = fwdOf(f), fist = f.pos.clone().addScaledVector(fw, 1.5); Sfx.play('heavy'); Sfx.play('fire');
      const hit1 = coneHit(f, t, KZ.s1.range, .75, KZ.s1.punch, { kb: 2, el: 'fire', heavy: true });
      later(.12, () => { if (game.state !== 'fight' && game.state !== 'ko') return; kazanFx(fist, false); Sfx.play('explode'); shake(.3);
        let hit2 = false; for (const T of opps(f)) if (!T.ghost() && Math.hypot(T.pos.x - fist.x, T.pos.z - fist.z) < KZ.s1.blastR && Math.abs(T.pos.y - fist.y) < 2) { applyHit(f, T, SK(f, { dmg: KZ.s1.blast, kb: 6, launch: 3, el: 'fire', from: fist, heavy: true })); hit2 = true; }
        if (!hit1 && !hit2 && f.cast) f.cast.dur = f.cast.a.dur + KZ.s1.recover; }); // a whiff leaves Kazan open
    } });
  def('kz_s2', { el: 'fire', clip: 'magic_area', anim: 'stomp', hit: .5, speed: 1.4, dur: .95, cd: KZ.s2.cd, label: KZ.s2.name,
    fn(f, t) {
      const aim = aimPoint(f, t, .2), dir = aim.sub(f.pos).setY(0).normalize(); if (dir.lengthSq() < .01) dir.copy(fwdOf(f));
      const a = f.pos.clone().addScaledVector(dir, .8), b = f.pos.clone().addScaledVector(dir, .8 + KZ.s2.length); const r = Math.hypot(b.x, b.z); if (r > CFG.ARENA_R) b.multiplyScalar(CFG.ARENA_R / r);
      a.y = groundAt(a.x, a.z, f.pos.y + .2); b.y = a.y;
      kazanFx(f.pos.clone().addScaledVector(dir, .9), false); decal(a, 'crack', 2); Sfx.play('earth'); shake(.25);
      telegraphLine(a, b, KZ.s2.width, 0xff5a1a, KZ.s2.warn); const cid = f.castId;
      later(KZ.s2.warn, () => {
        if (game.state !== 'fight' && game.state !== 'ko') return;
        const n = 6; for (let i = 0; i <= n; i++) later(i * .04, () => { const p = new V3().lerpVectors(a, b, i / n); fb('fire_burst', { pos: p.clone().setY(p.y + 1), size: 2.3, boost: 1.1 }); FX.earth(p.clone().setY(p.y + .2), 4, .6); if (i % 2 === 0) decal(p, 'scorch', 2.2); });
        Sfx.play('explode'); Sfx.play('fire'); shake(.4);
        const z = addLava(f, { kind: 'line', a, b, w: KZ.s2.width, dur: KZ.s2.lavaDur, dps: KZ.s2.lavaDps });
        for (const T of opps(f)) if (!T.ghost() && inZone(z, T.pos)) applyHit(f, T, { dmg: KZ.s2.dmg, kb: 3, launch: 5, el: 'fire', from: T.pos.clone().setY(T.pos.y - 1), heavy: true, skill: true, castId: cid, unblockable: false });
      });
    } });
  def('kz_su', { el: 'fire', clip: 'magic2h3', anim: 'burst', hit: KZ.su.warn, speed: 1.6, dur: KZ.su.warn + .45, cd: 1, super: true, power: 3, label: KZ.su.name,
    onStart(f, t) { // the circle is placed once in front of Kazan and does NOT follow the target
      const fw = fwdOf(f), d = clamp(Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) + (f.aimErr ? rand(-1, 1) * f.aimErr * 8 : 0), KZ.su.minDist, KZ.su.maxDist);
      const P = f.pos.clone().addScaledVector(fw, d); const r = Math.hypot(P.x, P.z); if (r > CFG.ARENA_R - 1) P.multiplyScalar((CFG.ARENA_R - 1) / r);
      P.y = groundAt(P.x, P.z, f.pos.y + .3); f.suP = P; telegraph(P, KZ.su.radius, 0xff3a10, KZ.su.warn);
      fb('fire_ring', { pos: P.clone().setY(P.y + .1), size: KZ.su.radius * 2, loop: true, life: KZ.su.warn, opacity: .6 });
    },
    fn(f, t) { const P = f.suP, s = KZ.su;
      fb('explosion', { pos: P.clone().setY(P.y + 2.6), size: 9 }); kazanFx(P, true); decal(P, 'scorch', 7); Sfx.play('explode'); Sfx.play('earth'); shake(.9); flashSky();
      addLava(f, { kind: 'circle', c: P.clone(), r: s.radius, dur: s.lavaDur, dps: s.lavaDps });
      for (const T of opps(f)) if (!T.ghost() && Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < s.radius && T.pos.y - P.y < 2.5) applyHit(f, T, SK(f, { dmg: s.dmg, kb: 8, launch: 6, el: 'fire', from: P, heavy: true })); } });
}
// Magma Heat — skills build it, the 3rd combo hit spends it
function kazanPerk(att, tgt, h, dmg) {
  if (h.skill && h.castId && att.heatCast !== h.castId) { att.heatCast = h.castId; att.heat = Math.min(KZ.heat.max, (att.heat || 0) + 1); att.heatT = KZ.heat.dur; popText(att.pos.clone().setY(att.pos.y + 2.4), 'HEAT ' + att.heat, '#ffb070', 18); }
}

// ---------------------------------------------------------------- ELEMENT VISUALS FROM VIDEO (cast → projectile → impact)
const EFX = {
  fire: { proj: 'fireball', projK: 4.4, hit: 'explosion', hit2: 'fire_burst', muzzle: 'fire_burst', charge: 'fire_loop' },
  water: { proj: 'water_orb', projK: 3.2, hit: 'water_splash', muzzle: 'water_splash', charge: 'water_vortex' },
  wind: { proj: 'water_vortex', projK: 3, desat: 1, tint: 0xe8f4ff, hit: 'dust_puff', muzzle: 'dust_puff', charge: 'tornado' },
  earth: { proj: null, hit: 'rock_burst', hit2: 'dust_puff', muzzle: 'dust_puff', charge: 'rocks_float' },
  lightning: { proj: 'lightning_orb', projK: 3.4, hit: 'bolt_branch', muzzle: 'lightning_orb', charge: 'lightning_orb' },
};
function projFX(p) { // replaces the code-drawn projectile with filmed fire / water / air / lightning
  const v = p.vis, E = EFX[p.el] || EFX.fire, r = p.radius || .4, follow = () => p.dead ? null : p.pos;
  let main = null;
  if (v === 'fire' || (v === 'orb' && p.el === 'fire')) { main = fb('fireball', { follow, size: r * E.projK, loop: true, speed: 1.4, tint: 0xffa860, boost: .85 }); p.fbh = [fb('fire_loop', { follow, size: r * 3.2, loop: true, speed: 1.6, opacity: .8 })]; }
  else if (v === 'water' || v === 'ewater') main = fb('water_orb', { follow, size: r * 3.2, loop: true, speed: 1.3, opacity: .95 });
  else if (v === 'bolt') main = fb('lightning_orb', { follow, size: .95, loop: true, speed: 1.6, boost: 1.2 });
  else if (v === 'ice_needle') main = fb('ice_orb', { follow, size: 1.5, loop: true, speed: 1.8, boost: 1.15 });
  else if (v === 'lance') main = fb('lightning_orb', { follow, size: 1.5, loop: true, speed: 1.8, boost: 1.3 });
  else if (v === 'wind') main = fb('water_vortex', { follow, size: r * 3.2, loop: true, speed: 2, desat: 1, tint: 0xffffff, boost: 1.35, opacity: .95 });
  else if (v === 'gale') main = fb('tornado', { follow, size: [r * 2.4, r * 3], loop: true, speed: 1.6, mode: 'up', opacity: .9 });
  else if (v === 'crescent') main = p.el === 'fire' ? fb('fire_wall', { follow, size: [r * 3.4, r * 2.2], loop: true, speed: 1.4, mode: 'up' }) : fb('water_vortex', { follow, size: [r * 3, r * 1.4], loop: true, speed: 2, desat: p.el === 'wind' ? 1 : 0, tint: p.el === 'wind' ? 0xe8f4ff : 0xffffff, opacity: .85 });
  else if (v === 'railrock') main = fb('fire_loop', { follow, size: 1.2, loop: true, speed: 1.5 });
  else if (v === 'rock' && p.el === 'earth') { p.fbh = (p.fbh || []).concat([fb('dust_puff', { follow, size: r * 3.6, loop: true, speed: 1.6, opacity: .5 })]); }
  if (main) { p.fbh = (p.fbh || []).concat([main]); if (p.mesh && v !== 'lance' && v !== 'railrock' && v !== 'crescent') p.mesh.visible = false; if (p.mesh && v === 'crescent') p.mesh.visible = false; }
  if (v === 'ewater') p.fbh.push(fb('lightning_orb', { follow, size: .9, loop: true, speed: 2 }));
}
function impactFX(el, pos, heavy, big = 1) {
  const E = EFX[el] || EFX.fire, s = (heavy ? 1.6 : 1) * big;
  if (el === 'fire') { fb('explosion', { pos: _v4.copy(pos).setY(pos.y + .4 * s), size: 2.6 * s }); if (heavy) fb('fire_burst', { pos, size: 2.2 * s, boost: 1.1 }); }
  else if (el === 'water') { fb('water_splash', { pos, size: 2.9 * s, speed: 1.4 }); }
  else if (el === 'wind') { fb('dust_puff', { pos: _v4.copy(pos).setY(pos.y - .3), size: 2.6 * s, opacity: .7, speed: 1.7 }); fb('water_vortex', { pos, size: 1.9 * s, speed: 2.4, desat: 1, tint: 0xffffff, boost: 1.3, opacity: .8 }); }
  else if (el === 'earth') { fb('rock_burst', { pos: _v4.copy(pos).setY(pos.y - .2), size: 3.1 * s }); fb('dust_puff', { pos, size: 2.5 * s, opacity: .85, speed: 1.5 }); }
  else if (el === 'ice') { fb('ice_burst', { pos, size: 2.1 * s, speed: 1.8 }); if (heavy) fb('ice_spike', { pos: _v4.copy(pos).setY(pos.y - .9), size: [2.2 * s, 2 * s], mode: 'up', speed: 1.6 }); }
  else if (el === 'lightning') { fb('bolt_branch', { pos, size: 2 * s, speed: 1.8, boost: 1.2 }); fb('lightning_orb', { pos, size: 1.3 * s, speed: 2.5 }); }
}
function muzzleFX(f, el) {
  const h = handPos(f, 'R'), E = EFX[el]; if (!E) return;
  if (el === 'fire') fb('fire_burst', { pos: h, size: 1.1, speed: 2.2, boost: 1.1 });
  else if (el === 'water') fb('water_splash', { pos: h, size: 1.2, speed: 2 });
  else if (el === 'wind') fb('dust_puff', { pos: h, size: 1.2, speed: 2, opacity: .6 });
  else if (el === 'earth') fb('dust_puff', { pos: f.pos.clone().addScaledVector(fwdOf(f), 1).setY(f.pos.y + .3), size: 1.6, speed: 1.8, opacity: .8 });
  else if (el === 'lightning') fb('lightning_orb', { pos: h, size: .9, speed: 3 });
}
function chargeFX(f, el, dur) {
  const follow = () => f.state === 'cast' ? handPos(f, 'R') : null, E = EFX[el]; if (!E || dur < .25) return;
  if (el === 'earth') fb('rocks_float', { pos: f.pos.clone().setY(f.pos.y + .8), size: 1.8, speed: 1.4, life: dur, loop: true });
  else if (el === 'wind') fb('tornado', { follow: () => f.state === 'cast' ? f.pos.clone().setY(f.pos.y + 1) : null, size: [1.8, 2.4], mode: 'up', loop: true, life: dur, opacity: .5 });
  else fb(E.charge, { follow, size: el === 'water' ? 1 : .9, loop: true, life: dur, speed: 1.5, desat: 0 });
}
// ---------------------------------------------------------------- ELEMENT ATTACK — tap 3 times: 3 different ranged strikes (every fighter)
BAL.basic = { dmg: [40, 40, 60], cd: [.36, .45, .9], chainWindow: 1.1, moveWhileCasting: .7 };
function buildBasics() {
  const D = BAL.basic.dmg, C = BAL.basic.cd;
  const s1 = { clip: 'magic1h', hit: .16, speed: 2.6, dur: .4 }, s2 = { clip: 'magic2h', hit: .18, speed: 2.6, dur: .45 }, s3 = { hit: .26, speed: 2, dur: .62, power: 2 };
  const B = (name, base, o) => def(name, Object.assign({}, base, o, { basic: true }));
  const pair = (f, t, o, gap = .14) => { const sh = s => spawnBall(f, t, Object.assign({ pos: frontPos(f, .9, o.y || 1.3).add(new V3(Math.cos(f.yaw) * s * .25, 0, -Math.sin(f.yaw) * s * .25)), spread: s * .05 }, o, { dmg: D[1] / 2 })); sh(1); later(gap, () => { if (f.state === 'cast') sh(-1); }); };
  // fire
  B('fire', s1, { el: 'fire', anim: 'punch', cd: C[0], hint: 'Fireball', fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, .9, 1.35), speed: 28, radius: .38, dmg: D[0], kb: 3, vis: 'fire', life: 2 }); Sfx.play('fire'); } });
  B('fire2', s2, { el: 'fire', anim: 'rapid', cd: C[1], hint: 'Twin Flames', fn(f, t) { pair(f, t, { el: 'fire', speed: 29, radius: .32, kb: 2.5, vis: 'fire', life: 2 }); Sfx.play('fire'); } });
  B('fire3', s3, { el: 'fire', clip: 'kick2', anim: 'kick', cd: C[2], hint: 'Flame Wave', fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, 1, .8), speed: 21, radius: 1.3, dmg: D[2], kb: 8, knockdown: true, life: .95, vis: 'crescent', big: true }); Sfx.play('fire'); Sfx.play('wind'); shake(.15); } });
  // water
  B('water', s1, { el: 'water', anim: 'push', cd: C[0], hint: 'Water Orb', fn(f, t) { spawnBall(f, t, { el: 'water', pos: frontPos(f, .9, 1.3), speed: 20, radius: .46, dmg: D[0], kb: 4, homing: 1.4, vis: 'water', life: 2.2 }); Sfx.play('water'); } });
  B('water2', s2, { el: 'water', anim: 'jab', cd: C[1], hint: 'Water Lash', fn(f, t) { waterWhip(f, t, 'L', D[1]); } });
  B('water3', s3, { el: 'water', clip: 'magic_area', anim: 'uppercut', cd: C[2], hint: 'Geyser', fn(f, t) { spawnGeyser(f, t, D[2]); } });
  // wind
  B('wind', s1, { el: 'wind', clip: 'kick2', anim: 'kick', speed: 3, cd: C[0], hint: 'Air Bullet', fn(f, t) { spawnBall(f, t, { el: 'wind', pos: frontPos(f, .9, 1.1), speed: 34, radius: .8, dmg: D[0], kb: 6, life: .7, vis: 'wind' }); Sfx.play('wind'); } });
  B('wind2', s2, { el: 'wind', anim: 'sweep', cd: C[1], hint: 'Air Slicers', fn(f, t) { for (const sp of [-.16, .16]) spawnBall(f, t, { el: 'wind', pos: frontPos(f, .9, .9), speed: 31, radius: .7, dmg: D[1] / 2, kb: 3, spread: sp, life: .9, vis: 'crescent' }); Sfx.play('wind'); } });
  B('wind3', s3, { el: 'wind', clip: 'hurricane', anim: 'spin', speed: 2.4, cd: C[2], hint: 'Gale Burst', fn(f, t) { spawnBall(f, t, { el: 'wind', pos: frontPos(f, 1, 1.1), speed: 25, radius: 1.6, dmg: D[2], kb: 14, launch: 5, life: .6, vis: 'gale' }); Sfx.play('wind'); shake(.2); } });
  // earth
  B('earth', s1, { el: 'earth', anim: 'lift', cd: C[0], hint: 'Boulder', fn(f, t) { const p = frontPos(f, 1.1, -.4); spawnBall(f, t, { el: 'earth', pos: p, speed: 22, radius: .55, dmg: D[0], kb: 5, rise: .12, riseTo: 1.3, vis: 'rock', life: 2 }); Sfx.play('earth'); FX.earth(p.clone().setY(f.pos.y + .1), 8, .5); } });
  B('earth2', s2, { el: 'earth', anim: 'rapid', cd: C[1], hint: 'Rock Shards', fn(f, t) { const p = frontPos(f, .9, 1.25); for (const sp of [-.14, 0, .14]) spawnBall(f, t, { el: 'earth', pos: p.clone(), speed: 30, radius: .33, dmg: D[1] / 3, kb: 2, spread: sp, vis: 'shard', life: 1.4 }); Sfx.play('earth'); } });
  B('earth3', s3, { el: 'earth', clip: 'magic_area', anim: 'hammer', cd: C[2], hint: 'Earth Pillars', fn(f, t) { spikeLine(f, t, D[2]); } });
  // lightning
  B('lightning', s1, { el: 'lightning', anim: 'punch', cd: C[0], hint: 'Spark', fn(f, t) { spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.35), speed: 46, radius: .32, dmg: D[0], kb: 2, stun: .12, vis: 'bolt', life: 1 }); Sfx.play('lightning'); } });
  B('lightning2', s2, { el: 'lightning', anim: 'push', cd: C[1], hint: 'Twin Bolts', fn(f, t) { for (const sp of [-.06, .06]) spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.3), speed: 48, radius: .3, dmg: D[1] / 2, kb: 1.5, spread: sp, vis: 'bolt', life: 1 }); Sfx.play('lightning'); } });
  B('lightning3', s3, { el: 'lightning', clip: 'magic2h', anim: 'lift', speed: 2.4, cd: C[2], hint: 'Lightning Lance', fn(f, t) { spawnBall(f, t, { el: 'lightning', pos: frontPos(f, .9, 1.6), speed: 56, radius: .5, dmg: D[2], kb: 7, stun: .3, knockdown: true, vis: 'lance', life: 1 }); Sfx.play('thunder'); shake(.25); } });
  // Rakan — stone & gravity (heavier earth shots)
  B('stone', s1, { el: 'earth', anim: 'lift', cd: C[0], hint: 'Stone Shot', fn(f, t) { const p = frontPos(f, 1.1, -.3); spawnBall(f, t, { el: 'earth', pos: p, speed: 23, radius: .6, dmg: D[0], kb: 5, rise: .12, riseTo: 1.4, vis: 'rock', life: 2 }); Sfx.play('earth'); FX.earth(p.clone().setY(f.pos.y + .1), 8, .5); } });
  B('stone2', s2, { el: 'earth', anim: 'rapid', cd: C[1], hint: 'Shard Volley', fn(f, t) { const p = frontPos(f, .9, 1.3); for (const sp of [-.14, 0, .14]) spawnBall(f, t, { el: 'earth', pos: p.clone(), speed: 31, radius: .34, dmg: D[1] / 3, kb: 2, spread: sp, vis: 'shard', life: 1.4 }); Sfx.play('earth'); } });
  B('stone3', s3, { el: 'earth', clip: 'magic2h', anim: 'hammer', speed: 2.2, cd: C[2], hint: 'Gravity Boulder', fn(f, t) { const p = frontPos(f, 1.2, -.3); spawnBall(f, t, { el: 'earth', pos: p, speed: 20, radius: .8, dmg: D[2], kb: 9, knockdown: true, rise: .14, riseTo: 1.5, vis: 'rock', life: 2.2 }); FX.earth(p.clone().setY(f.pos.y + .1), 12, .8); gravityRing(f, false); Sfx.play('earth'); shake(.2); } });
  // Kazan — magma (no lava pools: those only come from his skills)
  B('magma', s1, { el: 'fire', anim: 'punch', cd: C[0], hint: 'Magma Shot', fn(f, t) { spawnBall(f, t, { el: 'fire', pos: frontPos(f, .9, 1.35), speed: 25, radius: .42, dmg: D[0], kb: 3, vis: 'fire', life: 2, trail: 'fire_loop', trailSize: 1 }); Sfx.play('fire'); } });
  B('magma2', s2, { el: 'earth', anim: 'rapid', cd: C[1], hint: 'Lava Shards', fn(f, t) { pair(f, t, { el: 'fire', speed: 27, radius: .34, kb: 2.5, vis: 'railrock', life: 1.6, y: 1.25 }); Sfx.play('earth'); Sfx.play('fire'); } });
  B('magma3', s3, { el: 'fire', clip: 'magic_area', anim: 'hammer', speed: 2.2, cd: C[2], hint: 'Magma Boulder', fn(f, t) { const p = frontPos(f, 1.2, -.4); spawnBall(f, t, { el: 'fire', pos: p, speed: 19, radius: .75, dmg: D[2], kb: 8, knockdown: true, rise: .14, riseTo: 1.4, vis: 'rock', life: 2.2, trail: 'fire_loop', trailSize: 1.6 }); FX.earth(p.clone().setY(f.pos.y + .1), 12, .7); Sfx.play('earth'); Sfx.play('fire'); shake(.2); } });
}
const MB_VIS = { fire: ['fire', 'fire_loop'], water: ['water', 'water_orb'], earth: ['rock', 'rocks_float'], wind: ['wind', 'tornado'], ice: ['ice_needle', 'ice_orb'], lightning: ['bolt', 'lightning_orb'] };
const MB_EXTRA = { fire: { burn: 2 }, water: { kb: 8 }, earth: { knockdown: true }, wind: { launch: 6 }, ice: { slow: 1.4, slowPct: .3 }, lightning: { stun: .3 } };
function mbPrev(f) { return f.prevEl && f.prevEl !== f.melEl ? f.prevEl : (f.melEl === 'lightning' ? 'fire' : 'lightning'); }
function mbShot(f, t, el, o) { const v = MB_VIS[el]; return spawnBall(f, t, Object.assign({ el, pos: frontPos(f, .9, 1.35), speed: el === 'lightning' ? 46 : el === 'earth' ? 24 : 30, radius: el === 'wind' ? .6 : .38, kb: 3, vis: v[0], life: 1.8 }, o)); }
function buildMasterBasics() {
  const D = BAL.basic.dmg, C = BAL.basic.cd; // ×dmgMul is applied in applyHit
  const B = (name, o) => def(name, Object.assign({ basic: true, power: 1 }, o));
  B('mb', { el: 'fire', anim: 'punch', clip: 'magic1h3', hit: .16, speed: 2.8, dur: .4, cd: C[0], hint: 'Element Shot', fn(f, t) { const el = f.melEl; mbShot(f, t, el, { dmg: D[0] }); Sfx.play(el === 'ice' ? 'water' : el); } });
  B('mb2', { el: 'fire', anim: 'rapid', clip: 'magic1h', hit: .18, speed: 2.8, dur: .45, cd: C[1], hint: 'Twin Elements', fn(f, t) { const a = f.melEl, b = mbPrev(f);
    mbShot(f, t, a, { dmg: D[1] / 2, spread: -.08 }); later(.1, () => mbShot(f, t, b, { dmg: D[1] / 2, spread: .08 })); Sfx.play(a === 'ice' ? 'water' : a); } });
  B('mb3', { el: 'fire', anim: 'burst', clip: 'magic2h2', hit: .26, speed: 2.2, dur: .62, cd: C[2], power: 2, hint: '', fn(f, t) {
    const a = f.melEl, b = mbPrev(f), name = FUSE[fuseKey(a, b)] || 'Fusion';
    const p = mbShot(f, t, a, Object.assign({ dmg: D[2], radius: .55, big: true, speed: 30, trail: MB_VIS[b][1], trailSize: 1.3, aoe: { r: 2.4, dmg: 18, el: b, stun: 0 } }, MB_EXTRA[b]));
    if (f.isPlayer) popText(f.pos.clone().setY(f.pos.y + 2.3), name.toUpperCase() + ' SHOT', '#ffe9a0', 18);
    Sfx.play('chain'); Sfx.play(b === 'ice' ? 'water' : b); return p; } });
}
// a line of filmed structures racing along the ground (ice spikes / fire wall); hits each opponent once
function groundLine(f, t, o) {
  const fw = fwdOf(f), cid = f.castId, hit = new Set();
  for (let i = 0; i < o.n; i++) later(i * o.gap, () => {
    if (game.state !== 'fight' && game.state !== 'ko') return;
    const P = f.pos.clone().addScaledVector(fw, o.start + i * o.step); const r = Math.hypot(P.x, P.z); if (r > CFG.ARENA_R) return; P.y = groundAt(P.x, P.z, f.pos.y + .3);
    fb(o.fx, { pos: P.clone().setY(P.y + (o.fxY || 0)), size: o.size, mode: 'up', speed: o.fxSpeed || 1.4, boost: o.boost || 1, tint: o.tint });
    if (o.decal && i % 2 === 0) decal(P, o.decal, 1.8);
    if (o.sfx && i % 2 === 0) Sfx.play(o.sfx);
    for (const T of opps(f)) { if (hit.has(T) || T.ghost()) continue; if (Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < o.w && T.pos.y - P.y < 2.2) { hit.add(T); applyHit(f, T, Object.assign({ dmg: o.dmg, from: P.clone(), el: o.el, castId: cid, proj: true }, o.hit)); } }
  });
}
function buildBladeBasics() {
  const D = BAL.basic.dmg, C = BAL.basic.cd;
  const B = (name, o) => def(name, Object.assign({ basic: true, power: 1 }, o));
  // ---- Sira — FROST BLADE: the sword throws the cold (her own slashes, not Raven's water casts)
  B('frost', { el: 'ice', clip: 'jab2', anim: 'sweep', hit: .2, speed: 2.4, dur: .42, cd: C[0], hint: 'Frost Slash', fn(f, t) {
    spawnBall(f, t, { el: 'ice', pos: frontPos(f, 1, 1.2), speed: 31, radius: .85, dmg: D[0], kb: 3, life: .9, vis: 'crescent', trail: 'ice_orb', trailSize: .8, slow: .6, slowPct: .15 }); Sfx.play('swing'); Sfx.play('water'); } });
  B('frost2', { el: 'ice', clip: 'cross', anim: 'sweep', hit: .2, speed: 2.4, dur: .45, cd: C[1], hint: 'Twin Ice Shards', fn(f, t) {
    for (const [sp, dl] of [[-.1, 0], [.1, .08]]) later(dl, () => spawnBall(f, t, { el: 'ice', pos: frontPos(f, .9, 1.3), speed: 36, radius: .34, dmg: D[1] / 2, kb: 1.5, spread: sp, life: 1, vis: 'ice_needle', wet: true }));
    Sfx.play('swing'); Sfx.play('lightning'); } });
  B('frost3', { el: 'ice', clip: 'kick2', anim: 'hammer', hit: .28, speed: 2, dur: .62, cd: C[2], power: 2, hint: 'Glacier Line', fn(f, t) {
    groundLine(f, t, { n: 6, gap: .05, start: 1.6, step: 1.45, w: 1.15, dmg: D[2], el: 'ice', fx: 'ice_spike', size: [1.7, 2.1], fxSpeed: 1.5, sfx: 'water', hit: { kb: 4, launch: 4, slow: 1.2, slowPct: .25, heavy: true } }); Sfx.play('clash'); shake(.3); } });
  // ---- Rayn — FLAME BLADE: arcs of fire cut from the great sword
  B('ember', { el: 'fire', clip: 'jab2', anim: 'sweep', hit: .24, speed: 2.2, dur: .45, cd: C[0], hint: 'Flame Slash', fn(f, t) {
    spawnBall(f, t, { el: 'fire', pos: frontPos(f, 1, 1.15), speed: 28, radius: .95, dmg: D[0] + (f.igniteT > 0 ? 5 : 0), kb: 3.5, life: .9, vis: 'crescent', trail: 'fire_loop', trailSize: 1, burn: 1 }); Sfx.play('swing'); Sfx.play('fire'); } });
  B('ember2', { el: 'fire', clip: 'cross', anim: 'sweep', hit: .24, speed: 2.2, dur: .48, cd: C[1], hint: 'Cross Fire', fn(f, t) {
    for (const [sp, dl] of [[-.13, 0], [.13, .07]]) later(dl, () => spawnBall(f, t, { el: 'fire', pos: frontPos(f, 1, 1.0 + dl * 4), speed: 30, radius: .8, dmg: D[1] / 2 + (f.igniteT > 0 ? 3 : 0), kb: 2.5, spread: sp, life: .85, vis: 'crescent', trail: 'fire_loop', trailSize: .8 }));
    Sfx.play('swing'); Sfx.play('fire'); } });
  B('ember3', { el: 'fire', clip: 'kick2', anim: 'hammer', hit: .3, speed: 1.9, dur: .66, cd: C[2], power: 2, hint: 'Blazing Arc', fn(f, t) {
    groundLine(f, t, { n: 6, gap: .045, start: 1.5, step: 1.4, w: 1.1, dmg: D[2] + (f.igniteT > 0 ? 10 : 0), el: 'fire', fx: 'fire_wall', size: [1.9, 1.9], fxY: .9, fxSpeed: 1.6, boost: 1.1, decal: 'scorch', sfx: 'fire', hit: { kb: 6, launch: 3, burn: 2, heavy: true } }); shake(.35); } });
}
const cdKeyOf = (f, name) => { const a = AB[name]; if (f && f.isMaster && (name === 'm1' || name === 'm2')) return name + '_' + f.melEl; return (a && a.slot) || name; };
const isBasic = (f, name) => !!name && (ELS.includes(name) || (f.kit && name === f.kit.basic));
// ---------------------------------------------------------------- RAKAN — Guardian of the Mountain (legendary; numbers from the user's sheet)
BAL.chars.rakan = { hp: 1100, speedMul: 1, dashCD: 2.5, dashMul: .85, combo: [30, 40, 55], height: 2.12, baseDR: .08,
  stab: { dr: .15, kbRes: .5, dur: 3, icd: 8 },
  s1: { name: 'Rock Smash', dmg: 105, cd: 9, windup: .65, recover: .45, range: 4.4, half: .62, slow: .2, slowDur: 1.5 },
  s2: { name: 'Gravity Counter', dur: .8, perfect: .3, pulse: 60, reflect: .7, reflectCap: 100, lateDR: .35, cd: 13 },
  su: { name: 'Mountain Fall', dmg: 210, warn: 1.2, radius: 4.2, dist: 4.3, windupDR: .2, recover: .7 } };
const RK = BAL.chars.rakan;
const RAKAN_PERK_TEXT = `Landing the 3rd combo hit grants <b>Mountain Stability</b> for ${RK.stab.dur} s: damage taken −${Math.round(RK.stab.dr * 100)}% and knockback halved (once every ${RK.stab.icd} s). Base defense: −${Math.round(RK.baseDR * 100)}% damage taken.`;
const RAKAN_KIT = { name: 'Stone', basic: 'stone', btn: [['stone', 'Stone Attack'], ['rk_s1', RK.s1.name], ['rk_s2', RK.s2.name]], superAb: 'rk_su', superR: [0, 6],
  desc: `<b>${RK.s1.name}</b> · <b>${RK.s2.name}</b> · Super: <b>${RK.su.name}</b><br>Perk: ${RAKAN_PERK_TEXT}`,
  moves: [['stone', .15, 3, 2.5, 16], ['rk_s1', .7, 3, 0, 4.2], ['rk_s2', 1, .8, 0, 3.5]], pref: 3.2, speed: BAL.moveSpeed, aggr: .85, blockP: .35, jumpP: .1, airJumps: 0, glide: false, armor: 1, heal: 0 };
// highest damage reduction only — percentages never stack (user's rule)
function charDR(tgt) {
  let dr = 0;
  if (tgt.charId === 'rakan') {
    dr = RK.baseDR;
    if (tgt.sts.stab > 0) dr = Math.max(dr, RK.stab.dr);
    if (tgt.state === 'cast' && tgt.cast) { const n = tgt.cast.a.name; if (n === 'rk_s2') dr = Math.max(dr, RK.s2.lateDR); if (n === 'rk_su' && !tgt.cast.fired) dr = Math.max(dr, RK.su.windupDR); }
  }
  if (tgt.sts.fort > 0) dr = Math.max(dr, BAL.el.earth.perk.pct);
  return dr;
}
function gravityRing(f, big) {
  const c = f.pos.clone().setY(f.pos.y + 1.1);
  fb('dust_puff', { pos: f.pos.clone().setY(f.pos.y + .2), size: big ? 4 : 2.6, opacity: .7, speed: 1.8 });
  FX.shock(c, 'wind', big ? 2 : 1.3); FX.earth(f.pos.clone().setY(f.pos.y + .2), big ? 16 : 8, 1.2);
  for (let i = 0; i < (big ? 14 : 7); i++) DEBRIS.spawn(f.pos.clone().setY(f.pos.y + rand(.2, 1.5)), _v1.randomDirection().multiplyScalar(rand(2, 5)).setY(rand(2, 6)), rand(.6, 1.4));
}
function rakanCounterTry(att, tgt, h) { // returns a result string when the stance answers the hit, else null
  if (att.isEnv) return null;
  const S = RK.s2, c = tgt.cast, p = h.proj;
  const perfect = c.t <= S.perfect && !c.used;
  const hitPos = tgt.pos.clone().setY(tgt.pos.y + 1.2);
  if (perfect && h.melee) {
    c.used = true; gravityRing(tgt, false); Sfx.play('perfect'); popText(hitPos.clone().setY(hitPos.y + 1), 'COUNTERED!', '#ffe08a', 26); hitstop(.1); shake(.4);
    applyHit(tgt, att, { dmg: S.pulse, kb: 10, launch: 3, el: 'earth', from: tgt.pos, heavy: true, push: true, counterPulse: true });
    return 'counter';
  }
  if (perfect && p && p.kind === 'ball' && p.power < 3 && !p.reflected) {
    c.used = true; p.owner = tgt; p.dir = aimDir(tgt, p.pos, att); p.speed *= 1.1; p.t = 0; p.castId = null; p.skill = false; p.reflected = true; p.dmg = Math.min(Math.round(p.dmg * S.reflect), S.reflectCap);
    gravityRing(tgt, false); Sfx.play('perfect'); popText(hitPos, 'RETURNED! ↩', '#ffe08a', 24); hitstop(.08);
    return 'reflect';
  }
  return null; // late (or not reflectable): the stance's 35% reduction applies through charDR
}
function buildRakanKit() {
  def('rk_s1', { el: 'earth', clip: 'magic_area', anim: 'stomp', hit: RK.s1.windup, speed: 2, dur: RK.s1.windup + .35, cd: RK.s1.cd, label: RK.s1.name, noMove: true,
    fn(f, t) {
      const fw = fwdOf(f), P = f.pos.clone().addScaledVector(fw, 2.2);
      fb('rock_burst', { pos: P.clone().setY(P.y + .8), size: 4.6 }); fb('dust_wave', { pos: P.clone().setY(P.y + .6), size: [5.5, 2.6], mode: 'up', speed: 1.5 });
      FX.earth(P.clone().setY(P.y + .2), 18, 1.6); decal(P, 'crack', 3.4); Sfx.play('earth'); Sfx.play('heavy'); shake(.5);
      for (let i = 0; i < 10; i++) DEBRIS.spawn(P.clone().setY(P.y + .3), _v1.set(fw.x, 0, fw.z).multiplyScalar(rand(2, 6)).add(_v2.randomDirection()).setY(rand(3, 8)), rand(.8, 2));
      const ok = coneHit(f, t, RK.s1.range, RK.s1.half, RK.s1.dmg, { kb: 4, launch: 3, el: 'earth', heavy: true, slow: RK.s1.slowDur, slowPct: RK.s1.slow });
      if (!ok && f.cast) f.cast.dur = f.cast.a.dur + RK.s1.recover; // a whiff leaves him open
    } });
  def('rk_s2', { el: 'earth', clip: 'block', anim: 'lift', hit: .02, speed: 1, dur: RK.s2.dur, cd: RK.s2.cd, label: RK.s2.name, noMove: true, counter: true, noMuzzle: true,
    onStart(f) { f.cast.used = false; Sfx.play('earth'); FX.shock(f.pos.clone().setY(f.pos.y + 1), 'wind', 1); fb('rocks_float', { follow: () => f.state === 'cast' && f.cast && f.cast.a.name === 'rk_s2' ? f.pos.clone().setY(f.pos.y + 1) : null, size: 2.6, loop: true, life: RK.s2.dur, opacity: .9 }); },
    fn() { } });
  def('rk_su', { el: 'earth', clip: 'magic2h3', anim: 'stomp', hit: RK.su.warn, speed: 1.1, dur: RK.su.warn + RK.su.recover, cd: 1, super: true, power: 3, label: RK.su.name, noMove: true,
    onStart(f, t) { const fw = fwdOf(f); const P = f.pos.clone().addScaledVector(fw, RK.su.dist); const r = Math.hypot(P.x, P.z); if (r > CFG.ARENA_R - 1) P.multiplyScalar((CFG.ARENA_R - 1) / r); P.y = groundAt(P.x, P.z, f.pos.y + .3); f.suP = P; telegraph(P, RK.su.radius, 0xc8a050, RK.su.warn); fb('rocks_float', { pos: P.clone().setY(P.y + 1.4), size: 5, loop: true, life: RK.su.warn, opacity: .85 }); },
    fn(f, t) { const P = f.suP, s = RK.su;
      fb('crater', { pos: P.clone().setY(P.y + .3), size: 7, speed: .9 }); fb('rock_burst', { pos: P.clone().setY(P.y + 1.2), size: 6.5 }); fb('dust_wave', { pos: P.clone().setY(P.y + .9), size: [9, 4], mode: 'up', speed: 1.2 }); fb('explosion', { pos: P.clone().setY(P.y + 2), size: 5, opacity: .85 });
      FX.burst(P.clone().setY(P.y + .4), 'earth', 30, 9, 2); decal(P, 'crack', 7); Sfx.play('explode'); Sfx.play('earth'); shake(1); flashSky();
      for (let i = 0; i < 16; i++) DEBRIS.spawn(P.clone().setY(P.y + .5), _v1.randomDirection().multiplyScalar(rand(3, 9)).setY(rand(4, 10)), rand(1, 2.4));
      for (const T of opps(f)) if (!T.ghost() && Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < s.radius && T.pos.y - P.y < 3) applyHit(f, T, SK(f, { dmg: s.dmg, kb: 13, launch: 5, knockdown: true, el: 'earth', from: P, heavy: true, push: true })); } });
}
// ---------------------------------------------------------------- ICE ELEMENT + FILMED ELEMENT SHIELDS
EL.ice = { name: 'Ice', color: 0x9adcff, c: [.62, .88, 1], icon: '❄️' };
const ELS6 = [...ELS, 'ice'];
FX.ice = function (p, n = 5, sp = .2, v = null, sc = 1) { for (let i = 0; i < n; i++) PADD.emit(p.x + rand(-sp, sp), p.y + rand(-sp, sp), p.z + rand(-sp, sp), (v ? v.x : 0) + rand(-1, 1), (v ? v.y : 0) + rand(-.3, 1.5), (v ? v.z : 0) + rand(-1, 1), .55, .85, 1, rand(.1, .2) * sc, rand(.3, .6), 2, 0, .04, .7); };
EFX.ice = { proj: 'ice_orb', hit: 'ice_burst', muzzle: 'ice_burst', charge: 'ice_orb' };
const _sv = new V3();
const relF = (f, dx, dy, dz, cond) => () => (cond ? cond() : f.state === 'block') ? _sv.set(f.pos.x + Math.sin(f.yaw) * dz + Math.cos(f.yaw) * dx, f.pos.y + dy, f.pos.z + Math.cos(f.yaw) * dz - Math.sin(f.yaw) * dx) : null;
// every shield is a real element structure cut from the user's videos
function startShieldFX(f) {
  const bs = f.blockStyle;
  if (bs === 'fire' || bs === 'magma') {
    const tint = bs === 'magma' ? 0xff7a35 : 0xffffff;
    for (const [dx, dz] of [[0, 1.5], [-1.25, .95], [1.25, .95]]) fb('fire_wall', { follow: relF(f, dx, 1.05, dz), size: [2.1, 1.9], mode: 'up', loop: true, tint, opacity: .95, speed: 1.2 });
    fb('fire_ring', { follow: relF(f, 0, .12, 0), size: 4.2, loop: true, speed: 1.2, opacity: .9 });
    if (bs === 'magma') fb('rocks_float', { follow: relF(f, 0, 1.1, 1.2), size: 2, loop: true, opacity: .8 });
  } else if (bs === 'water') { // water bubble
    fb('water_orb', { follow: relF(f, 0, 1.05, 0), size: 3.6, loop: true, opacity: .55, speed: 1.2 });
    fb('water_vortex', { follow: relF(f, 0, .1, 0), size: 3.4, mode: 'flat', loop: true, opacity: .5, speed: 1.4 });
  } else if (bs === 'wind') { // air wall
    for (const [dx, dz] of [[0, 1.5], [-1.3, .9], [1.3, .9]]) fb('water_vortex', { follow: relF(f, dx, 1.2, dz), size: [2.1, 2.2], mode: 'up', loop: true, desat: 1, tint: 0xffffff, boost: 1.3, opacity: .75, speed: 2 });
    fb('dust_puff', { follow: relF(f, 0, .2, 0), size: 3.4, loop: true, opacity: .4, speed: 1.6 });
  } else if (bs === 'ice' || bs === 'frost') { // ice wall
    for (const [dx, dz, s] of [[0, 1.5, 2.4], [-1.2, 1, 1.9], [1.2, 1, 1.9]]) fb('ice_spike', { follow: relF(f, dx, .15, dz), size: [s, s * .95], mode: 'up', loop: true, speed: .8, opacity: .95 });
  } else if (bs === 'lightning') {
    fb('lightning_orb', { follow: relF(f, 0, 1.1, 0), size: 2.8, loop: true, opacity: .8, speed: 1.6 });
  } else if (bs === 'blade') { // Rayn: a burning parry — fire swirls round the great sword and a ring at his feet
    fb('fire_ring', { follow: relF(f, 0, .12, 0), size: 3.4, loop: true, speed: 1.5, opacity: .95 });
    fb('fire_loop', { follow: () => f.state === 'block' ? swordTip(f, .55) : null, size: 1.6, loop: true, speed: 1.6, boost: 1.2 });
    fb('fire_burst', { follow: relF(f, 0, 1.2, 1.1), size: 2.2, loop: true, speed: 1.3, opacity: .8 });
  } else if (bs === 'all') { // Master: the six elements orbit him as a guard
    const SIX = [['fire_loop', 1], ['water_orb', 1.1], ['rocks_float', 1.1], ['tornado', 1.1], ['ice_orb', 1], ['lightning_orb', 1]];
    SIX.forEach(([n, s], i) => fb(n, { follow: () => { if (f.state !== 'block') return null; const a = game.time * 2.4 + i * Math.PI / 3; return _sv.set(f.pos.x + Math.cos(a) * 1.25, f.pos.y + 1.05 + Math.sin(a * 2) * .15, f.pos.z + Math.sin(a) * 1.25); }, size: s, loop: true, speed: 1.6, opacity: .95 }));
    fb('water_orb', { follow: relF(f, 0, 1.05, 0), size: 3.2, loop: true, opacity: .28, speed: 1.1, desat: 1, tint: 0xfff2c0 });
  }
}
// ---------------------------------------------------------------- SIRA — Frost Blade (fast duelist; numbers from the user's sheet)
BAL.chars.sira = { hp: 900, speedMul: 1.15, comboSpd: 1.15, dashCD: 1.0, combo: [25, 30, 45], height: 1.8,
  flow: { markDur: 4, haste: .10, hasteDur: 2, icd: 7, maxSpeed: 1.25 },
  s1: { name: 'Wave Slide', dmg: 65, cd: 8, distMul: 1.2 },
  s2: { name: 'Winter Needle', dmg: 80, cd: 10, windup: .35, freeze: .6, slow: .2, slowDur: 1.5, speed: 44 },
  su: { name: 'Frozen Mirror Dance', warn: .9, cuts: [55, 65, 80], slow: .25, slowDur: 2, len: 9.5, width: 2.4, recover: .5 } };
const SR = BAL.chars.sira;
const SIRA_PERK_TEXT = `Water-skill hits mark the enemy <b>Wet</b> for ${SR.flow.markDur} s and grant +${Math.round(SR.flow.haste * 100)}% speed for ${SR.flow.hasteDur} s (every ${SR.flow.icd} s). Winter Needle <b>freezes</b> a Wet enemy; the 3rd sword cut slows them instead.`;
const SIRA_KIT = { name: 'Frost', basic: 'frost', btn: [['frost', 'Frost Blade'], ['sr_s1', SR.s1.name], ['sr_s2', SR.s2.name]], superAb: 'sr_su', superR: [1, 8],
  desc: `<b>${SR.s1.name}</b> · <b>${SR.s2.name}</b> · Super: <b>${SR.su.name}</b><br>Perk: ${SIRA_PERK_TEXT}`,
  moves: [['frost', .15, 3, 2, 16], ['sr_s1', .7, 2.6, 2.5, 9], ['sr_s2', .8, 3, 3, 15]], pref: 3, speed: BAL.moveSpeed * 1.15, aggr: .85, blockP: .35, jumpP: .3, airJumps: 1, glide: false, armor: 1, heal: 0 };
function siraMark(att, tgt) {
  tgt.sts.wet = SR.flow.markDur; popText(tgt.pos.clone().setY(tgt.pos.y + 2.3), 'WET', '#9fd4ff', 17); fb('water_splash', { pos: tgt.pos.clone().setY(tgt.pos.y + 1.2), size: 1.8, speed: 2 });
  if ((att.icd.flow || 0) <= 0) { att.icd.flow = SR.flow.icd; att.sts.haste = SR.flow.hasteDur; popText(att.pos.clone().setY(att.pos.y + 2.3), 'FLOW', '#bfe9ff', 16); }
}
function buildSiraKit() {
  def('sr_s1', { el: 'water', clip: 'roll2', anim: 'punch', hit: .05, speed: 1.6, dur: .22, cd: SR.s1.cd, label: SR.s1.name, noMuzzle: true,
    fn(f, t) {
      const I = f.intent; const d = new V3(I.mx, 0, I.mz); if (d.lengthSq() < .05) d.copy(t.pos).sub(f.pos).setY(0); d.normalize();
      f.startDash(d, BAL.dashSpeed * 1.05, BAL.dashTime * SR.s1.distMul, 'water');
      f.dashAttack = { dmg: SR.s1.dmg, el: 'water', wet: true, hit: false };
      fb('water_stream', { follow: () => f.state === 'dash' ? f.pos.clone().setY(f.pos.y + .9) : null, size: [2.6, 1.1], loop: true, speed: 2.4, opacity: .9 });
    } });
  def('sr_s2', { el: 'water', clip: 'magic2h', anim: 'push', hit: SR.s2.windup, speed: 2.2, dur: SR.s2.windup + .3, cd: SR.s2.cd, label: SR.s2.name,
    onStart(f) { fb('ice_orb', { follow: () => f.state === 'cast' ? handPos(f, 'R') : null, size: 1, loop: true, life: SR.s2.windup + .1, speed: 2 }); },
    fn(f, t) { spawnBall(f, t, { el: 'ice', pos: frontPos(f, .9, 1.35), speed: SR.s2.speed, radius: .42, dmg: SR.s2.dmg, kb: 2, vis: 'ice_needle', life: 1.1, needle: true }); Sfx.play('water'); Sfx.play('lightning'); } });
  def('sr_su', { el: 'ice', clip: 'magic2h3', anim: 'spin', hit: SR.su.warn, speed: 1.6, dur: SR.su.warn + .9 + SR.su.recover, cd: 1, super: true, power: 3, label: SR.su.name, noMove: true,
    onStart(f, t) { const fw = fwdOf(f); const a = f.pos.clone().addScaledVector(fw, .5), b = f.pos.clone().addScaledVector(fw, SR.su.len); const r = Math.hypot(b.x, b.z); if (r > CFG.ARENA_R) b.multiplyScalar(CFG.ARENA_R / r); a.y = b.y = groundAt(a.x, a.z, f.pos.y + .2); f.suLine = { a, b, dir: fw.clone() }; telegraphLine(a, b, SR.su.width, 0x9adcff, SR.su.warn); },
    fn(f, t) {
      const L = f.suLine, cid = f.castId; let step = 0;
      const inCorridor = (T) => { if (T.ghost()) return false; const dx = L.b.x - L.a.x, dz = L.b.z - L.a.z, L2 = dx * dx + dz * dz; const k = clamp(((T.pos.x - L.a.x) * dx + (T.pos.z - L.a.z) * dz) / L2, 0, 1); return Math.hypot(T.pos.x - L.a.x - dx * k, T.pos.z - L.a.z - dz * k) < SR.su.width / 2 + .4; };
      for (let i = 0; i < 3; i++) later(.12 + i * .3, () => {
        if (game.state !== 'fight' && game.state !== 'ko') return;
        const k = [.3, .62, .95][i]; const P = new V3().lerpVectors(L.a, L.b, k);
        f.pos.set(P.x, groundAt(P.x, P.z, f.pos.y + .5), P.z); f.vel.set(0, 0, 0); f.yaw = Math.atan2(L.dir.x, L.dir.z);
        fb('water_stream', { pos: P.clone().setY(P.y + 1), size: [3.4, 1.4], mode: 'beam', dir: L.dir.clone(), speed: 2.6 }); fb('ice_burst', { pos: P.clone().setY(P.y + 1.1), size: 2.4, speed: 2 });
        FX.ice(P.clone().setY(P.y + 1), 10, .8); Sfx.play('swing'); Sfx.play('water'); if (f.rig.glb) playAttack(f.rig.glb, ['jab2', 'cross', 'kick2'][i], .4, 2.2, 'su' + cid + i);
        for (const T of opps(f)) if (inCorridor(T)) applyHit(f, T, { dmg: SR.su.cuts[i], kb: i === 2 ? 5 : 1.5, el: 'ice', from: f.pos.clone(), heavy: i === 2, skill: true, castId: cid, multi: i < 2, slow: i === 2 ? SR.su.slowDur : 0, slowPct: SR.su.slow });
      });
    } });
}
// ---------------------------------------------------------------- RAYN — Flame Blade (sword duelist; numbers from the user's sheet)
BAL.chars.rayn = { hp: 1000, speedMul: 1, dashCD: 1.2, combo: [30, 35, 50], height: 1.85,
  ember: { max: 2, dur: 8, extraIgnite: 1 },
  s1: { name: 'Flame Crescent', dmg: 85, ignDmg: 100, cd: 7, windup: .4 },
  s2: { name: 'Ignite Blade', dur: 5, cd: 15, windup: .5, meleeBonus: 5, burnDps: 5, burnDur: 3 },
  su: { name: 'Sun Cleave', dmg: 190, burn: 15, burnDur: 3, warn: 1, len: 10, width: 2.6, recover: .7 } };
const RY = BAL.chars.rayn;
const RAYN_PERK_TEXT = `Landing the 3rd sword cut grants an <b>Ember</b> (max ${RY.ember.max}, ${RY.ember.dur} s). Igniting the blade consumes Embers: +1 s of burning blade each. While ignited: sword hits +${RY.s2.meleeBonus}, the 3rd cut burns, and the Crescent deals ${RY.s1.ignDmg}.`;
const RAYN_KIT = { name: 'Flame', basic: 'ember', btn: [['ember', 'Flame Blade'], ['ry_s1', RY.s1.name], ['ry_s2', RY.s2.name]], superAb: 'ry_su', superR: [1, 8],
  desc: `<b>${RY.s1.name}</b> · <b>${RY.s2.name}</b> · Super: <b>${RY.su.name}</b><br>Perk: ${RAYN_PERK_TEXT}`,
  moves: [['ember', .15, 3, 2, 16], ['ry_s1', .6, 3, 3, 14], ['ry_s2', 1.2, 1.6, 0, 3.5]], pref: 2.6, speed: BAL.moveSpeed, aggr: .9, blockP: .35, jumpP: .2, airJumps: 1, glide: false, armor: 1, heal: 0 };
function swordTip(f, k = 1) { const G = f.rig.glb, s = G && G.sword; if (!s) return handPos(f, 'R'); return s.localToWorld((G.swordTipLocal || new V3(0, 1, 0)).clone().multiplyScalar(.95 * k)); }
function buildRaynKit() {
  def('ry_s1', { el: 'fire', clip: 'magic1h', anim: 'kick', hit: RY.s1.windup, speed: 1.4, dur: RY.s1.windup + .3, cd: RY.s1.cd, label: RY.s1.name,
    fn(f, t) { const ign = f.igniteT > 0; spawnBall(f, t, { el: 'fire', pos: frontPos(f, 1, 1.1), speed: 24, radius: 1.1, dmg: ign ? RY.s1.ignDmg : RY.s1.dmg, kb: 5, life: 1.1, vis: 'crescent', big: ign }); Sfx.play('fire'); Sfx.play('swing'); } });
  def('ry_s2', { el: 'fire', clip: 'power_up', anim: 'lift', hit: RY.s2.windup, speed: 1.6, dur: RY.s2.windup + .3, cd: RY.s2.cd, label: RY.s2.name, noMuzzle: true,
    fn(f) { const extra = (f.embers || 0) * RY.ember.extraIgnite; f.embers = 0; f.igniteT = RY.s2.dur + extra; Sfx.play('fire');
      fb('fire_burst', { pos: swordTip(f, .6), size: 1.6, speed: 2 }); popText(f.pos.clone().setY(f.pos.y + 2.5), 'BLADE IGNITED' + (extra ? ` +${extra}s` : ''), '#ffb060', 20); } });
  def('ry_su', { el: 'fire', clip: 'magic2h3', anim: 'burst', hit: RY.su.warn, speed: 1.75, dur: RY.su.warn + RY.su.recover, cd: 1, super: true, power: 3, label: RY.su.name, noMove: true,
    onStart(f, t) { const fw = fwdOf(f); const a = f.pos.clone().addScaledVector(fw, .6), b = f.pos.clone().addScaledVector(fw, RY.su.len); const r = Math.hypot(b.x, b.z); if (r > CFG.ARENA_R) b.multiplyScalar(CFG.ARENA_R / r); a.y = b.y = groundAt(a.x, a.z, f.pos.y + .2); f.suLine = { a, b, dir: fw.clone() }; telegraphLine(a, b, RY.su.width, 0xff5a1a, RY.su.warn); fb('fire_loop', { follow: () => f.state === 'cast' ? swordTip(f, .7) : null, size: 1.6, loop: true, life: RY.su.warn, speed: 1.6 }); },
    fn(f, t) {
      const L = f.suLine, cid = f.castId, n = 7;
      for (let i = 0; i <= n; i++) later(i * .045, () => { const P = new V3().lerpVectors(L.a, L.b, i / n); fb('fire_wall', { pos: P.clone().setY(P.y + 1), size: [2.6, 2.1], mode: 'up', speed: 1.5, boost: 1.1 }); if (i % 2 === 0) { decal(P, 'scorch', 2.4); FX.fire(P.clone().setY(P.y + .4), 6, .6, _v2.set(0, 3, 0), 1.2); } });
      fb('explosion', { pos: L.a.clone().lerp(L.b, .35).setY(L.a.y + 1.6), size: 4.5 }); Sfx.play('explode'); Sfx.play('fire'); shake(.7); flashSky();
      const dx = L.b.x - L.a.x, dz = L.b.z - L.a.z, L2 = dx * dx + dz * dz;
      for (const T of opps(f)) { const k = clamp(((T.pos.x - L.a.x) * dx + (T.pos.z - L.a.z) * dz) / L2, 0, 1);
      if (!T.ghost() && Math.hypot(T.pos.x - L.a.x - dx * k, T.pos.z - L.a.z - dz * k) < RY.su.width / 2 + .4) applyHit(f, T, { dmg: RY.su.dmg, kb: 6, launch: 2, el: 'fire', from: L.a, heavy: true, skill: true, castId: cid, burn: RY.su.burnDur, unblockable: false, power3: true }); }
    } });
}
// ---------------------------------------------------------------- ELEMENTAL MASTER — six elements, seals & fusions (user's sheet)
BAL.chars.master = { hp: 1100, speedMul: 1.05, dashCD: 1.1, combo: [32, 38, 50], height: 1.85, dmgMul: 1.1,
  energy: { max: 100, regen: 8, delay: 2 }, swapGap: .12,
  s1: { cost: 0, cd: 5 }, s2: { cost: 0, cd: 9 }, fuse: { cost: 0, cd: 8 }, spD: .1, spT: .05,
  su: { name: 'Union of the Six', warn: 1.2, waves: [60, 70, 100], radius: 3.8 } };
const MM = BAL.chars.master;
const M1 = { // skill 1 per element: [name, dmg, anim, extra]
  fire: ['Flame Spear', 75], water: ['Water Whip', 65], earth: ['Rock Fist', 85], wind: ['Air Blade', 60], ice: ['Ice Spear', 60], lightning: ['Flash Bolt', 65] };
const M2 = { fire: ['Fire Arc', 105], water: ['Push Wave', 85], earth: ['Stone Wall', 0], wind: ['Wind Shove', 70], ice: ['Frost Grip', 75], lightning: ['Thunder Step', 85] };
const FUSE = { // sorted pair -> [name, fn-key]
  'fire+water': 'Steam Burst', 'earth+fire': 'Molten Rock', 'fire+wind': 'Flame Vortex', 'fire+ice': 'Thermal Shock', 'fire+lightning': 'Plasma Spear',
  'earth+water': 'Mud Snare', 'water+wind': 'Water Cyclone', 'ice+water': 'Freezing Wave', 'lightning+water': 'Charged Pool',
  'earth+wind': 'Pebble Storm', 'earth+ice': 'Frost-Rock Shield', 'earth+lightning': 'Shock Stake', 'ice+wind': 'Blizzard', 'lightning+wind': 'Storm Rush', 'ice+lightning': 'Charged Bind' };
const fuseKey = (a, b) => [a, b].sort().join('+');
function mSeal(f, el) { f.seal = { el, until: game.time + 5 }; if (f.isPlayer) popText(f.pos.clone().setY(f.pos.y + 2.5), EL[el].name.toUpperCase() + ' SEAL', '#ffe9a0', 17); }
function buildMasterKit() {
  const chk = (f, cost) => { if (f.mana < cost) { if (f.isPlayer) { popText(f.pos.clone().setY(f.pos.y + 2.3), 'NO ENERGY', '#8fd0ff', 18); btnDenied('m1'); } return false; } return true; };
  // ---- skill 1 (shared slot m1)
  def('m1', { slot: 'm1', el: 'fire', anim: 'punch', clip: 'magic1h', speed: 2.2, hit: .2, dur: .5, rel: .2, cd: MM.s1.cd, cost: MM.s1.cost, energy: true, label: null, fn(f, t) {
    const el = f.melEl, cid = f.castId, S = (o) => Object.assign({ skill: true, castId: cid, seal: el }, o);
    if (el === 'fire') spawnBall(f, t, S({ el, pos: frontPos(f, .9, 1.35), speed: 30, radius: .42, dmg: 75, kb: 3, vis: 'fire', life: 2 }));
    else if (el === 'water') { waterWhip(f, t, 'R', 65, { skill: true, castId: cid, seal: 'water', slow: 1, slowPct: .15 }); }
    else if (el === 'earth') { const p = frontPos(f, 1.1, -.4); spawnBall(f, t, S({ el, pos: p, speed: 19, radius: .6, dmg: 85, kb: 6, rise: .13, riseTo: 1.4, vis: 'rock', life: 2.4 })); FX.earth(p.clone().setY(f.pos.y + .1), 8, .5); }
    else if (el === 'wind') spawnBall(f, t, S({ el, pos: frontPos(f, .9, 1.1), speed: 36, radius: .75, dmg: 60, kb: 4, life: .8, vis: 'wind' }));
    else if (el === 'ice') spawnBall(f, t, S({ el: 'ice', pos: frontPos(f, .9, 1.3), speed: 30, radius: .4, dmg: 60, kb: 2, slow: 1.5, slowPct: .2, vis: 'ice_needle' }));
    else { // lightning: warned narrow line
      const fw = fwdOf(f); const a = frontPos(f, .8, 0); a.y = groundAt(a.x, a.z, f.pos.y + .2); const b = a.clone().addScaledVector(fw, 14); const r = Math.hypot(b.x, b.z); if (r > CFG.ARENA_R) b.multiplyScalar(CFG.ARENA_R / r);
      telegraphLine(a, b, .8, 0xb48cff, .3);
      later(.3, () => { if (game.state !== 'fight' && game.state !== 'ko') return; const from = a.clone().setY(a.y + 1.2), to = b.clone().setY(b.y + 1.2); boltFX(from, to, 0xd0c4ff, .12, .3, .4); fb('lightning_beam', { pos: from.clone().lerp(to, .5), size: [a.distanceTo(b), 1.4], mode: 'beam', dir: fw.clone(), speed: 2 }); Sfx.play('lightning');
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        for (const T of opps(f)) { const k = clamp(((T.pos.x - a.x) * dx + (T.pos.z - a.z) * dz) / L2, 0, 1);
        if (!T.ghost() && Math.hypot(T.pos.x - a.x - dx * k, T.pos.z - a.z - dz * k) < 1) applyHit(f, T, S({ dmg: 65, kb: 2, el: 'lightning', from: a, beam: true })); } });
    }
    Sfx.play(el === 'ice' ? 'water' : el);
  } });
  // ---- skill 2 (shared slot m2)
  def('m2', { slot: 'm2', el: 'fire', anim: 'push', clip: 'magic2h', speed: 2, hit: .25, dur: .6, rel: .25, cd: MM.s2.cd, cost: MM.s2.cost, energy: true, fn(f, t) {
    const el = f.melEl, cid = f.castId, S = (o) => Object.assign({ skill: true, castId: cid, seal: el }, o);
    if (el === 'fire') { for (let k = 1; k <= 3; k++) fb('fire_wall', { pos: f.pos.clone().addScaledVector(fwdOf(f), k * 1.5).setY(f.pos.y + 1.1), size: [2 + k * .5, 1.6], mode: 'up', speed: 1.6, boost: 1.1 }); coneHit(f, t, 5, .75, 105, S({ kb: 3, el, heavy: true })); }
    else if (el === 'water') { const p = spawnWave(f, t, S({ el: 'water', speed: 14, width: 3.4, height: 1.1, dmg: 85, kb: 8, launch: 0, life: 1.4, vis: 'water', push: true })); p.fbh = [fb('water_wave', { follow: () => p.dead ? null : p.pos, off: new V3(0, 1.1, 0), size: 3.2, loop: true })]; }
    else if (el === 'earth') { spawnWall(f, t, { hp: 180, life: 3, both: true }); }
    else if (el === 'wind') { coneHit(f, t, 6, .7, 70, S({ kb: 9, el, push: true })); fb('dust_wave', { pos: f.pos.clone().addScaledVector(fwdOf(f), 2.6).setY(f.pos.y + .7), size: [5, 2.4], mode: 'up', speed: 1.5, opacity: .8 }); f.sts.haste = 2;
      for (let k = 1; k <= 3; k++) fb('water_vortex', { pos: f.pos.clone().addScaledVector(fwdOf(f), k * 1.6).setY(f.pos.y + 1.1), size: 1.3 + k * .4, desat: 1, tint: 0xffffff, boost: 1.3, opacity: .6, speed: 1.8 }); }
    else if (el === 'ice') { fb('ice_spike', { pos: f.pos.clone().addScaledVector(fwdOf(f), 2.2).setY(f.pos.y + .1), size: [3.6, 3.4], mode: 'up', speed: 1.4 }); if (coneHit(f, t, 3.8, .65, 75, S({ kb: 1, el: 'ice', freeze: true }))) { } }
    else { // thunder step: short attack dash
      const d = _v1.copy(t.pos).sub(f.pos).setY(0).normalize(); f.startDash(d, BAL.dashSpeed * 1.1, .26, 'lightning'); f.dashAttack = { dmg: 85, el: 'lightning', hit: false, seal: 'lightning', castId: cid }; }
    Sfx.play(el === 'ice' ? 'water' : el);
  } });
  // ---- fusion (slot mf) — needs a stored seal + a different current element
  def('mfuse', { slot: 'mf', el: 'fire', anim: 'burst', clip: 'magic_area', speed: 2, hit: .3, dur: .7, rel: .3, cd: MM.fuse.cd, cost: MM.fuse.cost, energy: true, power: 2, fn(f, t) {
    const pair = f.pendingFuse; if (!pair) return; const [a, b] = pair; const key = fuseKey(a, b); const cid = f.castId, S = (o) => Object.assign({ skill: true, castId: cid }, o);
    popText(f.pos.clone().setY(f.pos.y + 2.6), FUSE[key].toUpperCase(), '#ffe9a0', 22); Sfx.play('chain');
    const fw = fwdOf(f);
    switch (key) {
      case 'fire+water': { const c = f.pos.clone().setY(f.pos.y + 1); fb('explosion', { pos: c, size: 5, opacity: .9 }); fb('water_splash', { pos: c, size: 4.5, speed: 1.6 }); FX.burst(c, 'fire', 20, 6); Sfx.play('explode'); shake(.4); if (t.pos.distanceTo(f.pos) < 4) applyHit(f, t, S({ dmg: 95, kb: 9, el: 'water', from: f.pos, heavy: true, push: true })); break; }
      case 'earth+fire': spawnBall(f, t, S({ el: 'fire', pos: frontPos(f, 1.1, 0), speed: 13, radius: .8, dmg: 100, kb: 7, vis: 'rock', life: 3, trail: 'fire_loop', trailSize: 1.8, aoe: { r: 2.6, dmg: 40, el: 'fire' } })); break;
      case 'fire+wind': { const p = spawnTornado(f, t, S({ el: 'fire', speed: 7, life: 2, radius: 1.6, tick: 130 / 8, tickRate: .25 })); p.fbh = [fb('tornado', { follow: () => p.dead ? null : p.pos, off: new V3(0, 2, 0), size: [3, 4.4], loop: true, mode: 'up', tint: 0xffa050, boost: 1.2 })]; break; }
      case 'fire+ice': spawnBall(f, t, S({ el: 'ice', pos: frontPos(f, .9, 1.3), speed: 30, radius: .45, dmg: 40, kb: 2, vis: 'ice_needle', aoe: { r: 2.8, dmg: 85, el: 'fire' } })); break;
      case 'fire+lightning': { const a = frontPos(f, .8, 0); a.y = groundAt(a.x, a.z, f.pos.y + .2); const b = a.clone().addScaledVector(fw, 16); const r0 = Math.hypot(b.x, b.z); if (r0 > CFG.ARENA_R) b.multiplyScalar(CFG.ARENA_R / r0); telegraphLine(a, b, 1, 0xffb060, .7);
        later(.7, () => { if (game.state !== 'fight' && game.state !== 'ko') return; const from = a.clone().setY(a.y + 1.2), to = b.clone().setY(b.y + 1.2); boltFX(from, to, 0xffc080, .2, .3, .2); fb('lightning_beam', { pos: from.clone().lerp(to, .5), size: [a.distanceTo(b), 2], mode: 'beam', dir: fw.clone(), tint: 0xffb070, speed: 2, boost: 1.3 }); fb('fire_burst', { pos: to, size: 2.5 }); Sfx.play('lightning'); Sfx.play('fire');
          const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; const k = clamp(((t.pos.x - a.x) * dx + (t.pos.z - a.z) * dz) / L2, 0, 1); if (!t.ghost() && Math.hypot(t.pos.x - a.x - dx * k, t.pos.z - a.z - dz * k) < 1.2) applyHit(f, t, S({ dmg: 135, kb: 5, el: 'fire', from: a, beam: true, heavy: true })); }); break; }
      case 'earth+water': { const c = aimPoint(f, t, .25); const z = addLava(f, { kind: 'circle', c, r: 2.6, dur: 3, dps: 0 }); z.slowPct = .25; z.mud = true; fb('dust_puff', { pos: c.clone().setY(c.y + .4), size: 3.4, opacity: .9, tint: 0x6a5134, speed: 1.4 }); if (!t.ghost() && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < 2.6) applyHit(f, t, S({ dmg: 70, kb: 1, el: 'earth', from: c })); break; }
      case 'water+wind': { const p = spawnTornado(f, t, S({ el: 'water', speed: 6.5, life: 2.2, radius: 1.8, tick: 100 / 8, tickRate: .27, pull: 3 })); p.fbh = [fb('tornado', { follow: () => p.dead ? null : p.pos, off: new V3(0, 2, 0), size: [3.2, 4.6], loop: true, mode: 'up', tint: 0x9fd4ff }), fb('water_vortex', { follow: () => p.dead ? null : p.pos, off: new V3(0, .15, 0), size: 3.6, mode: 'flat', loop: true, opacity: .7 })]; break; }
      case 'ice+water': { const p = spawnWave(f, t, S({ el: 'ice', speed: 12, width: 4.5, height: 1.1, dmg: 90, kb: 2, launch: 0, life: 1.6, vis: 'water', freeze: true })); p.fbh = [fb('water_wave', { follow: () => p.dead ? null : p.pos, off: new V3(0, 1.1, 0), size: 4, loop: true, tint: 0xbfe9ff })]; break; }
      case 'lightning+water': { const c = aimPoint(f, t, .25); const z = addLava(f, { kind: 'circle', c, r: 2.6, dur: 3, dps: 35 }); z.zap = true; fb('water_vortex', { pos: c.clone().setY(c.y + .12), size: 5, mode: 'flat', loop: true, life: 3, opacity: .8 }); break; }
      case 'earth+wind': { for (let i = 0; i < 8; i++) later(i * .12, () => { if (f.state === 'ko') return; spawnBall(f, t, { el: 'earth', pos: frontPos(f, .8, 1.3), speed: 32, radius: .3, dmg: 15, kb: 1.5, spread: rand(-.12, .12), vis: 'pebble', life: 1.2, skill: true, castId: cid, multi: true }); }); fb('dust_wave', { pos: f.pos.clone().addScaledVector(fw, 3).setY(f.pos.y + .8), size: [6, 3], mode: 'up', speed: 1.4, opacity: .85 }); break; }
      case 'earth+ice': { f.shieldHp = 120; f.shieldT = 4; fb('ice_spike', { follow: () => f.shieldHp > 0 ? f.pos.clone().setY(f.pos.y + .1) : null, size: [3, 2.8], mode: 'up', loop: true, life: 4, opacity: .9 }); fb('rocks_float', { follow: () => f.shieldHp > 0 ? f.pos.clone().setY(f.pos.y + 1.2) : null, size: 2.4, loop: true, life: 4, opacity: .9 }); popText(f.pos.clone().setY(f.pos.y + 2.5), 'SHIELD 120', '#bfe9ff', 20); break; }
      case 'earth+lightning': { const P = aimPoint(f, t, .3); telegraph(P, 1.6, 0xd0c4ff, .9); later(.9, () => { if (game.state !== 'fight' && game.state !== 'ko') return; fb('ice_spike', { pos: P.clone().setY(P.y + .1), size: [2.6, 3], mode: 'up', tint: 0xcaa96a, speed: 1.6 }); boltFX(P.clone().setY(P.y + 8), P, 0xd0c4ff, .25, .3, 1); fb('bolt_branch', { pos: P.clone().setY(P.y + 2.6), size: [3, 5], mode: 'up', speed: 1.8 }); FX.earth(P.clone().setY(P.y + .3), 14, 1.2); Sfx.play('thunder'); Sfx.play('earth'); shake(.5); if (!t.ghost() && Math.hypot(t.pos.x - P.x, t.pos.z - P.z) < 1.9 && t.pos.y - P.y < 2.4) applyHit(f, t, S({ dmg: 125, kb: 2, launch: 7, el: 'lightning', from: P, heavy: true })); }); break; }
      case 'ice+wind': { const ticks = 7; for (let i = 0; i < ticks; i++) later(.15 + i * 2 / ticks, () => { if (game.state !== 'fight' && game.state !== 'ko') return; for (const o of [-1, 0, 1]) fb('ice_burst', { pos: f.pos.clone().addScaledVector(fwdOf(f), 2 + i * .5).add(_v2.set(Math.cos(f.yaw) * o * 1.2, 1 + rand(0, .8), -Math.sin(f.yaw) * o * 1.2)), size: 1.5, speed: 2.4, opacity: .8 }); coneHit(f, t, 6.5, .6, 90 / ticks, S({ el: 'ice', multi: true, noStagger: true, slow: 2, slowPct: .25 })); }); fb('dust_wave', { pos: f.pos.clone().addScaledVector(fw, 3).setY(f.pos.y + 1), size: [6, 3], mode: 'up', tint: 0xcfe9ff, opacity: .8, speed: 1.3, life: 2 }); break; }
      case 'lightning+wind': { const d = _v1.copy(t.pos).sub(f.pos).setY(0).normalize(); f.startDash(d, BAL.dashSpeed * 1.25, .3, 'lightning'); f.dashAttack = { dmg: 110, el: 'lightning', hit: false, castId: cid }; break; }
      case 'ice+lightning': spawnBall(f, t, S({ el: 'ice', pos: frontPos(f, .9, 1.3), speed: 38, radius: .45, dmg: 85, kb: 1, vis: 'ice_needle', root: .7, trail: 'lightning_orb', trailSize: .9 })); break;
    }
    f.seal = null;
  } });
  // ---- super
  def('m_su', { el: 'wind', anim: 'ult', clip: 'magic2h3', speed: 1.4, dur: MM.su.warn + 1.3, rel: MM.su.warn, cd: 1, super: true, power: 3, label: MM.su.name, noMove: true,
    onStart(f, t) { f.suP = aimPoint(f, t, .3); telegraph(f.suP, MM.su.radius, 0xffe9a0, MM.su.warn); },
    fn(f, t) { const P = f.suP, cid = f.castId, R = MM.su.radius;
      const stage = (i, fx) => later(i * .5, () => { if (game.state !== 'fight' && game.state !== 'ko') return; fx(); Sfx.play(i === 2 ? 'explode' : i === 1 ? 'wind' : 'earth'); shake(.4 + i * .2); for (const T of opps(f)) if (!T.ghost() && Math.hypot(T.pos.x - P.x, T.pos.z - P.z) < R && T.pos.y - P.y < 3) applyHit(f, T, { dmg: MM.su.waves[i], kb: i === 2 ? 9 : 2, el: ['earth', 'ice', 'fire'][i], from: P, heavy: i === 2, skill: true, castId: cid, multi: i < 2, push: i === 2 }); });
      stage(0, () => { fb('rock_burst', { pos: P.clone().setY(P.y + .8), size: 4.5 }); fb('water_wave', { pos: P.clone().setY(P.y + 1), size: 4 }); fb('dust_puff', { pos: P.clone().setY(P.y + .3), size: 3.5, opacity: .8 }); });
      stage(1, () => { fb('ice_spike', { pos: P.clone().setY(P.y + .1), size: [4.5, 4.2], mode: 'up', speed: 1.5 }); fb('dust_wave', { pos: P.clone().setY(P.y + .9), size: [6, 3], mode: 'up', tint: 0xcfe9ff, speed: 1.4 }); });
      stage(2, () => { fb('explosion', { pos: P.clone().setY(P.y + 2.2), size: 7.5 }); fb('bolt_branch', { pos: P.clone().setY(P.y + 3), size: [4, 7], mode: 'up', speed: 1.7, boost: 1.3 }); fb('fire_ring', { pos: P.clone().setY(P.y + .12), size: 8 }); flashSky(); });
    } });
}
buildKits(); buildKazanKit(); buildRakanKit(); buildBasics(); buildSiraKit(); buildRaynKit(); buildMasterKit(); buildMasterBasics(); buildBladeBasics();
// ---------------------------------------------------------------- HIT RESOLUTION
function applyHit(att, tgt, h) {
  if (att && att.boss && h && h.dmg) h = Object.assign({}, h, { dmg: h.dmg * BOSS.dmg });
  if (tgt && tgt.boss && h) h = Object.assign({}, h, { kb: (h.kb || 0) * .4, launch: (h.launch || 0) * .35, stun: (h.stun || 0) * .5, knockdown: h.knockdown && Math.random() < .35 });
  if (att && att.isMaster && h && h.dmg && !h._mm) { h = Object.assign({}, h, { dmg: h.dmg * (MM.dmgMul || 1), _mm: 1 }); }
  if (tgt.invuln > 0 || tgt.state === 'ko' || (game.state !== 'fight' && game.state !== 'ko')) return 'miss';
  const from = h.from || att.pos;
  _v1.copy(from).sub(tgt.pos).setY(0).normalize();
  const fwd = _v2.set(Math.sin(tgt.yaw), 0, Math.cos(tgt.yaw)); const facing = fwd.dot(_v1) > .1;
  const hitPos = tgt.pos.clone().setY(tgt.pos.y + 1.1).addScaledVector(_v1, .3);
  if (tgt.state === 'block' && facing && !h.unblockable) {
    const perfect = (game.time - tgt.blockStart) < BAL.perfectWindow;
    const p = h.proj;
    if (perfect && p && p.kind === 'ball' && p.power < 3) {
      p.owner = tgt; p.dir = aimDir(tgt, p.pos, att); p.speed *= 1.2; p.t = 0; p.castId = null; p.skill = false;
      FX.sparks(hitPos, [1, .9, .5], 26, 9); FX.shock(hitPos, tgt.el || 'wind', 1.2); Sfx.play('perfect'); popText(hitPos, 'PERFECT! ↩', '#9ff', 26); hitstop(.08); vibrate(30);
      return 'reflect';
    }
    const chip = Math.round(h.dmg * BAL.blockChip);
    tgt.hp -= chip; if (tgt.isDummy) tgt.hp = Math.max(1, tgt.hp); tgt.vel.addScaledVector(_v1, -Math.min(3, Math.abs(h.kb || 2) * .4)); tgt.blockFlash = .15;
    tgt.spirit = Math.min(100, tgt.spirit + chip * BAL.superPerTaken); att.spirit = Math.min(100, att.spirit + chip * BAL.superPerDealt * .5);
    FX.sparks(hitPos, EL[h.el || 'wind'].c, 14, 6); Sfx.play('block'); hitstop(.03); if (chip > 0) popDamage(hitPos, chip, 'block');
    if (tgt.hp <= 0) { tgt.hp = 0; tgt.knock(_v1, 6, 6, true); onKO(tgt); }
    return 'block';
  }
  if (tgt.state === 'cast' && tgt.cast && tgt.cast.a.counter && !h.unblockable && !h.lava && !h.counterPulse) {
    const cr = rakanCounterTry(att, tgt, h); if (cr) return cr;
  }
  let dmg = h.dmg;
  if (h.melee && tgt.sts.static > 0) { dmg += BAL.el.lightning.perk.bonus; tgt.sts.static = 0; for (let i = 0; i < 5; i++) boltFX(hitPos, hitPos.clone().add(_v3.randomDirection().multiplyScalar(1.2)), 0xd0c4ff, .05, .2); Sfx.play('lightning'); popText(hitPos.clone().setY(hitPos.y + .6), 'STATIC +' + BAL.el.lightning.perk.bonus, '#d8ccff', 18); }
  if (tgt.sts.soak > 0) dmg *= 1 + BAL.el.water.perk.pct;
  dmg *= 1 - charDR(tgt); // highest reduction only, never stacked
  dmg = Math.max(1, Math.round(dmg));
  if (tgt.shieldHp > 0) { // frost-rock shield absorbs before health
    const ab = Math.min(tgt.shieldHp, dmg); tgt.shieldHp -= ab; dmg -= ab;
    FX.ice(hitPos, 8, .5); popText(hitPos, 'ABSORB', '#bfe9ff', 16);
    if (tgt.shieldHp <= 0) { fb('ice_burst', { pos: tgt.pos.clone().setY(tgt.pos.y + 1), size: 2.6, speed: 2 }); Sfx.play('clash'); }
    if (dmg <= 0) return 'absorb';
  }
  const real = Math.min(dmg, Math.max(0, tgt.hp)); tgt.hp -= dmg; tgt.lastHit = game.time; if (tgt.isDummy) tgt.hp = Math.max(1, tgt.hp);
  if (att === hero) { game.stats.dealt += real; game.stats.comboDmg = (game.time - (game.stats.lastHitT || -9) < 1.4 ? game.stats.comboDmg : 0) + dmg; game.stats.lastHitT = game.time; } else if (tgt === hero) game.stats.taken += real;
  const inCombo = (tgt.state === 'hit' || tgt.state === 'down' || !tgt.onGround) && game.time - att.lastComboHit < 1.1;
  att.combo = inCombo ? att.combo + 1 : 1; att.lastComboHit = game.time;
  if (att === hero) { showCombo(att.combo); game.stats.maxCombo = Math.max(game.stats.maxCombo, att.combo); }
  att.spirit = Math.min(100, att.spirit + dmg * (att.spD ?? BAL.superPerDealt)); tgt.spirit = Math.min(100, tgt.spirit + dmg * (tgt.spT ?? BAL.superPerTaken));
  perkOnHit(att, tgt, h, dmg);
  if (att.charId === 'sira' && h.skill && h.el === 'water' && att.wetCast !== h.castId) { att.wetCast = h.castId; siraMark(att, tgt); }
  if (h.burn) { tgt.burnT = Math.max(tgt.burnT, h.burn); tgt.burnDps = att.charId === 'rayn' || h.power3 ? 5 : 2.2; }
  if (h.slow) { tgt.slowT = Math.max(tgt.slowT, h.slow); tgt.slowPct = h.slowPct || .3; }
  let stunT = h.stun || 0;
  const ccFree = tgt.sts.ccImm <= 0;
  if (h.needle) { // Sira: freezes a Wet enemy, otherwise slows
    if (tgt.sts.wet > 0 && ccFree) { tgt.sts.wet = 0; stunT = Math.max(stunT, SR.s2.freeze); tgt.sts.ccImm = 2 + SR.s2.freeze; fb('ice_spike', { pos: tgt.pos.clone().setY(tgt.pos.y + .1), size: [2, 2.2], mode: 'up', speed: 1.6 }); popText(hitPos.clone().setY(hitPos.y + .8), 'FROZEN!', '#bfe9ff', 24); Sfx.play('clash'); }
    else { if (tgt.sts.wet > 0) tgt.sts.wet = 0; tgt.slowT = Math.max(tgt.slowT, SR.s2.slowDur); tgt.slowPct = SR.s2.slow; }
  }
  if (h.freeze && ccFree) { stunT = Math.max(stunT, .7); tgt.sts.ccImm = 2.7; fb('ice_spike', { pos: tgt.pos.clone().setY(tgt.pos.y + .1), size: [2, 2.2], mode: 'up', speed: 1.6 }); popText(hitPos.clone().setY(hitPos.y + .8), 'FROZEN!', '#bfe9ff', 22); }
  if (h.root && ccFree) { tgt.sts.root = h.root; tgt.sts.ccImm = 2 + h.root; popText(hitPos.clone().setY(hitPos.y + .8), 'BOUND!', '#d8ccff', 20); for (let i = 0; i < 4; i++) boltFX(tgt.pos.clone().setY(tgt.pos.y + .2), tgt.pos.clone().setY(tgt.pos.y + 1.6).add(_v3.randomDirection().multiplyScalar(.5)), 0xd0c4ff, .05, .3); }
  if (stunT) tgt.shockT = Math.max(tgt.shockT || 0, stunT), h.stun = stunT;
  if (false && h.seal && att.charId === 'master' && h.castId && att.sealCast !== h.castId) { att.sealCast = h.castId; mSeal(att, h.seal); att.pendingFuse = att.seal && att.seal.el !== att.melEl ? [att.seal.el, att.melEl] : null; }
  if (h.wet && att.charId === 'sira') siraMark(att, tgt);
  FX.sparks(hitPos, EL[h.el || 'fire'].c, h.heavy ? 22 : 12, h.heavy ? 9 : 6); if (h.heavy) FX.shock(hitPos, h.el || 'fire', 1);
  if (!h.proj && !h.multi) impactFX(h.el || 'fire', hitPos, h.heavy, .8);
  popDamage(hitPos, dmg, h.el); Sfx.play(h.heavy ? 'heavy' : 'hit');
  if (!h.multi) { hitstop(h.heavy ? .09 : .05); shake(h.heavy ? .45 : .2); }
  if (tgt === hero) vibrate(h.heavy ? 60 : 25);
  let kb = h.kb || 0, launch = h.launch || 0, kd = !!h.knockdown;
  const forced = launch >= 3 || kd || h.pull || h.lift || h.push || Math.abs(kb) >= 6;
  if (tgt.sts.stab > 0) { kb *= RK.stab.kbRes; launch *= RK.stab.kbRes; }
  if (tgt.sts.ccImm > 0 && forced) { kb = Math.sign(kb) * Math.min(Math.abs(kb), 1.5); launch = 0; kd = false; }
  else if (forced) tgt.sts.ccImm = 1 + (launch > 0 ? 2 * launch / CFG.GRAVITY : 0) + (kd ? 1.9 : 0);
  if (tgt.hp <= 0) { tgt.hp = 0; tgt.knock(_v1, Math.max(7, Math.abs(kb)), Math.max(7, launch), true); onKO(tgt); return 'hit'; }
  if (kd) tgt.knock(_v1, kb, launch || 5, false);
  else if (!h.noStagger) tgt.stagger(_v1, kb, launch, Math.max(h.heavy ? .45 : .32, h.stun || 0));
  return 'hit';
}
function perkOnHit(att, tgt, h, dmg) {
  if (att.charId === 'kazan') return kazanPerk(att, tgt, h, dmg);
  if (att.isMaster || !att.el) return;
  const P = BAL.el[att.el].perk, once = !!h.castId && att.perkCast !== h.castId, head = att.pos.clone().setY(att.pos.y + 2.3);
  if (P.kind === 'lifesteal' && h.skill) {
    if (att.healCast !== h.castId) { att.healCast = h.castId; att.healed = 0; }
    const amt = Math.min(P.cap - att.healed, dmg * P.pct);
    if (amt > .5) { att.healed += amt; att.hp = Math.min(att.maxHp, att.hp + amt); popText(head, '+' + Math.round(amt), '#7dff9a', 18); FX.el('fire', att.pos.clone().setY(att.pos.y + 1), 6, .5, _v3.set(0, 2, 0), .8); }
  } else if (P.kind === 'soak' && h.melee && h.third && (att.icd.soak || 0) <= 0) {
    tgt.sts.soak = P.dur; att.icd.soak = P.icd; popText(tgt.pos.clone().setY(tgt.pos.y + 2.3), 'SOAKED', '#9fd4ff', 20); fb('water_splash', { pos: tgt.pos.clone().setY(tgt.pos.y + 1.1), size: 2.4 });
  } else if (P.kind === 'haste' && h.skill && once && (att.icd.haste || 0) <= 0) {
    att.sts.haste = P.dur; att.icd.haste = P.icd; popText(head, 'HASTE', '#e8f6ff', 18);
  } else if (P.kind === 'static' && h.skill && once && (att.icd.static || 0) <= 0) {
    tgt.sts.static = P.dur; att.icd.static = P.icd; popText(tgt.pos.clone().setY(tgt.pos.y + 2.3), 'STATIC', '#d8ccff', 18);
  }
  if (h.castId) att.perkCast = h.castId;
}
function vibrate(ms) { try { if (IS_TOUCH && SETTINGS.vibrate && navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

// ---------------------------------------------------------------- MIXAMO CHARACTER (Raven GLB)
let RAVEN_GLB = null;
const CHAR_GLB = {}, CHAR_META = {}, CHAR_LOADING = {};
const CLIP_SPEED = { walk: 1.6, walk_back: 1.5, strafe_left: 1.7, strafe_right: 1.7, run: 4.8 };
function loadCharGLB(id, onP = () => { }) {
  if (CHAR_GLB[id]) { onP(1); return Promise.resolve(true); }
  if (CHAR_LOADING[id]) { CHAR_LOADING[id].cbs.push(onP); return CHAR_LOADING[id].p; }
  const L = CHAR_LOADING[id] = { cbs: [onP] };
  fetch(`assets/${id}_meta.json`).then(r => r.json()).then(j => CHAR_META[id] = j).catch(() => { });
  L.p = new Promise(res => newGLTF().load(`assets/${id}.glb`, g => {
    const clips = {};
    for (const c of g.animations) {
      for (const tr of c.tracks) if (/Hips\.position$/.test(tr.name)) { // keep the character in place: physics moves the root
        const v = tr.values, x0 = v[0], y0 = v[1], z0 = v[2], capY = ['jump', 'jump_up', 'wall_jump', 'fall'].includes(c.name);
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; if (capY) v[i + 1] = Math.min(v[i + 1], y0); }
      }
      clips[c.name] = c;
    }
    g.clips = clips; CHAR_GLB[id] = g; if (id === 'raven') RAVEN_GLB = g; delete CHAR_LOADING[id]; L.cbs.forEach(f => f(1)); res(true);
  }, x => { if (x.total) L.cbs.forEach(f => f(x.loaded / x.total)); }, e => { console.warn(id + '.glb not loaded', e); delete CHAR_LOADING[id]; res(false); }));
  return L.p;
}
const loadRavenGLB = onP => loadCharGLB('raven', onP);
const SWORDS = {}, SWORD_FOR = { sira: 'ice', rayn: 'fire' };
function loadSword(kind) { if (SWORDS[kind]) return Promise.resolve(); return new Promise(res => newGLTF().load(`assets/sword_${kind}.glb`, g => {
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new V3()), c = box.getCenter(new V3());
  const k = 2 / Math.max(1e-6, size.y); // bake to a -1..1 sword along +Y whatever the file's node scales are
  const w = new THREE.Group(); g.scene.scale.multiplyScalar(k); g.scene.position.set(-c.x * k, -c.y * k, -c.z * k); w.add(g.scene);
  w.userData.info = swordInfo(w); SWORDS[kind] = w; res();
}, undefined, () => res())); }
function swordInfo(root) { // find where the guard is (widest slice) -> the short side of it is the handle; and which axis is the blade's width
  root.updateMatrixWorld(true); const N = 48, wx = new Float32Array(N), wz = new Float32Array(N), mnx = [], mxx = [], mnz = [], mxz = []; for (let i = 0; i < N; i++) { mnx[i] = mnz[i] = 9; mxx[i] = mxz[i] = -9; }
  const v = new V3();
  root.traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position, st = Math.max(1, Math.floor(P.count / 20000));
    for (let i = 0; i < P.count; i += st) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); const b = Math.max(0, Math.min(N - 1, Math.floor((v.y + 1) / 2 * N))); mnx[b] = Math.min(mnx[b], v.x); mxx[b] = Math.max(mxx[b], v.x); mnz[b] = Math.min(mnz[b], v.z); mxz[b] = Math.max(mxz[b], v.z); } });
  let gi = 0, gw = 0; for (let i = 0; i < N; i++) { wx[i] = Math.max(0, mxx[i] - mnx[i]); wz[i] = Math.max(0, mxz[i] - mnz[i]); const wd = Math.max(wx[i], wz[i]); if (wd > gw) { gw = wd; gi = i; } }
  const flip = gi > N / 2; // guard in the upper half -> handle is on top -> turn the sword over
  const guardY = ((flip ? N - 1 - gi : gi) + .5) / N * 2 - 1; // guard position once the handle is at -1
  let sx = 0, sz = 0; for (let i = 0; i < N; i++) { const j = flip ? N - 1 - i : i; const y = (i + .5) / N * 2 - 1; if (y > guardY + .25 && y < .7) { sx += wx[j]; sz += wz[j]; } }
  return { flip, gripY: (-1 + guardY) / 2, wide: sx >= sz ? 'x' : 'z', guardY };
}
const SWORD_FIT = { ice: { len: 1.05 }, fire: { len: 1.3 } };
function attachSword(R, id) {
  const kind = SWORD_FOR[id]; if (!kind) return;
  const put = () => { const G = R.glb, hb = G.b.RightHand; if (!hb || G.sword || !SWORDS[kind]) return;
    R.root.updateMatrixWorld(true);
    const ix = G.model.getObjectByName('mixamorigRightHandIndex1');
    const F = SWORD_FIT[kind], info = SWORDS[kind].userData.info, ws = hb.getWorldScale(new V3()).x || 1;
    const holder = new THREE.Group(), g = SWORDS[kind].clone(true);
    if (info.flip) g.rotation.z = Math.PI; // handle down
    g.position.y = -info.gripY; // middle of the handle sits in the fist
    holder.add(g);
    // calibrated on the sword animations: the blade leaves the fist along the hand bone's -Z (upright in Rayn's great-sword idle,
    // outward in every slash); the edge faces the knuckles (+Y)
    const a = new V3(0, 0, -1), f = new V3(0, 1, 0), m = new THREE.Matrix4();
    if (info.wide === 'x') m.makeBasis(f, a, new V3().crossVectors(f, a)); else m.makeBasis(new V3().crossVectors(a, f), a, f);
    holder.quaternion.setFromRotationMatrix(m);
    if (ix) holder.position.copy(ix.position).multiplyScalar(.72); // inside the fist, just short of the knuckles
    holder.scale.setScalar(F.len / 2 / Math.max(1e-6, ws));
    hb.add(holder); G.sword = holder; G.swordTipLocal = new V3(0, 1 - info.gripY, 0); };
  if (SWORDS[kind]) put(); else loadSword(kind).then(put);
}
const gmeta = G => CHAR_META[G.id] || {};
const BONES = ['Hips', 'Spine', 'Neck', 'HeadTop_End', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
function attachRavenGLB(R, el, variant, id = 'raven') {
  const SRC = CHAR_GLB[id]; const model = SkeletonUtils.clone(SRC.scene);
  const holder = new THREE.Group(); R.root.add(holder); holder.add(model);
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true); const s = ((BAL.chars[id] || {}).height || 1.85) / Math.max(.01, box.max.y - box.min.y); model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model, true);
  model.position.x -= (box.min.x + box.max.x) / 2; model.position.z -= (box.min.z + box.max.z) / 2; model.position.y -= box.min.y;
  const tint = variant === 'b' ? (id === 'kazan' ? new THREE.Color(.8, .85, 1) : new THREE.Color(1, .82, .66)) : id === 'kazan' ? new THREE.Color(1, 1, 1) : new THREE.Color(1, 1, 1).lerp(new THREE.Color(el ? EL[el].color : 0xffffff), .07);
  model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.copy(tint); if (el) { o.material.emissive = new THREE.Color(EL[el].color); o.material.emissiveIntensity = .025; } o.castShadow = true; o.frustumCulled = false; } });
  const b = {}; for (const n of BONES) b[n] = model.getObjectByName('mixamorig' + n);
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const [n, c] of Object.entries(SRC.clips)) { const a = mixer.clipAction(c); if (['jump_up', 'land', 'hard_land', 'roll', 'run_stop'].includes(n)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; } actions[n] = a; }
  R.bodyMeshes.forEach(m => m.visible = false);
  R.glb = { model, holder, mixer, actions, b, cur: null, retW: 0, id };
  attachSword(R, id);
  playClip(R.glb, 'idle', 0);
}
function playClip(G, name, fade = .18) {
  if (!G.actions[name] || G.cur === name) return;
  const a = G.actions[name]; a.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (G.cur) G.actions[G.cur].fadeOut(fade);
  G.cur = name;
}
const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qI = new THREE.Quaternion(), _pA = new V3(), _pB = new V3(), _pC = new V3(), _pD = new V3();
function aimBone(bone, child, from, to, w) { // rotate bone so bone→child points like from→to (world space)
  if (!bone || !child) return;
  bone.getWorldPosition(_pA); child.getWorldPosition(_pB); _pB.sub(_pA).normalize();
  _pD.copy(to).sub(from).normalize(); if (_pD.lengthSq() < .5) return;
  _qA.setFromUnitVectors(_pB, _pD); if (w < 1) _qA.slerpQuaternions(_qI, _qA, w);
  bone.getWorldQuaternion(_qB); _qB.premultiply(_qA);
  bone.parent.getWorldQuaternion(_qA).invert(); bone.quaternion.copy(_qA.multiply(_qB)); bone.updateMatrixWorld(true);
}
let META = {};
function playAttack(G, clip, start, speed, key) {
  const a = G.actions[clip]; if (!a) return false; if (G.key === key) return true;
  const same = G.cur === clip;
  if (!same) { a.reset(); a.setEffectiveWeight(1).fadeIn(.1); if (G.cur) G.actions[G.cur].fadeOut(.1); }
  a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.paused = false; a.enabled = true; a.timeScale = speed; a.time = Math.max(0, start); a.play();
  G.cur = clip; G.key = key; return true;
}
const impactStart = (G, clip, hit, speed) => { const M = gmeta(G); return Math.max(0, ((M[clip] && M[clip].impact) || hit * speed) - hit * speed); };
function animateGLB(f, dt, lz, lx, hs) {
  const R = f.rig, G = R.glb, st = f.state;
  let clip = G.cur, ret = true, drove = false;
  if (f.emote && st === 'idle') drove = playAttack(G, f.emote.clip, 0, 1, 'e' + f.emote.id);
  else if (st === 'cast' && f.cast && f.cast.a.clip) { const a = f.cast.a; drove = playAttack(G, a.clip, impactStart(G, a.clip, a.rel, a.speed || 1), a.speed || 1, 'c' + f.castId); }
  else if (st === 'melee' && f.melee) { const md = (MELEE_OV[f.charId] || {})[f.melee.i] || MELEE[f.melee.i]; drove = playAttack(G, md.clip, impactStart(G, md.clip, md.hit, md.speed * (f.comboSpd || 1)), md.speed * (f.comboSpd || 1), 'm' + f.castId); }
  else if (st === 'hit') drove = playAttack(G, f.stun > .6 ? 'stunned' : 'hit', f.stun > .6 ? 0 : .05, f.stun > .6 ? 1.2 : 1.7, 'h' + f.hitId);
  else if (st === 'down' || st === 'ko') drove = playAttack(G, 'dying', 0, st === 'ko' ? 1.05 : 1.7, 'd' + f.downId);
  else if (st === 'getup') drove = playAttack(G, 'getup', .35, 2.6, 'g' + f.downId);
  else if (st === 'dash') drove = playAttack(G, 'roll2', .12, 3.4, 'r' + f.dashId);
  else if (st === 'block') { drove = playAttack(G, 'block', ((gmeta(G).block && gmeta(G).block.impact) || 1.1) - .25, 1, 'b' + f.blockStart); const a = G.actions.block; if (a.time >= ((gmeta(G).block && gmeta(G).block.impact) || 1.1)) a.timeScale = 0; }
  else if (st === 'win') drove = playAttack(G, 'victory', 0, 1, 'win');
  if (drove) { ret = false; clip = null; } else G.key = null;
  if (drove) { }
  else if (st === 'idle' && f.onGround) {
    ret = false;
    if (hs > .6) { const fz = lz / hs, fx = lx / hs; clip = fz > .5 ? (hs > 3.2 ? 'run' : 'walk') : fz < -.5 ? 'walk_back' : (fx > 0 ? 'strafe_left' : 'strafe_right'); G.actions[clip].timeScale = clamp(hs / CLIP_SPEED[clip], .6, 2.2); }
    else clip = 'idle';
  } else if (st === 'air' || (st === 'idle' && !f.onGround)) { ret = false; clip = f.vel.y > 1 ? 'jump_up' : 'fall'; }
  else if (st === 'menu') { ret = false; clip = 'idle'; }
  if (clip) { if (G.actions[clip] && G.actions[clip].loop === THREE.LoopOnce && !['jump_up', 'land', 'hard_land', 'roll', 'run_stop'].includes(clip)) { G.actions[clip].setLoop(THREE.LoopRepeat); } playClip(G, clip); }
  G.mixer.update(dt);
  G.retW = damp(G.retW, ret ? 1 : 0, 16, dt);
  const w = G.retW, cur = f.pose;
  G.holder.rotation.set(cur.body[0] * w, cur.body[1] * w, cur.body[2] * w);
  G.holder.position.y = (cur.hipsY - BASE.hipsY) * w;
  G.model.updateMatrixWorld(true);
  if (w > .01) {
    R.root.updateMatrixWorld(true);
    const P = o => o.getWorldPosition(new V3()), L = (o, x, y, z) => o.localToWorld(new V3(x, y, z)), b = G.b;
    aimBone(b.Spine, b.Neck, P(R.spine), P(R.neck), w);
    aimBone(b.Neck, b.HeadTop_End, P(R.neck), L(R.head, 0, .2, .02), w);
    aimBone(b.LeftArm, b.LeftForeArm, P(R.shL), P(R.elL), w); aimBone(b.LeftForeArm, b.LeftHand, P(R.elL), P(R.handL), w);
    aimBone(b.RightArm, b.RightForeArm, P(R.shR), P(R.elR), w); aimBone(b.RightForeArm, b.RightHand, P(R.elR), P(R.handR), w);
    aimBone(b.LeftUpLeg, b.LeftLeg, P(R.thL), P(R.knL), w); aimBone(b.LeftLeg, b.LeftFoot, P(R.knL), L(R.knL, 0, -.45, 0), w);
    aimBone(b.RightUpLeg, b.RightLeg, P(R.thR), P(R.knR), w); aimBone(b.RightLeg, b.RightFoot, P(R.knR), L(R.knR, 0, -.45, 0), w);
  }
  // hand glows follow the real hands
  for (const [g, hb] of [[R.glowL, b2(G, 'LeftHand')], [R.glowR, b2(G, 'RightHand')]]) { if (g.parent !== R.root) R.root.add(g); g.position.copy(R.root.worldToLocal(hb.getWorldPosition(new V3()))); }
}
const b2 = (G, n) => G.b[n];

// ---------------------------------------------------------------- TRAINING DUMMY (built in code)
function buildDummy() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body); g.userData.body = body;
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: .85 }), straw = new THREE.MeshStandardMaterial({ color: 0xc8a560, roughness: .95 }), rope = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: .9 }), cloth = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: .9 });
  const add = (geo, m, x, y, z, p = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  add(new THREE.CylinderGeometry(.38, .44, .14, 18), wood, 0, .07, 0, g);
  add(new THREE.CylinderGeometry(.07, .08, 1.9, 8), wood, 0, .95, 0);
  const torso = add(new THREE.CylinderGeometry(.3, .26, .95, 14), straw, 0, 1.25, 0); torso.scale.z = .8;
  for (const y of [.95, 1.25, 1.55]) add(new THREE.TorusGeometry(.29, .025, 6, 18), rope, 0, y, 0).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(.05, .05, 1.3, 8), wood, 0, 1.55, 0).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) { const a = add(new THREE.CylinderGeometry(.09, .08, .45, 10), straw, s * .5, 1.55, 0); a.rotation.z = Math.PI / 2; }
  add(new THREE.SphereGeometry(.2, 14, 10), straw, 0, 1.95, 0); add(new THREE.ConeGeometry(.23, .2, 14), cloth, 0, 2.12, 0);
  const tgt = add(new THREE.CircleGeometry(.12, 20), new THREE.MeshStandardMaterial({ color: 0xb02a1e, emissive: 0x3a0a06 }), 0, 1.35, .215); tgt.scale.y = 1.2;
  return g;
}
// ---------------------------------------------------------------- FIGHTER
const MELEE_OV = { rakan: { 2: { clip: 'kick2', anim: 'punch', dur: 1.0, hit: .55, speed: 1.15, kb: 9, launch: 2, reach: 2.5, heavy: true, push: true } } };
const MELEE = [
  { clip: 'jab2', anim: 'jab', dur: .36, hit: .13, speed: 1.5, kb: 1.6, reach: 1.75 },
  { clip: 'cross', anim: 'cross', dur: .4, hit: .15, speed: 1.6, kb: 2.2, reach: 1.8 },
  { clip: 'kick2', anim: 'kick', dur: .62, hit: .24, speed: 1.5, kb: 6, launch: 4, reach: 2.05, heavy: true },
];
class Fighter {
  constructor(o) {
    Object.assign(this, { name: o.name, isMaster: o.isMaster, isPlayer: !!o.isPlayer, el: o.el || null, kit: o.kit || null });
    this.blockStyle = o.blockStyle || (o.isMaster ? 'all' : o.el);
    this.rig = buildRig(o.isMaster ? 'hero' : 'raven', o.el ? EL[o.el].color : 0xffffff, o.el, o.variant || 'a');
    if (o.dummy) { this.isDummy = true; this.rig.root.traverse(m => { if (m.isMesh || m.isSprite || m.isPoints) m.visible = false; }); this.rig.root.add(this.dummyMesh = buildDummy()); this.wob = 0; this.wobV = 0; this.lastHitId = 0; }
    else if (CHAR_GLB[o.isMaster ? 'master' : (o.char || 'raven')]) attachRavenGLB(this.rig, o.isMaster ? null : o.el, o.variant || 'a', o.isMaster ? 'master' : (o.char || 'raven'));
    this.charId = o.dummy ? 'dummy' : o.isMaster ? 'master' : (o.char || 'raven');
    const CS = BAL.chars[this.charId] || BAL.chars.raven; this.maxHp = CS.hp; this.dashMax = CS.dashCD; this.comboDmg = CS.combo; this.dashMul = CS.dashMul || 1;
    if (this.charId === 'kazan' && this.rig.glb) { const b = this.rig.glb.b; this.heatGlow = [b.LeftForeArm, b.LeftHand, b.RightHand].filter(Boolean).map((bn, i) => { this.rig.root.updateMatrixWorld(true); const ws = bn.getWorldScale(new V3()).x || 1; const g = glowSprite(0xff5a10, (i === 1 ? .6 : .45) / ws, 0); g.material.opacity = 0; bn.add(g); return g; }); }
    scene.add(this.rig.root);
    this.pos = new V3(); this.vel = new V3(); this.yaw = 0;
    this.pose = clonePose(BASE); this.poseV = {}; for (const n of JN) this.poseV[n] = [0, 0, 0]; this.poseV.hipsY = 0;
    this.intent = this.blankIntent();
    this.speed = o.speed || 6.6; this.armor = o.armor || 1; this.maxAirJumps = o.airJumps ?? 1; this.canGlide = o.glide ?? true; this.heal = o.heal || 0;
    this.cds = {}; this.spirit = 0; this.reset(new V3());
  }
  blankIntent() { return { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, melee: false, block: false, elems: [], ult: false, ability: null }; }
  reset(p) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.hp = this.maxHp || BAL.hp; this.dispHp = 100; this.heat = 0; this.heatT = 0; this.lavaAcc = 0; this.trailHp = 100; this.sts = { soak: 0, fort: 0, haste: 0, static: 0, stab: 0, wet: 0, root: 0, ccImm: 0 }; this.embers = 0; this.emberT = 0; this.igniteT = 0; this.shieldHp = 0; this.shieldT = 0; this.seal = null; this.pendingFuse = null; this.swapCd = 0; this.dashAttack = null; this.lastUse = -9; this.icd = {}; this.mchain = 0; this.mchainT = -9; this.slowPct = .3; this.bufAb = null; this.castId = 0; this.hitId = 0; this.downId = 0; this.mana = CFG.MANA_MAX;
    this.state = 'idle'; this.st = 0; this.onGround = true; this.airJumps = this.maxAirJumps; this.airDash = 1; this.dashCD = 0;
    this.invuln = 0; this.stun = 0; this.combo = 0; this.lastComboHit = -9; this.burnT = 0; this.slowT = 0; this.blockFlash = 0; this.lastHit = -9;
    this.cast = null; this.melee = null; this.walkPh = 0; this.freezeT = 0; this.lastEl = 'fire'; this.dashFx = null; this.dashHit = false; this.landT = 0;
    this.chainEl = null; this.chainT = 0; this.comboStep = 0; this.bufEl = null; this.bufT = 0; this.shockT = 0; this.wallCD = 0; this.blockWall = null;
    this.rig.body.rotation.set(0, 0, 0); this.pose = clonePose(BASE); this.rig.shield.visible = false;
    for (const k in this.cds) this.cds[k] = 0;
  }
  ghost() { return this.invuln > 0 || this.state === 'ko'; }
  setState(s) { this.state = s; this.st = 0; }
  stagger(dir, kb, launch, stun) { this.hitId++; this.vel.x = -dir.x * kb; this.vel.z = -dir.z * kb; if (launch) { this.vel.y = launch; this.onGround = false; } this.cast = null; this.melee = null; this.setState('hit'); this.stun = stun; this.rig.shield.visible = false; }
  knock(dir, kb, launch, ko) { this.downId++; this.vel.x = -dir.x * kb; this.vel.z = -dir.z * kb; this.vel.y = launch; this.onGround = false; this.cast = null; this.melee = null; this.setState(ko ? 'ko' : 'down'); this.rig.shield.visible = false; }
  startDash(dir, spd = 22, dur = .24, fx = 'wind') {
    if (dir.lengthSq() < .01) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.x = dir.x * spd; this.vel.z = dir.z * spd; this.vel.y = this.onGround ? 1.5 : 0;
    this.setState('dash'); this.dashDur = dur; this.invuln = Math.max(this.invuln, dur * .75); this.dashCD = this.dashMax || BAL.dashCD; this.dashId = (this.dashId || 0) + 1; this.dashFx = fx; this.dashHit = false;
    this.dashDir = dir.clone(); Sfx.play('dash'); FX.wind(this.pos.clone().setY(this.pos.y + .8), 10, .5, null, 1.2);
  }
  canCast() { return ['idle', 'air', 'block'].includes(this.state); }
  useAbility(name, opp, force = false) {
    const a = AB[name]; if (!a) return false;
    const cdKey = cdKeyOf(this, name);
    if ((this.cds[cdKey] || 0) > 0) return false;
    if (this.isMaster) this.pendingFuse = this.prevEl && this.prevEl !== this.melEl ? [this.prevEl, this.melEl] : null;
    if (name === 'mfuse' && !this.pendingFuse) { if (this.isPlayer) { btnDenied('mfuse'); popText(this.pos.clone().setY(this.pos.y + 2.3), 'SWITCH ELEMENT FIRST', '#ffe9a0', 16); } return false; }
    if (!this.canCast() && !(force && this.state === 'cast' && this.cast && this.cast.fired)) return false;
    if ((this.useEnergy ? a.cost && this.mana < a.cost : !CFG.UNLIMITED_MANA && this.mana < a.cost)) { if (this.useEnergy) btnDenied(name); popText(this.pos.clone().setY(this.pos.y + 2.2), 'Not enough mana', '#8fd0ff', 18); return false; }
    if ((a.ult || a.super) && this.spirit < 100) return false;
    if (a.ult || a.super) this.spirit = 0;
    if (!CFG.UNLIMITED_MANA || this.useEnergy) this.mana -= a.cost || 0;
    if (this.useEnergy) this.lastUse = game.time;
    this.cds[cdKey] = a.cd; this.cast = { a, t: 0, fired: false }; this.setState('cast'); this.rig.shield.visible = false; this.castId = ++CAST_ID; this.bufAb = null;
    this.lastEl = a.el || this.lastEl;
    if (a.onStart) a.onStart(this, opp);
    if (a.el && a.rel > .22) chargeFX(this, a.el, a.rel);
    if (a.label && (a.super || a.ult || this.isMaster)) popText(this.pos.clone().setY(this.pos.y + 2.4), a.label, '#ffe9a0', 24);
    if (a.ult || a.super) startCinematic(this, opp, a);
    return true;
  }
  nextStep(e) { return this.chainT > 0 && this.chainEl === e && this.comboStep < 3 ? this.comboStep + 1 : 1; }
  pressElement(e, opp) {
    const inChain = this.chainT > 0 && this.chainEl;
    if (inChain && this.isMaster && this.chainEl !== e) {
      const fk = fusionKey(this.chainEl, e);
      if (this.useAbility(fk, opp, true)) { this.chainEl = null; this.chainT = 0; this.comboStep = 0; markSlots(fk); Sfx.play('chain'); vibrate(20); return true; }
    }
    let step = this.nextStep(e); let name = step === 1 ? e : e + step;
    if (step > 1 && (this.cds[name] || 0) > 0) { step = 1; name = e; }
    if (this.useAbility(name, opp, step > 1)) {
      this.chainEl = e; this.chainT = CFG.CHAIN_WINDOW; this.comboStep = step; markSlots(e);
      if (step > 1) { Sfx.play('chain'); if (this.isPlayer) popText(this.pos.clone().setY(this.pos.y + 2.3), AB[name].hint, '#ffe9a0', 18); }
      return true;
    }
    if (this.state === 'cast' || this.state === 'melee') { this.bufEl = e; this.bufT = .3; }
    return false;
  }
  handleElements(opp) {
    const I = this.intent; let els = I.elems.slice();
    if (!els.length && this.bufEl && this.canCast()) { els = [this.bufEl]; this.bufEl = null; }
    if (!els.length) return;
    if (els.length >= 2 && this.isMaster) { const fk = fusionKey(els[0], els[1]); if (this.useAbility(fk, opp, true)) { this.chainEl = null; this.chainT = 0; this.comboStep = 0; markSlots(fk); Sfx.play('chain'); vibrate(20); return; } }
    this.pressElement(els[els.length - 1], opp);
  }
  update(dt, opp) {
    if (this.isMaster && this.intent && this.state !== 'ko' && this.state !== 'down') { const I = this.intent; // switching element works in any state (buffered to the next free frame by swapCd only)
      if (I.ability === 'mswap') { I.ability = null; if (this.swapCd <= 0) this.setElement6(ELS6[(ELS6.indexOf(this.melEl) + 1) % 6]); }
      else if (I.ability && I.ability.startsWith && I.ability.startsWith('msel:')) { const e = I.ability.slice(5); I.ability = null; if (this.swapCd <= 0 && e !== this.melEl) this.setElement6(e); } }
    if (this.isDummy) return this.updateDummy(dt);
    if (this.freezeT > 0) { this.freezeT -= dt; this.animate(dt * .15, opp); return; }
    const I = this.intent; this.st += dt;
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    for (const k in this.sts) if (this.sts[k] > 0) this.sts[k] = Math.max(0, this.sts[k] - dt);
    for (const k in this.icd) this.icd[k] -= dt;
    if (this.heat > 0) { this.heatT -= dt; if (this.heatT <= 0) this.heat = 0; }
    if (this.embers > 0) { this.emberT -= dt; if (this.emberT <= 0) this.embers = 0; }
    if (this.igniteT > 0) { this.igniteT -= dt; if (!this.ignFb || this.ignFb.dead) this.ignFb = fb('fire_loop', { follow: () => this.igniteT > 0 && this.state !== 'ko' ? swordTip(this, .7) : null, size: 1.25, loop: true, opacity: .95, speed: 1.5 }); if (Math.random() < .3) FX.fire(swordTip(this, rand(.3, .9)), 1, .05, null, .7); }
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shieldHp = 0; }
    if (this.seal && game.time > this.seal.until) { this.seal = null; this.pendingFuse = null; }
    this.swapCd -= dt;
    if (this.useEnergy) this.mana = Math.min(MM.energy.max, this.mana + (game.time - this.lastUse > MM.energy.delay ? MM.energy.regen * dt : 0));
    if (this.sts.haste > 0 && Math.random() < .3) FX.wind(this.pos.clone().setY(this.pos.y + rand(.2, 1)), 1, .3, null, .6);
    if (this.sts.soak > 0 && Math.random() < .25) FX.water(this.pos.clone().setY(this.pos.y + rand(.4, 1.8)), 1, .3, _v3.set(0, -1.5, 0), .6);
    if (this.sts.static > 0 && Math.random() < .2) { const c = this.pos.clone().setY(this.pos.y + rand(.4, 1.7)); boltFX(c, c.clone().add(_v3.randomDirection().multiplyScalar(.5)), 0xd0c4ff, .025, .07); }
    this.dashCD -= dt; this.invuln = Math.max(0, this.invuln - dt); this.blockFlash -= dt; this.chainT -= dt; this.landT -= dt;
    if (this.bufT > 0) { this.bufT -= dt; if (this.bufT <= 0) { this.bufEl = null; this.bufAb = null; } }
    this.mana = CFG.UNLIMITED_MANA ? CFG.MANA_MAX : Math.min(CFG.MANA_MAX, this.mana + CFG.MANA_REGEN * dt);
    if (this.burnT > 0) { this.burnT -= dt; if (this.hp > 1 && this.state !== 'ko') this.hp -= (this.burnDps || 2.2) * dt; FX.fire(this.pos.clone().setY(this.pos.y + rand(.3, 1.6)), 1, .3); }
    if (this.slowT > 0) { this.slowT -= dt; if (Math.random() < .3) PADD.emit(this.pos.x + rand(-.3, .3), this.pos.y + rand(.2, 1.6), this.pos.z + rand(-.3, .3), 0, -.3, 0, .6, 1, 1.6, .18, .5, 0, 0, .05, .7); }
    if (this.heal && game.time - this.lastHit > 3 && this.hp < this.maxHp && this.hp > 0) { this.hp = Math.min(this.maxHp, this.hp + this.heal * dt); if (Math.random() < .15) FX.water(this.pos.clone().setY(this.pos.y + 1), 1, .4, _v1.set(0, 1.5, 0), .6); }
    const slow = this.slowT > 0 ? 1 - this.slowPct : 1, haste = this.sts.haste > 0 ? 1 + BAL.el.wind.perk.pct : 1;
    const toOpp = _v1.copy(opp.pos).sub(this.pos).setY(0); const distOpp = toOpp.length();
    if (!['dash', 'down', 'ko'].includes(this.state) && distOpp > .05) { const ty = Math.atan2(toOpp.x, toOpp.z); this.yaw += angDiff(this.yaw, ty) * Math.min(1, dt * (this.state === 'cast' ? 20 : 12)); }
    const canControl = game.state === 'fight';
    const mvx = canControl ? I.mx : 0, mvz = canControl ? I.mz : 0;
    switch (this.state) {
      case 'idle': case 'air': case 'block': {
        if (canControl && I.block && this.onGround) { if (this.state !== 'block') { this.setState('block'); this.blockStart = game.time; this.rig.shield.visible = !['blade', 'all'].includes(this.blockStyle); this.onBlockStart(opp); } }
        else if (this.state === 'block') { this.setState(this.onGround ? 'idle' : 'air'); this.rig.shield.visible = false; }
        if (!canControl) break;
        if (this.state !== 'block') { const sp = this.speed * slow * haste * (this.onGround ? 1 : .85), inp = mvx * mvx + mvz * mvz > .01, k = this.onGround ? (inp ? BAL.accel : BAL.decel) * (MAPF.grip || 1) : 4; this.vel.x = damp(this.vel.x, mvx * sp, k, dt); this.vel.z = damp(this.vel.z, mvz * sp, k, dt); if (!inp && this.onGround && Math.hypot(this.vel.x, this.vel.z) < .25) { this.vel.x = 0; this.vel.z = 0; } }
        else { this.vel.x = damp(this.vel.x, 0, 12, dt); this.vel.z = damp(this.vel.z, 0, 12, dt); }
        if (I.jump && this.state !== 'block') {
          if (this.onGround) { this.vel.y = 10.8; this.onGround = false; this.setState('air'); Sfx.play('jump'); FX.earth(this.pos.clone().setY(this.pos.y + .1), 4, .3, null, .6); }
          else if (this.airJumps > 0) { this.airJumps--; this.vel.y = 9.8; Sfx.play('jump'); FX.wind(this.pos.clone().setY(this.pos.y + .2), 12, .5, _v2.set(0, -3, 0), 1.2); FX.shock(this.pos.clone().setY(this.pos.y + .1), 'wind', .8); }
        }
        if (this.sts.root > 0) { I.dash = false; this.vel.x = damp(this.vel.x, 0, 20, dt); this.vel.z = damp(this.vel.z, 0, 20, dt); if (Math.random() < .3) boltFX(this.pos.clone().setY(this.pos.y + .15), this.pos.clone().setY(this.pos.y + rand(.5, 1.5)).add(_v3.randomDirection().multiplyScalar(.4)), 0xd0c4ff, .04, .12); }
        if (I.dash && this.dashCD <= 0 && !(this.sts.root > 0) && (this.onGround || this.airDash > 0)) {
          if (!this.onGround) this.airDash--;
          const d = new V3(mvx, 0, mvz); if (d.lengthSq() < .05) d.copy(toOpp).normalize().multiplyScalar(-1); else d.normalize();
          this.startDash(d, BAL.dashSpeed * this.dashMul, BAL.dashTime); break;
        }
        if (I.melee) { this.startMelee(0); break; }
        if (I.ult) { this.useAbility(this.kit.superAb, opp); break; }
        if (I.ability === 'mswap') { I.ability = null; if (this.swapCd <= 0) this.setElement6(ELS6[(ELS6.indexOf(this.melEl) + 1) % 6]); }
        if (I.ability && I.ability.startsWith && I.ability.startsWith('msel:')) { const e = I.ability.slice(5); I.ability = null; if (this.swapCd <= 0 && e !== this.melEl) this.setElement6(e); }
        if (!I.ability && this.bufAb && this.bufT > 0) I.ability = this.bufAb;
        if (I.ability) { if (isBasic(this, I.ability)) this.pressElement(I.ability, opp); else if (!this.useAbility(I.ability, opp) && this.isPlayer && (this.cds[I.ability] || 0) > 0) btnDenied(I.ability); I.ability = null; this.bufAb = null; }
        if (!this.onGround && this.canGlide && I.jumpHeld && this.vel.y < 0) { this.vel.y = Math.max(this.vel.y, -2.2); if (Math.random() < .5) FX.wind(this.pos.clone(), 1, .5, _v2.set(0, -2, 0), .8); }
        break;
      }
      case 'dash': {
        FX.el(this.dashFx, this.pos.clone().setY(this.pos.y + rand(.3, 1.4)), this.dashFx === 'fire' ? 4 : 3, .3, null, 1);
        const DA = this.dashAttack;
        if (DA && !DA.hit && this.pos.distanceTo(opp.pos) < 1.6) { DA.hit = true; const r = applyHit(this, opp, { melee: false, skill: true, castId: DA.castId || this.castId, dmg: DA.dmg, kb: 4, el: DA.el, from: this.pos.clone(), heavy: true, seal: DA.seal, wet: DA.wet }); if (r === 'hit') { fb(DA.el === 'lightning' ? 'bolt_branch' : 'water_splash', { pos: opp.pos.clone().setY(opp.pos.y + 1.1), size: 2.2, speed: 2 }); } }
        if (this.st > this.dashDur) { this.vel.x *= .25; this.vel.z *= .25; this.dashAttack = null; this.setState(this.onGround ? 'idle' : 'air'); }
        break;
      }
      case 'melee': {
        const m = this.melee, md = (MELEE_OV[this.charId] || {})[m.i] || MELEE[m.i];
        if (I.melee && this.st > .1) m.queued = true;
        const spdM = this.comboSpd || 1;
        if (!m.done && this.st >= md.hit / spdM) {
          m.done = true; Sfx.play('swing'); if (this.charId === 'rakan') { FX.earth(handPos(this, m.i === 0 ? 'L' : 'R'), 6, .25, null, .8); if (m.i === 2) Sfx.play('earth'); }
          const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.vel.addScaledVector(fwd, 3.5);
          const tp = _v3.copy(opp.pos).sub(this.pos); const dy = Math.abs(tp.y); tp.y = 0; const d = tp.length();
          if (d < md.reach && dy < 1.4 && fwd.dot(tp.normalize()) > .3 && !opp.ghost()) {
            const el = this.isMaster ? this.lastEl : this.el;
            const chainOk = m.i > 0 && game.time - this.mchainT < BAL.comboReset;
            const molten = !!m.molten; const ign = this.charId === 'rayn' && this.igniteT > 0; const r = applyHit(this, opp, { melee: true, burn: ign && m.i === 2 ? RY.s2.burnDur : 0, dmg: (this.comboDmg || BAL.combo)[m.i] + (molten ? KZ.heat.bonus : 0) + (ign ? RY.s2.meleeBonus : 0), push: m.i === 2 && this.charId === 'rakan', kb: md.kb + (molten ? 3 : 0), launch: md.launch, slow: molten ? KZ.heat.slowDur : 0, slowPct: KZ.heat.slow, el, from: this.pos, heavy: md.heavy, castId: this.castId, third: m.i === 2 && chainOk && this.mchain >= 2 });
            if (molten && r === 'hit') { kazanFx(opp.pos.clone(), false); popText(opp.pos.clone().setY(opp.pos.y + 2.4), 'MOLTEN!', '#ff8a3a', 24); }
            if (this.charId === 'rayn' && r === 'hit' && m.i === 2 && (this.embers || 0) < RY.ember.max) { this.embers = (this.embers || 0) + 1; this.emberT = RY.ember.dur; popText(this.pos.clone().setY(this.pos.y + 2.5), 'EMBER ' + this.embers, '#ffb060', 17); }
            if (this.charId === 'sira' && r === 'hit' && m.i === 2 && opp.sts.wet > 0) { opp.sts.wet = 0; opp.slowT = Math.max(opp.slowT, 1.5); opp.slowPct = .2; fb('water_splash', { pos: opp.pos.clone().setY(opp.pos.y + 1), size: 2.2, speed: 2 }); popText(opp.pos.clone().setY(opp.pos.y + 2.3), 'CHILLED', '#bfe9ff', 18); }
            if (this.charId === 'rakan' && m.i === 2 && r === 'hit' && (this.icd.stab || 0) <= 0) { this.sts.stab = RK.stab.dur; this.icd.stab = RK.stab.icd; gravityRing(this, false); popText(this.pos.clone().setY(this.pos.y + 2.6), 'STABILITY', '#e8c890', 20); }
            if (r === 'hit') { this.mchain = chainOk ? this.mchain + 1 : 1; this.mchainT = game.time; } else if (r !== 'miss') this.mchain = 0;
            FX.el(el, handPos(this, m.i === 2 ? 'R' : m.i === 0 ? 'L' : 'R'), 10, .25, null, .9);
          }
        }
        // lunge toward opponent if a bit far (makes melee usable on phones)
        if (this.st < md.hit && distOpp > 1.2 && distOpp < 3.2) { this.vel.x = damp(this.vel.x, toOpp.x / distOpp * 7, 10, dt); this.vel.z = damp(this.vel.z, toOpp.z / distOpp * 7, 10, dt); }
        else { this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt); }
        if (this.st >= md.dur / spdM) { if (m.queued && m.i < 2) this.startMelee(m.i + 1); else this.setState(this.onGround ? 'idle' : 'air'); }
        break;
      }
      case 'cast': {
        const c = this.cast; c.t += dt;
        const cm = c.a.noMove ? 0 : c.a.basic ? BAL.basic.moveWhileCasting : .25; this.vel.x = damp(this.vel.x, mvx * this.speed * cm, 10, dt); this.vel.z = damp(this.vel.z, mvz * this.speed * cm, 10, dt);
        if (!this.onGround && !c.a.ult) this.vel.y = Math.max(this.vel.y, -1.2);
        if (c.a.ult) { this.vel.y = (this.castBaseY + 2.6 - this.pos.y) * 4; this.onGround = false; this.vel.x *= .9; this.vel.z *= .9; ELS.forEach((e, i) => { const a = game.time * 4 + i * Math.PI / 2; FX.el(e, _v2.set(this.pos.x + Math.cos(a) * 1.4, this.pos.y + 1.1 + Math.sin(a * 1.3) * .3, this.pos.z + Math.sin(a) * 1.4), 2, .1, null, 1.1); }); this.invuln = .2; }
        if (!c.fired && c.t >= c.a.rel) { c.fired = true; AB_CUR_POWER = c.a.power; if (c.a.el && !c.a.noMuzzle) muzzleFX(this, c.a.el); c.a.fn(this, opp); AB_CUR_POWER = 1; }
        if (c.t >= (c.dur || c.a.dur)) { this.cast = null; this.setState(this.onGround ? 'idle' : 'air'); }
        break;
      }
      case 'hit': { this.stun -= dt; this.vel.x = damp(this.vel.x, 0, this.onGround ? 6 : 1, dt); this.vel.z = damp(this.vel.z, 0, this.onGround ? 6 : 1, dt); if (this.stun <= 0 && this.onGround) this.setState('idle'); break; }
      case 'down': { if (this.onGround) { this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt); } if (this.st > .9 && this.onGround) { this.setState('getup'); this.invuln = .95; } break; }
      case 'getup': { if (this.st > .85) this.setState('idle'); break; }
      case 'ko': { if (this.onGround) { this.vel.x = damp(this.vel.x, 0, 4, dt); this.vel.z = damp(this.vel.z, 0, 4, dt); } break; }
      case 'win': { this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt); break; }
    }
    if (canControl) { this.handleElements(opp); if (I.ability && this.state === 'cast' && isBasic(this, I.ability)) this.pressElement(I.ability, opp); if (I.ability && !isBasic(this, I.ability) && (this.state === 'cast' || this.state === 'melee')) { this.bufAb = I.ability; this.bufT = .35; } }
    if (this.state !== 'block' && this.blockWall) { this.blockWall.release = true; this.blockWall = null; this.wallCD = .7; }
    this.wallCD -= dt;
    if (this.shockT > 0) { this.shockT -= dt; if (Math.random() < .35) { const c = this.pos.clone().setY(this.pos.y + rand(.3, 1.7)); boltFX(c, c.clone().add(_v3.randomDirection().multiplyScalar(.6)), 0xc8b8ff, .03, .08); } }
    if (this.state === 'cast' && this.cast && this.cast.t === 0) this.castBaseY = this.pos.y;
    if (this.state === 'cast' && this.cast && this.cast.a.ult && this.castBaseY == null) this.castBaseY = this.pos.y;
    // ---- physics with multi-level ground
    if (this.state !== 'dash' && !this.onGround) this.vel.y -= CFG.GRAVITY * (this.state === 'hit' ? .8 : 1) * dt;
    this.pos.addScaledVector(this.vel, dt);
    pushOut(this.pos, .38);
    const g = groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.onGround) {
      if (g < this.pos.y - .08 && !(this.state === 'cast' && this.cast && this.cast.a.ult)) { this.onGround = false; if (this.state === 'idle') this.setState('air'); }
      else if (!(this.state === 'cast' && this.cast && this.cast.a.ult)) { this.pos.y = g; this.vel.y = Math.max(0, this.vel.y); if (this.vel.y > 0) this.onGround = false; }
    } else if (this.pos.y <= g && this.vel.y <= 0) {
      const impact = -this.vel.y; this.pos.y = g;
      if ((this.state === 'down' || this.state === 'ko') && impact > 6) { this.vel.y = impact * .3; FX.earth(this.pos.clone().setY(g + .1), 10, .6); Sfx.play('land'); shake(.2); decal(this.pos, 'crack', 1.6); }
      else {
        this.onGround = true; this.vel.y = 0; this.airJumps = this.maxAirJumps; this.airDash = 1;
        if (impact > 4) { FX.earth(this.pos.clone().setY(g + .05), 5, .3, null, .7); Sfx.play('land'); this.landT = .16; }
        if (this.state === 'air') this.setState('idle');
        if (this.state === 'hit' && this.stun <= 0) this.setState('idle');
      }
    }
    if (this.state === 'idle' && !this.onGround) this.setState('air');
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > CFG.ARENA_R) { this.pos.x *= CFG.ARENA_R / r; this.pos.z *= CFG.ARENA_R / r; }
    for (const w of WALLS) { if (!w.personal && wallHit(w, _v2.copy(this.pos).setY(this.pos.y + 1), .35)) { _v3.copy(this.pos).sub(w.pos); const along = _v3.dot(w.dir); this.pos.addScaledVector(w.dir, (along >= 0 ? .65 : -.65) - along); } }
    this.animate(dt, opp);
  }
  updateDummy(dt) {
    this.st += dt; for (const k in this.sts) if (this.sts[k] > 0) this.sts[k] = Math.max(0, this.sts[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt); this.slowT = Math.max(0, this.slowT - dt); this.shockT = Math.max(0, (this.shockT || 0) - dt); this.burnT = 0;
    if (this.state !== 'idle' && this.st > .35) this.setState('idle');
    const id = this.hitId + this.downId * 7; if (id !== this.lastHitId) { this.lastHitId = id; this.wobV += 6 + rand(0, 3); }
    if (this.home) this.pos.copy(this.home); this.vel.set(0, 0, 0); this.onGround = true;
    if (game.time - this.lastHit > 2.5 && this.hp < this.maxHp) { this.hp = this.maxHp; FX.burst(this.pos.clone().setY(this.pos.y + 1.2), 'earth', 10, 3, .6); }
    this.wobV += (-this.wob * 90 - this.wobV * 7) * dt; this.wob += this.wobV * dt;
    const R = this.rig; R.root.position.copy(this.pos); R.root.rotation.y = this.yaw; this.dummyMesh.userData.body.rotation.x = -this.wob * .12;
  }
  animate(dt, opp) { if (this.isDummy) return; return this.animate2(dt, opp); }
  setElement6(e) {
    if (e !== this.melEl) this.prevEl = this.melEl;
    this.melEl = e; this.swapCd = MM.swapGap; this.lastEl = e === 'ice' ? 'water' : e;
    this.pendingFuse = this.prevEl && this.prevEl !== e ? [this.prevEl, e] : null;
    FX.burst(this.pos.clone().setY(this.pos.y + 1), e === 'ice' ? 'water' : e, 14, 3, .9); Sfx.play('select'); if (this.isPlayer) popText(this.pos.clone().setY(this.pos.y + 2.4), EL[e].name.toUpperCase(), '#' + new THREE.Color(EL[e].color).getHexString(), 19);
  }
  startMelee(i) { if (i === 0 && game.time - this.mchainT > BAL.comboReset) this.mchain = 0; this.melee = { i, done: false, queued: false };
    if (i === 2 && this.charId === 'kazan' && this.heat >= KZ.heat.max) { this.melee.molten = true; this.heat = 0; this.heatT = 0; FX.burst(handPos(this, 'R'), 'fire', 24, 4, 1.2); Sfx.play('fire'); } // stacks are spent even if the hit misses
    this.castId = ++CAST_ID; this.setState('melee'); }
  buildShieldFX() {
    const g = new THREE.Group(); this.rig.root.add(g); const bs = this.blockStyle, P = { g, rot: [] };
    const addM = (geo, m, y = 1) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.castShadow = false; g.add(o); return o; };
    const glowM = (r, gg, b, op = .9) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, gg, b), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const helix = (r, h, turns, ph) => { const pts = []; for (let i = 0; i <= 40; i++) { const a = ph + i / 40 * Math.PI * 2 * turns; pts.push(new V3(Math.cos(a) * r * (1 - i / 40 * .25), i / 40 * h, Math.sin(a) * r * (1 - i / 40 * .25))); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .04, 5, false); };
    if (bs === 'fire' || bs === 'all') {
      const big = bs === 'fire';
      P.fireRings = [];
      const n = big ? 3 : 1;
      for (let i = 0; i < n; i++) { const o = addM(new THREE.TorusGeometry(big ? 1.05 + i * .12 : 1.2, big ? .06 : .045, 6, 56), glowM(2.2, .75, .12), 1); o.userData.tilt = i; P.fireRings.push(o); }
      if (big) { P.floorFire = addM(new THREE.TorusGeometry(1.3, .1, 6, 56), glowM(2, .55, .08, .8), .08); P.floorFire.rotation.x = Math.PI / 2; }
    }
    if (bs === 'wind' || bs === 'all') {
      P.helix = [];
      const n = bs === 'wind' ? 3 : 1;
      for (let i = 0; i < n; i++) P.helix.push(addM(helix(1.15, 2.4, 1.6, i * 2.1), glowM(1.2, 1.35, 1.5, bs === 'wind' ? .45 : .35), 0));
      if (bs === 'wind') { P.windTop = addM(new THREE.TorusGeometry(.9, .05, 5, 40), glowM(1.2, 1.35, 1.5, .4), 2.35); P.windTop.rotation.x = Math.PI / 2; P.windBase = addM(new THREE.TorusGeometry(1.3, .06, 5, 40), glowM(1.2, 1.35, 1.5, .45), .1); P.windBase.rotation.x = Math.PI / 2; }
    }
    if (bs === 'lightning' || bs === 'all') {
      P.zapRing = addM(new THREE.TorusGeometry(bs === 'all' ? 1.35 : 1.15, .04, 5, 48), glowM(1.4, 1.1, 2.4), .06); P.zapRing.rotation.x = Math.PI / 2;
      if (bs === 'lightning') { P.zapTop = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xb59cff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); P.zapTop.scale.setScalar(1.2); P.zapTop.position.y = 2.6; g.add(P.zapTop); }
    }
    if (bs === 'water' || bs === 'all') { P.waterRing = addM(new THREE.TorusGeometry(bs === 'all' ? 1.1 : 1.0, .07, 8, 48), new THREE.MeshStandardMaterial({ color: 0x3a9cff, emissive: 0x0b3a80, roughness: .05, transparent: true, opacity: .75 }), 1); }
    if (bs === 'all' || bs === 'earth') { P.plates = []; for (let i = 0; i < 3; i++) { const o = addM(rockGeo(.24, 0, 50 + i, 1.3, .35, 1), MATS.rocks[i % 3], 1); o.castShadow = true; P.plates.push(o); } }
    g.scale.setScalar(.01); g.visible = false; return P;
  }
  blockFX(t) {
    const R = this.rig; const on = this.state === 'block'; const bs = this.blockStyle;
    if (!this.sfx) this.sfx = this.buildShieldFX();
    const P = this.sfx; this.shieldK = damp(this.shieldK || 0, on ? 1 : 0, on ? 16 : 10, game.rdt || .016);
    P.g.visible = this.shieldK > .02; P.g.scale.setScalar(Math.max(.01, this.shieldK));
    if (P.g.visible) {
      if (P.fireRings) P.fireRings.forEach((o, i) => { const k = o.userData.tilt; o.rotation.set(Math.PI / 2 + (k ? (k === 1 ? 1.0 : -1.0) : 0) + Math.sin(t * 2 + k) * .15, t * (2.5 + k), 0); o.position.y = 1 + Math.sin(t * 4 + k) * .08; });
      if (P.helix) P.helix.forEach((o, i) => o.rotation.y = -t * (7 + i * 1.5));
      if (P.windTop) P.windTop.rotation.z = t * 6;
      if (P.waterRing) { P.waterRing.rotation.set(Math.PI / 2 + Math.sin(t * 2) * .6, t * 2, Math.cos(t * 1.7) * .5); }
      if (P.zapRing) P.zapRing.material.opacity = .5 + Math.random() * .5;
      if (P.plates) P.plates.forEach((o, i) => { const a = t * (bs === 'earth' ? 1.8 : 2.4) + i / 3 * Math.PI * 2, r = bs === 'earth' ? 1.25 : 1.3; o.position.set(Math.cos(a) * r, (bs === 'earth' ? .4 : .7) + i * .45 + Math.sin(t * 3 + i) * .1, Math.sin(a) * r); o.rotation.set(t + i, t * 1.4, 0); });
    }
    if (bs === 'all') {
      if (!R.orbs) { R.orbs = ELS6.map(e => { const s = glowSprite(EL[e].color, .5, .95); R.root.add(s); return s; }); }
      R.orbs.forEach((o, i) => { o.visible = on; if (on) { const a = t * 3.2 + i / 6 * Math.PI * 2; o.position.set(Math.cos(a) * 1.05, 1 + Math.sin(a * 2 + i) * .45, Math.sin(a) * 1.05); } });
      if (on && Math.random() < .25) { const a = R.orbs[(Math.random() * 5) | 0], b = R.orbs[(Math.random() * 5) | 0]; if (a !== b) boltFX(a.getWorldPosition(new V3()), b.getWorldPosition(new V3()), 0xc8b8ff, .025, .07, .2); }
    }
    if (!on) return;
    const c = this.pos;
    if (bs === 'lightning') { // electric cage
      for (let k = 0; k < 3; k++) { const a = rand(0, 6.28); boltFX(_v3.set(c.x + Math.cos(a) * 1.15, c.y + .06, c.z + Math.sin(a) * 1.15), _v4.set(c.x + Math.cos(a + .5) * .3, c.y + 2.6, c.z + Math.sin(a + .5) * .3), 0xc8b8ff, .055, .12, .35); }
    }
    if (bs === 'fire' || bs === 'all') for (let i = 0; i < (bs === 'all' ? 1 : 6); i++) { const a = rand(0, 6.28); FX.fire(_v3.set(c.x + Math.cos(a) * 1.3, c.y + .1, c.z + Math.sin(a) * 1.3), 1, .05, null, .8); }
    if (bs === 'water' || bs === 'all') for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2.1, y = c.y + .3 + ((t * 1.5 + i * .33) % 1) * 1.6; PADD.emit(c.x + Math.cos(a) * 1, y, c.z + Math.sin(a) * 1, -Math.sin(a) * 2, 0, Math.cos(a) * 2, .3, .75, 1.6, .22, .3, 0, 1, .05, .9); }
    if (bs === 'wind' || bs === 'all') for (let i = 0; i < 3; i++) { const a = t * 9 + i * 2.1, y = c.y + rand(0, 2); PADD.emit(c.x + Math.cos(a) * 1.1, y, c.z + Math.sin(a) * 1.1, -Math.sin(a) * 6, 1.5, Math.cos(a) * 6, .8, .9, 1, .4, .25, 0, 2, .9, .3); }
    if ((bs === 'lightning' || bs === 'all') && Math.random() < .4) { const p = c.clone().setY(c.y + 1).add(_v3.randomDirection().multiplyScalar(1)); boltFX(p, p.clone().add(_v4.randomDirection().multiplyScalar(.7)), 0xc8b8ff, .03, .08); }
    if (bs === 'earth' && Math.random() < .2) FX.earth(c.clone().setY(c.y + .1), 1, .8, null, .6);
  }
  onBlockStart(opp) {
    const bs = this.blockStyle;
    startShieldFX(this);
    if ((bs === 'earth' || bs === 'stone') && this.wallCD <= 0) this.blockWall = spawnBlockWall(this, opp, bs);
    if (bs === 'fire') { FX.burst(this.pos.clone().setY(this.pos.y + .3), 'fire', 14, 4); Sfx.play('fire'); }
    else if (bs === 'water') Sfx.play('water'); else if (bs === 'wind') Sfx.play('wind'); else if (bs === 'lightning') Sfx.play('lightning');
    else if (bs === 'all') { Sfx.play('wind'); FX.shock(this.pos.clone().setY(this.pos.y + 1), 'lightning', 1); }
  }
  animate2(dt, opp) {
    const R = this.rig, P0 = clonePose(BASE);
    let P = P0, w = 18, z = .72;
    const t = game.time;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const lz = this.vel.x * sy + this.vel.z * cy, lx = this.vel.x * cy - this.vel.z * sy;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    switch (this.state) {
      case 'idle': case 'getup': {
        P.hipsY += Math.sin(t * 5.2) * .012; P.chest[0] += Math.sin(t * 2.2) * .025; P.shL[0] += Math.sin(t * 5.2) * .04; P.shR[0] += Math.sin(t * 5.2 + 1) * .04;
        if (hs > .6 && this.onGround) {
          const run = clamp((hs - 1) / 4.5, 0, 1); this.walkPh += dt * (5.5 + hs * 1.25);
          const s = Math.sin(this.walkPh), c = Math.cos(this.walkPh), a = Math.min(1, hs / 5);
          const fz = lz / Math.max(.1, hs), fx = lx / Math.max(.1, hs);
          const back = fz < -.3 ? .6 : 1;
          P.thL[0] += -s * .75 * a * fz * back; P.thR[0] += s * .75 * a * fz * back;
          P.thL[2] += s * .35 * a * fx; P.thR[2] += -s * .35 * a * fx;
          P.knL[0] += (.15 + .9 * Math.max(0, c)) * a; P.knR[0] += (.15 + .9 * Math.max(0, -c)) * a;
          P.hipsY += -Math.abs(c) * .05 * a + .02 * run; P.hips[1] += s * .15 * a * fz - .32 * run * (fz > .5 ? 1 : 0);
          P.chest[1] += -s * .2 * a * fz + .28 * run * (fz > .5 ? 1 : 0);
          // run: drop guard into arm swing
          if (run > 0 && fz > .3) {
            const ar = run * fz; P.shL = mix({ a: P.shL }, { a: [-.35 + s * .75, 0, .2] }, ar).a; P.shR = mix({ a: P.shR }, { a: [-.35 - s * .75, 0, -.2] }, ar).a;
            P.elL = mix({ a: P.elL }, { a: [-1.4, 0, 0] }, ar).a; P.elR = mix({ a: P.elR }, { a: [-1.4, 0, 0] }, ar).a;
          }
          P.body = [lz * .028, 0, -lx * .03];
        }
        if (this.state === 'getup') { P = mix(over(clonePose(P0), { body: [-1.0, 0, 0], hipsY: .6 }), P, ease(Math.min(1, this.st / .85))); w = 16; }
        if (this.landT > 0) P.hipsY -= this.landT / .16 * .14;
        break;
      }
      case 'air': {
        P = over(clonePose(P0), { thL: [-1.0, 0, .12], knL: [1.5, 0, 0], thR: [-.3, 0, -.12], knR: [1.0, 0, 0], shL: [-.5, 0, .9], shR: [-.5, 0, -.9], elL: [-.6, 0, 0], elR: [-.6, 0, 0], chest: [.1, 0, 0], hips: [0, 0, 0] });
        if (this.vel.y > 2) { P.thL = [-.6, 0, .1]; P.knL = [1.0, 0, 0]; P.thR = [.2, 0, -.1]; P.knR = [.6, 0, 0]; }
        if (this.vel.y < -2 && this.intent.jumpHeld && this.canGlide) { P.shL = [-.2, 0, 1.4]; P.shR = [-.2, 0, -1.4]; P.elL = [0, 0, 0]; P.elR = [0, 0, 0]; P.thL = [-.2, 0, .1]; P.knL = [.4, 0, 0]; P.thR = [.1, 0, -.1]; P.knR = [.5, 0, 0]; P.body = [.35, 0, 0]; }
        w = 12; break;
      }
      case 'dash': {
        P = over(clonePose(P0), { body: [.55, 0, 0], shL: [.9, 0, .35], shR: [.9, 0, -.35], elL: [-.2, 0, 0], elR: [-.2, 0, 0], thL: [-.6, 0, .1], knL: [1.0, 0, 0], thR: [.5, 0, -.1], knR: [.8, 0, 0], hips: [0, 0, 0], chest: [.1, 0, 0] });
        if (this.dashDir) { const dl = this.dashDir.x * sy + this.dashDir.z * cy, ds = this.dashDir.x * cy - this.dashDir.z * sy; P.body = [.55 * dl, 0, -.5 * ds]; }
        w = 26; break;
      }
      case 'block': { P = over(clonePose(P0), { hipsY: .85, shL: [-1.35, -.3, -.45], elL: [-1.35, 0, 0], shR: [-1.35, .3, .45], elR: [-1.35, 0, 0], chest: [.2, 0, 0], hips: [0, .15, 0], head: [.15, 0, 0] }); if (this.blockFlash > 0) P.chest[0] -= .25; w = 26; break; }
      case 'melee': { const md = (MELEE_OV[this.charId] || {})[this.melee.i] || MELEE[this.melee.i]; P = POSE_ANIMS[md.anim || 'punch'](P0, this.st, md.hit); w = 30; z = .62; break; }
      case 'cast': { const a = this.cast.a; P = POSE_ANIMS[a.anim](P0, this.cast.t, a.rel); w = 28; z = .62; if (!this.onGround && a.anim === 'lift') P.thL = [-.6, 0, .2]; break; }
      case 'hit': { P = over(clonePose(P0), { chest: [-.5, 0, rand(-.05, .05)], head: [-.5, 0, 0], shL: [-.2, 0, .8], shR: [-.2, 0, -.8], elL: [-.6, 0, 0], elR: [-.6, 0, 0], hipsY: .88, body: [-.18, 0, 0] }); if (!this.onGround) { P.thL = [-.8, 0, .2]; P.knL = [1, 0, 0]; P.thR = [-.4, 0, -.2]; P.knR = [1.2, 0, 0]; P.body = [-.5, 0, 0]; } w = 30; z = .5; break; }
      case 'down': case 'ko': {
        P = over(clonePose(P0), { body: [-1.42, 0, 0], hipsY: .98, hips: [0, 0, 0], chest: [-.1, 0, 0], head: [-.25, .3, 0], shL: [-.4, 0, 1.4], shR: [-.6, 0, -1.2], elL: [-.5, 0, 0], elR: [-.3, 0, 0], thL: [-.15, 0, .15], knL: [.3, 0, 0], thR: [.05, 0, -.1], knR: [.15, 0, 0] });
        if (!this.onGround) P.body[0] = -.9 - Math.min(.6, this.st * 1.2);
        w = 11; z = .8; break;
      }
      case 'win': {
        P = over(clonePose(P0), { hips: [0, 0, 0], chest: [-.1, 0, 0], head: [-.25, 0, 0], shR: [-3.0, 0, -.25], elR: [-.1, 0, 0], shL: [.1, 0, .35], elL: [-1.6, 0, 0], thL: [-.1, 0, .1], knL: [.1, 0, 0], thR: [.05, 0, -.1], knR: [.1, 0, 0], hipsY: 1 });
        if (!this.isMaster) { P.shR = [-.7, 0, -.1]; P.elR = [-2.2, 0, 0]; P.shL = [-.7, 0, .1]; P.elL = [-2.2, 0, 0]; P.head = [.1, 0, 0]; }
        w = 8; break;
      }
    }
    // spring blend (organic overshoot / follow-through)
    const cur = this.pose, vel = this.poseV, steps = Math.max(1, Math.ceil(dt * w / .35)), h = dt / steps, k = w * w, c = 2 * z * w;
    for (let s = 0; s < steps; s++) {
      for (const n of JN) { const a = cur[n], v = vel[n], b = P[n]; for (let i = 0; i < 3; i++) { v[i] += (k * (b[i] - a[i]) - c * v[i]) * h; a[i] += v[i] * h; } }
      vel.hipsY += (k * (P.hipsY - cur.hipsY) - c * vel.hipsY) * h; cur.hipsY += vel.hipsY * h;
    }
    if (this.state === 'cast' && this.cast && this.cast.a.anim === 'spin') { cur.body[1] = P.body[1]; vel.body[1] = 0; }
    for (const n of JN) { if (n === 'body') continue; const o = R[n], v = cur[n]; o.rotation.set(v[0], v[1], v[2]); }
    R.body.rotation.set(cur.body[0], cur.body[1], cur.body[2]); R.hips.position.y = cur.hipsY;
    R.root.position.copy(this.pos); R.root.rotation.y = this.yaw;
    // foot ring sticks to ground
    const gy = groundAt(this.pos.x, this.pos.z, this.pos.y); R.footRing.position.y = gy - this.pos.y + .03; R.footRing.material.opacity = .45 * clamp(1 - (this.pos.y - gy) / 4, .2, 1);
    // secondary: hair strands
    if (R.hair.length) {
      const base = clamp(.18 + lz * .075 + this.vel.y * .035 + Math.sin(t * 1.7) * .04, -.3, 1.5) - cur.head[0] - cur.chest[0] - cur.spine[0] - cur.body[0];
      const sideSw = clamp(-lx * .05, -.5, .5);
      for (const hs2 of R.hair) {
        if (hs2.side) { hs2.j.rotation.x = damp(hs2.j.rotation.x, clamp(base * .4, -.2, .6), 8, dt); continue; }
        const tgt = (hs2.i === 0 ? base : .1 * base + Math.sin(t * 3.2 - hs2.i * .8 + hs2.ph) * .05);
        hs2.j.rotation.x = damp(hs2.j.rotation.x, tgt, 10 - hs2.i * 1.2, dt);
        hs2.j.rotation.z = damp(hs2.j.rotation.z, sideSw * (hs2.i ? .3 : 1) + Math.sin(t * 2 + hs2.ph) * .03, 7, dt);
      }
    }
    // cloth: vertex-animated coat/skirt
    if (R.cloth) {
      const cl = R.cloth, pa = cl.geo.attributes.position, b = cl.base;
      const legSwing = (cur.thL[0] - cur.thR[0]) * .5;
      const sz = clamp(lz * .05 + (this.vel.y < -2 ? -.1 : 0), -.5, .5), sx = clamp(-lx * .05, -.4, .4);
      for (let i = 0; i < pa.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1], zz = b[i * 3 + 2]; const kk = clamp(-y / cl.h, 0, 1), k2 = kk * kk;
        const ang = Math.atan2(x, zz);
        const ripple = Math.sin(t * 6 + ang * 3) * .018 * kk * (1 + hs * .15);
        const legPush = (x > 0 ? 1 : -1) * legSwing * .12 * k2 * (zz > 0 ? 1 : .3);
        pa.setXYZ(i, x + (-sx) * k2 * .6 + Math.sin(ang) * ripple, y + Math.abs(sz) * k2 * .08, zz - sz * k2 * .7 + Math.cos(ang) * ripple + legPush);
      }
      pa.needsUpdate = true; cl.geo.computeVertexNormals();
      R.skirt.rotation.set(cur.hips[0] * -.3, -cur.hips[1] * .5, 0);
    }
    const glow = this.state === 'cast' ? 1 : (this.isMaster ? .25 : .35);
    const ge = this.state === 'cast' && this.cast ? (this.cast.a.el || this.lastEl) : (this.isMaster ? this.lastEl : this.el);
    for (const g2 of [R.glowL, R.glowR]) { g2.material.color.setRGB(...EL[ge].c).multiplyScalar(this.state === 'cast' ? 1.6 : .8); g2.material.opacity = damp(g2.material.opacity, glow * (.75 + Math.sin(t * 13) * .25), 10, dt); }
    if (this.isMaster && this.state === 'cast' && this.cast && this.cast.a.ult) { R.glowL.material.color.setHSL((t * .8) % 1, 1, .6); R.glowR.material.color.setHSL((t * .8 + .5) % 1, 1, .6); }
    if (R.shield.visible) { const u = R.shield.material.uniforms; u.uT.value = t; u.uA.value = this.blockFlash > 0 ? 1.1 : .22; if (this.isMaster) u.uColor.value.setHSL((t * .25) % 1, .7, .62); else u.uColor.value.setRGB(...EL[this.el].c); }
    this.blockFX(t);
    if (!this.isMaster && this.state !== 'ko' && Math.random() < .25) FX.el(this.el, handPos(this, Math.random() < .5 ? 'L' : 'R'), 1, .05, _v2.set(0, .5, 0), .45);
    if (this.isMaster && this.spirit >= 100 && Math.random() < .5) FX.el(pick(ELS), this.pos.clone().setY(this.pos.y + rand(.2, 1.8)), 1, .4, _v2.set(0, 1, 0), .6);
    if (this.isMaster && this.chainT > 0 && Math.random() < .5) FX.el(this.chainEl, handPos(this, 'R'), 1, .08, _v2.set(0, .6, 0), .5);
    if (this.heatGlow) { const k = this.heat / KZ.heat.max; this.heatGlow.forEach((g, i) => { g.material.opacity = damp(g.material.opacity, k * (.55 + .2 * Math.sin(t * 9 + i)), 8, dt); }); if (this.heat >= KZ.heat.max && Math.random() < .5) FX.fire(handPos(this, 'L'), 1, .1, _v2.set(0, 1, 0), .8); }
    if (R.glb) animateGLB(this, dt, lz, lx, hs);
  }
}

// ---------------------------------------------------------------- AI
class AI {
  constructor(f, kit, diff) {
    this.f = f; this.kit = kit; this.diff = diff; this.D = BAL.ai[diff] || BAL.ai.normal; f.aimErr = this.D.aimErr;
    this.thinkT = .8; this.strafe = 1; this.strafeT = 0; this.blockHold = 0; this.meleeChain = 0; this.move = new V3(); this.stuckT = 0; this.lastPos = new V3(); this.pace = .6; this.mood = 1;
  }
  update(dt, tgt) {
    const f = this.f, I = f.intent;
    I.jump = I.dash = I.melee = I.ult = false; I.ability = null; I.elems = []; I.jumpHeld = false;
    if (game.state !== 'fight' || window.__aiOff) { I.mx = I.mz = 0; I.block = false; return; }
    this.blockHold -= dt; this.strafeT -= dt; this.pace -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < .5 ? -1 : 1; this.strafeT = rand(.9, 2.4); this.mood = Math.random() < .25 ? .4 : 1; }
    this.thinkT -= dt; if (this.thinkT <= 0) { this.thinkT = this.D.react * rand(.75, 1.25); this.think(tgt); }
    if (this.meleeChain > 0 && f.state === 'melee' && f.st > .12) { I.melee = true; this.meleeChain--; }
    if (this.chainLeft > 0 && f.state === 'cast' && f.cast && f.cast.fired && f.cast.t > f.cast.a.rel + .05 && f.chainEl === this.kit.basic) { I.ability = this.kit.basic; this.chainLeft--; }
    if (this.move.lengthSq() > .01) { // steer around scenery
      for (const o of OBS) {
        if (o.walk && o.top < .6) continue;
        const rr = o.type === 'b' ? Math.min(o.r, Math.max(o.hw, o.hd) + .3) : o.r;
        const dx = f.pos.x - o.x, dz = f.pos.z - o.z, d = Math.hypot(dx, dz);
        if (d < rr + 1.5 && d > .01 && f.pos.y < o.top - .45) { const n = _v1.set(dx / d, 0, dz / d); const into = -(this.move.x * n.x + this.move.z * n.z); if (into > 0) { this.move.addScaledVector(n, into); this.move.addScaledVector(_v2.set(-n.z, 0, n.x), this.strafe * .9); } }
      }
      const moved = Math.hypot(f.pos.x - this.lastPos.x, f.pos.z - this.lastPos.z); this.lastPos.copy(f.pos);
      if (moved < dt * 1.2 && f.onGround && f.state === 'idle') { this.stuckT += dt; if (this.stuckT > .5) { this.strafe *= -1; this.stuckT = 0; if (Math.random() < .5) I.jump = true; } } else this.stuckT = 0;
    }
    I.block = this.blockHold > 0;
    if (this.move.lengthSq() > 1) this.move.normalize();
    I.mx = I.block ? 0 : this.move.x; I.mz = I.block ? 0 : this.move.z;
  }
  sees(p) { // not omniscient: only reacts to what is roughly in front, or very close
    const f = this.f; _v3.copy(p.pos).sub(f.pos).setY(0); const d = _v3.length(); if (d < 3) return true;
    return _v3.divideScalar(d).dot(_v4.set(Math.sin(f.yaw), 0, Math.cos(f.yaw))) > -.2;
  }
  dodge(away) {
    const f = this.f, I = f.intent;
    if (f.dashCD <= 0 && f.onGround) { I.dash = true; this.move.copy(away); return true; }
    if (f.onGround && Math.random() < .5) { I.jump = true; this.move.copy(away); return true; }
    this.move.copy(away); return false;
  }
  think(tgt) {
    const f = this.f, I = f.intent, K = this.kit, D = this.D;
    const d = _v1.copy(tgt.pos).sub(f.pos).setY(0); const dist = d.length(); d.normalize();
    const perp = _v2.set(-d.z, 0, d.x).clone().multiplyScalar(this.strafe);
    const free = ['idle', 'air', 'block'].includes(f.state);
    // 1) dangers: ground telegraphs, projectiles, waves, cyclones
    for (const T of TELES) if (T.end > game.time && teleHit(T, f.pos.x, f.pos.z) && free) {
      if (Math.random() < D.dodgeP + .15) { const aw = teleAway(T, f.pos.x, f.pos.z); if (aw.lengthSq() < .01) aw.copy(perp); this.dodge(aw.normalize()); return; }
    }
    for (const z of LAVA) if (z.owner !== f && free && inZone(z, f.pos) && Math.random() < .5 + D.dodgeP * .5) { // walk out of lava
      const aw = z.kind === 'line' ? teleAway({ line: true, ax: z.a.x, az: z.a.z, bx: z.b.x, bz: z.b.z }, f.pos.x, f.pos.z) : new V3(f.pos.x - z.c.x, 0, f.pos.z - z.c.z);
      this.move.copy(aw.lengthSq() > .01 ? aw.normalize() : perp); return;
    }
    let threat = null, tmin = 9;
    for (const p of PROJ) {
      if (p.owner === f || (p.owner && p.owner.team === f.team) || p.dead || !this.sees(p)) continue;
      if (p.kind === 'ball') { _v3.copy(f.pos).setY(f.pos.y + 1).sub(p.pos); const dd = _v3.length(); const approach = p.dir.dot(_v3.normalize()); const tt = dd / p.speed; if (approach > .8 && tt < .8 && tt < tmin) { tmin = tt; threat = p; } }
      else if (p.kind === 'wave') { _v3.copy(f.pos).sub(p.pos); const along = _v3.dot(p.dir); if (along > -.5 && along < 6 && Math.abs(_v3.x * p.dir.z - _v3.z * p.dir.x) < p.width / 2 + .5) { threat = p; tmin = 0; } }
      else if (p.kind === 'tornado') { if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) < 5.5) { threat = p; tmin = 0; } }
    }
    if (threat && free) {
      const r = Math.random();
      if (threat.kind === 'tornado') { this.move.copy(_v3.set(f.pos.x - threat.pos.x, 0, f.pos.z - threat.pos.z).normalize()).addScaledVector(perp, .5).normalize(); if (r < D.dodgeP) this.dodge(this.move.clone()); return; }
      if (threat.kind === 'wave') { if (r < D.dodgeP) { if (threat.width > 5 || f.dashCD > 0) { if (f.onGround) I.jump = true; } else this.dodge(perp.clone()); } else if (r < D.dodgeP + D.blockP) this.blockHold = .5; return; }
      if (K.superAb === 'earth_su' && (f.cds.earth_s2 || 0) <= 0 && f.onGround && r < D.blockP * .35 && dist > 7) { I.ability = 'earth_s2'; return; }
      if (r < D.blockP) { this.blockHold = .3 + Math.random() * .25; return; }
      if (r < D.blockP + D.dodgeP) { this.dodge(perp.clone()); return; }
    }
    if ((tgt.state === 'melee' || (tgt.state === 'cast' && tgt.cast && !tgt.cast.fired && (dist < 6 || tgt.cast.a.name === 'lightning_s2'))) && (dist < 6 || tgt.cast) && free && Math.random() < D.blockP * .8) { if (K.superAb === 'rk_su' && (f.cds.rk_s2 || 0) <= 0 && dist < 4 && Math.random() < .6) { I.ability = 'rk_s2'; return; } this.blockHold = .45; return; }
    if (this.blockHold > 0 || !['idle', 'air'].includes(f.state)) return;
    // 2) offense — openings make the AI more aggressive
    let blocked = losBlocked(f.pos, tgt.pos);
    if (!blocked) for (const w of WALLS) { if (w.personal) continue; for (let k = .15; k < 1; k += .1) { _v3.lerpVectors(f.pos, tgt.pos, k); _v3.y += 1; if (wallHit(w, _v3, .2)) { blocked = true; break; } } if (blocked) break; }
    const opening = ['down', 'getup', 'hit'].includes(tgt.state) || (tgt.state === 'cast' && tgt.cast && tgt.cast.fired) || tgt.state === 'block' && false;
    const aggr = D.aggr * this.mood * (opening ? 1.5 : 1);
    if (f.isMaster) {
      if (f.prevEl && f.prevEl !== f.melEl && (f.cds.mf || 0) <= 0 && dist < 13 && Math.random() < aggr * .35) { I.ability = 'mfuse'; return; }
      const spent = (f.cds['m1_' + f.melEl] || 0) > 0 && (f.cds['m2_' + f.melEl] || 0) > 0;
      if (f.swapCd <= 0 && (spent ? Math.random() < .6 : Math.random() < .05)) { const fresh = ELS6.filter(e => e !== f.melEl && !(f.cds['m1_' + e] > 0)); f.setElement6(pick(fresh.length ? fresh : ELS6.filter(e => e !== f.melEl))); }
    }
    if (f.spirit >= 100 && !blocked && dist >= K.superR[0] && dist <= K.superR[1] && Math.random() < aggr * .6) { I.ult = true; return; }
    if (dist < 2.1 && f.onGround && Math.random() < aggr) { I.melee = true; this.meleeChain = Math.random() < D.follow ? 2 : Math.random() < .5 ? 1 : 0; return; }
    if (!blocked && this.pace <= 0 && Math.random() < aggr) {
      const opts = K.moves.filter(m => dist >= m[3] && dist <= m[4] && (f.cds[cdKeyOf(f, m[0])] || 0) <= 0 && (m[0] !== 'mfuse' || (f.prevEl && f.prevEl !== f.melEl)));
      if (opts.length) { let r = Math.random() * opts.reduce((s, m) => s + m[2], 0); for (const m of opts) { r -= m[2]; if (r <= 0) { I.ability = m[0]; this.pace = m[1] * rand(.8, 1.6) / D.aggr; if (m[0] === K.basic) this.chainLeft = Math.random() < D.follow ? 2 : Math.random() < .5 ? 1 : 0; return; } } }
    }
    // 3) movement: keep the element's preferred range, circle, use cover
    this.move.set(0, 0, 0);
    const pref = opening ? Math.min(K.pref, 2) : K.pref;
    if (blocked) this.move.copy(perp).addScaledVector(d, .6);
    else if (dist > pref + 1.5) { this.move.copy(d); if (dist > pref + (K.pref < 4 ? 3.5 : 8) && f.dashCD <= 0 && Math.random() < (K.pref < 4 ? .35 : .2)) I.dash = true; }
    else if (dist < pref - 1.5) this.move.copy(d).multiplyScalar(-1);
    this.move.addScaledVector(perp, .75 * this.mood);
    const r0 = Math.hypot(f.pos.x, f.pos.z); if (r0 > CFG.ARENA_R - 2.5) this.move.addScaledVector(_v3.copy(f.pos).setY(0).normalize(), -1.4);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }
}

// ---------------------------------------------------------------- INPUT
const KEYS = {}; const PRESSED = new Set();
addEventListener('keydown', e => { if (e.repeat) return; KEYS[e.code] = true; PRESSED.add(e.code); Sfx.init(); if (e.code === 'Escape') togglePause(); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && game.state !== 'menu') e.preventDefault(); });
addEventListener('keyup', e => { KEYS[e.code] = false; });
addEventListener('blur', () => { for (const k in KEYS) KEYS[k] = false; });
const TOUCH = { mx: 0, mz: 0, btn: {}, pressed: new Set() };
const MASTER_KEYS = [['KeyU', 'Digit1', 'fire'], ['KeyI', 'Digit2', 'water'], ['KeyO', 'Digit3', 'wind'], ['KeyP', 'Digit4', 'earth'], ['KeyL', 'Digit5', 'lightning']];
const RAVEN_KEYS = [['KeyU', 'Digit1'], ['KeyI', 'Digit2'], ['KeyO', 'Digit3']];
function readPlayerIntent() {
  const I = hero.intent; let x = 0, z = 0;
  if (KEYS.KeyA || KEYS.ArrowLeft) x -= 1; if (KEYS.KeyD || KEYS.ArrowRight) x += 1;
  if (KEYS.KeyW || KEYS.ArrowUp) z += 1; if (KEYS.KeyS || KEYS.ArrowDown) z -= 1;
  x += TOUCH.mx; z += TOUCH.mz;
  camera.getWorldDirection(_v1); _v1.y = 0; _v1.normalize(); _v2.set(-_v1.z, 0, _v1.x);
  const mv = _v3.set(0, 0, 0).addScaledVector(_v2, x).addScaledVector(_v1, z); if (mv.lengthSq() > 1) mv.normalize();
  I.mx = mv.x; I.mz = mv.z;
  const P = c => PRESSED.has(c) || TOUCH.pressed.has(c);
  I.jump = P('Space'); I.jumpHeld = !!KEYS.Space || !!TOUCH.btn.Space;
  I.dash = P('ShiftLeft') || P('ShiftRight'); I.melee = P('KeyJ'); I.block = !!KEYS.KeyK || !!TOUCH.btn.KeyK; I.ult = P('KeyE');
  I.elems = []; I.ability = null;
  if (hero.isMaster) { if (P('KeyU')) I.ability = 'mb'; if (P('KeyL') || P('KeyQ')) I.ability = 'mswap'; ELS6.forEach((e, k) => { if (P('Digit' + (k + 1))) I.ability = 'msel:' + e; }); if (P('KeyI')) I.ability = 'm1'; if (P('KeyO')) I.ability = 'm2'; if (P('KeyP')) I.ability = 'mfuse'; }
  else { RAVEN_KEYS.forEach(([k, d], i) => { if (P(k) || P(d)) I.ability = hero.kit.btn[i][0]; }); }
}
const TBTN = {}, KSLOT = {};
const ICON = n => `url(assets/ui/${n}.webp)`;
function ctrlDefs() {
  const el = hero.el, K = hero.kit, kz = hero.charId === 'kazan', rk = hero.charId === 'rakan';
  if (hero.isMaster) return [
    { code: 'KeyJ', key: 'J', icon: 'sk_fist', kind: 'melee', name: 'Combo' },
    { code: 'KeyU', key: 'U', icon: 'ic_fire', ab: 'mb', kind: 'basic', name: 'Element attack (tap ×3 — 3rd is a fusion shot)' },
    { code: 'KeyL', key: 'L', icon: 'ic_water', kind: 'swap', ab: null, name: 'Switch element (1-6 direct)' },
    { code: 'KeyI', key: 'I', icon: 'sk_fire', ab: 'm1', kind: 'mskill', name: 'Skill 1 (own cooldown per element)', tag: '1' },
    { code: 'KeyO', key: 'O', icon: 'sk_fire', ab: 'm2', kind: 'mskill', name: 'Skill 2 (own cooldown per element)', tag: '2' },
    { code: 'KeyP', key: 'P', icon: 'sk_super', ab: 'mfuse', kind: 'fuse', name: 'Fusion (last two elements)' },
    { code: 'KeyE', key: 'E', icon: 'sk_super', kind: 'super', ab: 'm_su', name: 'Super' },
    { code: 'ShiftLeft', key: 'Shift', icon: 'sk_dash', kind: 'dash', name: 'Dash' },
    { code: 'KeyK', key: 'K', icon: null, kind: 'block', name: 'Block' },
    { code: 'Space', key: 'Space', icon: 'sk_jump', kind: 'jump', name: 'Jump' },
  ];
  return [
    { code: 'KeyJ', key: 'J', icon: 'sk_fist', kind: 'melee', name: 'Combo' },
    { code: 'KeyU', key: 'U', icon: kz ? 'sk_fire' : hero.charId === 'sira' ? 'ic_ice' : 'ic_' + el, ab: K.btn[0][0], kind: 'basic', name: K.btn[0][1] + ' (tap ×3)' },
    { code: 'KeyI', key: 'I', icon: kz ? 'sk_fire' : 'sk_' + el, ab: K.btn[1][0], name: K.btn[1][1], tag: '1' },
    { code: 'KeyO', key: 'O', icon: kz ? 'sk_earth' : rk ? 'sk_jump' : 'sk_' + el, ab: K.btn[2][0], name: K.btn[2][1], tag: '2' },
    { code: 'KeyE', key: 'E', icon: 'sk_super', kind: 'super', ab: K.superAb, name: 'Super' },
    { code: 'ShiftLeft', key: 'Shift', icon: 'sk_dash', kind: 'dash', name: 'Dash' },
    { code: 'KeyK', key: 'K', icon: null, kind: 'block', name: 'Block' },
    { code: 'Space', key: 'Space', icon: 'sk_jump', kind: 'jump', name: 'Jump' },
  ];
}
// [right, bottom, size] in px from the bottom-right corner (landscape phone)
const TOUCH_LAYOUT = { KeyU: [18, 16, 98], KeyJ: [128, 12, 64], KeyI: [114, 88, 64], KeyO: [34, 126, 62], KeyE: [202, 50, 60], KeyK: [198, 124, 54], Space: [110, 166, 54], ShiftLeft: [36, 200, 52], KeyP: [262, 16, 56], KeyL: [272, 86, 58] };
function slotEl(d, cls) {
  const b = document.createElement('div'); b.className = cls + (d.icon ? '' : ' shieldIc');
  if (d.icon) b.style.backgroundImage = ICON(d.icon);
  b.innerHTML = '<i class="cd"></i><span class="t"></span>' + (d.tag ? `<b class="tg">${d.tag}</b>` : '') + (d.kind === 'basic' ? '<s class="pips"><i></i><i></i><i></i></s>' : '') + (cls === 'ks' ? `<kbd>${d.key}</kbd>` : '');
  b._cd = b.querySelector('.cd'); b._t = b.querySelector('.t'); b._p = -1; b._tx = ''; b.title = d.name;
  return b;
}
function buildControls() {
  for (const k in TBTN) delete TBTN[k]; for (const k in KSLOT) delete KSLOT[k];
  const defs = ctrlDefs();
  const bar = $('#keyBar'); bar.innerHTML = '';
  if (!IS_TOUCH) for (const d of defs) { const b = slotEl(d, 'ks'); bar.appendChild(b); KSLOT[d.code] = Object.assign({ b }, d); }
  const tb = $('#tbtns'); tb.innerHTML = '';
  if (!IS_TOUCH) return;
  for (const d of defs) {
    const [r, bt, s] = TOUCH_LAYOUT[d.code]; const b = slotEl(d, 'tb');
    Object.assign(b.style, { right: `calc(${r}px + var(--sr))`, bottom: bt + 'px', width: s + 'px', height: s + 'px' });
    const code = d.code;
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Sfx.init(); TOUCH.btn[code] = true; TOUCH.pressed.add(code); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { } });
    const up = () => { TOUCH.btn[code] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    tb.appendChild(b); TBTN[code] = Object.assign({ b }, d);
  }
}
function buildTouch() {
  const joy = $('#joy'), knob = joy.querySelector('i'); let jid = null, cx = 0, cy = 0;
  const zone = $('#joyZone');
  zone.addEventListener('pointerdown', e => { Sfx.init(); if (jid !== null) return; jid = e.pointerId; cx = e.clientX; cy = e.clientY; joy.style.left = (cx - 75) + 'px'; joy.style.top = (cy - 75) + 'px'; joy.style.bottom = 'auto'; joy.classList.add('on'); zone.setPointerCapture(e.pointerId); });
  zone.addEventListener('pointermove', e => { if (e.pointerId !== jid) return; const R = 62 / (SETTINGS.sens || 1); let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } knob.style.transform = `translate(${dx * 62 / R}px,${dy * 62 / R}px)`; let mx = dx / R, mz = -dy / R; if (Math.hypot(mx, mz) < .12) mx = mz = 0; TOUCH.mx = mx; TOUCH.mz = mz; });
  const endJ = e => { if (e.pointerId !== jid) return; jid = null; knob.style.transform = ''; TOUCH.mx = TOUCH.mz = 0; joy.classList.remove('on'); joy.style.left = ''; joy.style.top = ''; joy.style.bottom = ''; };
  zone.addEventListener('pointerup', endJ); zone.addEventListener('pointercancel', endJ);
}
function slotState(d) {
  if (d.kind === 'swap') { const cd = Math.max(0, hero.swapCd); return [cd / MM.swapGap * 100, '', false]; }
  if (d.kind === 'fuse') { const cd = hero.cds.mf || 0; const rdy = cd <= 0 && hero.prevEl && hero.prevEl !== hero.melEl; return [cd / MM.fuse.cd * 100, cd > 0 ? Math.ceil(cd) + '' : '', !!rdy]; }
  if (d.kind === 'mskill') { const cd = hero.cds[cdKeyOf(hero, d.ab)] || 0, base = d.ab === 'm1' ? MM.s1.cd : MM.s2.cd; return [cd / base * 100, cd > 0 ? Math.ceil(cd) + '' : '', false]; }
  if (d.kind === 'basic') { const st = hero.chainT > 0 && hero.chainEl === d.ab ? hero.comboStep : 0; return [0, '', false, st]; }
  if (d.ab && d.kind !== 'super') { const cd = hero.cds[d.ab] || 0; return [cd / AB[d.ab].cd * 100, cd > 0 ? Math.ceil(cd) + '' : '', false]; }
  if (d.kind === 'super') return [100 - hero.spirit, '', hero.spirit >= 100];
  if (d.kind === 'dash') { const cd = Math.max(0, hero.dashCD); return [cd / (hero.dashMax || BAL.dashCD) * 100, cd > 0 ? Math.ceil(cd) + '' : '', false]; }
  return [0, '', false];
}
function updateControls() {
  if (hero && hero.isMaster) { const ic = 'ic_' + (hero.melEl === 'lightning' ? 'lightning' : hero.melEl), sk = 'sk_' + (hero.melEl === 'ice' ? 'water' : hero.melEl);
    const nx = ELS6[(ELS6.indexOf(hero.melEl) + 1) % 6], icn = 'ic_' + nx;
    for (const M of [TBTN, KSLOT]) { if (M.KeyU && M.KeyU._ic !== ic) { M.KeyU._ic = ic; M.KeyU.b.style.backgroundImage = ICON(ic); } if (M.KeyL && M.KeyL._ic !== icn) { M.KeyL._ic = icn; M.KeyL.b.style.backgroundImage = ICON(icn); } for (const c of ['KeyI', 'KeyO']) if (M[c] && M[c]._ic !== sk) { M[c]._ic = sk; M[c].b.style.backgroundImage = ICON(sk); } } }
  for (const M of [TBTN, KSLOT]) for (const c in M) {
    const d = M[c], b = d.b; const [p, tx, rdy] = slotState(d); const pp = Math.round(p);
    if (pp !== b._p) { b._p = pp; b._cd.style.setProperty('--p', pp + '%'); }
    if (tx !== b._tx) { b._tx = tx; b._t.textContent = tx; }
    if (rdy !== b._r) { b._r = rdy; b.classList.toggle('ready', rdy); }
    const st = slotState(d)[3]; if (st !== undefined && st !== b._st) { b._st = st; b.querySelectorAll('.pips i').forEach((p, k) => p.classList.toggle('on', k < st)); }
  }
}
function btnDenied(name) { for (const M of [TBTN, KSLOT]) for (const c in M) if (M[c].ab === name) { const b = M[c].b; b.classList.remove('deny'); void b.offsetWidth; b.classList.add('deny'); } }
function markSlots() { }

// ---------------------------------------------------------------- CAMERA (third-person, behind the back, lock-on)
const CAM = { pos: new V3(0, 5, 18), look: new V3(0, 1, 0), dir: new V3(0, 0, -1), shake: 0, focus: null, focusT: 0, introT: 0 };
const CAM_DIST = { near: [3.4, 1.85, .7], mid: [4.6, 2.2, .85], far: [6.2, 2.8, 1.0] };
function shake(a) { CAM.shake = Math.min(1.2, CAM.shake + a); }
function hitstop(t) { game.hitstop = Math.max(game.hitstop, t); }
function startCinematic(f, opp, a) { if (f === hero) { CAM.focus = f; CAM.focusT = .55; } if (a.ult) opp.freezeT = a.rel + .1; Sfx.play('ult'); popBanner(a.label || ''); }
function updateCamera(dt) {
  const camH = (hero.hp > 0 || FIGHTERS.length <= 2) ? hero : (FIGHTERS.find(x => x.team === hero.team && x.hp > 0) || hero);
  const h = camH.pos, e = (camH.target && camH.target.hp > 0 ? camH.target : enemy).pos;
  const d = _v1.copy(e).sub(h).setY(0); const dist = d.length();
  if (dist > 1.4) { d.divideScalar(dist); CAM.dir.lerp(d, 1 - Math.exp(-6 * dt)).normalize(); }
  const [cd, ch, sh] = CAM_DIST[SETTINGS.camDist] || CAM_DIST.mid;
  const right = _v2.set(-CAM.dir.z, 0, CAM.dir.x);
  let tx = h.x - CAM.dir.x * cd + right.x * sh, tz = h.z - CAM.dir.z * cd + right.z * sh, ty = h.y + ch + Math.max(0, (e.y - h.y)) * .25;
  const la = Math.min(dist * .55, 9);
  let lx = h.x + CAM.dir.x * la + right.x * sh * .4, lz = h.z + CAM.dir.z * la + right.z * sh * .4, ly = h.y + 1.35 + (e.y - h.y) * .4;
  let kpos = 10;
  if (game.state === 'intro' && CAM.introT > 0) {
    const k = CAM.introT; const ang = k * 2.2;
    const s = _v3.set(-CAM.dir.x, 0, -CAM.dir.z).applyAxisAngle(_v4.set(0, 1, 0), ang);
    tx = h.x + s.x * (cd + k * 10); tz = h.z + s.z * (cd + k * 10); ty = h.y + ch + k * 7; lx = lerp(lx, (h.x + e.x) / 2, k); lz = lerp(lz, (h.z + e.z) / 2, k); kpos = 4;
  }
  if (CAM.focusT > 0 && CAM.focus) {
    const f = CAM.focus; const fwd = _v3.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    tx = f.pos.x + fwd.x * 3.4 + right.x * 1.6; tz = f.pos.z + fwd.z * 3.4 + right.z * 1.6; ty = f.pos.y + 1.6; lx = f.pos.x; ly = f.pos.y + 1.3; lz = f.pos.z; kpos = 7;
  }
  if (game.state === 'ko') { const w = game.koVictim || enemy; tx = w.pos.x - CAM.dir.x * 5 + right.x * 2.5; tz = w.pos.z - CAM.dir.z * 5 + right.z * 2.5; ty = w.pos.y + 2.4; lx = w.pos.x; lz = w.pos.z; ly = w.pos.y + .8; kpos = 2.5; }
  CAM.pos.x = damp(CAM.pos.x, tx, kpos, dt); CAM.pos.y = damp(CAM.pos.y, ty, kpos * .8, dt); CAM.pos.z = damp(CAM.pos.z, tz, kpos, dt);
  // keep camera above ground/platforms and inside the world
  CAM.pos.y = Math.max(CAM.pos.y, groundAt(CAM.pos.x, CAM.pos.z, CAM.pos.y) + .6);
  CAM.look.x = damp(CAM.look.x, lx, 12, dt); CAM.look.y = damp(CAM.look.y, ly, 12, dt); CAM.look.z = damp(CAM.look.z, lz, 12, dt);
  camera.position.copy(CAM.pos);
  if (game.state !== 'menu') { _v3.copy(h).setY(h.y + 1.5); const k = camClip(_v3, CAM.pos); if (k < 1) camera.position.lerpVectors(_v3, CAM.pos, Math.max(.15, k - .06)); }
  if (CAM.shake > 0) { const s = CAM.shake * CAM.shake * .3; camera.position.x += rand(-s, s); camera.position.y += rand(-s, s); camera.position.z += rand(-s, s); CAM.shake = Math.max(0, CAM.shake - dt * 2.6); }
  camera.lookAt(CAM.look);
  // fade pillars/tall rocks that block the view of either fighter
  for (const c of ARENA.faders) {
    let blocked = false;
    for (const tp of [hero.pos, enemy.pos]) {
      const px = camera.position.x, pz = camera.position.z, vx = tp.x - px, vz = tp.z - pz, l2 = vx * vx + vz * vz || 1;
      const tt = clamp(((c.pos.x - px) * vx + (c.pos.z - pz) * vz) / l2, 0, 1);
      if (tt > 0 && tt < .98 && Math.hypot(px + vx * tt - c.pos.x, pz + vz * tt - c.pos.z) < c.r + .5) blocked = true;
    }
    if (Math.hypot(camera.position.x - c.pos.x, camera.position.z - c.pos.z) < c.r + 1) blocked = true;
    c.op = damp(c.op, blocked ? .2 : 1, 8, dt); c.mats.forEach(m => { m.opacity = c.op; m.depthWrite = c.op > .9; });
  }
  // shadow camera follows the fight
  const sun = ARENA.sun; const mx = (h.x + e.x) / 2, mz = (h.z + e.z) / 2;
  sun.target.position.set(mx, 0, mz); sun.position.set(mx - 16, 22, mz - 24);
}

// ---------------------------------------------------------------- HUD
const HUD = {
  hp: [...document.querySelectorAll('.hp .fill')], tr: [...document.querySelectorAll('.hp .trail')], hpTxt: [...document.querySelectorAll('.hp b')],
  sp: [...document.querySelectorAll('.sp')], en: [...document.querySelectorAll('.en')], wins: [$('#pb0 .wins'), $('#pb1 .wins')], timer: $('#timer'), stats: [$('#pb0 .stats'), $('#pb1 .stats')], statKey: ['', ''],
  combo: $('#combo'), ann: $('#announce'), arrow: $('#offArrow'), mark: $('#enemyMark'), train: $('#trainInfo'),
};
// status icons: [icon, good/bad]
const ST_DEF = { wet: ['ic_water', 'bad', 'Wet: Winter Needle will freeze you'], root: [null, 'bad', 'Bound: cannot move or dash', '⛓'], stab: ['ic_earth', 'good', 'Mountain Stability: −15% damage, knockback halved'], heat: ['ic_fire', 'good', 'Magma Heat stacks (3 = Molten 3rd combo hit)'], soak: ['ic_water', 'bad', 'Soaked: +10% damage taken'], static: ['ic_lightning', 'bad', 'Static: next combo hit +30'], slow: [null, 'bad', 'Slowed', '❄'], fort: ['ic_earth', 'good', 'Fortified: −20% damage taken'], haste: ['ic_wind', 'good', 'Haste: +12% speed'], ccImm: [null, 'good', 'Immune to forced displacement', '⛨'] };
function hudStatuses(i, f) {
  const act = []; if (f.seal) act.push(['seal', EL[f.seal.el].icon]); if (f.embers > 0) act.push(['heat', f.embers]); if (f.igniteT > 0) act.push(['ign', Math.ceil(f.igniteT)]); if (f.shieldHp > 0) act.push(['shld', Math.ceil(f.shieldHp)]);
  for (const k in ST_DEF) { if (k === 'heat') { if (f.heat > 0 && f.charId === 'kazan') act.push([k, f.heat]); continue; } const v = k === 'slow' ? f.slowT : f.sts[k]; if (v > 0) act.push([k, Math.ceil(v)]); }
  const key = act.map(a => a.join(':')).join(','); if (key === HUD.statKey[i]) return; HUD.statKey[i] = key;
  const XTR = { seal: ['ic_fire', 'good', 'Stored seal — switch element and press Fusion'], ign: ['sk_fire', 'good', 'Blade ignited'], shld: ['ic_water', 'good', 'Frost-rock shield'] };
  HUD.stats[i].innerHTML = act.map(([k, s]) => { const D = ST_DEF[k] || XTR[k] || ST_DEF.stab; return `<div class="st ${D[1]} ${D[0] ? '' : 'txt'}" title="${D[2]}" style="${D[0] ? `background-image:${ICON(D[0])}` : ''}">${D[3] || ''}<b>${s}</b></div>`; }).join('');
}
function hudUpdate(dt) {
  [hero, enemy].forEach((f, i) => {
    f.dispHp = damp(f.dispHp, f.hp / f.maxHp * 100, 18, dt); f.trailHp = f.trailHp > f.dispHp ? damp(f.trailHp, f.dispHp, 2.2, dt) : f.dispHp;
    HUD.hp[i].style.width = f.dispHp + '%'; HUD.tr[i].style.width = f.trailHp + '%'; HUD.hp[i].classList.toggle('low', f.hp < f.maxHp * .3);
    const t = Math.ceil(f.hp) + ''; if (HUD.hpTxt[i].textContent !== t) HUD.hpTxt[i].textContent = t;
    HUD.sp[i].firstElementChild.style.width = f.spirit + '%'; HUD.sp[i].classList.toggle('full', f.spirit >= 100);
    HUD.en[i].classList.toggle('hidden', !f.useEnergy); if (f.useEnergy) HUD.en[i].firstElementChild.style.width = f.mana + '%';
    [...HUD.wins[i].children].forEach((b, k) => b.classList.toggle('on', game.wins[i] > k));
    hudStatuses(i, f);
  });
  const tt = game.mode === 'training' ? '∞' : Math.max(0, Math.ceil(game.timer)) + ''; if (HUD.timer.textContent !== tt) HUD.timer.textContent = tt; HUD.timer.classList.toggle('warn', game.mode !== 'training' && game.timer <= 10);
  updateControls();
  if (game.comboT > 0) { game.comboT -= dt; if (game.comboT <= 0) HUD.combo.classList.remove('on'); }
  if (game.mode === 'training') { const s = game.stats, tx = `TRAINING · last combo <b>${Math.round(s.comboDmg)}</b> dmg · total ${Math.round(s.dealt)}`; if (HUD.train._t !== tx) { HUD.train._t = tx; HUD.train.innerHTML = tx; } }
  // enemy marker (red triangle above the head) or an edge arrow when off-screen
  _v1.copy(enemy.pos).setY(enemy.pos.y + (enemy.isDummy ? 2.1 : 2.25)).project(camera);
  const off = _v1.z > 1 || Math.abs(_v1.x) > .95 || Math.abs(_v1.y) > .95, fighting = ['fight', 'intro'].includes(game.state);
  HUD.mark.classList.toggle('hidden', off || !fighting);
  if (!off) HUD.mark.style.transform = `translate(${(_v1.x * .5 + .5) * innerWidth}px,${(-_v1.y * .5 + .5) * innerHeight}px)`;
  HUD.arrow.style.display = off && game.state === 'fight' ? 'block' : 'none';
  if (off) { let x = _v1.x, y = _v1.y; if (_v1.z > 1) { x = -x; y = -y; } const a = Math.atan2(-y, x); const r = Math.min(innerWidth, innerHeight) * .38; HUD.arrow.style.transform = `translate(${innerWidth / 2 + Math.cos(a) * r}px,${innerHeight / 2 + Math.sin(a) * r}px) rotate(${a}rad)`; }
  if (HUD.obars && HUD.obars.length) for (const [f, d, s] of HUD.obars) {
    _v1.copy(f.pos).setY(f.pos.y + (f.charId === 'rakan' ? 2.9 : 2.35)).project(camera);
    const vis = _v1.z < 1 && Math.abs(_v1.x) < 1 && Math.abs(_v1.y) < 1 && f.hp > 0 && fighting;
    d.style.display = vis ? '' : 'none';
    if (vis) { d.style.transform = `translate(${(_v1.x * .5 + .5) * innerWidth}px,${(-_v1.y * .5 + .5) * innerHeight}px) translate(-50%,-100%)`; s.style.width = Math.max(0, f.hp / f.maxHp * 100) + '%'; }
  }
}
function showCombo(n) { if (n < 2) return; HUD.combo.querySelector('b').textContent = n; HUD.combo.classList.add('on'); game.comboT = 1.4; }
function announce(text, sub = '') { const a = HUD.ann; a.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); a.classList.remove('show'); void a.offsetWidth; a.classList.add('show'); }
function popBanner(text) { if (text) announce(`<span style="font-size:.5em">${text}</span>`); }
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove('on'), 1600); }
const DMG = [];
function popText(pos, text, color = '#fff', size = 26) { if (DMG.length > 40) { DMG[0].el.remove(); DMG.shift(); } const el = document.createElement('div'); el.className = 'dmg'; el.textContent = text; el.style.color = color; el.style.fontSize = size + 'px'; $('#dmgLayer').appendChild(el); DMG.push({ el, pos: pos.clone(), t: 0, vy: 1.2 }); }
function popDamage(pos, d, el) { const c = { fire: '#ffb070', water: '#9fd4ff', wind: '#e6fff4', earth: '#e8c890', lightning: '#d8ccff', ice: '#bfe9ff', block: '#9aa' }[el] || '#fff'; popText(pos.clone().add(new V3(rand(-.3, .3), .3, rand(-.3, .3))), Math.round(d), c, d >= 120 ? 34 : d >= 60 ? 28 : 22); }
function updateDmg(dt) {
  for (let i = DMG.length - 1; i >= 0; i--) {
    const d = DMG[i]; d.t += dt; d.pos.y += d.vy * dt; _v1.copy(d.pos).project(camera);
    d.el.style.left = ((_v1.x * .5 + .5) * innerWidth) + 'px'; d.el.style.top = ((-_v1.y * .5 + .5) * innerHeight) + 'px'; d.el.style.opacity = _v1.z < 1 ? Math.min(1, (1.1 - d.t) * 2.5) : 0;
    d.el.style.transform = `translate(-50%,-50%) scale(${d.t < .1 ? 1.6 - d.t * 6 : 1})`;
    if (d.t > 1.1) { d.el.remove(); DMG.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- ROSTER / PROFILE (add characters & skins here)
const ROSTER = [
  { id: 'raven', name: 'Raven', short: 'RAVEN', title: 'Shadow of the Five Elements', img: 'assets/p_raven.jpg', available: true, about: 'A shadow ninja who masters one element per fight. Pick the element before the match.' },
  { id: 'kazan', name: 'Kazan', short: 'KAZAN', title: 'Lord of Magma', img: 'assets/p_kazan.jpg', available: true, legendary: true, fixedEl: 'Magma', about: 'A heavy volcanic warrior: he controls the ground with lava and punishes up close. Slower and easier to dodge than Raven, but his skills leave burning ground behind.' },
  { id: 'sira', name: 'Sira', short: 'SIRA', title: 'Blade of Frost', img: 'assets/p_sira.jpg', available: true, legendary: true, fixedEl: 'Frost', about: 'The fastest fighter: a sword duelist of water and ice. Water skills mark the enemy Wet; the Winter Needle freezes a Wet target. Fragile — she wins by timing, not by trading.' },
  { id: 'rayn', name: 'Rayn', short: 'RAYN', title: 'Blade of Flame', img: 'assets/p_rayn.jpg', available: true, legendary: true, fixedEl: 'Flame', about: 'A fire swordsman. Finishing his combo grants Embers; igniting the blade turns them into burning steel — stronger cuts, burning wounds and a bigger Flame Crescent.' },
  { id: 'rakan', name: 'Rakan', short: 'RAKAN', title: 'Guardian of the Mountain', img: 'assets/p_rakan.jpg', available: true, legendary: true, fixedEl: 'Stone', about: 'A stone giant who wins up close: heavy fists, high defense, and a Gravity Counter that returns blows and projectiles when timed right. Big and slow to wind up — bait his swings and punish.' },
  { id: 'master', name: 'Elemental Master', short: 'MASTER', title: 'Wielder of the six', img: 'assets/p_hero.jpg', available: true, legendary: true, fixedEl: 'All', about: 'Commands all six elements. Land a skill to store its seal, switch element, then fuse the two — fifteen fusions in all. Runs on energy, and his super unites the six.' },
];
const SKINS = { sira: [{ id: 'default', name: 'Frost Plate', available: true, img: 'assets/full_sira.jpg' }, { id: 'tide', name: 'Tide Plate', available: false }], rayn: [{ id: 'default', name: 'Ashen Garb', available: true, img: 'assets/full_rayn.jpg' }, { id: 'sun', name: 'Sun Garb', available: false }], master: [{ id: 'default', name: 'Avatar Robes', available: true, img: 'assets/full_hero.jpg' }, { id: 'gold', name: 'Gilded Robes', available: false }], rakan: [{ id: 'default', name: 'Mountain Plate', available: true, img: 'assets/full_rakan.jpg' }, { id: 'granite', name: 'Granite Plate', available: false }, { id: 'jade', name: 'Jade Plate', available: false }], kazan: [{ id: 'default', name: 'Volcanic Garb', available: true, img: 'assets/full_kazan.jpg' }, { id: 'obsidian', name: 'Obsidian Garb', available: false }, { id: 'ash', name: 'Ash Garb', available: false }, { id: 'inferno', name: 'Inferno Garb', available: false }], raven: [{ id: 'default', name: 'Shadow Garb', available: true, img: 'assets/full_raven.jpg' }, { id: 'ember', name: 'Ember Garb', available: false }, { id: 'tide', name: 'Tide Garb', available: false }, { id: 'storm', name: 'Storm Garb', available: false }] };
const availableChars = () => ROSTER.filter(c => c.available);
const PROFILE = { char: 'raven', el: 'fire', skin: 'default', opp: { char: 'random', el: 'random' }, ally: { char: 'random' }, diff: 'normal', mode: 'versus' };
try { const p = JSON.parse(localStorage.getItem('ea_profile') || '{}'); Object.assign(PROFILE, p, { opp: Object.assign({}, PROFILE.opp, p.opp) }); } catch (e) { }
if (!ROSTER.find(c => c.id === PROFILE.char && c.available)) PROFILE.char = availableChars()[0].id;
const skinOf = id => (PROFILE.skins = PROFILE.skins || {})[id] || 'default';
if (PROFILE.opp.char !== 'random' && !ROSTER.find(c => c.id === PROFILE.opp.char && c.available)) PROFILE.opp.char = 'random';
if (!PROFILE.ally || (PROFILE.ally.char !== 'random' && !ROSTER.find(c => c.id === PROFILE.ally.char && c.available))) PROFILE.ally = { char: 'random' };
if (!['versus', 'duo', 'rumble', 'tower', 'training'].includes(PROFILE.mode)) PROFILE.mode = 'versus';
if (!ELS.includes(PROFILE.el)) PROFILE.el = 'fire';
function saveProfile() { try { localStorage.setItem('ea_profile', JSON.stringify(PROFILE)); } catch (e) { } }

// ---------------------------------------------------------------- GAME FLOW
const game = { state: 'loading', mode: 'lobby', time: 0, rdt: 0, timer: CFG.ROUND_TIME, round: 1, wins: [0, 0], hitstop: 0, timeScale: 1, diff: 'normal', comboT: 0, koVictim: null, phaseT: 0,
  sel: { p: { char: 'raven', el: 'fire' }, ai: { char: 'raven', el: 'fire' } }, stats: { dealt: 0, taken: 0, maxCombo: 0, comboDmg: 0 } };
let hero, enemy, ai;
let FIGHTERS = [], OBS0 = null, WORLD_K = 1;
const opps = f => FIGHTERS.filter(o => o !== f && o.team !== f.team && o.hp > 0);
function nearestOpp(f, pos) { let b = null, bd = 1e9; for (const o of opps(f)) { const d = (o.pos.x - pos.x) ** 2 + (o.pos.z - pos.z) ** 2; if (d < bd) { bd = d; b = o; } } return b; }
function pickTarget(f) { const os = opps(f); if (!os.length) return null; let best = os[0], bd = 1e9; for (const o of os) { const d = o.pos.distanceToSquared(f.pos); if (d < bd) { bd = d; best = o; } } const cur = f.target; if (cur && cur !== best && os.includes(cur) && cur.pos.distanceToSquared(f.pos) < bd * 1.69) return cur; return best; }
function teamsAlive() { const s = new Set(); for (const f of FIGHTERS) if (f.hp > 0) s.add(f.team); return [...s]; }
function setWorldScale(k) { // bigger map for team modes: the whole built arena scales in XZ, heights stay
  WORLD_K = k; if (ARENA.grp) ARENA.grp.scale.set(k, 1, k);
  if (OBS0) for (const [o, b] of OBS0) { o.x = b.x * k; o.z = b.z * k; if (b.r !== undefined) o.r = b.r * k; if (b.hw !== undefined) { o.hw = b.hw * k; o.hd = b.hd * k; } }
  CFG.ARENA_R = 24 * k;
}
const START_H = new V3(0, 0, 11), START_E = new V3(0, 0, -11);
const fighterLabel = f => f.isDummy ? 'Training Dummy' : f.isMaster ? 'Elemental Master' : f.charId === 'kazan' ? 'Kazan · Magma' : f.charId === 'rakan' ? 'Rakan · Stone' : f.charId === 'sira' ? 'Sira · Frost' : f.charId === 'rayn' ? 'Rayn · Flame' : `Raven · ${EL[f.el].name}`;
function makeFighter(sel, isPlayer, variant) {
  if (sel.char === 'dummy') return new Fighter({ name: 'Training Dummy', dummy: true, el: 'earth', kit: RAVEN_KITS.earth });
  if (sel.char === 'master') { const K = MASTER_KIT; const f = new Fighter({ name: 'Elemental Master', char: 'master', isMaster: true, isPlayer, kit: K, speed: K.speed, airJumps: 1, glide: true, variant }); f.useEnergy = false; f.melEl = 'fire'; f.prevEl = null; f.maxHp = f.hp = MM.hp; f.spD = MM.spD; f.spT = MM.spT; return f; }
  if (sel.char === 'sira') { const K = SIRA_KIT; const f = new Fighter({ name: 'Sira', char: 'sira', isMaster: false, isPlayer, el: 'water', blockStyle: 'frost', kit: K, speed: K.speed, armor: 1, airJumps: 1, glide: false, heal: 0, variant }); f.comboSpd = BAL.chars.sira.comboSpd; return f; }
  if (sel.char === 'rayn') { const K = RAYN_KIT; return new Fighter({ name: 'Rayn', char: 'rayn', isMaster: false, isPlayer, el: 'fire', blockStyle: 'blade', kit: K, speed: K.speed, armor: 1, airJumps: 1, glide: false, heal: 0, variant }); }
  if (sel.char === 'rakan') { const K = RAKAN_KIT; return new Fighter({ name: 'Rakan', char: 'rakan', isMaster: false, isPlayer, el: 'earth', blockStyle: 'stone', kit: K, speed: K.speed, armor: 1, airJumps: 0, glide: false, heal: 0, variant }); }
  if (sel.char === 'kazan') { const K = KAZAN_KIT; return new Fighter({ name: 'Kazan', char: 'kazan', isMaster: false, isPlayer, el: 'fire', blockStyle: 'magma', kit: K, speed: K.speed, armor: 1, airJumps: 1, glide: false, heal: 0, variant }); }
  const K = RAVEN_KITS[sel.el]; return new Fighter({ name: 'Raven', char: 'raven', isMaster: false, isPlayer, el: sel.el, kit: K, speed: K.speed, armor: K.armor, airJumps: K.airJumps, glide: K.glide, heal: K.heal, variant });
}
function disposeFighter(f) { if (!f) return; scene.remove(f.rig.root); f.rig.root.traverse(o => { if (o.isMesh && o.material && o.material.dispose && f.rig.glb && o.isSkinnedMesh) o.material.dispose(); }); }
function syncRightBar(t, force) {
  if (!t || (!force && HUD._rt === t)) return; HUD._rt = t;
  $('#pb1 .pname').textContent = fighterLabel(t) + (t.isDummy || FIGHTERS.length > 2 ? '' : ` · ${game.diff.toUpperCase()}`);
  const por = f => f.isDummy ? 'none' : `url(assets/${f.isMaster ? 'p_hero' : 'p_' + f.charId}.jpg)`;
  $('#pb1 .portrait').style.background = t.isDummy ? 'radial-gradient(circle,#8a6a3a,#3a2a14)' : '';
  if (!t.isDummy) $('#pb1 .portrait').style.backgroundImage = por(t);
}
function buildObars() { // small HP bars above everyone else's head in team / rumble matches
  let c = $('#obars'); if (!c) { c = document.createElement('div'); c.id = 'obars'; $('#hud').appendChild(c); }
  c.innerHTML = ''; HUD.obars = [];
  if (FIGHTERS.length <= 2) return;
  for (const f of FIGHTERS) { if (f === hero) continue; const d = document.createElement('div'); d.className = 'ob' + (f.team === hero.team ? ' ally' : ''); d.innerHTML = `<b>${f.team === hero.team ? 'ALLY · ' : ''}${f.name}</b><i><s></s></i>`; c.appendChild(d); HUD.obars.push([f, d, d.querySelector('s')]); }
}
function setupFighters(slots) {
  for (const f of FIGHTERS) disposeFighter(f);
  if (!FIGHTERS.includes(hero)) disposeFighter(hero); if (!FIGHTERS.includes(enemy)) disposeFighter(enemy);
  FIGHTERS = [];
  if (!slots) { const { p, ai: a } = game.sel; slots = [Object.assign({ team: 0, isPlayer: true }, p), Object.assign({ team: 1 }, a)]; }
  const used = {};
  for (const s of slots) {
    const key = s.char + (s.char === 'raven' ? ':' + s.el : '');
    const f = makeFighter(s, !!s.isPlayer, used[key] ? 'b' : 'a'); used[key] = 1;
    f.team = s.team || 0; FIGHTERS.push(f); if (s.isPlayer) hero = f;
  }
  enemy = FIGHTERS.find(f => f.team !== hero.team) || FIGHTERS[1];
  for (const f of FIGHTERS) { f.target = f === hero ? enemy : hero; f.ai = (f === hero || f.isDummy) ? null : new AI(f, f.kit, game.diff); }
  ai = enemy.ai || null;
  $('#pb0 .pname').textContent = fighterLabel(hero) + ' (YOU)';
  const por = f => f.isDummy ? 'none' : `url(assets/${f.isMaster ? 'p_hero' : 'p_' + f.charId}.jpg)`;
  $('#pb0 .portrait').style.backgroundImage = por(hero);
  syncRightBar(enemy, true);
  buildControls(); buildObars();
}
// ===================== MAPS & HAZARDS =====================
const MAPS = {
  temple: { name: 'Sunset Temple', desc: 'The classic arena. No hazards.', icon: '🏛️' },
  volcano: { name: 'Volcano Crater', desc: 'Lava pools burn; eruptions blast marked circles every few seconds.', icon: '🌋', fog: 0x5a1e10, fogN: 30, fogF: 170, bg: .5, hemi: [0xff9a70, 0x401008, 1.0], sun: [0xff6a30, 2.3], floor: 0xa27a66, every: 4.2 },
  frozen: { name: 'Frozen Peak', desc: 'Slippery ice — you slide when you stop. Ice spikes burst from marked circles.', icon: '❄️', fog: 0xcfe2f2, fogN: 40, fogF: 210, bg: .95, hemi: [0xe4f2ff, 0x6080a0, 1.3], sun: [0xe8f4ff, 2.1], floor: 0xf2f9ff, grip: .32, every: 5, snow: 0xffffff },
  storm: { name: 'Storm Plateau', desc: 'Lightning strikes marked circles — and strikes more often as the round goes on.', icon: '⛈️', fog: 0x2a2f3a, fogN: 22, fogF: 140, bg: .22, hemi: [0x8090b0, 0x202028, .85], sun: [0x9fb0ff, 1.0], floor: 0x9a9aa8, every: 3, snow: 0x9fb8ff, rain: true, dark: true },
};
const MAPF = { id: 'temple', grip: 1 };
let MAP_DEF = null, HAZ_T = 0, WEATHER = null;
const HAZ = { isEnv: true, team: -1, charId: 'world', name: 'The Arena', pos: new V3(0, 30, 0), spirit: 0, combo: 0, lastComboHit: -9, hp: 1, maxHp: 1, ghost: () => true };
function applyMap(id) {
  if (!MAP_DEF) MAP_DEF = { fog: scene.fog.color.getHex(), fogN: scene.fog.near, fogF: scene.fog.far, bg: scene.backgroundIntensity, hemi: ARENA.hemi ? [ARENA.hemi.color.getHex(), ARENA.hemi.groundColor.getHex(), ARENA.hemi.intensity] : null, sun: [ARENA.sun.color.getHex(), ARENA.sun.intensity], floor: MATS.floor ? MATS.floor.color.getHex() : 0xffffff, env: scene.environmentIntensity };
  const M = MAPS[id] || MAPS.temple, D = MAP_DEF; MAPF.id = MAPS[id] ? id : 'temple'; MAPF.grip = M.grip || 1;
  scene.fog.color.setHex(M.fog ?? D.fog); scene.fog.near = M.fogN ?? D.fogN; scene.fog.far = M.fogF ?? D.fogF;
  if (!D.bgTex) D.bgTex = scene.background;
  if (M.dark) { if (!D.stormTex) { const c = document.createElement('canvas'); c.width = 16; c.height = 256; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0b0e16'); gr.addColorStop(.42, '#252c3c'); gr.addColorStop(.5, '#3a4254'); gr.addColorStop(.56, '#2a2e36'); gr.addColorStop(1, '#14161b'); x.fillStyle = gr; x.fillRect(0, 0, 16, 256); D.stormTex = new THREE.CanvasTexture(c); D.stormTex.colorSpace = THREE.SRGBColorSpace; D.stormTex.mapping = THREE.EquirectangularReflectionMapping; }
    scene.background = D.stormTex; } else scene.background = D.bgTex;
  scene.backgroundIntensity = M.dark ? 1 : (M.bg ?? D.bg); scene.environmentIntensity = D.env * (M.bg ? Math.max(.45, M.bg) : 1);
  const hm = M.hemi || D.hemi; if (ARENA.hemi && hm) { ARENA.hemi.color.setHex(hm[0]); ARENA.hemi.groundColor.setHex(hm[1]); ARENA.hemi.intensity = hm[2]; }
  const sn = M.sun || D.sun; ARENA.sun.color.setHex(sn[0]); ARENA.sun.intensity = sn[1];
  if (MATS.floor) MATS.floor.color.setHex(M.floor ?? D.floor);
  if (WEATHER) { scene.remove(WEATHER.pts); WEATHER.pts.geometry.dispose(); WEATHER = null; }
  if (M.snow) { const n = IS_TOUCH ? 500 : 900, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = rand(-30, 30); pos[i * 3 + 1] = rand(0, 22); pos[i * 3 + 2] = rand(-30, 30); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: M.snow, size: M.rain ? .07 : .12, transparent: true, opacity: M.rain ? .55 : .85, depthWrite: false }));
    pts.frustumCulled = false; scene.add(pts); WEATHER = { pts, rain: !!M.rain }; }
  HAZ_T = 2.5;
}
function updateWeather(dt) {
  if (!WEATHER) return; const a = WEATHER.pts.geometry.attributes.position, A = a.array, fall = WEATHER.rain ? 26 : 2.2;
  for (let i = 0; i < A.length; i += 3) { A[i + 1] -= fall * dt; if (!WEATHER.rain) A[i] += Math.sin(game.time + i) * dt * .4; else A[i] += dt * 3; if (A[i + 1] < 0) { A[i + 1] = 22; A[i] = camera.position.x + rand(-30, 30); A[i + 2] = camera.position.z + rand(-30, 30); } }
  a.needsUpdate = true;
}
function mapRoundStart() { // permanent features re-created every round (clearField wipes them)
  if (MAPF.id === 'volcano') { const K = WORLD_K; for (const [x, z, r] of [[-9, -2, 2.2], [9.5, 3, 2.4], [1, 12.5, 1.9], [-2, -13, 2]]) addLava(HAZ, { kind: 'circle', c: new V3(x * K, groundAt(x * K, z * K) + .03, z * K), r, dps: 16, dur: 1e6 }); }
  HAZ_T = 3;
}
function hazardStrike() {
  const live = FIGHTERS.filter(f => f.hp > 0); if (!live.length) return; const T = pick(live);
  const P = T.pos.clone().add(new V3(rand(-1.6, 1.6), 0, rand(-1.6, 1.6))); if (Math.hypot(P.x, P.z) > CFG.ARENA_R - 1) P.multiplyScalar((CFG.ARENA_R - 1) / Math.hypot(P.x, P.z));
  P.y = groundAt(P.x, P.z, T.pos.y + .3);
  const id = MAPF.id, R = id === 'storm' ? 1.8 : 2.3, warn = id === 'storm' ? .85 : 1.1;
  telegraph(P, R, id === 'volcano' ? 0xff4010 : id === 'frozen' ? 0x9adcff : 0xb59cff, warn);
  later(warn, () => {
    if (game.state !== 'fight') return;
    if (id === 'volcano') { fb('explosion', { pos: P.clone().setY(P.y + 1.2), size: 4.2, boost: 1.2 }); fb('fire_burst', { pos: P.clone().setY(P.y + .8), size: 3.2, mode: 'up' }); decal(P, 'scorch', 2.6); Sfx.play('fire'); shake(.45); addLava(HAZ, { kind: 'circle', c: P.clone().setY(P.y + .03), r: 1.6, dps: 14, dur: 3 }); }
    else if (id === 'frozen') { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; fb('ice_spike', { pos: P.clone().add(new V3(Math.cos(a) * .9, .9, Math.sin(a) * .9)), size: [1.4, 2], mode: 'up', speed: 1.4 }); } fb('ice_burst', { pos: P.clone().setY(P.y + .7), size: 3, boost: 1.1 }); Sfx.play('water'); shake(.3); }
    else { fb('bolt', { pos: P.clone().setY(P.y + 5), size: [2.2, 11], mode: 'up', speed: 2.2, boost: 1.4 }); fb('lightning_orb', { pos: P.clone().setY(P.y + .6), size: 2.6 }); Sfx.play('lightning'); shake(.4); if (ARENA.hemi) { const i0 = ARENA.hemi.intensity; ARENA.hemi.intensity = 3; later(.12, () => { if (ARENA.hemi) ARENA.hemi.intensity = i0; }); } }
    for (const f of FIGHTERS) { if (f.hp <= 0 || f.ghost()) continue; if (Math.hypot(f.pos.x - P.x, f.pos.z - P.z) < R + .3 && f.pos.y - P.y < 2.5) {
      const hit = id === 'volcano' ? { dmg: 70, el: 'fire', kb: 6, launch: 7, burn: 2 } : id === 'frozen' ? { dmg: 55, el: 'ice', kb: 3, launch: 5, slow: 1.6, slowPct: .35 } : { dmg: 60, el: 'lightning', kb: 3, stun: .45 };
      applyHit(HAZ, f, Object.assign({ from: P.clone().setY(P.y - .5), unblockable: true, heavy: true }, hit)); } }
  });
}
function updateHazards(dt) {
  if (game.mode === 'training' || game.state !== 'fight' || !MAPS[MAPF.id].every) return;
  HAZ_T -= dt; if (HAZ_T > 0) return;
  const M = MAPS[MAPF.id], ramp = MAPF.id === 'storm' ? Math.max(.55, game.timer / CFG.ROUND_TIME) : 1;
  HAZ_T = M.every * ramp * rand(.8, 1.2) / Math.max(1, (FIGHTERS.length - 1) * .75); hazardStrike();
}

// ===================== PROGRESSION =====================
const UNLOCK = { raven: null, sira: null, kazan: null, rayn: { lvl: 3, coins: 600 }, rakan: { lvl: 5, coins: 900 }, master: { lvl: 8, coins: 1500 } };
const PROG = PROFILE.prog = Object.assign({ xp: 0, lvl: 1, coins: 0, owned: ['raven', 'sira', 'kazan'], towerBest: 0, wins: 0, played: 0 }, PROFILE.prog || {});
const xpNeed = L => 150 + 100 * (L - 1);
const owns = id => !UNLOCK[id] || PROG.owned.includes(id) || PROG.lvl >= UNLOCK[id].lvl;
function grantRewards(xp, coins) {
  const ups = [], unl = []; PROG.xp += xp; PROG.coins += coins;
  while (PROG.xp >= xpNeed(PROG.lvl)) { PROG.xp -= xpNeed(PROG.lvl); PROG.lvl++; ups.push(PROG.lvl); for (const id in UNLOCK) if (UNLOCK[id] && UNLOCK[id].lvl === PROG.lvl && !PROG.owned.includes(id)) { PROG.owned.push(id); unl.push(id); } }
  saveProfile(); return { ups, unl };
}
function progStrip() {
  const need = xpNeed(PROG.lvl), pct = Math.round(PROG.xp / need * 100);
  return `<div class="progS"><div class="lvB">LV ${PROG.lvl}</div><div class="xpB"><i style="width:${pct}%"></i><span>${PROG.xp} / ${need} XP</span></div><div class="coinB">🪙 ${PROG.coins}</div></div>`;
}
function rewardHTML(xp, coins, r, extra) {
  const nm = id => (ROSTER.find(c => c.id === id) || { name: id }).name;
  return `<div class="rew"><span>+${xp} XP</span><span>+${coins} 🪙</span>${extra ? `<span>${extra}</span>` : ''}</div>` +
    (r.ups.length ? `<div class="lvup">LEVEL UP! → LV ${PROG.lvl}</div>` : '') +
    r.unl.map(id => `<div class="unl">🔓 NEW FIGHTER UNLOCKED: <b>${nm(id).toUpperCase()}</b></div>`).join('') + progStrip();
}
function matchRewards(won) {
  if (game.mode === 'training') return '';
  const dm = { easy: .7, normal: 1, hard: 1.45 }[game.diff] || 1, mm = game.mode === 'duo' || game.mode === 'rumble' ? 1.15 : 1;
  const xp = Math.round(((won ? 100 : 35) + game.wins[0] * 20 + Math.min(80, game.stats.dealt / 25)) * dm * mm), coins = Math.round(xp * .8);
  PROG.played++; if (won) PROG.wins++;
  return rewardHTML(xp, coins, grantRewards(xp, coins));
}
function buyChar(id) {
  const U = UNLOCK[id]; if (!U || owns(id)) return true;
  if (PROG.coins < U.coins) { toast(`Reach level ${U.lvl} or collect ${U.coins} 🪙 to unlock`); return false; }
  PROG.coins -= U.coins; PROG.owned.push(id); saveProfile(); Sfx.play('chain'); toast('🔓 ' + ROSTER.find(c => c.id === id).name + ' unlocked!'); return true;
}

// ===================== TOWER =====================
const BOSS = { hp: 2.3, dmg: 1.3, scale: 1.38 };
const TOWER_FLOORS = 8;
function towerNew() {
  const pool = availableChars().map(c => c.id), FL = [];
  for (let i = 0; i < TOWER_FLOORS - 1; i++) FL.push(pool[(i + Math.floor(Math.random() * pool.length)) % pool.length]);
  const maps = ['temple', 'volcano', 'frozen', 'storm', 'temple', 'frozen', 'storm'];
  game.tower = { floor: 1, opp: FL, boss: pick(['rakan', 'kazan', 'master']), maps, carry: 1 };
}
function towerFloorSetup() {
  const T = game.tower, f = T.floor, boss = f === TOWER_FLOORS;
  const ch = boss ? T.boss : T.opp[f - 1];
  game.diff = boss ? 'hard' : f <= 2 ? 'easy' : f <= 5 ? 'normal' : 'hard';
  game.sel.ai = { char: ch, el: { kazan: 'fire', rakan: 'earth', sira: 'water', rayn: 'fire', master: 'fire' }[ch] || pick(ELS), boss };
  game.mapId = boss ? 'volcano' : T.maps[(f - 1) % T.maps.length];
}
function towerRewards(won) {
  const T = game.tower, f = T.floor; let xp, coins, extra = '';
  if (won) { xp = 50 + 20 * f; coins = 40 * f; if (f === TOWER_FLOORS) { coins += 500; xp += 200; extra = 'TOWER CONQUERED +500 🪙'; } }
  else { xp = 20 + 10 * f; coins = 15 * f; }
  const best = won ? f : f - 1; if (best > PROG.towerBest) { PROG.towerBest = best; extra = extra || `NEW BEST: FLOOR ${best}`; }
  return rewardHTML(xp, coins, grantRewards(xp, coins), extra);
}

function clearField() { for (const p of PROJ) killProj(p, false); PROJ.length = 0; for (const w of WALLS) scene.remove(w.mesh); WALLS.length = 0; TIMERS.length = 0; TELES.length = 0; clearLava(); }
function trainingSpots() { const s = ARENA.dummySpot; const c = new V3(-s.x, 0, -s.z).normalize(); return [new V3(s.x, .38, s.z).addScaledVector(c, 7.5).setY(0), new V3(s.x, .38, s.z)]; }
function startRound() {
  clearField(); mapRoundStart();
  const sp = FIGHTERS.map(f => f.spirit), K = WORLD_K;
  if (game.mode === 'training') { const [h, d] = trainingSpots(); hero.reset(h); enemy.reset(d); enemy.home = d.clone(); hero.yaw = Math.atan2(d.x - h.x, d.z - h.z); enemy.yaw = hero.yaw + Math.PI; CAM.dir.set(d.x - h.x, 0, d.z - h.z).normalize(); }
  else if (game.mode === 'duo') {
    const T0 = FIGHTERS.filter(f => f.team === 0), T1 = FIGHTERS.filter(f => f.team !== 0);
    T0.forEach((f, i) => { f.reset(new V3(i ? 2.8 : -2.8, 0, 11 * K)); f.yaw = Math.PI; });
    T1.forEach((f, i) => { f.reset(new V3(i ? 2.8 : -2.8, 0, -11 * K)); f.yaw = 0; });
    CAM.dir.set(0, 0, -1);
  } else if (game.mode === 'rumble') {
    const R = 10.5 * K;
    FIGHTERS.forEach((f, i) => { const a = Math.PI / 2 + i * Math.PI * 2 / 3; f.reset(new V3(Math.cos(a) * R, 0, Math.sin(a) * R)); f.yaw = Math.atan2(-f.pos.x, -f.pos.z); });
    CAM.dir.copy(hero.pos).multiplyScalar(-1).setY(0).normalize();
  }
  else { hero.reset(START_H); enemy.reset(START_E); hero.yaw = Math.PI; enemy.yaw = 0; CAM.dir.set(0, 0, -1); }
  FIGHTERS.forEach((f, i) => { f.spirit = sp[i]; f._out = false; });
  for (const f of FIGHTERS) { const nt = pickTarget(f); if (nt) f.target = nt; }
  enemy = hero.target || enemy; syncRightBar(enemy, true); game.winTeam = undefined;
  game.timer = CFG.ROUND_TIME; game.state = 'intro'; game.phaseT = 0; game.timeScale = 1; game.koVictim = null; game.gongHit = false;
  CAM.introT = game.mode === 'training' ? 0 : game.round === 1 ? 1 : .35;
  CAM.pos.copy(hero.pos).addScaledVector(CAM.dir, -5).setY(hero.pos.y + 3);
  if (game.mode === 'training') announce('TRAINING', 'HIT THE DUMMY');
  else announce(`ROUND ${game.round}`, game.round === 3 ? 'FINAL ROUND' : '');
}
function onKO(victim) {
  if (game.state !== 'fight' || game.mode === 'training') return;
  const ta = teamsAlive(), ffaHeroOut = game.mode === 'rumble' && victim === hero;
  if (FIGHTERS.length > 2 && ta.length > 1 && !ffaHeroOut) { // someone is down but the round goes on
    if (victim._out) return; victim._out = true;
    Sfx.play('ko'); shake(.7); vibrate(80); game.hitstop = Math.max(game.hitstop, .22);
    announce('DOWN!', victim === hero ? 'YOUR ALLY FIGHTS ON' : fighterLabel(victim).toUpperCase() + ' IS OUT');
    return;
  }
  game.state = 'ko'; game.phaseT = 0; game.timeScale = .3; game.koVictim = victim; Sfx.play('ko'); shake(1); vibrate(120);
  const wt = ffaHeroOut ? +(ta.find(t => t !== hero.team) ?? 1) : ta.length ? +ta[0] : (victim.team === hero.team ? 1 : 0);
  game.winTeam = wt; const won = wt === hero.team;
  announce('K.O.', won ? 'YOU WIN THE ROUND' : 'ROUND LOST'); game.wins[won ? 0 : 1]++;
}
function timeUp() {
  game.state = 'ko'; game.phaseT = 0; game.timeScale = 1;
  const hpT = {}; for (const f of FIGHTERS) hpT[f.team] = (hpT[f.team] || 0) + Math.max(0, f.hp) / f.maxHp;
  let wt = hero.team, best = hpT[hero.team] || 0; for (const k in hpT) if (hpT[k] > best) { best = hpT[k]; wt = +k; }
  game.winTeam = wt; const won = wt === hero.team;
  game.wins[won ? 0 : 1]++; game.koVictim = won ? (FIGHTERS.find(f => f.team !== hero.team && f.hp > 0) || enemy) : hero;
  announce('TIME!', won ? 'YOU WIN THE ROUND' : 'ROUND LOST');
}
function updateFlow(dt) {
  game.phaseT += dt;
  if (game.state === 'intro') {
    const tr = game.mode === 'training';
    CAM.introT = Math.max(0, CAM.introT - dt * (game.round === 1 ? .55 : 1));
    if (!tr && game.phaseT > (game.round === 1 ? 1.8 : 1.2) && !game.gongHit) { game.gongHit = true; Sfx.play('gong'); if (ARENA.gong) ARENA.gong.vel = 1.2; }
    if (game.phaseT > (tr ? .8 : game.round === 1 ? 2.4 : 1.8)) { game.state = 'fight'; if (!tr) announce('FIGHT!'); }
  } else if (game.state === 'fight') {
    updateHazards(dt);
    if (game.mode === 'training') { hero.spirit = Math.min(100, hero.spirit + 9 * dt); if (hero.hp < hero.maxHp && game.time - hero.lastHit > 2) hero.hp = hero.maxHp; }
    else { game.timer -= dt; if (game.timer <= 0) { game.timer = 0; timeUp(); } }
  }
  else if (game.state === 'ko') {
    if (game.phaseT > .55) game.timeScale = damp(game.timeScale, 1, 3, dt / Math.max(.05, game.timeScale));
    if (game.phaseT > 1.6) { const wt = game.winTeam !== undefined ? game.winTeam : (game.koVictim === enemy ? hero.team : enemy.team); for (const w of FIGHTERS) if (w.team === wt && w.hp > 0 && w.state !== 'win' && w.onGround) { w.setState('win'); w.cast = null; } }
    const RTW = game.mode === 'tower' ? 1 : CFG.ROUNDS_TO_WIN;
    if (game.phaseT > 3.6) { if (game.wins[0] >= RTW || game.wins[1] >= RTW) endMatch(); else { game.round++; startRound(); } }
  }
}
function endMatch() {
  game.state = 'end'; const won = game.wins[0] > game.wins[1];
  const t = $('#endTitle'); t.textContent = won ? 'VICTORY' : 'DEFEAT'; t.classList.toggle('lose', !won);
  const foes = FIGHTERS.filter(f => f.team !== hero.team).map(fighterLabel).join(' & ') || fighterLabel(enemy);
  const allies = FIGHTERS.filter(f => f.team === hero.team && f !== hero).map(fighterLabel).join(' & ');
  $('#endSub').innerHTML = `${fighterLabel(hero)}${allies ? ' & ' + allies : ''} <span style="opacity:.6">vs</span> ${foes} · ${game.diff.toUpperCase()}<br>${won ? 'Well fought.' : `<b>Tip:</b> ${tipFor(hero.target || enemy)}`}`;
  const s = game.stats; $('#endStats').innerHTML = `<div><b>${Math.round(s.dealt)}</b><span>DAMAGE DEALT</span></div><div><b>${Math.round(s.taken)}</b><span>DAMAGE TAKEN</span></div><div><b>${s.maxCombo}</b><span>BEST COMBO</span></div>`;
  let ag = 'REMATCH';
  if (game.mode === 'tower') {
    const T = game.tower, f = T.floor, last = f === TOWER_FLOORS;
    t.textContent = won ? (last ? 'TOWER CONQUERED' : `FLOOR ${f} CLEARED`) : 'THE TOWER STANDS';
    $('#endSub').innerHTML = won ? (last ? 'You beat the boss and every floor of the tower.' : `Next: floor ${f + 1} of ${TOWER_FLOORS}${f + 1 === TOWER_FLOORS ? ' — <b style="color:#ff7a4a">THE BOSS</b>' : ''}. Your health carries over (+35% healed).`) : `You fell on floor ${f} of ${TOWER_FLOORS}. Best: floor ${Math.max(PROG.towerBest, f - 1)}.<br><b>Tip:</b> ${tipFor(enemy)}`;
    $('#endRew').innerHTML = towerRewards(won);
    T.carry = Math.max(0, hero.hp) / hero.maxHp; T.won = won;
    ag = won && !last ? 'NEXT FLOOR ▶' : 'NEW CLIMB';
  } else $('#endRew').innerHTML = matchRewards(won);
  $('#againBtn').textContent = ag;
  $('#endScreen').classList.remove('hidden'); showHUD(false);
}
function tipFor(f) {
  if (f.charId === 'sira') return 'Sira is fast but fragile: block her Wave Slide, and when you are Wet expect the freezing Needle — dash sideways. One heavy combo of yours trades well against her.';
  if (f.charId === 'rayn') return 'Rayn wants his blade ignited: interrupt the ignition wind-up, and step out of the Sun Cleave line early. His crescents can be reflected.';
  if (f.charId === 'master') return 'The Master’s third normal shot is a fusion — block it. He switches element to get fresh skills, so the moment right after a switch is when he is most dangerous; close the gap while he recovers.';
  if (f.charId === 'rakan') return 'Rakan punishes close attacks: when he crosses his arms, WAIT — hitting him in that window gets you countered. His heavy swings are slow, so step back and answer after they miss.';
  if (f.charId === 'kazan') return 'Kazan’s skills have long wind-ups: watch for the red line or circle and step out sideways, then punish him while he recovers. Never stand in his lava.';
  return { fire: 'Inferno Blast shows a red circle first — dash out of it. Fire heals a little on skill hits, so trade with combos.', water: 'Don’t eat the 3rd combo hit: it soaks you (+10% damage taken). Jump over the Wave.', wind: 'Air Blade is fast but light — block it. Walk out of the Cyclone sideways, its pull is weak.', earth: 'Rock Shot is slow: dash sideways. Walk around the Stone Wall instead of shooting into it.', lightning: 'Break line of sight with pillars to stop Chain Lightning, and keep moving during Thunderstorm.' }[f.el] || 'Keep moving and block the big shots.';
}
function showHUD(on) {
  ['#hud'].forEach(s => $(s).classList.toggle('hidden', !on));
  $('#keyBar').classList.toggle('hidden', !on || IS_TOUCH);
  $('#touch').classList.toggle('hidden', !on || !IS_TOUCH);
  $('#trainInfo').classList.toggle('hidden', !on || game.mode !== 'training');
  [...$('#pb0 .wins').children, ...$('#pb1 .wins').children].forEach(b => b.style.visibility = game.mode === 'training' ? 'hidden' : '');
  if (!on) HUD.mark.classList.add('hidden');
}
function goFullscreen() { try { if (IS_TOUCH && !STANDALONE && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { })).catch(() => { }); } catch (e) { } }
function resolveOpponent() {
  const o = PROFILE.opp; const ch = o.char === 'random' ? pick(availableChars()).id : o.char;
  const FEL = { kazan: 'fire', rakan: 'earth', sira: 'water', rayn: 'fire', master: 'fire' };
  game.sel.ai = { char: ch, el: FEL[ch] || (o.el === 'random' ? pick(ELS) : o.el) };
}
function makeBoss(f) {
  f.boss = true; f.maxHp = Math.round(f.maxHp * BOSS.hp); f.hp = f.maxHp; f.name = 'BOSS · ' + f.name;
  f.rig.root.scale.multiplyScalar(BOSS.scale); syncRightBar(f, true);
  fb('fire_ring', { follow: () => f.hp > 0 && FIGHTERS.includes(f) ? _sv.set(f.pos.x, f.pos.y + .1, f.pos.z) : null, size: 3.6, loop: true, speed: .9, opacity: .7, tint: 0xff5030, mode: 'flat' });
}
async function beginMatch(mode, reroll = true) {
  Sfx.init(); Sfx.play('select'); goFullscreen();
  game.mode = mode; game.diff = PROFILE.diff;
  const FELP = { kazan: 'fire', rakan: 'earth', sira: 'water', rayn: 'fire', master: 'fire' };
  const selOf = (char, elPref) => { const ch = char === 'random' ? pick(availableChars()).id : char; return { char: ch, el: FELP[ch] || (!elPref || elPref === 'random' ? pick(ELS) : elPref) }; };
  if (!owns(PROFILE.char)) PROFILE.char = 'raven';
  game.sel.p = { char: PROFILE.char, el: FELP[PROFILE.char] || PROFILE.el };
  let slots = null;
  if (mode === 'tower') { if (reroll || !game.tower) towerNew(); towerFloorSetup(); }
  else game.mapId = PROFILE.map === 'random' ? pick(Object.keys(MAPS)) : (PROFILE.map || 'temple');
  if (mode === 'training') { game.sel.ai = { char: 'dummy' }; game.mapId = 'temple'; }
  else if (mode === 'tower') { }
  else if (mode === 'duo') {
    const ally = selOf((PROFILE.ally && PROFILE.ally.char) || 'random');
    const e1 = selOf(PROFILE.opp.char, PROFILE.opp.el), e2 = selOf('random');
    slots = [Object.assign({ team: 0, isPlayer: true }, game.sel.p), Object.assign({ team: 0 }, ally), Object.assign({ team: 1 }, e1), Object.assign({ team: 1 }, e2)];
    game.sel.ai = e1;
  } else if (mode === 'rumble') {
    const e1 = selOf(PROFILE.opp.char, PROFILE.opp.el), e2 = selOf('random');
    slots = [Object.assign({ team: 0, isPlayer: true }, game.sel.p), Object.assign({ team: 1 }, e1), Object.assign({ team: 2 }, e2)];
    game.sel.ai = e1;
  } else if (mode !== 'tower' && reroll) resolveOpponent();
  if (!(await ensureChars(slots ? slots.map(s => s.char) : [game.sel.p.char, game.sel.ai.char]))) return;
  $('#lobby').classList.remove('on'); $('#lobby').classList.add('hidden'); $('#endScreen').classList.add('hidden'); $('#pause').classList.add('hidden');
  game.stats = { dealt: 0, taken: 0, maxCombo: 0, comboDmg: 0 };
  if (ARENA.lobbyPad) ARENA.lobbyPad.visible = false; if (ARENA.lobbyKey) ARENA.lobbyKey.visible = false;
  setWorldScale(mode === 'duo' ? 1.35 : mode === 'rumble' ? 1.2 : 1);
  applyMap(game.mapId);
  setupFighters(slots); game.wins = [0, 0]; game.round = 1; game.winTeam = undefined;
  if (mode === 'tower') { if (game.sel.ai.boss) makeBoss(enemy); }
  showHUD(true); startRound();
  if (mode === 'tower') { const T = game.tower; if (T.floor > 1) hero.hp = Math.min(hero.maxHp, Math.max(.25, T.carry) * hero.maxHp + .35 * hero.maxHp);
    later(.4, () => announce(T.floor === TOWER_FLOORS ? 'BOSS FLOOR' : `FLOOR ${T.floor} / ${TOWER_FLOORS}`, (MAPS[game.mapId] || MAPS.temple).name.toUpperCase())); }
  else if (game.mapId !== 'temple') later(.4, () => announce((MAPS[game.mapId]).name.toUpperCase(), MAPS[game.mapId].desc.split(';')[0].split('—')[0].toUpperCase()));
}
const startMatch = () => beginMatch('versus');
function togglePause() {
  if (game.state === 'paused') { game.state = game.prevState; $('#pause').classList.add('hidden'); }
  else if (['fight', 'intro', 'ko'].includes(game.state)) {
    game.prevState = game.state; game.state = 'paused'; $('#pause').classList.remove('hidden');
    const ps = $('#pauseSet'); ps.innerHTML = settingsHTML(); bindSettings(ps, () => { ps.innerHTML = settingsHTML(); bindSettings(ps); });
    $('#pauseHelp').innerHTML = controlsHTML(); $('#restartBtn').textContent = game.mode === 'training' ? 'RESET' : 'RESTART';
  }
}

// ---------------------------------------------------------------- SETTINGS UI
function settingsHTML() {
  const seg = (label, attr, opts, cur) => `<div class="sec"><label>${label}</label><div class="row">${opts.map(([v, t]) => `<button class="gbtn ${cur === v ? 'sel' : ''}" ${attr}="${v}">${t}</button>`).join('')}</div></div>`;
  return `<div class="setL"><span>Sound</span><input type="range" min="0" max="100" value="${Math.round(SETTINGS.volume * 100)}" data-set="volume"><output>${Math.round(SETTINGS.volume * 100)}%</output></div>
  <div class="setL"><span>Sensitivity</span><input type="range" min="50" max="150" value="${Math.round(SETTINGS.sens * 100)}" data-set="sens"><output>${Math.round(SETTINGS.sens * 100)}%</output></div>
  ${seg('GRAPHICS QUALITY', 'data-q', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], SETTINGS.quality)}
  ${seg('CAMERA DISTANCE', 'data-cam', [['near', 'CLOSE'], ['mid', 'MEDIUM'], ['far', 'FAR']], SETTINGS.camDist)}
  ${IS_TOUCH ? seg('VIBRATION', 'data-vib', [['on', 'ON'], ['off', 'OFF']], SETTINGS.vibrate ? 'on' : 'off') : ''}`;
}
function bindSettings(root, rerender) {
  const re = rerender || (() => { root.innerHTML = settingsHTML(); bindSettings(root); });
  root.querySelectorAll('input[data-set]').forEach(i => i.oninput = () => { SETTINGS[i.dataset.set] = i.value / 100; i.nextElementSibling.textContent = i.value + '%'; applySettings(); saveSettings(); });
  root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { SETTINGS.quality = b.dataset.q; applySettings(true); saveSettings(); Sfx.play('select'); re(); });
  root.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => { SETTINGS.camDist = b.dataset.cam; saveSettings(); Sfx.play('select'); re(); });
  root.querySelectorAll('[data-vib]').forEach(b => b.onclick = () => { SETTINGS.vibrate = b.dataset.vib === 'on'; saveSettings(); re(); });
}
function controlsHTML() {
  if (IS_TOUCH) return `<b>Move:</b> left thumb anywhere on the left side · <b>Big element button</b> ×3 = 3 different element shots · <b>Fist</b> ×3 = close combo · <b>Skill buttons 1 & 2</b> = your two skills · <b>Sun</b> = super when the blue bar is full · <b>Dash</b> (5 s cooldown) · <b>Shield</b> hold to block — raise it just before a projectile hits to reflect it.`;
  return `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> dash (5 s) · <kbd>U</kbd> ×3 element attack (3 different shots) · <kbd>J</kbd> ×3 close combo · <kbd>I</kbd> skill 1 · <kbd>O</kbd> skill 2 · <kbd>E</kbd> super (blue bar full) · hold <kbd>K</kbd> block — raise it just before a projectile hits to <b>reflect</b> it · <kbd>Esc</kbd> pause`;
}

// ---------------------------------------------------------------- LOBBY
const LOBBY = { nav: 'home', tab: null, yaw: 0, yawV: 0, drag: null, emoteId: 0 };
const CHAR_EL = { kazan: ['fire', 'MAGMA · FIRE + EARTH'], rakan: ['earth', 'STONE & GRAVITY'], sira: ['water', 'FROST · WATER + ICE'], rayn: ['fire', 'FLAME BLADE'], master: ['fire', 'ALL SIX ELEMENTS'] };
const LOCK_SVG = '<svg viewBox="0 0 100 130"><path fill="#c9a24e" d="M50 5a30 30 0 0 0-30 30v20h-8v70h76V55h-8V35A30 30 0 0 0 50 5zm0 14a16 16 0 0 1 16 16v20H34V35a16 16 0 0 1 16-16z"/></svg>';
const SIL_SVG = '<svg viewBox="0 0 100 120"><path fill="#6c5a3a" d="M50 8a18 18 0 1 1 0 36a18 18 0 1 1 0-36zM18 118c0-36 14-58 32-58s32 22 32 58z"/></svg>';
function elIcon(e) { return ICON('ic_' + e); }
function initLobby() {
  const em = $('#emblem'); ELS.forEach((e, i) => { const a = i / 5 * Math.PI * 2 - Math.PI / 2; const i2 = document.createElement('i'); i2.style.backgroundImage = elIcon(e); i2.style.left = `calc(50% + ${Math.cos(a) * 32}% - 11px)`; i2.style.top = `calc(50% + ${Math.sin(a) * 32}% - 11px)`; em.appendChild(i2); });
  if (innerHeight < 520) em.querySelectorAll('i').forEach((i2, k) => { const a = k / 5 * Math.PI * 2 - Math.PI / 2; i2.style.left = `calc(50% + ${Math.cos(a) * 30}% - 7.5px)`; i2.style.top = `calc(50% + ${Math.sin(a) * 30}% - 7.5px)`; });
  document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { LOBBY.nav = b.dataset.nav; Sfx.init(); Sfx.play('select'); renderLobby(); });
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { LOBBY.tab = LOBBY.tab === b.dataset.tab ? null : b.dataset.tab; Sfx.init(); Sfx.play('select'); renderTab(); });
  const d = $('#lobbyDrag');
  d.addEventListener('pointerdown', e => { LOBBY.drag = { x: e.clientX, id: e.pointerId }; LOBBY.yawV = 0; d.setPointerCapture(e.pointerId); if (LOBBY.tab) { LOBBY.tab = null; renderTab(); } });
  d.addEventListener('pointermove', e => { if (!LOBBY.drag || e.pointerId !== LOBBY.drag.id) return; const dx = e.clientX - LOBBY.drag.x; LOBBY.drag.x = e.clientX; LOBBY.yaw += dx * .012; LOBBY.yawV = dx * .012 / Math.max(.008, game.rdt); });
  const up = e => { if (LOBBY.drag && e.pointerId === LOBBY.drag.id) LOBBY.drag = null; };
  d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  $('#resumeBtn').onclick = togglePause;
  $('#restartBtn').onclick = () => { $('#pause').classList.add('hidden'); if (game.mode === 'training') { game.state = 'fight'; clearField(); startRound(); } else beginMatch('versus', false); };
  $('#quitBtn').onclick = toLobby; $('#menuBtn').onclick = toLobby;
  $('#againBtn').onclick = () => { if (game.state !== 'end' || game._starting) return; game._starting = true; setTimeout(() => game._starting = false, 1500); if (game.mode === 'tower') { const T = game.tower; if (T && T.won && T.floor < TOWER_FLOORS) { T.floor++; beginMatch('tower', false); } else beginMatch('tower', true); } else beginMatch(game.mode, false); };
  $('#pauseBtn').onclick = togglePause;
  if (IS_TOUCH) buildTouch();
}
function ensureChars(ids) { // downloads any fighter that is not on the phone yet, with a visible progress bar
  const need = [...new Set(ids)].filter(id => ['raven', 'kazan', 'rakan', 'sira', 'rayn', 'master'].includes(id) && !CHAR_GLB[id]); if (!need.length) return Promise.resolve(true);
  const ov = $('#charLoad'); ov.classList.remove('hidden'); const pr = {}; const upd = () => { const v = need.reduce((a, id) => a + (pr[id] || 0), 0) / need.length; $('#charLoadBar').style.width = Math.round(v * 100) + '%'; $('#charLoadTxt').textContent = `Summoning ${need.map(n => n[0].toUpperCase() + n.slice(1)).join(' & ')}… ${Math.round(v * 100)}%`; };
  upd(); return Promise.all(need.map(id => loadCharGLB(id, p => { pr[id] = p; upd(); }))).then(r => { ov.classList.add('hidden'); if (r.includes(false)) { toast('Download failed — check your connection'); return false; } return true; });
}
function lobbyShowcase() {
  const el = ({ kazan: 'fire', rakan: 'earth', sira: 'water', rayn: 'fire', master: 'fire' })[PROFILE.char] || PROFILE.el;
  game.sel.p = { char: PROFILE.char, el }; game.sel.ai = { char: PROFILE.char, el };
  game.diff = PROFILE.diff; setupFighters(); enemy.rig.root.visible = false;
  const s = ARENA.lobbySpot; hero.reset(new V3(s.x, ARENA.lobbyTop, s.z)); hero.onGround = true;
}
function toLobby() {
  setWorldScale(1); applyMap('temple');
  game.state = 'menu'; game.mode = 'lobby'; game.timeScale = 1; game.hitstop = 0;
  ['#pause', '#endScreen'].forEach(s => $(s).classList.add('hidden')); showHUD(false); clearField();
  lobbyShowcase(); LOBBY.tab = null; renderLobby();
  const L = $('#lobby'); L.classList.remove('hidden'); requestAnimationFrame(() => L.classList.add('on'));
}
async function selectChar(id) {
  if (PROFILE.char === id) return; Sfx.play('select');
  if (!(await ensureChars([id]))) return;
  PROFILE.char = id; PROFILE.skin = skinOf(id); saveProfile(); const y = LOBBY.yaw; lobbyShowcase(); LOBBY.yaw = y;
  const c = ROSTER.find(x => x.id === id); if (c.legendary) { FX.burst(hero.pos.clone().setY(hero.pos.y + 1), 'fire', 60, 7, 1.5); fb('fire_ring', { pos: hero.pos.clone().setY(hero.pos.y + .1), size: 4.5 }); Sfx.play('explode'); shake(.2); playEmote('hurricane'); }
  renderLobby();
}
function setElement(e) {
  if (PROFILE.el === e) return; PROFILE.el = e; saveProfile(); Sfx.play('select');
  const y = hero.yaw; lobbyShowcase(); hero.yaw = y;
  FX.burst(hero.pos.clone().setY(hero.pos.y + 1), e, 36, 5, 1.2); Sfx.play(e === 'lightning' ? 'lightning' : e);
  renderLobby();
}
function renderLobby() {
  document.querySelectorAll('#nav [data-nav]').forEach(b => b.classList.toggle('sel', b.dataset.nav === LOBBY.nav));
  const ch = ROSTER.find(c => c.id === PROFILE.char);
  $('#heroName').innerHTML = ch.name.toUpperCase() + (ch.legendary ? '<span class="legend">LEGENDARY</span>' : '');
  $('#heroName').classList.toggle('long', ch.name.length > 10);
  const he = $('#heroEl'), fixed = ch.fixedEl; he.querySelector('i').style.backgroundImage = elIcon(fixed ? CHAR_EL[ch.id][0] : PROFILE.el); he.querySelector('span').textContent = fixed ? CHAR_EL[ch.id][1] : EL[PROFILE.el].name.toUpperCase() + ' ELEMENT';
  he.style.borderColor = fixed ? '#ff7a2a' : '#' + new THREE.Color(EL[PROFILE.el].color).getHexString();
  const B = $('#sideBody'), F = $('#sideFoot'), H = $('#sideHead');
  const elRow = (cur, attr, withRnd) => `<div class="els lbl">${ELS.map(e => `<button class="elb ${cur === e ? 'sel' : ''}" ${attr}="${e}" style="background-image:${elIcon(e)}" aria-label="${EL[e].name}"><small>${EL[e].name.toUpperCase()}</small></button>`).join('')}${withRnd ? `<button class="elb rnd ${cur === 'random' ? 'sel' : ''}" ${attr}="random" aria-label="Random">?<small>RANDOM</small></button>` : ''}</div>`;
  const seg = (attr, opts, cur) => `<div class="row">${opts.map(([v, t, dis]) => `<button class="gbtn ${cur === v ? 'sel' : ''} ${dis ? 'dis' : ''}" ${attr}="${v}" ${dis ? 'data-locked="1"' : ''}>${t}</button>`).join('')}</div>`;
  const playFoot = (label, sub) => { F.innerHTML = `<button class="imgbtn playBtn ${label === 'PLAY' ? 'img' : 'gold'}" id="playBtn" aria-label="${label}">${label}</button><div class="playSub">${sub}</div>`; };
  if (LOBBY.nav === 'home') {
    H.textContent = 'BATTLE SETUP';
    const oppChars = [['random', 'RANDOM'], ...ROSTER.filter(c => c.id.indexOf('soon') !== 0).map(c => [c.id, (c.available ? '' : '🔒 ') + c.short, !c.available])];
    B.innerHTML = `<div class="sec"><label>FIGHTER</label><div class="fcard"><div class="pt" style="background-image:url(${ch.img})"></div><div><b>${ch.name.toUpperCase()}</b><span>${ch.title} · Skin: ${SKINS[ch.id].find(s => s.id === skinOf(ch.id)).name}</span></div></div></div>
      ${ch.fixedEl ? `<div class="sec"><label>ELEMENT</label><div class="fcard magma"><div class="pt" style="background-image:${elIcon(CHAR_EL[ch.id][0])};border-radius:50%"></div><div><b>${CHAR_EL[ch.id][1].split(' ·')[0]}</b><span>${CHAR_EL[ch.id][1]} — this fighter’s own element, fixed.</span></div></div></div>` : `<div class="sec"><label>YOUR ELEMENT</label>${elRow(PROFILE.el, 'data-el')}</div>`}
      <div class="sec"><label>OPPONENT</label>${seg('data-oc', oppChars, PROFILE.opp.char)}</div>
      ${CHAR_EL[PROFILE.opp.char] ? '' : `<div class="sec"><label>OPPONENT ELEMENT${PROFILE.opp.char === 'random' ? ' (IF RAVEN)' : ''}</label>${elRow(PROFILE.opp.el, 'data-oe', true)}</div>`}
      <div class="sec"><label>AI DIFFICULTY</label>${seg('data-d', [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], PROFILE.diff)}</div>
      <div class="sec"><label>MODE</label>${seg('data-mode', [['versus', '1 VS 1'], ['duo', '2 VS 2'], ['rumble', 'RUMBLE'], ['tower', '🗼 TOWER'], ['training', 'TRAINING']], PROFILE.mode)}</div>
      ${PROFILE.mode === 'tower' ? `<div class="sec"><label>TOWER · BEST FLOOR ${PROG.towerBest} / ${TOWER_FLOORS}</label><p class="note">Eight fights in a row, one round each, on changing maps. The difficulty rises every floor, your health carries over between floors (+35% healed), and floor 8 is a giant <b style="color:#ff7a4a">BOSS</b> with double health. Coins on every floor — +500 for conquering it.</p></div>` : ''}
      ${PROFILE.mode !== 'tower' && PROFILE.mode !== 'training' ? `<div class="sec"><label>MAP</label>${seg('data-map', [...Object.entries(MAPS).map(([k, m]) => [k, m.icon + ' ' + m.name.split(' ')[0].toUpperCase()]), ['random', 'RANDOM']], PROFILE.map || 'temple')}<p class="note" style="margin-top:4px">${(MAPS[PROFILE.map] || { desc: 'A random map each match.' }).desc}</p></div>` : ''}
      ${PROFILE.mode === 'duo' ? `<div class="sec"><label>YOUR ALLY (AI)</label>${seg('data-ac', oppChars, (PROFILE.ally && PROFILE.ally.char) || 'random')}<p class="note" style="margin-top:4px">2 vs 2 on a larger arena — you and your ally against two AI fighters. A second random opponent joins the one picked above.</p></div>` : ''}
      ${PROFILE.mode === 'rumble' ? `<div class="sec"><label>RUMBLE</label><p class="note">Three fighters, everyone against everyone, on a larger arena. A random third fighter joins. Last one standing wins the round — if you fall, the round is lost.</p></div>` : ''}`;
    const modeTag = PROFILE.mode === 'duo' ? '2 VS 2 · ' : PROFILE.mode === 'rumble' ? 'RUMBLE · ' : '';
    B.innerHTML = progStrip() + B.innerHTML;
    const oppTxt = PROFILE.mode === 'training' ? 'TRAINING DUMMY' : modeTag + `${PROFILE.opp.char === 'random' ? 'RANDOM' : PROFILE.opp.char.toUpperCase()} · ${CHAR_EL[PROFILE.opp.char] ? CHAR_EL[PROFILE.opp.char][1].split(' ')[0] : PROFILE.opp.el === 'random' ? 'RANDOM' : EL[PROFILE.opp.el].name.toUpperCase()} · ${PROFILE.diff.toUpperCase()}`;
    playFoot('PLAY', PROFILE.mode === 'tower' ? `TOWER · 8 FLOORS · BEST ${PROG.towerBest}` : oppTxt);
  } else if (LOBBY.nav === 'chars') {
    H.textContent = 'CHARACTERS';
    B.innerHTML = progStrip() + `<div class="grid2">${ROSTER.map(c => {
      const eq = c.id === PROFILE.char, frm = eq ? 'card_green' : c.available ? 'card_gold' : 'card_gray';
      const art = c.img ? `<div class="art" style="background-image:url(${c.img})"></div>` : `<div class="sil">${SIL_SVG}</div>`;
      const own = owns(c.id), U = UNLOCK[c.id];
      const tag = eq ? '<span class="tag eq">EQUIPPED</span>' : !c.available ? '<span class="tag">🔒 COMING SOON</span>' : own ? '<span class="tag">SELECT</span>' : `<span class="tag lock">🔒 LV ${U.lvl} · ${U.coins} 🪙</span>`;
      return `<div class="ccard ${c.available ? '' : 'locked'} ${c.legendary ? 'legendary' : ''}" data-char="${c.id}">${art}${c.img ? '' : `<div class="nm">${c.name.toUpperCase()}</div>`}<div class="frm" style="background-image:${ICON(frm)}"></div>${eq ? `<div class="ico" style="background-image:${elIcon(c.fixedEl ? CHAR_EL[c.id][0] : PROFILE.el)}"></div>` : ''}${c.legendary ? '<span class="legTag">★ LEGENDARY</span>' : ''}${tag}</div>`;
    }).join('')}</div><p class="note" style="margin-top:10px"><b>${ch.name}</b> — ${ch.about}</p><p class="note" style="margin-top:4px;opacity:.75">Locked fighters 🔒 unlock when you reach their level — or buy them early with coins 🪙 earned in every match and on every Tower floor. You can still meet them as opponents.</p>`;
    F.innerHTML = '';
  } else if (LOBBY.nav === 'inv') {
    H.textContent = 'INVENTORY';
    B.innerHTML = `<div class="sec"><label>${ch.name.toUpperCase()} · SKINS</label><div class="grid2">${SKINS[ch.id].map(s => {
      const eq = s.id === skinOf(ch.id), frm = eq ? 'card_green' : s.available ? 'card_gold' : 'card_gray';
      return `<div class="ccard ${s.available ? '' : 'locked'}" data-skin="${s.id}">${s.img ? `<div class="art" style="background-image:url(${s.img});background-position:center 12%"></div>` : `<div class="sil">${SIL_SVG}</div><div class="nm">${s.name.toUpperCase()}</div>`}<div class="frm" style="background-image:${ICON(frm)}"></div>${eq ? '<span class="tag eq">EQUIPPED</span>' : s.available ? '<span class="tag">EQUIP</span>' : '<span class="tag">🔒 COMING SOON</span>'}</div>`;
    }).join('')}</div></div>`;
    F.innerHTML = '';
  } else if (LOBBY.nav === 'train') {
    H.textContent = 'TRAINING';
    B.innerHTML = `<div class="sec"><label>YOUR ELEMENT</label>${elRow(PROFILE.el, 'data-el')}</div><p class="note" style="margin-top:6px">Practise on the <b>training dummy</b> at the edge of the arena. It never fights back, refills its health after a short pause and shows your <b>combo damage</b>. Your super charges quickly here so you can try it.</p><p class="note" style="margin-top:8px">${controlsHTML()}</p>`;
    playFoot('TRAIN', `RAVEN · ${EL[PROFILE.el].name.toUpperCase()} · DUMMY`);
  } else if (LOBBY.nav === 'settings') {
    H.textContent = 'SETTINGS';
    B.innerHTML = settingsHTML() + `<div class="sec"><label>CONTROLS</label><p class="note">${controlsHTML()}</p></div>`;
    bindSettings(B, renderLobby); F.innerHTML = '';
  }
  // bindings
  B.querySelectorAll('[data-el]').forEach(b => b.onclick = () => setElement(b.dataset.el));
  B.querySelectorAll('[data-oe]').forEach(b => b.onclick = () => { PROFILE.opp.el = b.dataset.oe; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-oc]').forEach(b => b.onclick = () => { if (b.dataset.locked) { toast('Coming soon'); return; } PROFILE.opp.char = b.dataset.oc; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => { if (b.dataset.locked) { toast('Coming soon'); return; } (PROFILE.ally = PROFILE.ally || {}).char = b.dataset.ac; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { PROFILE.diff = b.dataset.d; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { PROFILE.mode = b.dataset.mode; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-map]').forEach(b => b.onclick = () => { PROFILE.map = b.dataset.map; saveProfile(); Sfx.play('select'); renderLobby(); });
  B.querySelectorAll('[data-char]').forEach(b => b.onclick = () => { const c = ROSTER.find(x => x.id === b.dataset.char); if (!c.available) { toast('Coming soon'); return; } if (!owns(c.id) && !buyChar(c.id)) return; selectChar(c.id); });
  B.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { const s = SKINS[PROFILE.char].find(x => x.id === b.dataset.skin); if (!s.available) { toast('Coming soon'); return; } (PROFILE.skins = PROFILE.skins || {})[PROFILE.char] = s.id; PROFILE.skin = s.id; saveProfile(); renderLobby(); });
  const pb = $('#playBtn'); if (pb) pb.onclick = () => beginMatch(LOBBY.nav === 'train' ? 'training' : PROFILE.mode);
  renderTab();
}
function renderTab() {
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('sel', b.dataset.tab === LOBBY.tab));
  const P = $('#tabPop'); P.classList.toggle('on', !!LOBBY.tab); if (!LOBBY.tab) return;
  if (LOBBY.tab === 'outfit') {
    P.innerHTML = `<h4>OUTFIT</h4><div class="strip">${SKINS[PROFILE.char].map(s => `<button class="gbtn ${s.id === skinOf(PROFILE.char) ? 'sel' : ''} ${s.available ? '' : 'dis'}" data-skin2="${s.id}">${s.available ? '' : '🔒 '}${s.name.toUpperCase()}</button>`).join('')}</div>`;
    P.querySelectorAll('[data-skin2]').forEach(b => b.onclick = () => { const s = SKINS[PROFILE.char].find(x => x.id === b.dataset.skin2); if (!s.available) { toast('Coming soon'); return; } PROFILE.skin = s.id; saveProfile(); renderLobby(); });
  } else if (LOBBY.tab === 'emotes') {
    const E = PROFILE.char === 'kazan' ? [['victory', 'VICTORY'], ['victory2', 'FIST PUMP'], ['hurricane', 'ROAR OF MAGMA'], ['power_up', 'EMBER BREATH'], ['kick', 'KICK']] : [['victory', 'VICTORY'], ['victory2', 'TRIUMPH'], ['power_up', 'POWER UP'], ['hurricane', 'WHIRLWIND']];
    P.innerHTML = `<h4>EMOTES</h4><div class="strip">${E.filter(e => hero.rig.glb && hero.rig.glb.actions[e[0]]).map(([c, t]) => `<button class="gbtn emo" data-emo="${c}">${t}</button>`).join('')}</div>`;
    P.querySelectorAll('[data-emo]').forEach(b => b.onclick = () => playEmote(b.dataset.emo));
  } else if (LOBBY.tab === 'details' && PROFILE.char === 'sira') {
    P.innerHTML = `<h4>SIRA · FROST KIT <span class="legend sm">LEGENDARY</span></h4><table class="kitT">
      <tr><td>Health</td><td>duelist</td><td class="n">${SR.hp} · speed +15% · combo +15%</td></tr>
      <tr><td>Water attack</td><td>tap ×3</td><td class="n">${BAL.basic.dmg.join(' · ')}</td></tr>
      <tr><td>Blade Dance</td><td>3 cuts</td><td class="n">${SR.combo.join(' · ')} · 3rd chills a Wet foe</td></tr>
      <tr><td>${SR.s1.name}</td><td>Skill 1</td><td class="n">${SR.s1.dmg} dmg dash-cut · ${SR.s1.cd}s</td></tr>
      <tr><td>${SR.s2.name}</td><td>Skill 2</td><td class="n">${SR.s2.dmg} dmg · freezes Wet · ${SR.s2.cd}s</td></tr>
      <tr><td>${SR.su.name}</td><td>Super</td><td class="n">${SR.su.cuts.join(' + ')} = 200</td></tr></table>
      <div class="perk"><b>PERK — FLOWING WATER:</b> ${SIRA_PERK_TEXT}</div>`;
  } else if (LOBBY.tab === 'details' && PROFILE.char === 'rayn') {
    P.innerHTML = `<h4>RAYN · FLAME KIT <span class="legend sm">LEGENDARY</span></h4><table class="kitT">
      <tr><td>Health</td><td>swordsman</td><td class="n">${RY.hp}</td></tr>
      <tr><td>Fire attack</td><td>tap ×3</td><td class="n">${BAL.basic.dmg.join(' · ')}</td></tr>
      <tr><td>Three Cuts</td><td>sword</td><td class="n">${RY.combo.join(' · ')} · 3rd grants an Ember</td></tr>
      <tr><td>${RY.s1.name}</td><td>Skill 1</td><td class="n">${RY.s1.dmg} (${RY.s1.ignDmg} ignited) · ${RY.s1.cd}s</td></tr>
      <tr><td>${RY.s2.name}</td><td>Skill 2</td><td class="n">burning blade ${RY.s2.dur}s (+1s/Ember) · ${RY.s2.cd}s</td></tr>
      <tr><td>${RY.su.name}</td><td>Super</td><td class="n">${RY.su.dmg} + burn ${RY.su.burn}</td></tr></table>
      <div class="perk"><b>PERK — BLADE EMBER:</b> ${RAYN_PERK_TEXT}</div>`;
  } else if (LOBBY.tab === 'details' && PROFILE.char === 'master') {
    P.innerHTML = `<h4>ELEMENTAL MASTER <span class="legend sm">LEGENDARY</span></h4><table class="kitT">
      <tr><td>Health</td><td>no energy</td><td class="n">${BAL.chars.master.hp} · damage +${Math.round((MM.dmgMul - 1) * 100)}%</td></tr>
      <tr><td>Element attack</td><td>tap ×3</td><td class="n">element · twin · <b>fusion shot</b> (current + previous)</td></tr>
      <tr><td>Elements</td><td>six</td><td class="n">🔥 💧 🪨 🌪️ ❄️ ⚡ — L / small button switches, 1-6 direct</td></tr>
      <tr><td>Skill 1</td><td>per element</td><td class="n">own cooldown for each element · ${MM.s1.cd}s</td></tr>
      <tr><td>Skill 2</td><td>per element</td><td class="n">own cooldown for each element · ${MM.s2.cd}s</td></tr>
      <tr><td>Fusion</td><td>P / ✦</td><td class="n">last two elements · 15 combos · ${MM.fuse.cd}s</td></tr>
      <tr><td>${MM.su.name}</td><td>Super</td><td class="n">${MM.su.waves.join(' + ')} = 230</td></tr></table>
      <div class="perk"><b>HOW TO PLAY:</b> use an element's skills, switch element and its skills are ready again; the switch also loads your <b>fusion</b> with the element you just left.</div>`;
  } else if (LOBBY.tab === 'details' && PROFILE.char === 'rakan') {
    P.innerHTML = `<h4>RAKAN · STONE KIT <span class="legend sm">LEGENDARY</span></h4><table class="kitT">
      <tr><td>Health</td><td>giant</td><td class="n">${RK.hp} · −${Math.round(RK.baseDR * 100)}% damage taken</td></tr>
      <tr><td>Stone attack</td><td>tap ×3</td><td class="n">${BAL.basic.dmg.join(' · ')}</td></tr>
      <tr><td>Mountain Fist</td><td>3 hits</td><td class="n">${RK.combo.join(' · ')} · 3rd pushes</td></tr>
      <tr><td>${RK.s1.name}</td><td>Skill 1</td><td class="n">${RK.s1.dmg} dmg · ${RK.s1.cd}s</td></tr>
      <tr><td>${RK.s2.name}</td><td>Skill 2</td><td class="n">counter ${RK.s2.pulse} / return ×${RK.s2.reflect} · ${RK.s2.cd}s</td></tr>
      <tr><td>${RK.su.name}</td><td>Super</td><td class="n">${RK.su.dmg} dmg + heavy push</td></tr></table>
      <div class="perk"><b>PERK — MOUNTAIN STABILITY:</b> ${RAKAN_PERK_TEXT}</div>`;
  } else if (LOBBY.tab === 'details' && PROFILE.char === 'kazan') {
    P.innerHTML = `<h4>KAZAN · MAGMA KIT <span class="legend sm">LEGENDARY</span></h4><table class="kitT">
      <tr><td>Health</td><td>heavy</td><td class="n">${KZ.hp} · speed −${Math.round((1 - KZ.speedMul) * 100)}%</td></tr>
      <tr><td>Magma attack</td><td>tap ×3</td><td class="n">${BAL.basic.dmg.join(' · ')}</td></tr>
      <tr><td>Close combo</td><td>3 hits</td><td class="n">${KZ.combo.join(' · ')}</td></tr>
      <tr><td>${KZ.s1.name}</td><td>Skill 1</td><td class="n">${KZ.s1.dmg} dmg · ${KZ.s1.cd}s</td></tr>
      <tr><td>${KZ.s2.name}</td><td>Skill 2</td><td class="n">${KZ.s2.dmg} + lava ${KZ.s2.lavaDps}/s · ${KZ.s2.cd}s</td></tr>
      <tr><td>${KZ.su.name}</td><td>Super</td><td class="n">${KZ.su.dmg} + lava ${KZ.su.lavaDps}/s</td></tr>
      <tr><td>Dash</td><td>no damage</td><td class="n">${KZ.dashCD}s cooldown</td></tr></table>
      <div class="perk"><b>PERK — MAGMA HEAT:</b> ${KAZAN_PERK_TEXT}</div>`;
  } else if (LOBBY.tab === 'details') {
    const B2 = BAL.el[PROFILE.el];
    P.innerHTML = `<h4>${EL[PROFILE.el].name.toUpperCase()} KIT</h4><table class="kitT">
      <tr><td>Element attack</td><td>tap ×3</td><td class="n">${BAL.basic.dmg.join(' · ')}</td></tr>
      <tr><td>Close combo</td><td>3 hits</td><td class="n">${BAL.combo.join(' · ')}</td></tr>
      <tr><td>${B2.s1.name}</td><td>Skill 1</td><td class="n">${B2.s1.dmg} dmg · ${B2.s1.cd}s</td></tr>
      <tr><td>${B2.s2.name}</td><td>Skill 2</td><td class="n">${B2.s2.dmg ? B2.s2.dmg + ' dmg' : B2.s2.hp + ' HP wall'} · ${B2.s2.cd}s</td></tr>
      <tr><td>${B2.su.name}</td><td>Super</td><td class="n">${B2.su.dmg} dmg</td></tr>
      <tr><td>Dash</td><td>all</td><td class="n">${BAL.dashCD}s cooldown</td></tr></table>
      <div class="perk"><b>PERK:</b> ${PERK_TEXT[PROFILE.el]}</div>`;
  }
}
function playEmote(clip) {
  const G = hero.rig.glb; if (!G || !G.actions[clip]) return;
  const M = gmeta(G); const dur = (M[clip] && M[clip].dur) || G.actions[clip].getClip().duration;
  hero.emote = { clip, id: ++LOBBY.emoteId, end: game.time + dur - .15 }; Sfx.play('select');
  if (clip === 'power_up') later(.4, () => FX.burst(hero.pos.clone().setY(hero.pos.y + 1), PROFILE.el, 40, 6, 1.3));
}
function lobbyFrame(rdt) {
  if (!LOBBY.drag) { LOBBY.yaw += LOBBY.yawV * rdt; LOBBY.yawV *= Math.exp(-4 * rdt); }
  const s = ARENA.lobbySpot, top = ARENA.lobbyTop; const c = _v1.set(0, 0, 1);
  const narrow = innerHeight < 520, aspect = innerWidth / innerHeight;
  const dist = narrow ? 3.9 : 3.8, xf = narrow ? .4 : .32; // where the fighter sits on screen (fraction of width)
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
  const off = (.5 - xf) * 2 * dist * tanH;
  const right = _v2.set(c.z, 0, -c.x);
  camera.position.set(s.x + c.x * dist + right.x * off, top + 1.2, s.z + c.z * dist + right.z * off);
  camera.lookAt(_v3.set(s.x + right.x * off, top + 1.02, s.z + right.z * off));
  if (ARENA.lobbyPad) ARENA.lobbyPad.visible = true;
  if (!ARENA.lobbyKey) { ARENA.lobbyKey = new THREE.DirectionalLight(0xffe2c0, 2.2); scene.add(ARENA.lobbyKey, ARENA.lobbyKey.target); }
  ARENA.lobbyKey.visible = true; ARENA.lobbyKey.position.set(s.x + 2.5, top + 3, s.z + 5); ARENA.lobbyKey.target.position.set(s.x, top + 1, s.z);
  if (hero) {
    hero.yaw = Math.atan2(c.x, c.z) + .35 + LOBBY.yaw; hero.pos.set(s.x, top, s.z); hero.vel.set(0, 0, 0);
    if (hero.emote && game.time > hero.emote.end) hero.emote = null;
    hero.animate(rdt, enemy);
  }
  const sun = ARENA.sun; sun.target.position.set(s.x, 0, s.z); sun.position.set(s.x - 16, 22, s.z - 24);
}

// ---------------------------------------------------------------- INSTALL AS APP (PWA)
const STANDALONE = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
let INSTALL_EVT = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); INSTALL_EVT = e; const b = $('#installBtn'); if (b) b.style.display = ''; });
addEventListener('appinstalled', () => { INSTALL_EVT = null; const b = $('#installBtn'); if (b) b.style.display = 'none'; toast('Installed — open it from your home screen'); });
function setupInstall() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  const b = $('#installBtn'); if (!b || STANDALONE) return;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS || INSTALL_EVT) b.style.display = '';
  b.onclick = async () => { if (INSTALL_EVT) { INSTALL_EVT.prompt(); try { await INSTALL_EVT.userChoice; } catch (e) { } INSTALL_EVT = null; b.style.display = 'none'; } else $('#iosHint').classList.remove('hidden'); };
}

// ---------------------------------------------------------------- MAIN LOOP
const clock = new THREE.Clock();
let menuAng = 0, DEBUG_CAM = null;
function loop() {
  requestAnimationFrame(loop);
  frame(Math.min(.05, clock.getDelta()));
  if (DEBUG_CAM) { camera.position.copy(DEBUG_CAM[0]); camera.lookAt(DEBUG_CAM[1]); }
  if (composer) composer.render(); else renderer.render(scene, camera);
}
function frame(rdt) {
  game.rdt = rdt;
  const paused = game.state === 'paused';
  let dt = paused ? 0 : rdt * game.timeScale;
  if (game.hitstop > 0) { game.hitstop -= rdt; dt *= .05; }
  game.time += dt;
  if (!paused) {
    if (['intro', 'fight', 'ko'].includes(game.state)) {
      updateWeather(dt);
      for (const f of FIGHTERS) { const nt = pickTarget(f); if (nt) f.target = nt; }
      if (hero.target && hero.target !== enemy) { enemy = hero.target; syncRightBar(enemy); }
      if (window.__heroAI) window.__heroAI.update(dt, enemy); else if (game.state === 'fight') readPlayerIntent(); else hero.intent = hero.blankIntent();
      for (const f of FIGHTERS) { if (f === hero) continue; if (f.ai && !window.__aiOff && f.hp > 0) f.ai.update(dt, f.target || hero); else f.intent = f.blankIntent(); }
      for (const f of FIGHTERS) f.update(dt, f.target || (f === hero ? enemy : hero));
      for (let i = 0; i < FIGHTERS.length; i++) for (let j = i + 1; j < FIGHTERS.length; j++) { const A = FIGHTERS[i], B = FIGHTERS[j]; if (A.hp <= 0 || B.hp <= 0) continue; const d = _v1.copy(B.pos).sub(A.pos).setY(0), l = d.length(); if (l < .8 && Math.abs(B.pos.y - A.pos.y) < 1.5) { d.normalize().multiplyScalar((.8 - l) / 2); A.pos.sub(d); B.pos.add(d); } }
      updateProjectiles(dt); updateLava(dt);
      for (let i = TIMERS.length - 1; i >= 0; i--) { TIMERS[i].t -= dt; if (TIMERS[i].t <= 0) { const f = TIMERS[i].fn; TIMERS.splice(i, 1); f(); } }
      updateFlow(game.state === 'ko' ? rdt : dt); updateCamera(rdt); hudUpdate(rdt); CAM.focusT -= dt;
    } else if (game.state === 'menu') lobbyFrame(rdt);
    else if (game.state === 'end') { for (const f of FIGHTERS) f.animate(rdt, f === hero ? enemy : hero); }
    PADD.update(dt || rdt * .05); PNORM.update(dt || rdt * .05); DEBRIS.update(dt); updateTweens(dt); updateDmg(rdt); updateDecals(dt); updateFlipbooks(dt || rdt * .2); updateBolts(dt || rdt * .2);
    if (SKY_FLASH > 0) { SKY_FLASH = Math.max(0, SKY_FLASH - rdt * 5); } renderer.toneMappingExposure = 1.05 + SKY_FLASH * .7;
    for (const b of ARENA.braziers) { FX.fire(b.pos, 2, .3, null, 1.3); if (b.light) b.light.intensity = 30 + Math.sin(game.time * 13 + b.ph) * 5 + Math.sin(game.time * 7.3 + b.ph) * 4; b.glow.material.opacity = .45 + Math.sin(game.time * 11 + b.ph) * .08; }
    if (Math.random() < .2) { const a = rand(0, 6.28), r = rand(3, 26); PADD.emit(Math.cos(a) * r, rand(0, 5), Math.sin(a) * r, rand(-.3, .3), rand(.1, .4), rand(-.3, .3), 1.4, .7, .25, .07, rand(2, 4), -.05, 0, .03, .8); }
    const tt = game.time;
    for (const bn of ARENA.banners) { const p = bn.geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = bn.base[i * 3], y = bn.base[i * 3 + 1]; const k = -y / 3.8; p.setZ(i, Math.sin(tt * 2.6 + x * 2.2 + y * 1.3 + bn.ph) * .16 * k + Math.sin(tt * 1.3 + bn.ph) * .12 * k); } p.needsUpdate = true; bn.geo.computeVertexNormals(); }
    const g = ARENA.gong; if (g) { g.vel -= g.swing * 9 * rdt; g.vel *= Math.exp(-.8 * rdt); g.swing += g.vel * rdt; g.obj.rotation.z = g.swing * .03; }
  }
  PRESSED.clear(); TOUCH.pressed.clear();
}

// ---------------------------------------------------------------- BOOT
(async function boot() {
  // everything downloads in parallel; the bar shows the combined progress
  const PR = { t: 0, r: 0, p: 0, f: 0 }, W = { t: .12, r: .4, p: .43, f: .05 };
  const bar = () => { let v = 0; for (const k in PR) v += PR[k] * W[k]; $('#loadBar').style.width = Math.max(4, Math.round(v * 92)) + '%'; $('#loadPct').textContent = Math.round(v * 100) + '%  ·  ' + (v * 7.2).toFixed(1) + " / 7.2 MB"; window.__loadTick = Date.now(); };
  bar();
  $('#loadTxt').textContent = 'Loading the arena, Raven and effects…';
    await Promise.all([
    loadTextures(p => { PR.t = p; bar(); }).then(() => { PR.t = 1; bar(); }),
    loadRavenGLB(p => { PR.r = p; bar(); }).then(() => { PR.r = 1; bar(); }),
    loadProps(p => { PR.p = p; bar(); }).then(() => { PR.p = 1; bar(); }),
    loadFlipbooks(p => { PR.f = p; bar(); }, ['fire_loop']).then(() => { PR.f = 1; bar(); }),
  ]);
  $('#loadTxt').textContent = 'Building the arena…'; await new Promise(r => setTimeout(r, 30));
  ARENA.grp = new THREE.Group(); scene.add(ARENA.grp);
  { const _add = scene.add.bind(scene); scene.add = (...o) => { ARENA.grp.add(...o); return scene; }; try { buildArena(); } finally { scene.add = _add; } }
  if (ARENA.sun) { scene.attach(ARENA.sun); if (ARENA.sun.target) scene.attach(ARENA.sun.target); }
  OBS0 = OBS.map(o => [o, { x: o.x, z: o.z, r: o.r, hw: o.hw, hd: o.hd }]);
  PADD = new PSys(IS_TOUCH ? 1600 : 2600, THREE.AdditiveBlending); PNORM = new PSys(IS_TOUCH ? 500 : 900, THREE.NormalBlending);
  DEBRIS = new Debris(70);
  setupComposer(); onResize();
  $('#loadTxt').textContent = 'Preparing fighters…'; $('#loadBar').style.width = '96%'; await new Promise(r => setTimeout(r, 30));
  initLobby(); toLobby(); window.__booted = true;
  loadFlipbooks(() => { }).then(() => { window.__fxReady = true; }).then(() => setTimeout(() => loadCharGLB('kazan').then(() => loadCharGLB('rakan')).then(() => loadCharGLB('sira')).then(() => loadCharGLB('rayn')).then(() => loadCharGLB('master')).then(() => loadSword('ice')).then(() => loadSword('fire')), 400)); // effects, then Kazan, download in the background while you are in the lobby
  if (PROFILE.char !== 'raven') { const want = PROFILE.char; PROFILE.char = 'raven'; selectChar(want); }
  setupInstall();
  $('#loading').classList.add('hidden');
  window.__game = { game, get hero() { return hero; }, get enemy() { return enemy; }, get FIGHTERS() { return FIGHTERS; }, PROG, MAPS, MAPF, applyMap, applyHit, grantRewards, owns, buyChar, hazardStrike, setWorldScale, pickTarget, startMatch, beginMatch, ensureChars, LAVA, TELES, toLobby, renderLobby, LOBBY, PROFILE, AB, BAL, AI, CAM, KEYS, PRESSED, TOUCH, PROJ, OBS, SETTINGS, renderer, step(n, keys = []) { for (let i = 0; i < n; i++) { keys.forEach(k => PRESSED.add(k)); keys = []; frame(1 / 60); } }, cam(p, l) { DEBUG_CAM = p ? [new V3(...p), new V3(...l)] : null; } };
  loop();
})();
