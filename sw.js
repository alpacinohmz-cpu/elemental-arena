// Elemental Arena — offline cache with automatic updates.
// Code (index.html, game.js, json, manifest) always comes fresh from the network when online;
// the saved copy is used only when offline. Images/models load instantly from the cache and
// refresh in the background, so a new upload shows up by itself on the next launch.
const VERSION = 'ea-auto-1';
const FILES = ["./", "assets/banner.jpg", "assets/column.jpg", "assets/floor.jpg", "assets/full_kazan.jpg", "assets/full_rakan.jpg", "assets/full_raven.jpg", "assets/gong.jpg", "assets/kazan.glb", "assets/kazan_meta.json", "assets/lava.jpg", "assets/p_hero.jpg", "assets/p_kazan.jpg", "assets/p_rakan.jpg", "assets/p_raven.jpg", "assets/props/archway.glb", "assets/props/banner.glb", "assets/props/boulder.glb", "assets/props/cauldron.glb", "assets/props/column.glb", "assets/props/gong.glb", "assets/props/obelisk.glb", "assets/props/pedestal.glb", "assets/props/rock.glb", "assets/rakan.glb", "assets/rakan_meta.json", "assets/raven.glb", "assets/raven_meta.json", "assets/rock_brown.jpg", "assets/rock_dark.jpg", "assets/rock_sand.jpg", "assets/sky.jpg", "assets/ui/btn_play.webp", "assets/ui/card_gold.webp", "assets/ui/card_gray.webp", "assets/ui/card_green.webp", "assets/ui/ic_earth.webp", "assets/ui/ic_fire.webp", "assets/ui/ic_lightning.webp", "assets/ui/ic_water.webp", "assets/ui/ic_wind.webp", "assets/ui/nav_char.webp", "assets/ui/nav_home.webp", "assets/ui/nav_inv.webp", "assets/ui/nav_set.webp", "assets/ui/sk_dash.webp", "assets/ui/sk_earth.webp", "assets/ui/sk_fire.webp", "assets/ui/sk_fist.webp", "assets/ui/sk_jump.webp", "assets/ui/sk_lightning.webp", "assets/ui/sk_pause.webp", "assets/ui/sk_super.webp", "assets/ui/sk_water.webp", "assets/ui/sk_wind.webp", "assets/vfx/bolt.webp", "assets/vfx/bolt_branch.webp", "assets/vfx/crater.webp", "assets/vfx/dust_puff.webp", "assets/vfx/dust_tornado.webp", "assets/vfx/dust_wave.webp", "assets/vfx/explosion.webp", "assets/vfx/fire_burst.webp", "assets/vfx/fire_loop.webp", "assets/vfx/fire_ring.webp", "assets/vfx/fire_wall.webp", "assets/vfx/fireball.webp", "assets/vfx/lightning_beam.webp", "assets/vfx/lightning_orb.webp", "assets/vfx/rock_burst.webp", "assets/vfx/rocks_float.webp", "assets/vfx/tornado.webp", "assets/vfx/water_orb.webp", "assets/vfx/water_splash.webp", "assets/vfx/water_stream.webp", "assets/vfx/water_vortex.webp", "assets/vfx/water_wave.webp", "game.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "index.html", "jsm/libs/meshopt_decoder.module.js", "jsm/loaders/GLTFLoader.js", "jsm/postprocessing/EffectComposer.js", "jsm/postprocessing/MaskPass.js", "jsm/postprocessing/OutputPass.js", "jsm/postprocessing/Pass.js", "jsm/postprocessing/RenderPass.js", "jsm/postprocessing/ShaderPass.js", "jsm/postprocessing/UnrealBloomPass.js", "jsm/shaders/CopyShader.js", "jsm/shaders/LuminosityHighPassShader.js", "jsm/shaders/OutputShader.js", "jsm/utils/BufferGeometryUtils.js", "jsm/utils/SkeletonUtils.js", "manifest.webmanifest", "three.module.min.js"];
const FRESH = /(\/|\.html|\.js|\.json|\.webmanifest)$/;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(FILES.map(f => c.add(new Request(f, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function save(req, res) {
  if (res && res.ok && (new URL(req.url).origin === location.origin || /fonts\.(googleapis|gstatic)\.com/.test(req.url))) {
    const cp = res.clone(); caches.open(VERSION).then(c => c.put(req, cp));
  }
  return res;
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' || (url.origin === location.origin && FRESH.test(url.pathname))) {
    // network first: always the newest code when online
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => save(req, res))
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./'))));
    return;
  }
  // assets: instant from cache, refreshed in the background
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => save(req, res)).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
