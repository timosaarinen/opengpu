/* Tuonela Walk (c) 2026 Timo Saarinen. All rights reserved. */
const b=`
fn karis(c: vec3f) -> vec3f { return c / (1. + max(max(c.r, c.g), c.b)); }
fn unkaris(c: vec3f) -> vec3f { return c / max(1. - max(max(c.r, c.g), c.b), 1e-4); }
fn ycocg(c: vec3f) -> vec3f { return vec3f(.25*c.r + .5*c.g + .25*c.b, .5*c.r - .5*c.b, -.25*c.r + .5*c.g - .25*c.b); }
fn rgb(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }`,z=`struct Frame { inSize: vec2f, outSize: vec2f, jitter: vec2f, prevJitter: vec2f,
 prevInSize: vec2f, reset: f32, mode: f32, sharpness: f32, nMax: f32, prior: f32, dump: f32,
 kernel: f32, kernelN: f32 };`,S=(P,i)=>{const t=[Math.sin(P)*Math.cos(i),Math.sin(i),Math.cos(P)*Math.cos(i)],e=Math.hypot(t[2],t[0])||1,r=[-t[2]/e,0,t[0]/e],s=[r[1]*t[2]-r[2]*t[1],r[2]*t[0]-r[0]*t[2],r[0]*t[1]-r[1]*t[0]];return[t,r,s]},k=`
struct Surround { fS: vec4f, rS: vec4f, uS: vec4f, lens: vec4f, w: vec4f };
const CAP = 2.;
fn texel(face: u32, s: f32, t: f32) -> vec3f {
 let a = 2. * s - 1.; let b = 2. * t - 1.;
 switch face {
  case 0u: { return normalize(vec3f(1., -b, -a)); }
  case 1u: { return normalize(vec3f(-1., -b, a)); }
  case 2u: { return normalize(vec3f(a, 1., b)); }
  case 3u: { return normalize(vec3f(a, -1., -b)); }
  case 4u: { return normalize(vec3f(a, -b, 1.)); }
  default: { return normalize(vec3f(-a, -b, -1.)); }
 }
}
fn load(i: u32) -> vec4f { let v = data[i]; return vec4f(unpack2x16float(v.x), unpack2x16float(v.y)); }
/* The weight is capped: later observations keep replacing earlier ones. */
fn keep(i: u32, t: vec4f) {
 let c = select(t, t * (CAP / t.w), t.w > CAP);
 data[i] = vec2u(pack2x16float(c.xy), pack2x16float(c.zw));
}`,R=12,T={f:"float",u:"unfilterable-float"};class U{static async create(i,{onError:t=()=>{},modelBase:e=new URL("./models/",import.meta.url),dump:r=!1,reconstruction:s="learned",scenePass:a,surround:h=64}={}){if(!navigator.gpu)throw Error("WebGPU is required. Use a browser with WebGPU enabled.");const o=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!o)throw Error("No WebGPU adapter is available.");const d=o.features.has("timestamp-query"),l=await o.requestDevice({requiredFeatures:d?["timestamp-query"]:[]}),u=new U(i,l,t);l.addEventListener("uncapturederror",p=>u.fail(p.error.message)),l.lost.then(p=>{u.destroyed||u.fail(`WebGPU device lost: ${p.message}`)});try{await u.initialize(e,r,a,h)}catch(p){throw u.destroy(),p}return u.reconstruction=s,u.adapterInfo={vendor:o.info.vendor,architecture:o.info.architecture,device:o.info.device,description:o.info.description},u}constructor(i,t,e){if(this.canvas=i,this.device=t,this.onError=e,this.context=i.getContext("webgpu"),!this.context)throw Error("A WebGPU canvas could not be created.");this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:t,format:this.format,alphaMode:"opaque"}),this.stats={backend:"webgpu",reconstruction:"learned",sources:0,presents:0,reprojected:0,resets:0,uploadCpuMs:0,encodeCpuMs:0,refreshHz:60,queueFull:0},t.features.has("timestamp-query")&&(this.queries=t.createQuerySet({type:"timestamp",count:2}),this.queryResult=t.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.queryRead=t.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),this.pending=0,this.presentPending=0,this.slot=-1,this.running=!1,this.linear=t.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.sharpness=.25,this.nMax=16,this.prior=.15,this.vignette=.12,this.kernel=1,this.kernelN=8}fail(i){this.failed||this.destroyed||(this.failed=!0,this.pause(),this.onError(i))}layout(i){return this.device.createBindGroupLayout({entries:[...i].map((t,e)=>{const r=this.visibility;return t==="f"||t==="u"?{binding:e,visibility:r,texture:{sampleType:T[t]}}:t==="c"?{binding:e,visibility:r,texture:{sampleType:"float",viewDimension:"cube"}}:t==="s"?{binding:e,visibility:r,sampler:{type:"filtering"}}:t==="w"?{binding:e,visibility:r,storageTexture:{access:"write-only",format:"rgba16float"}}:t==="b"?{binding:e,visibility:r,buffer:{type:"uniform"}}:{binding:e,visibility:r,buffer:{type:t==="r"?"read-only-storage":"storage"}}})})}async pipeline(i,t,e){this.visibility=GPUShaderStage.COMPUTE;const r=this.device.createShaderModule({code:i,label:t}),a=(await r.getCompilationInfo()).messages.filter(d=>d.type==="error");if(a.length)throw Error(`${t}: ${a.map(d=>`${d.lineNum}: ${d.message}`).join("; ")}`);const h=this.layout(e);return{pipeline:await this.device.createComputePipelineAsync({label:t,layout:this.device.createPipelineLayout({bindGroupLayouts:[h]}),compute:{module:r,entryPoint:"main"}}),layout:h}}async initialize(i,t,e,r){e&&(this.scene=await this.pipeline(e.code,"scene pass","fwb"+"u".repeat(e.textures)),this.sceneTextures=Array.from({length:e.textures},()=>this.texture("r32float",1,1)));const s=await(await fetch(new URL("reconstruction.json",i))).json(),a=new Float32Array(s.weights);if([...new Uint8Array(await crypto.subtle.digest("SHA-256",a.buffer))].map(n=>n.toString(16).padStart(2,"0")).join("")!==s.sha256||s.features!==12||s.outputs!==3)throw Error("Reconstruction weights failed integrity validation.");this.model={name:s.name,revision:s.revision,sha256:s.sha256,hidden:s.hidden,parameters:a.length},this.weights=this.device.createBuffer({size:Math.max(16,a.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.weights,0,a),this.params=this.device.createBuffer({size:72,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayParams=this.device.createBuffer({size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.dumpEnabled=t,this.prep=await this.pipeline(`${z}
@group(0) @binding(0) var depth: texture_2d<f32>;
@group(0) @binding(1) var motion: texture_2d<f32>;
@group(0) @binding(2) var expected: texture_2d<f32>;
@group(0) @binding(3) var oldDepth: texture_2d<f32>;
@group(0) @binding(4) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> p: Frame;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let size = vec2i(p.inSize); let i = vec2i(id.xy);
 if (any(i >= size)) { return; }
 /* Motion of the nearest surface in 3x3 keeps foreground edges from ghosting. */
 var best = textureLoad(depth, i, 0).x; var at = i;
 for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
  let q = clamp(i + vec2i(x, y), vec2i(0), size - 1); let d = textureLoad(depth, q, 0).x;
  if (d > 0. && (best <= 0. || d < best)) { best = d; at = q; }
 }}
 let mv = textureLoad(motion, at, 0).xy;
 let z = textureLoad(depth, i, 0).x; let pz = textureLoad(expected, i, 0).x;
 let back = (vec2f(i) + .5 + p.jitter) / p.inSize + textureLoad(motion, i, 0).xy;
 var dis = 0.;
 if (p.reset > 0. || any(back < vec2f(0)) || any(back > vec2f(1))) { dis = 1.; }
 else if (z > 0.) {
  if (pz <= 0.) { dis = 1.; } else {
   /* Previous texels around where this surface was; the closest depth match wins. */
   let old = vec2i(textureDimensions(oldDepth));
   let b = vec2i(floor(back * p.prevInSize - .5 - p.prevJitter));
   var e = 1e9;
   for (var y = 0; y <= 1; y++) { for (var x = 0; x <= 1; x++) {
    let od = textureLoad(oldDepth, clamp(b + vec2i(x, y), vec2i(0), old - 1), 0).x;
    e = min(e, select(1e3, abs(od - pz) / (pz * .02 + .05), od > 0.));
   }}
   dis = clamp(e - 1., 0., 1.);
  }
 } else {
  /* Uncovered sky must reject finite history, while stable sky keeps it. */
  let old = vec2i(textureDimensions(oldDepth));
  let b = vec2i(floor(back * p.prevInSize - .5 - p.prevJitter));
  var sky = false;
  for (var y = 0; y <= 1; y++) { for (var x = 0; x <= 1; x++) {
   sky = sky || textureLoad(oldDepth, clamp(b + vec2i(x, y), vec2i(0), old - 1), 0).x <= 0.;
  }}
  dis = select(1., 0., sky);
 }
 /* Canonical depth: finite metres, zero for sky, including distant scenery. */
 textureStore(output, i, vec4f(mv, dis, best));
}`,"reconstruction prep","uuuuwb");const o=s.hidden,d=[12,...o,3];let l=0;const u=[];for(let n=1;n<d.length;n++){const c=d[n-1],m=d[n];u.push({inputs:c,outputs:m,w:l,b:l+c*m,relu:n<d.length-1}),l+=c*m+m}if(l!==a.length)throw Error("Reconstruction model shape mismatch.");const p=u.map((n,c)=>`
 var a${c+1}: array<f32, ${n.outputs}>;
 for (var j = 0u; j < ${n.outputs}u; j++) {
  var s = W[${n.b}u + j];
  for (var i = 0u; i < ${n.inputs}u; i++) { s += W[${n.w}u + j * ${n.inputs}u + i] * a${c}[i]; }
  a${c+1}[j] = ${n.relu?"max(s, 0.)":"s"};
 }`).join("");this.accumulate=await this.pipeline(`${z}${b}
@group(0) @binding(0) var colour: texture_2d<f32>;
@group(0) @binding(1) var prep: texture_2d<f32>;
@group(0) @binding(2) var reactive: texture_2d<f32>;
@group(0) @binding(3) var history: texture_2d<f32>;
@group(0) @binding(4) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var bilinear: sampler;
@group(0) @binding(6) var<uniform> p: Frame;
@group(0) @binding(7) var<storage, read> W: array<f32>;
@group(0) @binding(8) var<storage, read_write> records: array<f32>;
fn sigmoid(x: f32) -> f32 { return 1. / (1. + exp(-x)); }
/* Five bilinear taps of a Catmull-Rom filter: history keeps its sharpness. */
fn catmullRom(uv: vec2f) -> vec4f {
 let size = vec2f(textureDimensions(history)); let pos = uv * size;
 let c = floor(pos - .5) + .5; let f = pos - c;
 let w0 = f * (-.5 + f * (1. - .5 * f)); let w1 = 1. + f * f * (-2.5 + 1.5 * f);
 let w2 = f * (.5 + f * (2. - 1.5 * f)); let w3 = f * f * (-.5 + .5 * f);
 let w12 = w1 + w2; let t0 = (c - 1.) / size; let t3 = (c + 2.) / size; let t12 = (c + w2 / w12) / size;
 let a = w12.x * w0.y; let b = w0.x * w12.y; let m = w12.x * w12.y; let d = w3.x * w12.y; let e = w12.x * w3.y;
 let sum = textureSampleLevel(history, bilinear, vec2f(t12.x, t0.y), 0.) * a
  + textureSampleLevel(history, bilinear, vec2f(t0.x, t12.y), 0.) * b
  + textureSampleLevel(history, bilinear, t12, 0.) * m
  + textureSampleLevel(history, bilinear, vec2f(t3.x, t12.y), 0.) * d
  + textureSampleLevel(history, bilinear, vec2f(t12.x, t3.y), 0.) * e;
 return sum / (a + b + m + d + e);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let o = vec2i(id.xy); if (any(o >= vec2i(p.outSize))) { return; }
 let insize = vec2i(p.inSize); let uv = (vec2f(o) + .5) / p.outSize;
 let scale = p.outSize.y / p.inSize.y;
 /* Sample s sits at (s + .5 + jitter) / inSize. */
 let ip = uv * p.inSize - .5 - p.jitter; let base = vec2i(round(ip));
 var soft = vec3f(0); var sw = 0.;
 var m1 = vec3f(0); var m2 = vec3f(0); var dnear = 1e3; var dfar = 0.;
 var cs: array<vec3f, 9>; var rs: array<f32, 9>;
 for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
  let q = clamp(base + vec2i(x, y), vec2i(0), insize - 1);
  let c = ycocg(karis(max(textureLoad(colour, q, 0).rgb, vec3f(0))));
  let d = vec2f(q) - ip; let r2 = dot(d, d);
  let k = (y + 1) * 3 + x + 1; cs[k] = c; rs[k] = r2;
  let ws = exp(-2.2 * r2); soft += c * ws; sw += ws;
  m1 += c; m2 += c * c;
  /* Preserve the learned feature's training range independently of true depth.
     Its old virtual sky distance was 1000 m. Far surfaces share that feature
     proxy; disocclusion and late latching still use their actual finite depth. */
  let depth = textureLoad(prep, q, 0).w;
  let z = select(1000., min(depth, 1000.), depth > 0.);
  dnear = min(dnear, z); dfar = max(dfar, z);
 }}
 soft /= sw;
 let mean = m1 / 9.; let sigma = sqrt(max(m2 / 9. - mean * mean, vec3f(0)));
 let pr = textureLoad(prep, clamp(base, vec2i(0), insize - 1), 0);
 let back = uv + pr.xy;
 var h = vec3f(0); var n = 0.;
 /* Geometric rejection is an invariant, not a learned preference. Clear both
    colour and count before features: invalid colour must not influence the
    network's current-sample weight either. */
 if (p.reset == 0. && pr.z < 1. && all(back > vec2f(0)) && all(back < vec2f(1))) {
  let s = catmullRom(back); h = ycocg(max(s.rgb, vec3f(0)));
  n = textureSampleLevel(history, bilinear, back, 0.).a;
 }
 /* Current-sample kernel width, as reconstruction pixels per trace pixel. The
    sub-pixel kernel (ks = scale) adds jittered detail to established history,
    but at large ratios it leaves pixels between trace samples with almost no
    current weight: a lattice at trace pitch wherever history is short (moving
    camera, disocclusion). Short history therefore widens it to p.kernel trace
    pixels, narrowing as p.kernelN samples accumulate. */
 let ks = mix(min(scale, p.kernel), scale, smoothstep(0., p.kernelN, n));
 var splat = vec3f(0); var w = 0.;
 for (var k = 0; k < 9; k++) { let wo = exp(-2. * rs[k] * ks * ks); splat += cs[k] * wo; w += wo; }
 let current = splat / max(w, 1e-8);
 let react = select(0., 1., textureLoad(reactive, clamp(base, vec2i(0), insize - 1), 0).x > 0.);
 let moved = length(pr.xy * p.outSize);
 let deviation = (h - mean) / (sigma + .004);
 var a0: array<f32, 12>;
 a0[0] = pr.z; a0[1] = react; a0[2] = log2(1. + n) / 5.; a0[3] = min(w, 2.) * .5;
 a0[4] = log2(1. + moved) / 4.; a0[5] = min(length(deviation), 16.) / 4.;
 a0[6] = min(sigma.x / (mean.x + .02), 2.) * .5; a0[7] = current.x; a0[8] = h.x;
 a0[9] = min(log2(dfar / max(dnear, .01)), 6.) / 3.; a0[10] = scale / 6.;
 a0[11] = min(abs(h.x - soft.x) / (sigma.x + .004), 16.) / 4.;
 var trust = (1. - pr.z) * select(1., .35, react > 0.);
 var gamma = select(1.25, 2., moved < .05); var weight = 1.;
 if (p.mode == 1.) {${p}
  trust = sigmoid(a${u.length}[0]); gamma = .5 + 3.5 * sigmoid(a${u.length}[1]);
  weight = exp2(clamp(a${u.length}[2], -4., 4.));
 }
 if (p.mode == 2.) { n = 0.; weight = 0.; } /* spatial reference: no history or splat */
 /* Clip history toward the mean of the current neighbourhood (YCoCg box). */
 let v = h - mean; let extent = gamma * sigma + .002;
 let ratio = max(max(abs(v.x) / extent.x, abs(v.y) / extent.y), abs(v.z) / extent.z);
 let clipped = select(h, mean + v / ratio, ratio > 1.);
 let nh = trust * n; let wc = weight * w;
 let prior = select(p.prior, 1., p.mode == 2.);
 let result = (clipped * nh + current * wc + soft * prior) / (nh + wc + prior);
 textureStore(output, o, vec4f(rgb(result), min(nh + wc, p.nMax)));
 if (p.dump > 0.) {
  let r = u32(o.y * i32(p.outSize.x) + o.x) * 32u;
  for (var k = 0u; k < 12u; k++) { records[r + k] = a0[k]; }
  var tail = array<f32, 20>(h.x, h.y, h.z, mean.x, mean.y, mean.z, sigma.x, sigma.y, sigma.z,
   current.x, current.y, current.z, soft.x, soft.y, soft.z, n, w, trust, gamma, weight);
  for (var k = 0u; k < 20u; k++) { records[r + 12u + k] = tail[k]; }
 }
}`,"temporal accumulation","fuffwsbrx"),this.resolve=await this.pipeline(`${z}${b}
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p: Frame;
fn at(q: vec2i) -> vec3f { return textureLoad(image, clamp(q, vec2i(0), vec2i(p.outSize) - 1), 0).rgb; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let o = vec2i(id.xy); if (any(o >= vec2i(p.outSize))) { return; }
 let c = at(o); let n = at(o + vec2i(0, -1)); let s = at(o + vec2i(0, 1));
 let e = at(o + vec2i(1, 0)); let w = at(o + vec2i(-1, 0));
 let lo = min(c, min(min(n, s), min(e, w))); let hi = max(c, max(max(n, s), max(e, w)));
 /* Contrast-adaptive: less sharpening where the cross already spans the range. */
 let amp = sqrt(clamp(min(lo, 1. - hi) / max(hi, vec3f(1e-4)), vec3f(0), vec3f(1)));
 let k = -amp * p.sharpness * .2;
 let sharp = (c + k * (n + s + e + w)) / (1. + 4. * k);
 textureStore(output, o, vec4f(clamp(sharp, lo, hi), 1));
}`,"reconstruction sharpen","fwb"),await this.createSurround(r),this.visibility=GPUShaderStage.FRAGMENT,this.presentLayout=this.layout("fusbc");const g=`${b}
struct Display { eyeS: vec4f, fS: vec4f, rS: vec4f, uS: vec4f, eyeD: vec4f, fD: vec4f, rD: vec4f, uD: vec4f,
 lens: vec4f, size: vec4f, jitter: vec4f };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var prep: texture_2d<f32>;
@group(0) @binding(2) var bilinear: sampler;
@group(0) @binding(3) var<uniform> p: Display;
@group(0) @binding(4) var surround: texture_cube<f32>;
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
 let q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(q[i], 0, 1);
}
fn tone(v: vec3f) -> vec3f {
 let x = max(v, vec3f(0)); let a = clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), vec3f(0), vec3f(1));
 return select(12.92 * a, 1.055 * pow(a, vec3f(1. / 2.4)) - .055, a > vec3f(.0031308));
}
/* Catmull-Rom (five bilinear taps): reprojection must not soften every present. */
fn sharpSample(uv: vec2f) -> vec3f {
 let size = vec2f(textureDimensions(image)); let pos = uv * size;
 let c = floor(pos - .5) + .5; let f = pos - c;
 let w0 = f * (-.5 + f * (1. - .5 * f)); let w1 = 1. + f * f * (-2.5 + 1.5 * f);
 let w2 = f * (.5 + f * (2. - 1.5 * f)); let w3 = f * f * (-.5 + .5 * f);
 let w12 = w1 + w2; let t0 = (c - 1.) / size; let t3 = (c + 2.) / size; let t12 = (c + w2 / w12) / size;
 let a = w12.x * w0.y; let b = w0.x * w12.y; let m = w12.x * w12.y; let d = w3.x * w12.y; let e = w12.x * w3.y;
 let sum = textureSampleLevel(image, bilinear, vec2f(t12.x, t0.y), 0.).rgb * a
  + textureSampleLevel(image, bilinear, vec2f(t0.x, t12.y), 0.).rgb * b
  + textureSampleLevel(image, bilinear, t12, 0.).rgb * m
  + textureSampleLevel(image, bilinear, vec2f(t3.x, t12.y), 0.).rgb * d
  + textureSampleLevel(image, bilinear, vec2f(t12.x, t3.y), 0.).rgb * e;
 return clamp(sum / (a + b + m + d + e), vec3f(0), vec3f(.999));
}
/* World direction/point -> source UV (+y down); same camera model as the trace. */
fn project(q: vec3f) -> vec2f {
 let z = max(dot(q, p.fS.xyz), 1e-4); let t = p.lens.x;
 return vec2f((dot(q, p.rS.xyz) / (z * t * p.lens.y) + 1.) * .5, (1. - dot(q, p.uS.xyz) / (z * t)) * .5);
}
@fragment fn fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
 let s = pos.xy / p.size.xy; let x = 2. * s.x - 1.; let y = 1. - 2. * s.y;
 let d = normalize(p.fD.xyz + p.rD.xyz * x * p.lens.z * p.lens.x + p.uD.xyz * y * p.lens.x);
 var uv = project(d);
 let delta = p.eyeD.xyz - p.eyeS.xyz;
 if (dot(delta, delta) > 1e-8) {
  /* Walk along the display ray to the traced surface: a few fixed-point steps. */
  for (var k = 0; k < 3; k++) {
   let z = textureLoad(prep, clamp(vec2i(floor(uv * p.size.zw - p.jitter.xy)), vec2i(0), vec2i(p.size.zw) - 1), 0).w;
   if (z <= 0.) { break; }
   let ray = normalize(p.fS.xyz + p.rS.xyz * (2. * uv.x - 1.) * p.lens.y * p.lens.x + p.uS.xyz * (1. - 2. * uv.y) * p.lens.x);
   let surface = p.eyeS.xyz + ray * (z / dot(ray, p.fS.xyz));
   let t = max(dot(surface - p.eyeD.xyz, d), .05);
   uv = project(p.eyeD.xyz + d * t - p.eyeS.xyz);
  }
 }
 /* Past the traced image (over 2% of its height, never behind its camera), the
    surround's normalised colour where it has any weight, else black; never the
    stretched edge texel. */
 let past = max(max(-uv, uv - 1.), vec2f(0)) * vec2f(p.size.z / p.size.w, 1.);
 let known = (1. - smoothstep(0., .02, max(past.x, past.y))) * select(0., 1., dot(d, p.fS.xyz) > 0.);
 let cube = textureSampleLevel(surround, bilinear, d, 0.);
 let around = cube.rgb / max(cube.a, 1e-3) * smoothstep(0., .05, cube.a);
 let c = mix(around, unkaris(sharpSample(clamp(uv, vec2f(0), vec2f(1)))), known);
 return vec4f(tone(c * (1. - p.lens.w * (x * x + y * y))), 1);
}`,v=this.device.createShaderModule({code:g,label:"late-latched presentation"});this.present=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.presentLayout]}),vertex:{module:v,entryPoint:"vertex"},fragment:{module:v,entryPoint:"fragment",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}async createSurround(i){if(i!==0&&!(Number.isInteger(i)&&i>=32&&i<=256&&i%32===0))throw Error("surround must be 0 or a multiple of 32 in [32, 256]");const t=this.surroundSize=i,e=t||32;this.surroundCube=this.device.createTexture({size:[e,e,6],format:"rgba16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.surroundView=this.surroundCube.createView({dimension:"cube"}),this.stats.surroundSize=t,this.stats.surroundSamples=0,this.stats.surroundRejected=0,t&&(this.surroundData=this.device.createBuffer({size:6*t*t*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.surroundParams=this.device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.surroundSamples=this.device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.surroundViewPass=await this.pipeline(`${b}
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var bilinear: sampler;
@group(0) @binding(2) var<uniform> q: Surround;
@group(0) @binding(3) var<storage, read_write> data: array<vec2u>;
${k}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let n = u32(q.lens.z); if (id.x >= n || id.y >= 6u * n) { return; }
 let i = id.y * n + id.x; let face = id.y / n; let row = id.y % n;
 var t = load(i) * q.w.x;
 var sum = vec3f(0); var taps = 0.;
 for (var k = 0u; k < 4u; k++) {
  let o = fract(.5 + vec2f(.7548776662, .5698402910) * f32(u32(q.w.w) * 4u + k));
  let d = texel(face, (f32(id.x) + o.x) / f32(n), (f32(row) + o.y) / f32(n));
  let z = dot(d, q.fS.xyz);
  if (z > 1e-3) {
   let uv = vec2f((dot(d, q.rS.xyz) / (z * q.lens.x * q.lens.y) + 1.) * .5, (1. - dot(d, q.uS.xyz) / (z * q.lens.x)) * .5);
   if (all(uv > vec2f(0)) && all(uv < vec2f(1))) { sum += unkaris(textureSampleLevel(image, bilinear, uv, 0.).rgb); taps += 1.; }
  }
 }
 if (taps > 0.) { t += vec4f(sum / taps, 1.) * (q.w.y * taps * .25); }
 keep(i, t);
}`,"surround view","fsbx"),this.surroundSamplePass=await this.pipeline(`
@group(0) @binding(0) var<storage, read> S: array<u32>;
@group(0) @binding(1) var<uniform> q: Surround;
@group(0) @binding(2) var<storage, read_write> data: array<vec2u>;
${k}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
 let k = id.y * 64u + id.x; let n = u32(q.lens.z);
 if (id.x >= 64u || k >= u32(q.lens.w)) { return; }
 let i = S[3u * k]; if (i >= 6u * n * n) { return; }
 let rg = unpack2x16float(S[3u * k + 1u]); let c = vec3f(rg, unpack2x16float(S[3u * k + 2u]).x);
 if (any(c != c) || any(c < vec3f(0)) || any(c > vec3f(6e4))) { return; }
 keep(i, load(i) + vec4f(c, 1.) * q.w.z);
}`,"surround samples","rbx"),this.surroundWeights={view:1,sample:.25,metres:1,seconds:4})}updateSurround(i,t,e){const r=this.surroundSize,s=t.camera||{eye:[0,0,0],yaw:0,pitch:0,fov:1};e&&(i.clearBuffer(this.surroundData),this.surroundEye=null);const a=this.surroundWeights,h=this.surroundEye,o=h?Math.hypot(...s.eye.map((c,m)=>c-h.eye[m])):0,d=h&&Number.isFinite(s.seconds)&&Number.isFinite(h.seconds)?Math.max(0,s.seconds-h.seconds):0;this.surroundEye={eye:[...s.eye],seconds:s.seconds};const l=t.surround;let u=0;l&&l.count>0&&(l.size===r&&l.samples?.length>=3*l.count&&l.count<=6*r*r?u=l.count:this.stats.surroundRejected++);const[p,g,v]=S(s.yaw,s.pitch),n=c=>[...c,0];if(this.device.queue.writeBuffer(this.surroundParams,0,new Float32Array([...n(p),...n(g),...n(v),Math.tan(s.fov/2),t.width/t.height,r,u,Math.exp(-o/a.metres-d/a.seconds),a.view,a.sample,this.stats.sources&1023])),this.dispatch(i,this.surroundViewPass,[this.resolved,this.linear,this.surroundParams,this.surroundData],r,6*r),u){const c=u*12;this.surroundSamples.size<c&&(this.surroundSamples.destroy(),this.surroundSamples=this.device.createBuffer({size:Math.ceil(c/4096)*4096,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST})),this.device.queue.writeBuffer(this.surroundSamples,0,l.samples,0,3*u),this.dispatch(i,this.surroundSamplePass,[this.surroundSamples,this.surroundParams,this.surroundData],64,Math.ceil(u/64))}i.copyBufferToTexture({buffer:this.surroundData,bytesPerRow:r*8,rowsPerImage:r},{texture:this.surroundCube},[r,r,6]),this.stats.surroundSamples=u}texture(i,t,e,r=!1){return this.device.createTexture({size:[t,e],format:i,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|(r?GPUTextureUsage.STORAGE_BINDING:0)})}inputs(i,t,e){const r=this.slots[i];if(r?.width===t&&r.height===e)return r;if(r)for(const s of Object.values(r))s.destroy?.();return this.slots[i]={width:t,height:e,colour:this.texture("rgba16float",t,e),depth:this.texture("r32float",t,e),motion:this.texture("rg16float",t,e),expected:this.texture("r16float",t,e),reactive:this.texture("r8unorm",t,e),prep:this.texture("rgba16float",t,e,!0),...this.scene&&{scened:this.texture("rgba16float",t,e,!0)}}}outputs(i,t){const e=Math.max(16,Math.min(2560,Math.round(this.outputHeight()*i/t))),r=this.outputHeight();if(this.outWidth===e&&this.outHeight===r)return!1;for(const s of[...this.history||[],this.resolved])s?.destroy();return this.history=[0,1].map(()=>this.texture("rgba16float",e,r,!0)),this.resolved=this.texture("rgba16float",e,r,!0),this.dumpBuffer?.destroy(),this.dumpBuffer=this.device.createBuffer({size:this.dumpEnabled?e*r*128:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.outWidth=e,this.outHeight=r,this.stats.reconstructionWidth=e,this.stats.reconstructionHeight=r,!0}outputHeight(){return this.fixedOutputHeight||Math.max(16,Math.min(1080,Math.round(this.canvas.clientHeight*devicePixelRatio)))}group(i,t){return this.device.createBindGroup({layout:i.layout,entries:t.map((e,r)=>({binding:r,resource:e instanceof GPUBuffer?{buffer:e}:e instanceof GPUTexture?e.createView():e}))})}dispatch(i,t,e,r,s,a){const h=i.beginComputePass(a?{timestampWrites:a}:{});h.setPipeline(t.pipeline),h.setBindGroup(0,this.group(t,e)),h.dispatchWorkgroups(Math.ceil(r/8),Math.ceil(s/8)),h.end()}submit(i){if(this.failed||this.destroyed)return;if(this.scene&&i.scene?.textures?.forEach((f,w)=>{if(!f||w>=this.sceneTextures.length)return;let x=this.sceneTextures[w];(x.width!==f.width||x.height!==f.height)&&(x.destroy(),x=this.sceneTextures[w]=this.texture("r32float",f.width,f.height)),this.device.queue.writeTexture({texture:x},f.data,{bytesPerRow:f.width*4},[f.width,f.height])}),this.pending>=2){this.stats.queueFull++;return}const t=performance.now(),{width:e,height:r}=i,s=e*r;this.slots||=[];const a=this.slot<0?0:1-this.slot,h=this.slots[1-a],o=this.inputs(a,e,r),d=this.outputs(e,r),l=!!i.historyReset||d||!h||this.slot<0||this.needsReset;this.needsReset=!1;const u=new Uint8Array(i.buffer);for(const[f,w,x]of[["colour",0,8],["depth",s*8,4],["motion",s*12,4],["expected",s*16,2],["reactive",s*18,1]])this.device.queue.writeTexture({texture:o[f]},u.subarray(w,w+s*x),{bytesPerRow:e*x},[e,r]);const p=this.scene&&i.scene;if(p){const f=p.uniforms.byteLength;this.sceneUniforms?.size!==f&&(this.sceneUniforms?.destroy(),this.sceneUniforms=this.device.createBuffer({size:f,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})),this.device.queue.writeBuffer(this.sceneUniforms,0,p.uniforms)}this.stats.uploadCpuMs=performance.now()-t;const g=i.jitter||[0,0],v=h||o,n={learned:1,temporal:0,spatial:2}[i.reconstruction||this.reconstruction]??1;this.device.queue.writeBuffer(this.params,0,new Float32Array([e,r,this.outWidth,this.outHeight,g[0],g[1],...this.previousJitter||g,v.width,v.height,+l,n,this.sharpness,this.nMax,this.prior,this.dumpEnabled?1:0,this.kernel,this.kernelN]));const c=this.device.createCommandEncoder({label:"temporal reconstruction"}),m=this.queries&&!this.readingTime&&performance.now()-(this.lastTiming||-1e3)>=1e3;m&&(this.readingTime=!0,this.lastTiming=performance.now()),this.historyIndex=(this.historyIndex??0)^1;const y=this.history[this.historyIndex],q=this.history[this.historyIndex^1];p&&this.dispatch(c,this.scene,[o.colour,o.scened,this.sceneUniforms,...this.sceneTextures],e,r),this.dispatch(c,this.prep,[o.depth,o.motion,o.expected,v.depth,o.prep,this.params],e,r,m?{querySet:this.queries,beginningOfPassWriteIndex:0}:void 0),this.dispatch(c,this.accumulate,[p?o.scened:o.colour,o.prep,o.reactive,q,y,this.linear,this.params,this.weights,this.dumpBuffer],this.outWidth,this.outHeight),this.dispatch(c,this.resolve,[y,this.resolved,this.params],this.outWidth,this.outHeight,m?{querySet:this.queries,endOfPassWriteIndex:1}:void 0),this.surroundSize&&this.updateSurround(c,i,l),m&&(c.resolveQuerySet(this.queries,0,2,this.queryResult,0),c.copyBufferToBuffer(this.queryResult,0,this.queryRead,0,16)),this.device.queue.submit([c.finish()]),m&&this.queryRead.mapAsync(GPUMapMode.READ).then(()=>{const f=new BigUint64Array(this.queryRead.getMappedRange());this.stats.reconstructionGpuMs=Number(f[1]-f[0])/1e6,this.queryRead.unmap(),this.readingTime=!1}).catch(f=>{this.readingTime=!1,this.destroyed||this.fail(f.message)}),this.pending++,this.device.queue.onSubmittedWorkDone().then(()=>this.pending--).catch(f=>this.fail(f.message)),this.stats.encodeCpuMs=performance.now()-t-this.stats.uploadCpuMs,this.stats.reconstruction=["temporal heuristic","learned","spatial reference"][n],this.stats.sources++,l&&this.stats.resets++,this.stats.traceWidth=e,this.stats.traceHeight=r,this.slot=a,this.previousJitter=g,this.source={camera:i.camera||this.source?.camera||{eye:[0,0,0],yaw:0,pitch:0,fov:1},jitter:g,width:e,height:r,serial:(this.source?.serial||0)+1},this.lastPresented="",this.running||this.draw(performance.now(),!0)}draw(i,t=!1){if(this.slot<0||this.failed||this.presentPending>=2)return;const e=Math.max(1,Math.min(3840,Math.round(this.canvas.clientWidth*devicePixelRatio))),r=Math.max(1,Math.min(2160,Math.round(this.canvas.clientHeight*devicePixelRatio)));(this.canvas.width!==e||this.canvas.height!==r)&&(this.canvas.width=e,this.canvas.height=r,this.lastPresented="");const s=this.source.camera,a=!t&&this.predictPose&&this.predictPose(s,i)||s,h=`${this.source.serial}:${a.yaw}:${a.pitch}:${a.eye}:${e}x${r}`;if(h===this.lastPresented)return;const[o,d,l]=S(s.yaw,s.pitch),[u,p,g]=S(a.yaw,a.pitch),v=y=>[...y,0],n=this.slots[this.slot];this.device.queue.writeBuffer(this.displayParams,0,new Float32Array([...v(s.eye),...v(o),...v(d),...v(l),...v(a.eye),...v(u),...v(p),...v(g),Math.tan(s.fov/2),n.width/n.height,e/r,this.vignette,e,r,n.width,n.height,...this.source.jitter,0,0]));const c=this.device.createCommandEncoder({label:"late-latched presentation"}),m=c.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store"}]});m.setPipeline(this.present),m.setBindGroup(0,this.group({layout:this.presentLayout},[this.resolved,n.prep,this.linear,this.displayParams,this.surroundView])),m.draw(3),m.end(),this.device.queue.submit([c.finish()]),this.presentPending++,this.device.queue.onSubmittedWorkDone().then(()=>this.presentPending--).catch(y=>this.fail(y.message)),this.lastPresented=h,this.stats.presents++,a!==s&&this.stats.reprojected++}resume(){if(this.running||this.failed)return;this.running=!0,this.needsReset=!0,this.lastTick=0;const i=t=>{if(this.running){if(this.lastTick){const e=t-this.lastTick;e>2&&e<60&&(this.refreshMs=this.refreshMs?this.refreshMs*.95+e*.05:e,this.stats.refreshHz=1e3/this.refreshMs)}this.lastTick=t;try{this.draw(t)}catch(e){this.fail(e.message);return}this.raf=requestAnimationFrame(i)}};this.raf=requestAnimationFrame(i)}pause(){this.needsReset=!0,this.running=!1,cancelAnimationFrame(this.raf)}destroy(){this.destroyed=!0,this.pause(),this.device.destroy()}}export{R as FEATURES,U as WebGPUPresenter};
