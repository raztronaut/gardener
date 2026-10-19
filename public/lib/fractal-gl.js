// The Gardener™ — the Trihourly Fractal, rendered LIVE on the kiosk's GPU (WebGL) and
// orbited very slowly (one revolution every REV_MS). A line-for-line port of the CPU
// raymarcher in src/fractal.mjs — same distance estimators, orbit-trap palette, AO,
// Blinn specular, rim light, fog and ACES tone curve — fed the slot's exact scene by
// GET /api/fractal (`scene`, from sceneParams). The server's PNG still stays the first
// paint and the fallback when WebGL isn't available.
//
//   const r = fractalGL(canvas, scene);   // null → no WebGL (keep the still)
//   r.start(); r.stop();                  // the caller pauses it when it can't be seen
export const REV_MS = 400 * 1000; // 6m40s — 20% faster than the original 8 min (humans, 2026-10-19)
const FPS = 30;

const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `
precision highp float;
uniform vec2 res; uniform vec3 cam; uniform float fov;
uniform int fam; uniform int maxIt; uniform float power; uniform vec4 jc; uniform float scale;
uniform vec3 pa; uniform vec3 pb; uniform vec3 pc;
float trap;
float deBulb(vec3 p){
  vec3 z = p; float dr = 1.0, rr = 0.0; trap = 1e9;
  for (int i = 0; i < 12; i++) {
    if (i >= maxIt) break;
    rr = length(z);
    if (rr > 2.0) break;
    float th = acos(clamp(z.z / rr, -1.0, 1.0)) * power, ph = atan(z.y, z.x) * power;
    float zr = pow(rr, power);
    dr = pow(rr, power - 1.0) * power * dr + 1.0;
    float st = sin(th);
    z = zr * vec3(st * cos(ph), st * sin(ph), cos(th)) + p;
    trap = min(trap, dot(z, z));
  }
  return 0.5 * log(rr) * rr / dr;
}
float deJulia(vec3 p){
  vec4 z = vec4(p, 0.0), dz = vec4(1.0, 0.0, 0.0, 0.0); float m2 = 0.0; trap = 1e9;
  for (int i = 0; i < 12; i++) {
    if (i >= maxIt) break;
    dz = 2.0 * vec4(z.x*dz.x - z.y*dz.y - z.z*dz.z - z.w*dz.w, z.x*dz.y + z.y*dz.x + z.z*dz.w - z.w*dz.z,
                    z.x*dz.z - z.y*dz.w + z.z*dz.x + z.w*dz.y, z.x*dz.w + z.y*dz.z - z.z*dz.y + z.w*dz.x);
    z = vec4(z.x*z.x - z.y*z.y - z.z*z.z - z.w*z.w, 2.0*z.x*z.y, 2.0*z.x*z.z, 2.0*z.x*z.w) + jc;
    m2 = dot(z, z);
    trap = min(trap, m2);
    if (m2 > 16.0) break;
  }
  float mz = sqrt(m2), mdz = max(length(dz), 1e-9);
  return 0.5 * mz * log(mz) / mdz;
}
float deBox(vec3 p){
  vec3 z = p; float dr = 1.0; float tr = 1e9;
  for (int i = 0; i < 12; i++) {
    if (i >= maxIt) break;
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) { z *= 4.0; dr *= 4.0; } else if (r2 < 1.0) { z /= r2; dr /= r2; }
    z = z * scale + p; dr = dr * abs(scale) + 1.0;
    tr = min(tr, dot(z, z));
  }
  trap = sqrt(tr) * 0.25;
  return length(z) / abs(dr);
}
float deMenger(vec3 p){
  vec3 a0 = abs(p);
  float d = max(max(a0.x - 1.0, a0.y - 1.0), a0.z - 1.0), s = 1.0, tr = 1e9;
  for (int i = 0; i < 5; i++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y), db = max(r.y, r.z), dc = max(r.z, r.x);
    float c = (min(min(da, db), dc) - 1.0) / s;
    if (c > d) { d = c; tr = min(tr, float(i) / 5.0); }
  }
  trap = tr + 0.2 * length(p);
  return d;
}
float de(vec3 p){
  if (fam == 0) return deBulb(p);
  if (fam == 1) return deJulia(p);
  if (fam == 2) return deBox(p);
  return deMenger(p);
}
vec3 aces(vec3 c){ vec3 v = max(vec3(0.0), (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)); return pow(min(vec3(1.0), v), vec3(1.0 / 2.2)); }
void main(){
  vec3 f = normalize(-cam);
  vec3 r = normalize(vec3(f.z, 0.0, -f.x));
  vec3 u = cross(r, f);
  vec3 l = normalize(-r * 0.6 + u * 0.8 - f * 0.4);
  vec2 q = gl_FragCoord.xy / res;
  vec3 dir = normalize(f + r * ((q.x * 2.0 - 1.0) * (res.x / res.y) * fov) + u * ((q.y * 2.0 - 1.0) * fov));
  float MAXD = length(cam) + 4.0, pix = fov * 2.0 / res.y;
  float t = 0.0, dd = 0.0; bool hit = false; vec3 x = cam;
  for (int s = 0; s < 150; s++) {
    x = cam + dir * t;
    dd = de(x);
    if (dd < max(0.0004, t * pix * 0.6)) { hit = true; break; }
    t += dd * 0.9;
    if (t > MAXD) break;
  }
  if (!hit) { gl_FragColor = vec4(0.0); return; }
  float tp = trap;
  float e = max(0.0005, t * pix * 0.6);
  vec3 n = normalize(vec3(de(x + vec3(e, 0, 0)) - de(x - vec3(e, 0, 0)), de(x + vec3(0, e, 0)) - de(x - vec3(0, e, 0)), de(x + vec3(0, 0, e)) - de(x - vec3(0, 0, e))));
  float ao = 0.0, sc = 1.0;
  for (int k = 1; k <= 5; k++) { float hh = 0.02 * float(k) * (1.0 + t * 0.15); ao += (hh - de(x + n * hh)) * sc; sc *= 0.6; }
  ao = clamp(1.0 - ao * 3.2, 0.0, 1.0);
  float diff = max(0.0, dot(n, l));
  vec3 hv = normalize(l - dir);
  float spec = pow(max(0.0, dot(n, hv)), 28.0);
  float rim = pow(1.0 - max(0.0, -dot(n, dir)), 3.0);
  float k = clamp(sqrt(max(0.0, tp)) * 0.9, 0.0, 1.0);
  vec3 base = mix(mix(pa, pb, min(1.0, k * 2.0)), pc, max(0.0, k * 2.0 - 1.0));
  float fill = max(0.0, -dot(n, l)) * 0.25 + max(0.0, -n.y) * 0.12;
  float amb = 0.06 + 0.06 * (n.y * 0.5 + 0.5);
  float L = (amb + diff * 1.25) * ao * ao;
  vec3 col = base * L + pc * fill * ao + vec3(spec * 0.8 * ao) + rim * pc * 0.45 * ao;
  float fog = clamp((t - (MAXD - 4.0) * 0.55) / (MAXD * 0.6), 0.0, 1.0);
  float alpha = 1.0 - fog * 0.6;
  gl_FragColor = vec4(aces(col * 1.4) * alpha, alpha); // premultiplied
}`;

