/* Tuonela Walk (c) 2026 Timo Saarinen. All rights reserved. */
const S=`
fn karis(c: vec3f) -> vec3f { return c / (1. + max(max(c.r, c.g), c.b)); }
fn unkaris(c: vec3f) -> vec3f { return c / max(1. - max(max(c.r, c.g), c.b), 1e-4); }
fn ycocg(c: vec3f) -> vec3f { return vec3f(.25*c.r + .5*c.g + .25*c.b, .5*c.r - .5*c.b, -.25*c.r + .5*c.g - .25*c.b); }
fn rgb(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }`,k=`struct Frame { inSize: vec2f, outSize: vec2f, jitter: vec2f, prevJitter: vec2f,
 prevInSize: vec2f, reset: f32, mode: f32, sharpness: f32, nMax: f32, prior: f32, dump: f32,
 kernel: f32, kernelN: f32 };`,M=12,q={f:"float",u:"unfilterable-float"};class P{static async create(r,{onError:i=()=>{},modelBase:e=new URL("./models/",import.meta.url),dump:t=!1,reconstruction:s="learned",scenePass:u}={}){if(!navigator.gpu)throw Error("WebGPU is required. Use a browser with WebGPU enabled.");const n=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!n)throw Error("No WebGPU adapter is available.");const o=n.features.has("timestamp-query"),d=await n.requestDevice({requiredFeatures:o?["timestamp-query"]:[]}),h=new P(r,d,i);d.addEventListener("uncapturederror",m=>h.fail(m.error.message)),d.lost.then(m=>{h.destroyed||h.fail(`WebGPU device lost: ${m.message}`)});try{await h.initialize(e,t,u)}catch(m){throw h.destroy(),m}return h.reconstruction=s,h.adapterInfo={vendor:n.info.vendor,architecture:n.info.architecture,device:n.info.device,description:n.info.description},h}constructor(r,i,e){if(this.canvas=r,this.device=i,this.onError=e,this.context=r.getContext("webgpu"),!this.context)throw Error("A WebGPU canvas could not be created.");this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:i,format:this.format,alphaMode:"opaque"}),this.stats={backend:"webgpu",reconstruction:"learned",sources:0,presents:0,reprojected:0,resets:0,uploadCpuMs:0,encodeCpuMs:0,refreshHz:60,queueFull:0},i.features.has("timestamp-query")&&(this.queries=i.createQuerySet({type:"timestamp",count:2}),this.queryResult=i.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.queryRead=i.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),this.pending=0,this.presentPending=0,this.slot=-1,this.running=!1,this.linear=i.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.sharpness=.25,this.nMax=16,this.prior=.15,this.vignette=.12,this.kernel=1,this.kernelN=8}fail(r){this.failed||this.destroyed||(this.failed=!0,this.pause(),this.onError(r))}layout(r){return this.device.createBindGroupLayout({entries:[...r].map((i,e)=>{const t=this.visibility;return i==="f"||i==="u"?{binding:e,visibility:t,texture:{sampleType:q[i]}}:i==="s"?{binding:e,visibility:t,sampler:{type:"filtering"}}:i==="w"?{binding:e,visibility:t,storageTexture:{access:"write-only",format:"rgba16float"}}:i==="b"?{binding:e,visibility:t,buffer:{type:"uniform"}}:{binding:e,visibility:t,buffer:{type:i==="r"?"read-only-storage":"storage"}}})})}async pipeline(r,i,e){this.visibility=GPUShaderStage.COMPUTE;const t=this.device.createShaderModule({code:r,label:i}),u=(await t.getCompilationInfo()).messages.filter(d=>d.type==="error");if(u.length)throw Error(`${i}: ${u.map(d=>`${d.lineNum}: ${d.message}`).join("; ")}`);const n=this.layout(e);return{pipeline:await this.device.createComputePipelineAsync({label:i,layout:this.device.createPipelineLayout({bindGroupLayouts:[n]}),compute:{module:t,entryPoint:"main"}}),layout:n}}async initialize(r,i,e){e&&(this.scene=await this.pipeline(e.code,"scene pass","fwb"+"u".repeat(e.textures)),this.sceneTextures=Array.from({length:e.textures},()=>this.texture("r32float",1,1)));const t=await(await fetch(new URL("reconstruction.json",r))).json(),s=new Float32Array(t.weights);if([...new Uint8Array(await crypto.subtle.digest("SHA-256",s.buffer))].map(c=>c.toString(16).padStart(2,"0")).join("")!==t.sha256||t.features!==12||t.outputs!==3)throw Error("Reconstruction weights failed integrity validation.");this.model={name:t.name,revision:t.revision,sha256:t.sha256,hidden:t.hidden,parameters:s.length},this.weights=this.device.createBuffer({size:Math.max(16,s.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.weights,0,s),this.params=this.device.createBuffer({size:72,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayParams=this.device.createBuffer({size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.dumpEnabled=i,this.prep=await this.pipeline(`${k}
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
}`,"reconstruction prep","uuuuwb");const n=t.hidden,o=[12,...n,3];let d=0;const h=[];for(let c=1;c<o.length;c++){const l=o[c-1],f=o[c];h.push({inputs:l,outputs:f,w:d,b:d+l*f,relu:c<o.length-1}),d+=l*f+f}if(d!==s.length)throw Error("Reconstruction model shape mismatch.");const m=h.map((c,l)=>`
 var a${l+1}: array<f32, ${c.outputs}>;
 for (var j = 0u; j < ${c.outputs}u; j++) {
  var s = W[${c.b}u + j];
  for (var i = 0u; i < ${c.inputs}u; i++) { s += W[${c.w}u + j * ${c.inputs}u + i] * a${l}[i]; }
  a${l+1}[j] = ${c.relu?"max(s, 0.)":"s"};
 }`).join("");this.accumulate=await this.pipeline(`${k}${S}
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
 if (p.mode == 1.) {${m}
  trust = sigmoid(a${h.length}[0]); gamma = .5 + 3.5 * sigmoid(a${h.length}[1]);
  weight = exp2(clamp(a${h.length}[2], -4., 4.));
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
}`,"temporal accumulation","fuffwsbrx"),this.resolve=await this.pipeline(`${k}${S}
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
}`,"reconstruction sharpen","fwb"),this.visibility=GPUShaderStage.FRAGMENT,this.presentLayout=this.layout("fusb");const x=`${S}
struct Display { eyeS: vec4f, fS: vec4f, rS: vec4f, uS: vec4f, eyeD: vec4f, fD: vec4f, rD: vec4f, uD: vec4f,
 lens: vec4f, size: vec4f, jitter: vec4f };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var prep: texture_2d<f32>;
@group(0) @binding(2) var bilinear: sampler;
@group(0) @binding(3) var<uniform> p: Display;
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
 /* Past the traced image there is nothing to show: fade to black over 2% of the
    image height instead of stretching the edge texel across the gap. */
 let past = max(max(-uv, uv - 1.), vec2f(0)) * vec2f(p.size.z / p.size.w, 1.);
 let known = 1. - smoothstep(0., .02, max(past.x, past.y));
 let c = unkaris(sharpSample(clamp(uv, vec2f(0), vec2f(1)))) * known;
 return vec4f(tone(c * (1. - p.lens.w * (x * x + y * y))), 1);
}`,g=this.device.createShaderModule({code:x,label:"late-latched presentation"});this.present=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.presentLayout]}),vertex:{module:g,entryPoint:"vertex"},fragment:{module:g,entryPoint:"fragment",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}texture(r,i,e,t=!1){return this.device.createTexture({size:[i,e],format:r,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|(t?GPUTextureUsage.STORAGE_BINDING:0)})}inputs(r,i,e){const t=this.slots[r];if(t?.width===i&&t.height===e)return t;if(t)for(const s of Object.values(t))s.destroy?.();return this.slots[r]={width:i,height:e,colour:this.texture("rgba16float",i,e),depth:this.texture("r32float",i,e),motion:this.texture("rg16float",i,e),expected:this.texture("r16float",i,e),reactive:this.texture("r8unorm",i,e),prep:this.texture("rgba16float",i,e,!0),...this.scene&&{scened:this.texture("rgba16float",i,e,!0)}}}outputs(r,i){const e=Math.max(16,Math.min(2560,Math.round(this.outputHeight()*r/i))),t=this.outputHeight();if(this.outWidth===e&&this.outHeight===t)return!1;for(const s of[...this.history||[],this.resolved])s?.destroy();return this.history=[0,1].map(()=>this.texture("rgba16float",e,t,!0)),this.resolved=this.texture("rgba16float",e,t,!0),this.dumpBuffer?.destroy(),this.dumpBuffer=this.device.createBuffer({size:this.dumpEnabled?e*t*128:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.outWidth=e,this.outHeight=t,this.stats.reconstructionWidth=e,this.stats.reconstructionHeight=t,!0}outputHeight(){return this.fixedOutputHeight||Math.max(16,Math.min(1080,Math.round(this.canvas.clientHeight*devicePixelRatio)))}group(r,i){return this.device.createBindGroup({layout:r.layout,entries:i.map((e,t)=>({binding:t,resource:e instanceof GPUBuffer?{buffer:e}:e instanceof GPUTexture?e.createView():e}))})}dispatch(r,i,e,t,s,u){const n=r.beginComputePass(u?{timestampWrites:u}:{});n.setPipeline(i.pipeline),n.setBindGroup(0,this.group(i,e)),n.dispatchWorkgroups(Math.ceil(t/8),Math.ceil(s/8)),n.end()}submit(r){if(this.failed||this.destroyed)return;if(this.scene&&r.scene?.textures?.forEach((a,p)=>{if(!a||p>=this.sceneTextures.length)return;let v=this.sceneTextures[p];(v.width!==a.width||v.height!==a.height)&&(v.destroy(),v=this.sceneTextures[p]=this.texture("r32float",a.width,a.height)),this.device.queue.writeTexture({texture:v},a.data,{bytesPerRow:a.width*4},[a.width,a.height])}),this.pending>=2){this.stats.queueFull++;return}const i=performance.now(),{width:e,height:t}=r,s=e*t;this.slots||=[];const u=this.slot<0?0:1-this.slot,n=this.slots[1-u],o=this.inputs(u,e,t),d=this.outputs(e,t),h=!!r.historyReset||d||!n||this.slot<0||this.needsReset;this.needsReset=!1;const m=new Uint8Array(r.buffer);for(const[a,p,v]of[["colour",0,8],["depth",s*8,4],["motion",s*12,4],["expected",s*16,2],["reactive",s*18,1]])this.device.queue.writeTexture({texture:o[a]},m.subarray(p,p+s*v),{bytesPerRow:e*v},[e,t]);const x=this.scene&&r.scene;if(x){const a=x.uniforms.byteLength;this.sceneUniforms?.size!==a&&(this.sceneUniforms?.destroy(),this.sceneUniforms=this.device.createBuffer({size:a,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})),this.device.queue.writeBuffer(this.sceneUniforms,0,x.uniforms)}this.stats.uploadCpuMs=performance.now()-i;const g=r.jitter||[0,0],c=n||o,l={learned:1,temporal:0,spatial:2}[r.reconstruction||this.reconstruction]??1;this.device.queue.writeBuffer(this.params,0,new Float32Array([e,t,this.outWidth,this.outHeight,g[0],g[1],...this.previousJitter||g,c.width,c.height,+h,l,this.sharpness,this.nMax,this.prior,this.dumpEnabled?1:0,this.kernel,this.kernelN]));const f=this.device.createCommandEncoder({label:"temporal reconstruction"}),y=this.queries&&!this.readingTime&&performance.now()-(this.lastTiming||-1e3)>=1e3;y&&(this.readingTime=!0,this.lastTiming=performance.now()),this.historyIndex=(this.historyIndex??0)^1;const b=this.history[this.historyIndex],w=this.history[this.historyIndex^1];x&&this.dispatch(f,this.scene,[o.colour,o.scened,this.sceneUniforms,...this.sceneTextures],e,t),this.dispatch(f,this.prep,[o.depth,o.motion,o.expected,c.depth,o.prep,this.params],e,t,y?{querySet:this.queries,beginningOfPassWriteIndex:0}:void 0),this.dispatch(f,this.accumulate,[x?o.scened:o.colour,o.prep,o.reactive,w,b,this.linear,this.params,this.weights,this.dumpBuffer],this.outWidth,this.outHeight),this.dispatch(f,this.resolve,[b,this.resolved,this.params],this.outWidth,this.outHeight,y?{querySet:this.queries,endOfPassWriteIndex:1}:void 0),y&&(f.resolveQuerySet(this.queries,0,2,this.queryResult,0),f.copyBufferToBuffer(this.queryResult,0,this.queryRead,0,16)),this.device.queue.submit([f.finish()]),y&&this.queryRead.mapAsync(GPUMapMode.READ).then(()=>{const a=new BigUint64Array(this.queryRead.getMappedRange());this.stats.reconstructionGpuMs=Number(a[1]-a[0])/1e6,this.queryRead.unmap(),this.readingTime=!1}).catch(a=>{this.readingTime=!1,this.destroyed||this.fail(a.message)}),this.pending++,this.device.queue.onSubmittedWorkDone().then(()=>this.pending--).catch(a=>this.fail(a.message)),this.stats.encodeCpuMs=performance.now()-i-this.stats.uploadCpuMs,this.stats.reconstruction=["temporal heuristic","learned","spatial reference"][l],this.stats.sources++,h&&this.stats.resets++,this.stats.traceWidth=e,this.stats.traceHeight=t,this.slot=u,this.previousJitter=g,this.source={camera:r.camera||this.source?.camera||{eye:[0,0,0],yaw:0,pitch:0,fov:1},jitter:g,width:e,height:t,serial:(this.source?.serial||0)+1},this.lastPresented="",this.running||this.draw(performance.now(),!0)}draw(r,i=!1){if(this.slot<0||this.failed||this.presentPending>=2)return;const e=Math.max(1,Math.min(3840,Math.round(this.canvas.clientWidth*devicePixelRatio))),t=Math.max(1,Math.min(2160,Math.round(this.canvas.clientHeight*devicePixelRatio)));(this.canvas.width!==e||this.canvas.height!==t)&&(this.canvas.width=e,this.canvas.height=t,this.lastPresented="");const s=this.source.camera,u=!i&&this.predictPose&&this.predictPose(s,r)||s,n=`${this.source.serial}:${u.yaw}:${u.pitch}:${u.eye}:${e}x${t}`;if(n===this.lastPresented)return;const o=(w,a)=>{const p=[Math.sin(w)*Math.cos(a),Math.sin(a),Math.cos(w)*Math.cos(a)],v=Math.hypot(p[2],p[0])||1,z=[-p[2]/v,0,p[0]/v],U=[z[1]*p[2]-z[2]*p[1],z[2]*p[0]-z[0]*p[2],z[0]*p[1]-z[1]*p[0]];return[p,z,U]},[d,h,m]=o(s.yaw,s.pitch),[x,g,c]=o(u.yaw,u.pitch),l=w=>[...w,0],f=this.slots[this.slot];this.device.queue.writeBuffer(this.displayParams,0,new Float32Array([...l(s.eye),...l(d),...l(h),...l(m),...l(u.eye),...l(x),...l(g),...l(c),Math.tan(s.fov/2),f.width/f.height,e/t,this.vignette,e,t,f.width,f.height,...this.source.jitter,0,0]));const y=this.device.createCommandEncoder({label:"late-latched presentation"}),b=y.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store"}]});b.setPipeline(this.present),b.setBindGroup(0,this.group({layout:this.presentLayout},[this.resolved,f.prep,this.linear,this.displayParams])),b.draw(3),b.end(),this.device.queue.submit([y.finish()]),this.presentPending++,this.device.queue.onSubmittedWorkDone().then(()=>this.presentPending--).catch(w=>this.fail(w.message)),this.lastPresented=n,this.stats.presents++,u!==s&&this.stats.reprojected++}resume(){if(this.running||this.failed)return;this.running=!0,this.needsReset=!0,this.lastTick=0;const r=i=>{if(this.running){if(this.lastTick){const e=i-this.lastTick;e>2&&e<60&&(this.refreshMs=this.refreshMs?this.refreshMs*.95+e*.05:e,this.stats.refreshHz=1e3/this.refreshMs)}this.lastTick=i;try{this.draw(i)}catch(e){this.fail(e.message);return}this.raf=requestAnimationFrame(r)}};this.raf=requestAnimationFrame(r)}pause(){this.needsReset=!0,this.running=!1,cancelAnimationFrame(this.raf)}destroy(){this.destroyed=!0,this.pause(),this.device.destroy()}}export{M as FEATURES,P as WebGPUPresenter};
