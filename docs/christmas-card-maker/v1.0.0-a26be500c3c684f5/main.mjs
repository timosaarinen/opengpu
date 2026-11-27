var K=["Cottage","Riverlight"];var ae=class{constructor(e,t,{onStatus:r=()=>{},onError:n=()=>{},onCompile:a=()=>{},frameInput:o=()=>({}),maxFps:s=0,presenter:l=null,paceRequests:w=!1}={}){this.canvas=e,this.presenter=l,this.paceRequests=w,this.context=l?null:e.getContext("2d",{alpha:!1}),this.onStatus=r,this.onError=n,this.onCompile=a,this.frameInput=o,this.minimumFrameMs=Number.isFinite(s)&&s>0?1e3/s:0,this.lastRequest=-1/0,this.worker=new Worker(t,{type:"module"}),this.width=640,this.height=360,this.generation=0,this.frame=0,this.running=!1,this.busy=!1,this.ready=!1,this.compileId=0,this.origin=performance.now(),this.elapsed=0,this.info={},this.worker.onmessage=({data:v})=>this.receive(v),this.worker.onerror=v=>{this.stop(),this.busy=!1,this.onError(v.message)}}init(e={}){this.worker.postMessage({type:"init",...e})}compile(e){this.worker.postMessage({type:"compile",source:e,id:++this.compileId})}resize(e,t){if(!Number.isInteger(e)||!Number.isInteger(t)||e<1||t<1||e>1920||t>1080)throw new Error("Resolution must fit within 1920 \xD7 1080");this.width=e,this.height=t,this.generation++,this.worker.postMessage({type:"cancel"})}resume(){this.running||(this.origin=performance.now(),this.lastRequest=-1/0,this.running=!0,this.schedule())}stop(){this.running&&(this.elapsed+=(performance.now()-this.origin)/1e3),this.running=!1,this.generation++,this.worker.postMessage({type:"cancel"}),cancelAnimationFrame(this.raf),clearTimeout(this.timer)}schedule(){if(!this.running||!this.ready||this.busy)return;let e=t=>{if(!this.running||this.busy)return;if(this.presenter?.pending>=2||t-this.lastRequest+.1<this.minimumFrameMs){this.schedule();return}this.lastRequest=t;let r=this.elapsed+(performance.now()-this.origin)/1e3;this.busy=!0;let n={...this.frameInput({time:r,frame:this.frame}),type:"frame",width:this.width,height:this.height,generation:this.generation,time:r,frame:this.frame++,buffer:this.buffer};this.buffer=void 0,this.worker.postMessage(n,n.buffer?[n.buffer]:[])};if(this.presenter&&!this.paceRequests){let t=Math.max(this.presenter.pending>=2?4:0,this.minimumFrameMs-(performance.now()-this.lastRequest));this.timer=setTimeout(()=>e(performance.now()),t)}else this.raf=requestAnimationFrame(e)}receive(e){if(e.type==="ready")this.info=e,this.ready=!0,this.onStatus(e),this.schedule();else if(e.type==="compiled")this.onCompile(e);else if(e.type==="error")(e.request==="frame"||e.request==="init")&&(this.busy=!1,this.stop()),this.onError(e.message,e);else if(e.type==="frame"){if(this.busy=!1,this.buffer=e.buffer,!e.cancelled&&e.generation===this.generation){let t=performance.now();if(this.presenter)try{this.presenter.stats&&(this.presenter.stats.renderCpuMs=e.renderMs),this.presenter.submit(e)}catch(r){this.stop(),this.onError(r.message);return}else(this.canvas.width!==e.width||this.canvas.height!==e.height)&&(this.canvas.width=e.width,this.canvas.height=e.height),this.context.putImageData(new ImageData(new Uint8ClampedArray(e.buffer),e.width,e.height),0,0);this.onStatus({...this.info,...e,presentMs:performance.now()-t})}this.schedule()}}destroy(){return this.disposing?this.disposing:(this.stop(),this.buffer=void 0,this.ready=!1,this.disposing=new Promise(e=>{let t=()=>{clearTimeout(r),this.worker.onmessage=null,this.worker.onerror=null,this.worker.terminate(),e()},r=setTimeout(t,3e3);this.worker.onmessage=({data:n})=>{n.type==="disposed"&&t()},this.worker.onerror=t,this.worker.postMessage({type:"dispose"})}),this.disposing)}};var Ge=`
struct Extent {
  view: vec2f,
  pixel: vec2f,
}
struct Quad {
  rect: vec4f,
  uv: vec4f,
  clip: vec4f,
  color: u32,
  kind: u32,
  scale: f32,
  reserved: f32,
}
@group(0) @binding(0) var linear: sampler;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var<uniform> extent: Extent;
@group(0) @binding(4) var<storage, read> quads: array<Quad>;

struct SceneVertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn sceneVertex(@builtin(vertex_index) i: u32) -> SceneVertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return SceneVertex(vec4f(uv * vec2f(2., -2.) + vec2f(-1., 1.), 0., 1.), uv);
}
@fragment fn scenePixel(v: SceneVertex) -> @location(0) vec4f {
  return vec4f(textureSample(scene, linear, v.uv).rgb, 1.);
}

@fragment fn reconstructPixel(v: SceneVertex) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(scene));
  let p = v.uv * size - .5;
  let f = fract(p);
  let base = floor(p);
  let a = f * (-.5 + f * (1. - .5 * f));
  let b = 1. + f * f * (-2.5 + 1.5 * f);
  let c = f * (.5 + f * (2. - 1.5 * f));
  let d = f * f * (-.5 + .5 * f);
  let middle = b + c;
  let xs = vec3f(base.x - .5, base.x + .5 + c.x / middle.x, base.x + 2.5) / size.x;
  let ys = vec3f(base.y - .5, base.y + .5 + c.y / middle.y, base.y + 2.5) / size.y;
  let wx = vec3f(a.x, middle.x, d.x);
  let wy = vec3f(a.y, middle.y, d.y);
  var color = vec3f(0.);
  for (var y = 0; y < 3; y++) {
    for (var x = 0; x < 3; x++) {
      color += textureSampleLevel(scene, linear, vec2f(xs[x], ys[y]), 0.).rgb * wx[x] * wy[y];
    }
  }
  return vec4f(clamp(color, vec3f(0.), vec3f(1.)), 1.);
}

struct UiVertex {
  @builtin(position) position: vec4f,
  @location(0) point: vec2f,
  @location(1) @interpolate(flat) index: u32,
}
@vertex fn uiVertex(@builtin(vertex_index) i: u32, @builtin(instance_index) instance: u32) -> UiVertex {
  let q = quads[instance];
  let corner = vec2f(f32(i & 1u), f32(i >> 1u));
  let start = max(q.rect.xy, q.clip.xy);
  let end = max(start, min(q.rect.zw, q.clip.zw));
  let point = mix(start, end, corner);
  let ndc = point / extent.view * vec2f(2., -2.) + vec2f(-1., 1.);
  return UiVertex(vec4f(ndc, 0., 1.), point, instance);
}

fn median(c: vec3f) -> f32 {
  return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

@fragment fn uiPixel(v: UiVertex) -> @location(0) vec4f {
  let q = quads[v.index];
  let size = q.rect.zw - q.rect.xy;
  var coverage = 0.;
  if (q.kind == 0u) {
    let halfSize = size * .5;
    let radius = min(q.uv.x, min(halfSize.x, halfSize.y));
    let delta = abs(v.point - q.rect.xy - halfSize) - halfSize + radius;
    let distance = length(max(delta, vec2f(0.))) + min(max(delta.x, delta.y), 0.) - radius;
    coverage = clamp(.5 - distance / extent.pixel.y, 0., 1.);
  } else {
    let offsets = array(vec2f(-.375, -.125), vec2f(-.125, .375),
                        vec2f(.125, -.375), vec2f(.375, .125));
    for (var i = 0u; i < 4u; i++) {
      let xy = v.point + offsets[i] * extent.pixel;
      let uv = mix(q.uv.xy, q.uv.zw, (xy - q.rect.xy) / size);
      let distance = median(textureSampleLevel(atlas, linear, uv, 0.).rgb);
      coverage += .25 * clamp((distance - .5) * q.scale * 2. / extent.pixel.y + .5, 0., 1.);
    }
  }
  return unpack4x8unorm(q.color) * coverage;
}
`;async function Me(i){let e=navigator.gpu,t=await e?.requestAdapter();if(!t)throw new Error("A WebGPU adapter is required for the editor.");let r=await t.requestDevice(),n=!1;r.lost.then(a=>{n||i(a.message||"The WebGPU device was lost.")});try{let ie=function(h,d,x,S){r.queue.writeTexture({texture:h},d,{bytesPerRow:x*4},[x,S])},u=function(h,d){return r.createTexture({size:[h,d],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})},c=function(h,d){return r.createBindGroup({layout:h.getBindGroupLayout(0),entries:[{binding:0,resource:q},{binding:1,resource:d.createView()}]})},g=function(h,d,x,S=x){T?.destroy(),T=u(d,x),ie(T,h,d,S),W=void 0},L=function(h){let d=h.getContext("webgpu");if(!d)throw new Error("The browser could not create a WebGPU canvas.");return d.configure({device:r,format:a,alphaMode:"opaque"}),{ready(){return D},draw(x,S,N,[B,j,F,C]){let{imageWidth:O,imageHeight:U,commands:Y}=x,fe=x.image,de=r.createCommandEncoder();(!b||b.width!==O||b.height!==U)&&(b?.destroy(),b=u(O,U),P=c(v,b)),fe&&ie(b,fe,O,U);{let Re=Math.max(1,Math.min(O*2,Math.round(F))),Ae=Math.max(1,Math.min(U*2,Math.round(C))),Ne=_?.width!==Re||_.height!==Ae;if(Ne&&(_?.destroy(),_=r.createTexture({size:[Re,Ae],format:"rgba8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),H=c(l,_)),fe||Ne){let ne=de.beginRenderPass({colorAttachments:[{view:_.createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});ne.setPipeline(v),ne.setBindGroup(0,P),ne.draw(3),ne.end()}}let me=h.width/S,pe=h.height/N,R=de.beginRenderPass({colorAttachments:[{view:d.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[.032,.049,.077,1]}]});R.setViewport(B*me,j*pe,F*me,C*pe,0,1),R.setPipeline(l),R.setBindGroup(0,H),R.draw(3),Y?.byteLength&&((!f||f.size<Y.byteLength)&&(f?.destroy(),f=r.createBuffer({size:Math.max(Y.byteLength,(f?.size??0)*2,16*1024),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),W=void 0),W??=r.createBindGroup({layout:w.getBindGroupLayout(0),entries:[{binding:0,resource:q},{binding:2,resource:T.createView()},{binding:3,resource:{buffer:$}},{binding:4,resource:{buffer:f}}]}),r.queue.writeBuffer($,0,new Float32Array([S,N,1/me,1/pe])),r.queue.writeBuffer(f,0,Y),R.setViewport(0,0,h.width,h.height,0,1),R.setPipeline(w),R.setBindGroup(0,W),R.draw(4,Y.byteLength/64)),R.end(),r.queue.submit([de.finish()]),D=r.queue.onSubmittedWorkDone()},dispose(){d.unconfigure()}}},a=e.getPreferredCanvasFormat(),o=r.createShaderModule({code:Ge}),s={srcFactor:"one",dstFactor:"one-minus-src-alpha"},[l,w,v]=await Promise.all([r.createRenderPipelineAsync({layout:"auto",vertex:{module:o,entryPoint:"sceneVertex"},fragment:{module:o,entryPoint:"scenePixel",targets:[{format:a}]}}),r.createRenderPipelineAsync({layout:"auto",primitive:{topology:"triangle-strip"},vertex:{module:o,entryPoint:"uiVertex"},fragment:{module:o,entryPoint:"uiPixel",targets:[{format:a,blend:{color:s,alpha:s}}]}}),r.createRenderPipelineAsync({layout:"auto",vertex:{module:o,entryPoint:"sceneVertex"},fragment:{module:o,entryPoint:"reconstructPixel",targets:[{format:"rgba8unorm"}]}})]),q=r.createSampler({minFilter:"linear",magFilter:"linear"}),$=r.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),b,H,T,W,f,_,P,D;return{attach:L,setAtlas:g,dispose(){n=!0,r.destroy()}}}catch(a){throw n=!0,r.destroy(),a}}var Ve=`#version 300 es
out vec2 uv;
void main() {
  uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
}`,Xe=`#version 300 es
precision highp float;
uniform sampler2D image;
uniform bool reconstruct;
in vec2 uv;
out vec4 color;
void main() {
  if (!reconstruct) {
    color = vec4(texture(image, vec2(uv.x, 1. - uv.y)).rgb, 1.);
    return;
  }
  vec2 size = vec2(textureSize(image, 0));
  vec2 p = uv * size - .5, f = fract(p), base = floor(p);
  vec2 a = f * (-.5 + f * (1. - .5 * f));
  vec2 b = 1. + f * f * (-2.5 + 1.5 * f);
  vec2 c = f * (.5 + f * (2. - 1.5 * f));
  vec2 d = f * f * (-.5 + .5 * f);
  vec2 middle = b + c;
  vec3 xs = vec3(base.x - .5, base.x + .5 + c.x / middle.x, base.x + 2.5) / size.x;
  vec3 ys = vec3(base.y - .5, base.y + .5 + c.y / middle.y, base.y + 2.5) / size.y;
  vec3 wx = vec3(a.x, middle.x, d.x), wy = vec3(a.y, middle.y, d.y);
  vec3 sum = vec3(0.);
  for (int y = 0; y < 3; ++y)
    for (int x = 0; x < 3; ++x)
      sum += texture(image, vec2(xs[x], ys[y])).rgb * wx[x] * wy[y];
  color = vec4(clamp(sum, 0., 1.), 1.);
}`,$e=`#version 300 es
layout(location=0) in vec4 rect;
layout(location=1) in vec4 uv;
layout(location=2) in vec4 clip;
layout(location=3) in uvec2 packed;
layout(location=4) in float scale;
uniform vec2 extent;
out vec2 point;
flat out vec4 bounds, mapping, tint;
flat out uint kind;
flat out float textScale;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 start = max(rect.xy, clip.xy);
  point = mix(start, max(start, min(rect.zw, clip.zw)), corner);
  gl_Position = vec4(point / extent * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  bounds = rect;
  mapping = uv;
  uint p = packed.x;
  tint = vec4(uvec4(p, p >> 8u, p >> 16u, p >> 24u) & 255u) / 255.;
  kind = packed.y;
  textScale = scale;
}`,He=`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D atlas;
in vec2 point;
flat in vec4 bounds, mapping, tint;
flat in uint kind;
flat in float textScale;
out vec4 color;
float median(vec3 c) { return max(min(c.r, c.g), min(max(c.r, c.g), c.b)); }
void main() {
  vec2 size = bounds.zw - bounds.xy;
  float coverage = 0.;
  if (kind == 0u) {
    vec2 halfSize = size * .5;
    float radius = min(mapping.x, min(halfSize.x, halfSize.y));
    vec2 delta = abs(point - bounds.xy - halfSize) - halfSize + radius;
    float d = length(max(delta, vec2(0.))) + min(max(delta.x, delta.y), 0.) - radius;
    coverage = clamp(.5 - d, 0., 1.);
  } else {
    vec2 offsets[4] = vec2[4](vec2(-.375, -.125), vec2(-.125, .375),
                              vec2(.125, -.375), vec2(.375, .125));
    for (int i = 0; i < 4; ++i) {
      vec2 st = mix(mapping.xy, mapping.zw, (point + offsets[i] - bounds.xy) / size);
      float d = median(texture(atlas, st).rgb);
      coverage += .25 * clamp((d - .5) * textScale * 2. + .5, 0., 1.);
    }
  }
  color = tint * coverage;
}`;function Te(i,e,t){let r=i.createProgram();try{for(let[n,a]of[[i.VERTEX_SHADER,e],[i.FRAGMENT_SHADER,t]]){let o=i.createShader(n);i.shaderSource(o,a),i.compileShader(o);let s=i.getShaderParameter(o,i.COMPILE_STATUS),l=s?"":i.getShaderInfoLog(o);if(s&&i.attachShader(r,o),i.deleteShader(o),!s)throw Error(l||"Could not compile the display shader.")}if(i.linkProgram(r),!i.getProgramParameter(r,i.LINK_STATUS))throw Error(i.getProgramInfoLog(r)||"Could not link the display shaders.");return r}catch(n){throw i.deleteProgram(r),n}}function We(i){let e,t,r,n,a,o,s,l,w,v,q,$,b,H,T,W,f;function _(){let u=e.createTexture();return e.bindTexture(e.TEXTURE_2D,u),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),u}function P(u,c,g=null){e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,u,c,0,e.RGBA,e.UNSIGNED_BYTE,g)}function D(u){u.preventDefault(),i("The WebGL2 device was lost.")}let ie={async ready(){for(;f&&e.clientWaitSync(f,0,0)===e.TIMEOUT_EXPIRED;)await new Promise(u=>requestAnimationFrame(u));f&&e.deleteSync(f),f=null},draw(u,c,g,[L,h,d,x]){let{image:S,imageWidth:N,imageHeight:B,commands:j}=u,F=Math.max(1,Math.min(N*2,Math.round(d))),C=Math.max(1,Math.min(B*2,Math.round(x))),O=F!==T||C!==W;if(e.useProgram(w),e.disable(e.BLEND),e.bindVertexArray(null),S){let U=new Uint8Array(S);e.bindTexture(e.TEXTURE_2D,n),b!==N||H!==B?(P(N,B,U),b=N,H=B):e.texSubImage2D(e.TEXTURE_2D,0,0,0,N,B,e.RGBA,e.UNSIGNED_BYTE,U)}O&&(e.bindTexture(e.TEXTURE_2D,a),P(F,C),T=F,W=C),(S||O)&&(e.bindFramebuffer(e.FRAMEBUFFER,o),e.viewport(0,0,F,C),e.bindTexture(e.TEXTURE_2D,n),e.uniform1i(q,1),e.drawArrays(e.TRIANGLES,0,3)),e.bindFramebuffer(e.FRAMEBUFFER,null),e.clearColor(.032,.049,.077,1),e.clear(e.COLOR_BUFFER_BIT),e.viewport(Math.round(L),Math.round(g-h-x),Math.round(d),Math.round(x)),e.bindTexture(e.TEXTURE_2D,a),e.uniform1i(q,0),e.drawArrays(e.TRIANGLES,0,3),j?.byteLength&&(e.useProgram(v),e.bindVertexArray(l),e.bindBuffer(e.ARRAY_BUFFER,s),e.bufferData(e.ARRAY_BUFFER,new Uint8Array(j),e.STREAM_DRAW),e.bindTexture(e.TEXTURE_2D,r),e.uniform2f($,c,g),e.viewport(0,0,c,g),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA),e.drawArraysInstanced(e.TRIANGLE_STRIP,0,4,j.byteLength/64)),f=e.fenceSync(e.SYNC_GPU_COMMANDS_COMPLETE,0),e.flush()},dispose(){t.removeEventListener("webglcontextlost",D)}};return{attach(u){if(t=u,e=t.getContext("webgl2",{alpha:!1,antialias:!1}),!e)throw Error("The editor requires WebGPU or WebGL 2.");t.addEventListener("webglcontextlost",D),w=Te(e,Ve,Xe),v=Te(e,$e,He),q=e.getUniformLocation(w,"reconstruct"),$=e.getUniformLocation(v,"extent"),r=_(),n=_(),a=_(),o=e.createFramebuffer(),e.bindFramebuffer(e.FRAMEBUFFER,o),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,a,0),e.bindFramebuffer(e.FRAMEBUFFER,null),s=e.createBuffer(),l=e.createVertexArray(),e.bindVertexArray(l),e.bindBuffer(e.ARRAY_BUFFER,s);for(let c=0;c<5;++c)e.enableVertexAttribArray(c),e.vertexAttribDivisor(c,1);for(let c=0;c<3;++c)e.vertexAttribPointer(c,4,e.FLOAT,!1,64,c*16);return e.vertexAttribIPointer(3,2,e.UNSIGNED_INT,64,48),e.vertexAttribPointer(4,1,e.FLOAT,!1,64,56),e.bindVertexArray(null),ie},setAtlas(u,c,g,L=g){e.bindTexture(e.TEXTURE_2D,r),L===g?P(c,g,new Uint8Array(u)):(P(c,g),e.texSubImage2D(e.TEXTURE_2D,0,0,0,c,L,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array(u)))},dispose(){e&&(f&&e.deleteSync(f),f=null,e.deleteTexture(n),e.deleteTexture(a),e.deleteTexture(r),e.deleteFramebuffer(o),e.deleteBuffer(s),e.deleteVertexArray(l),e.deleteProgram(w),e.deleteProgram(v),t.removeEventListener("webglcontextlost",D))}}}var I=document.documentElement,he=document.querySelector(".editor"),E=document.querySelector("canvas"),ve=document.querySelector(".controls"),m=ve.querySelector("input"),Oe=document.querySelector("[data-editor-chrome]"),je=document.querySelector(".safe-area"),Ye=document.querySelector("footer > [role=status]"),ye=document.querySelector("#upgrade");var we=K,be=new URLSearchParams(location.search),Ee=be.get("profile")==="1",Ke=be.get("backend")??"auto",te=!0,z,k,Z;var oe,ge,p,A,X=!1,y=!1;var Qe=!1;var ee=!1,Q=!1,G,se,Je,Ue;function M(i){Ye.textContent=i}function ke(){return"Export in the full version."}function Pe(i,[e,t,r,n]){Object.assign(i.style,{left:`${e}px`,top:`${t}px`,width:`${r}px`,height:`${n}px`})}var J=new Map;function qe(i){i.disabled=i.dataset.disabled==="true",X?i.setAttribute("aria-disabled","true"):i.removeAttribute("aria-disabled")}function le(i){X=i;for(let e of J.values())qe(e)}function Be(i){let e=new Set;for(let t of i.controls){let r=J.get(t.id);r||(r=document.createElement("button"),r.type="button",r.addEventListener("click",()=>{_e(t.id)}),J.set(t.id,r),ve.insertBefore(r,m)),r.textContent!==t.label&&(r.textContent=t.label),Pe(r,t.box),r.hidden=!1,r.dataset.disabled=String(t.state===2),qe(r),t.state===1?r.setAttribute("aria-pressed","true"):r.removeAttribute("aria-pressed"),e.add(t.id)}for(let[t,r]of J)r.hidden=!e.has(t);if(i.field){let t=m.hidden;Pe(m,i.field),m.hidden=!1,m.setAttribute("aria-invalid",String(i.textError)),t&&(m.value=i.draft,m.focus(),m.select())}else m.hidden=!0,m.value=""}function De(){let i=Ue??he.getBoundingClientRect(),e=Math.max(1,Math.round(i.width)),t=Math.max(1,Math.round(i.height)),r=getComputedStyle(je),n=["paddingLeft","paddingTop","paddingRight","paddingBottom"].map(o=>parseFloat(r[o])||0);n[1]=Math.min(t,Math.max(n[1],Oe.getBoundingClientRect().bottom-i.top));let a=Math.min(devicePixelRatio,2,4096/Math.max(e,t));return{width:e,height:t,insets:n,scale:a,touch:matchMedia("(pointer: coarse)").matches}}function Ze(i){return y?Promise.reject(new Error("The editor has closed.")):A?Promise.reject(new Error("The renderer is already drawing.")):new Promise((e,t)=>{A={frame:i,resolve:e,reject:t},z.resume()})}async function ue(i={}){let e=!p,t=await Ze({view:De(),chromeHidden:Q,...i});if(t.profile){for(let[a,o]of[["coordinator",t.profile.coordinator],...t.profile.trace.map((s,l)=>[`trace-${l}`,s])])for(let{name:s,time:l}of o)performance.mark(`snowman:${a}:${s.slice(8)}`,{startTime:l-performance.timeOrigin});e&&performance.mark("snowman:first-reply")}p=t;{if(await Z.ready?.(),(e||i.refine)&&await new Promise(l=>requestAnimationFrame(l)),y)return t;t.atlas&&k.setAtlas(t.atlas.buffer,t.atlas.width,t.atlas.height,t.atlas.rows);let{pixelWidth:a,pixelHeight:o,rect:s}=t.view;E.width!==a&&(E.width=a),E.height!==o&&(E.height=o),Z.draw(t,a,o,s),t.profile&&e&&performance.mark("snowman:first-submit")}let r=te&&!i.refine,n=t.field&&m.hidden;return r&&!n&&Be(t),e&&await new Promise(a=>requestAnimationFrame(()=>requestAnimationFrame(a))),r&&n&&Be(t),t.profile&&e&&performance.mark("snowman:first-present"),I.dataset.state="drawn",I.dataset.scene=we[t.scene],I.dataset.daylight=String(t.daylight),I.dataset.revision=String(t.revision),I.dataset.previewSamples=String(t.previewSamples),t}async function _e(i,e){let t=J.get(i);if(y||X||t?.disabled)return;if(t?.textContent==="Image"||t?.textContent==="Render video"){ye.showModal();return}if(t?.textContent==="Privacy policy"||t?.textContent==="Support"){let n=t.textContent==="Support"?"support":"privacy";window.open(new URL(`./${n}.html`,location.href),"_blank","noopener");return}let r={id:i,...e};if(i===p?.done){if(new TextEncoder().encode(m.value).length>=128){m.setAttribute("aria-invalid","true"),M("That text is too long.");return}r.text=m.value}t?.textContent&&we.includes(t.textContent)&&M("Drawing scene\u2026"),le(!0);try{G&&await G,(await ue({action:r})).textError?(M("Use one non-empty line for overlay text. Candle greetings must fit the available letters."),m.focus()):M(ke())}catch(n){M(n.message)}finally{le(!1),re(),V()}}function re(){!ee||X||y||!p||G||(ee=!1,le(!0),ue().catch(i=>M(i.message)).finally(()=>{le(!1),re(),V()}))}function xe(){let i=p?.view,{width:e,height:t,scale:r,insets:n}=De();(!te||!i||i.width!==e||i.height!==t||i.scale!==r||n.some((a,o)=>a!==i.insets[o]))&&(ee=!0,re())}function Le(){ge=matchMedia(`(resolution: ${devicePixelRatio}dppx)`),ge.addEventListener("change",Ie,{once:!0})}function Ie(){Le(),xe()}function Fe(){return!y&&!X&&!ee&&!document.hidden&&!!p?.moreSamples&&!p.field&&!ye.open}function V(){G||se||!Fe()||(se=setTimeout(()=>{se=void 0,Fe()&&(G=ue({refine:!0}).catch(i=>{y||console.warn("Preview refinement:",i.message),p&&(p.moreSamples=!1)}).finally(()=>{G=void 0,re(),V()}))},450))}m.addEventListener("keydown",i=>{i.isComposing||(i.key==="Enter"||i.key==="Escape")&&(i.preventDefault(),_e(i.key==="Enter"?p.done:p.cancel))});{document.addEventListener("visibilitychange",V),ye.addEventListener("close",V);let i=document.querySelector("#toggle-controls");i.addEventListener("click",()=>{!p||p.field||X||y||(Q=!Q,i.textContent=Q?"Show controls":"Hide controls",ee=!0,re())})}function Se(){oe?.disconnect(),ge?.removeEventListener("change",Ie),clearTimeout(se),A?.reject(new Error("The editor has closed.")),A=void 0,z?.destroy(),Z?.dispose(),k?.dispose()}function ce(i){y||(y=!0,I.dataset.state="error",M(i),ve.hidden=!0,Se())}addEventListener("pagehide",({persisted:i})=>{i||(y=!0,Se())});function Ce(i){return new Promise((e,t)=>{z=new ae(E,new URL("./cottage-worker.mjs",import.meta.url),{presenter:{submit(){}},paceRequests:!0,frameInput:()=>A.frame,onStatus(r){if(r.type==="ready")Je=[r.width,r.height],z.resize(r.width,r.height),e();else if(r.type==="frame"){z.stop();let n=A;A=void 0,n.resolve(r)}},onError(r){let n=A;A=void 0,n?n.reject(new Error(r)):p?ce(r):t(new Error(r))}}),z.init({editor:te,software:i,concurrency:navigator.hardwareConcurrency,profile:Ee,uncachedScene:be.get("scene-cache")==="off"})})}try{let i=Ce(!1);i?.catch(()=>{});let e=new Promise(r=>{oe=new ResizeObserver(n=>{let a=n.find(o=>o.target===he);a&&(Ue=a.contentRect,r()),p&&xe()}),oe.observe(he),oe.observe(Oe)});Ee&&performance.mark("snowman:gpu-start");let t=Ke;if(t!=="webgl2")try{k=await Me(ce),Z=k.attach(E),t="webgpu"}catch(r){if(t==="webgpu")throw r;k?.dispose();let n=E.cloneNode();E.replaceWith(n),E=n,t="webgl2"}t==="webgl2"&&(k=We(ce),Z=k.attach(E)),E.addEventListener("click",r=>{Q||_e(-1,{x:r.offsetX,y:r.offsetY})}),y?Se():(E.dataset.backend=t,Ee&&performance.mark("snowman:gpu-ready"),te&&(E.dataset.ui=t),await Promise.all([i??Ce(t==="canvas2d"),e]),await ue(),M(ke()),Le(),xe(),V())}catch(i){ce(i.message)}