const FAM = { bulb: 0, julia: 1, box: 2, menger: 3 };

export function fractalGL(canvas, scene) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl || !scene) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('fractal-gl:', e.message); return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1i(U('fam'), FAM[scene.fam] ?? 0); gl.uniform1i(U('maxIt'), scene.maxIt | 0);
  gl.uniform1f(U('power'), scene.power || 8); gl.uniform1f(U('scale'), scene.scale || 2);
  gl.uniform4fv(U('jc'), scene.c || [0, 0, 0, 0]); gl.uniform1f(U('fov'), scene.fov);
  gl.uniform3fv(U('pa'), scene.pal.a); gl.uniform3fv(U('pb'), scene.pal.b); gl.uniform3fv(U('pc'), scene.pal.c);
  const uCam = U('cam'), uRes = U('res');

  let raf = 0, last = 0, frames = 0;
  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    if (now - last < 1000 / FPS - 2) return; // ~30 fps cap: the motion is slow, the GPU stays cool
    last = now;
    const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.uniform2f(uRes, w, h);
    const yaw = scene.yaw + ((Date.now() % REV_MS) / REV_MS) * Math.PI * 2; // the clock drives the orbit
    const cp = Math.cos(scene.pitch);
    gl.uniform3f(uCam, scene.dist * cp * Math.cos(yaw), scene.dist * Math.sin(scene.pitch), scene.dist * cp * Math.sin(yaw));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (++frames === 1) canvas.dispatchEvent(new Event('fractal-frame')); // first frame → caller fades it in
    canvas.dataset.frames = frames; // read by perf checks
  };
  return {
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(draw); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    get running() { return !!raf; },
  };
}
