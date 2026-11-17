/* Tuonela Walk (c) 2026 Timo Saarinen. All rights reserved. */
const e=`
struct Volume {
 grid: vec4u, eye_time: vec4f, forward_aspect: vec4f, right_exposure: vec4f, up_scale: vec4f,
 light_reach: vec4f, jitter: vec4f, anchor_extent: vec4f, map_right_distance: vec4f, map_up_size: vec4f,
 map_light: vec4f, mist_ambient: vec4f, mist_light: vec4f,
 sun_day: vec4f, sun_sky: vec4f, moon_sky: vec4f, night_floor: vec4f,
 cloud_light: vec4f, cloud_ambient: vec4f, weather: vec4f, sun_disc: vec4f, moon_disc: vec4f,
 near_anchor_extent: vec4f, near_right_distance: vec4f, near_up_size: vec4f, near_light: vec4f,
 shafts: vec4f, arena_frame: vec4f, arena_plane: vec4f,
 prev_anchor_extent: vec4f, prev_right_distance: vec4f, prev_up_size: vec4f, prev_light: vec4f,
 prev_near_anchor_extent: vec4f, prev_near_right_distance: vec4f, prev_near_up_size: vec4f,
 prev_near_light: vec4f, fade: vec4f,
 wisps: array<vec4f, 32>,
};
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> v: Volume;
@group(0) @binding(3) var shadow: texture_2d<f32>;
@group(0) @binding(4) var near_shadow: texture_2d<f32>;
@group(0) @binding(5) var prev_shadow: texture_2d<f32>;
@group(0) @binding(6) var prev_near_shadow: texture_2d<f32>;

fn hash_value(x0: u32) -> u32 {
 var x = x0; x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; return x ^ (x >> 16u);
}
fn lattice(p: vec2i) -> f32 {
 return f32(hash_value((bitcast<u32>(p.x) * 73856093u) ^ (bitcast<u32>(p.y) * 19349663u)) >> 8u) / 16777216.;
}
fn noise(p: vec2f) -> f32 {
 let i = vec2i(floor(p)); var t = p - floor(p); t = t * t * (3. - 2. * t);
 return mix(mix(lattice(i), lattice(i + vec2i(1, 0)), t.x), mix(lattice(i + vec2i(0, 1)), lattice(i + vec2i(1, 1)), t.x), t.y);
}
fn arena_mist(p: vec3f) -> f32 {
 let dx = p.x - v.arena_frame.x; let dz = p.z - v.arena_frame.y;
 let a = dx * v.arena_frame.z + dz * v.arena_frame.w; let b = dx * v.arena_frame.w - dz * v.arena_frame.z;
 let above = max(p.y - (v.arena_plane.x + v.arena_plane.y * a + v.arena_plane.z * b), 0.);
 let drift = v.eye_time.w * .05;
 let bank = noise(vec2f(p.x * .09 + drift, p.z * .09 - drift * .6));
 let veil = noise(vec2f(p.x * .3 - drift * 1.4, p.z * .3 + p.y * .2));
 let r = sqrt(a * a / (26. * 26.) + b * b / (28. * 28.));
 let low = exp(-above / .8) * (.35 + .65 * bank) * (.6 + .4 * veil) * (1. - smoothstep(.8, 1.3, r));
 let ha = (a + 10.5) / 6.; let hb = (b - 1.5) / 5.;
 let hollow = exp(-(ha * ha + hb * hb)) * exp(-above / .6);
 let gate = smoothstep(9., 13., a) * (1. - smoothstep(26., 40., a)) * exp(-b * b / 256.) * exp(-above / 5.) * (.6 + .4 * bank);
 let air = exp(-above / 7.) * (1. - smoothstep(1., 1.8, r)) * (.7 + .3 * bank);
 return .02 * low + .06 * hollow + .016 * gate + .0035 * air;
}
/* x: density (1/m); y: the direct light's weight there */
fn density_sample(p: vec3f) -> vec2f {
 let drift = v.eye_time.w * .035;
 let river = 13. * sin(p.z * .027) + 7. * sin(p.z * .061);
 let d = abs(p.x - river);
 let ground = -1.4 + smoothstep(4., 48., d) * (3. + 8. * noise(vec2f(p.x * .018 + 4., p.z * .018)));
 let valley = 1. - smoothstep(25., 110., d);
 let above = max(p.y - ground, 0.); let depth = 1.6 + 2.4 * valley;
 let bank = noise(vec2f(p.x * .035 + drift, p.z * .035));
 let veil = noise(vec2f(p.x * .11 - drift * .7, p.z * .10 + p.y * .07));
 let layer = exp(-above / depth) * (.15 + .85 * bank * bank) * (.55 + .45 * veil);
 let woods = smoothstep(12., 40., d);
 let air = exp(-above / 12.) * (.6 + .4 * bank) * (.3 + .7 * woods);
 let background = .00002 + .00033 * exp(-above / 24.);
 var total = v.mist_ambient.w * (background + (.018 + .05 * valley) * layer) + v.shafts.x * air;
 if (v.shafts.w > 0.) { total += v.shafts.w * arena_mist(p); }
 return vec2f(total, .45 + .55 * woods);
}
fn mist_phase(cosine: f32) -> f32 {
 let g = .7; let k = 1. + g * g - 2. * g * cosine;
 return .15 + .5 * (1. - g * g) / (k * sqrt(k));
}
fn occluded(map: texture_2d<f32>, n: i32, q: vec2i, depth: f32) -> f32 {
 if (any(q < vec2i(0)) || any(q >= vec2i(n))) { return 0.; }
 let separation = depth - textureLoad(map, q, 0).x;
 return select(0., 1., separation > .2 && separation <= v.light_reach.w);
}
fn map_visibility(map: texture_2d<f32>, anchor: vec4f, right: vec4f, up: vec4f, light: vec3f, p: vec3f) -> f32 {
 let d = p - anchor.xyz; let n = i32(up.w);
 let texel = (vec2f(dot(d, right.xyz), dot(d, up.xyz)) / anchor.w * .5 + .5) * f32(n) - .5;
 let base = floor(texel); let f = texel - base; let q = vec2i(base);
 let depth = right.w - dot(d, light);
 let a = occluded(map, n, q, depth); let b = occluded(map, n, q + vec2i(1, 0), depth);
 let c = occluded(map, n, q + vec2i(0, 1), depth); let e = occluded(map, n, q + vec2i(1, 1), depth);
 return 1. - mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
fn far_visibility(p: vec3f) -> f32 {
 let now = map_visibility(shadow, v.anchor_extent, v.map_right_distance, v.map_up_size, v.map_light.xyz, p);
 if (v.fade.x <= 0.) { return now; }
 let old = map_visibility(prev_shadow, v.prev_anchor_extent, v.prev_right_distance, v.prev_up_size, v.prev_light.xyz, p);
 return now + (old - now) * v.fade.x;
}
/* One near map where it covers p, blending into the far map over its outer eighth. */
fn near_visibility(map: texture_2d<f32>, anchor: vec4f, right: vec4f, up: vec4f, light: vec4f, p: vec3f) -> f32 {
 let d = p - anchor.xyz;
 let edge = max(abs(dot(d, right.xyz)), abs(dot(d, up.xyz))) / anchor.w;
 if (edge >= 1.) { return far_visibility(p); }
 let fine = map_visibility(map, anchor, right, up, light.xyz, p);
 let w = (edge - (1. - .125)) / .125;
 if (w <= 0.) { return fine; }
 return fine + (far_visibility(p) - fine) * w;
}
fn visibility(p: vec3f) -> f32 {
 if (v.near_up_size.w <= 0.) { return far_visibility(p); }
 let now = near_visibility(near_shadow, v.near_anchor_extent, v.near_right_distance, v.near_up_size, v.near_light, p);
 if (v.fade.y <= 0.) { return now; }
 let old = near_visibility(prev_near_shadow, v.prev_near_anchor_extent, v.prev_near_right_distance, v.prev_near_up_size, v.prev_near_light, p);
 return now + (old - now) * v.fade.y;
}
fn march_jitter(q: vec2u) -> f32 {
 if (v.shafts.y < .5) { return .5; }
 var n = .06711056 * f32(q.x) + .00583715 * f32(q.y);
 n = 52.9829189 * (n - floor(n));
 n = n - floor(n) + v.shafts.z;
 return n - floor(n);
}
fn glow(direction: vec3f, distance: f32) -> vec3f {
 var result = vec3f(0);
 for (var i = 0u; i < v.grid.w; i++) {
  let w = v.wisps[2u * i];
  let delta = w.xyz - v.eye_time.xyz;
  let along = dot(delta, direction); let radius = w.w * 7.;
  if (along < .001 || along > distance + w.w) { continue; }
  let perpendicular = delta - direction * along;
  let q = dot(perpendicular, perpendicular) / (radius * radius);
  if (q > 9.) { continue; }
  let optical = along * .5 * (density_sample(v.eye_time.xyz + direction * (along * .25)).x +
                              density_sample(v.eye_time.xyz + direction * (along * .75)).x);
  result += v.wisps[2u * i + 1u].xyz * (.055 * exp(-q - optical));
 }
 return result;
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let q = id.xy;
 if (any(q >= v.grid.xy)) { return; }
 let input = textureLoad(image, vec2i(q), 0);
 let uv = (vec2f(q) + .5 + v.jitter.xy) / vec2f(v.grid.xy);
 let direction = normalize(v.forward_aspect.xyz +
  v.right_exposure.xyz * ((2. * uv.x - 1.) * v.forward_aspect.w * v.up_scale.w) +
  v.up_scale.xyz * ((1. - 2. * uv.y) * v.up_scale.w));
 /* Single scattering, front to back. Segment i spans end * [(i/n)^2, ((i+1)/n)^2]. */
 let end = abs(input.a); var transmittance = 1.;
 var scattering = glow(direction, end);
 let phase = mist_phase(dot(direction, v.light_reach.xyz)); let jitter = march_jitter(q);
 let steps = v.grid.z;
 for (var i = 0u; i < steps; i++) {
  let a = f32(i) / f32(steps); let b = f32(i + 1u) / f32(steps);
  let near = end * a * a; let far = end * b * b;
  let p = v.eye_time.xyz + direction * (near + (far - near) * jitter);
  let s = density_sample(p);
  let opacity = 1. - exp(-s.x * (far - near));
  var lit = 1.;
  if (opacity > .0001) { lit = visibility(p); }
  let radiance = v.mist_ambient.rgb + v.mist_light.rgb * (lit * phase * s.y);
  scattering += radiance * (transmittance * opacity);
  transmittance *= 1. - opacity;
  if (transmittance < .005) { break; }
 }
 textureStore(output, vec2i(q), vec4f(input.rgb * transmittance + scattering * v.right_exposure.w, 1));
}`,t={code:e,textures:4};export{t as mistPass};
