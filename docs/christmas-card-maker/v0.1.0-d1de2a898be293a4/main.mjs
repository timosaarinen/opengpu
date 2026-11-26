var Ee=Object.defineProperty;var ne=(i,e)=>()=>(i&&(e=i(i=0)),e);var be=(i,e)=>{for(var r in e)Ee(i,r,{get:e[r],enumerable:!0})};var _,p=ne(()=>{_=["Cottage","Riverlight"]});var oe={};be(oe,{createCanvasPainter:()=>Ce});function ae(i,e,r,t,n){i.width!==t&&(i.width=t),i.height!==n&&(i.height=n),e.putImageData(new ImageData(new Uint8ClampedArray(r),t,n),0,0)}function Ce(){return{attach(i){let e=i.getContext("2d",{alpha:!1});if(!e)throw new Error("The browser could not create a Canvas2D editor.");let r=document.createElement("canvas"),t=document.createElement("canvas"),n=r.getContext("2d",{alpha:!1}),c=t.getContext("2d");return{draw(a,f,h,w){ae(r,n,a.buffer,a.imageWidth,a.imageHeight),a.overlay&&ae(t,c,a.overlay,f,h),e.setTransform(i.width/f,0,0,i.height/h,0,0),e.fillStyle="#080d14",e.fillRect(0,0,f,h),e.drawImage(r,...w),e.drawImage(t,0,0)},dispose(){r.width=r.height=t.width=t.height=1}}},dispose(){}}}var ce=ne(()=>{p()});p();p();var F=class{constructor(e,r,{onStatus:t=()=>{},onError:n=()=>{},onCompile:c=()=>{},frameInput:a=()=>({}),maxFps:f=0,presenter:h=null}={}){this.canvas=e,this.presenter=h,this.context=h?null:e.getContext("2d",{alpha:!1}),this.onStatus=t,this.onError=n,this.onCompile=c,this.frameInput=a,this.minimumFrameMs=Number.isFinite(f)&&f>0?1e3/f:0,this.lastRequest=-1/0,this.worker=new Worker(r,{type:"module"}),this.width=640,this.height=360,this.generation=0,this.frame=0,this.running=!1,this.busy=!1,this.ready=!1,this.compileId=0,this.origin=performance.now(),this.elapsed=0,this.info={},this.worker.onmessage=({data:w})=>this.receive(w),this.worker.onerror=w=>{this.stop(),this.busy=!1,this.onError(w.message)}}init(e={}){this.worker.postMessage({type:"init",...e})}compile(e){this.worker.postMessage({type:"compile",source:e,id:++this.compileId})}resize(e,r){if(!Number.isInteger(e)||!Number.isInteger(r)||e<1||r<1||e>1920||r>1080)throw new Error("Resolution must fit within 1920 \xD7 1080");this.width=e,this.height=r,this.generation++,this.worker.postMessage({type:"cancel"})}resume(){this.running||(this.origin=performance.now(),this.lastRequest=-1/0,this.running=!0,this.schedule())}stop(){this.running&&(this.elapsed+=(performance.now()-this.origin)/1e3),this.running=!1,this.generation++,this.worker.postMessage({type:"cancel"}),cancelAnimationFrame(this.raf),clearTimeout(this.timer)}schedule(){if(!this.running||!this.ready||this.busy)return;let e=r=>{if(!this.running||this.busy)return;if(this.presenter?.pending>=2||r-this.lastRequest+.1<this.minimumFrameMs){this.schedule();return}this.lastRequest=r;let t=this.elapsed+(performance.now()-this.origin)/1e3;this.busy=!0;let n={...this.frameInput({time:t,frame:this.frame}),type:"frame",width:this.width,height:this.height,generation:this.generation,time:t,frame:this.frame++,buffer:this.buffer};this.buffer=void 0,this.worker.postMessage(n,n.buffer?[n.buffer]:[])};if(this.presenter){let r=Math.max(this.presenter.pending>=2?4:0,this.minimumFrameMs-(performance.now()-this.lastRequest));this.timer=setTimeout(()=>e(performance.now()),r)}else this.raf=requestAnimationFrame(e)}receive(e){if(e.type==="ready")this.info=e,this.ready=!0,this.onStatus(e),this.schedule();else if(e.type==="compiled")this.onCompile(e);else if(e.type==="error")(e.request==="frame"||e.request==="init")&&(this.busy=!1,this.stop()),this.onError(e.message,e);else if(e.type==="frame"){if(this.busy=!1,this.buffer=e.buffer,!e.cancelled&&e.generation===this.generation){let r=performance.now();if(this.presenter)try{this.presenter.stats&&(this.presenter.stats.renderCpuMs=e.renderMs),this.presenter.submit(e)}catch(t){this.stop(),this.onError(t.message);return}else(this.canvas.width!==e.width||this.canvas.height!==e.height)&&(this.canvas.width=e.width,this.canvas.height=e.height),this.context.putImageData(new ImageData(new Uint8ClampedArray(e.buffer),e.width,e.height),0,0);this.onStatus({...this.info,...e,presentMs:performance.now()-r})}this.schedule()}}destroy(){return this.disposing?this.disposing:(this.stop(),this.buffer=void 0,this.ready=!1,this.disposing=new Promise(e=>{let r=()=>{clearTimeout(t),this.worker.onmessage=null,this.worker.onerror=null,this.worker.terminate(),e()},t=setTimeout(r,3e3);this.worker.onmessage=({data:n})=>{n.type==="disposed"&&r()},this.worker.onerror=r,this.worker.postMessage({type:"dispose"})}),this.disposing)}};p();var Me=`
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
`;async function se(i){let e=navigator.gpu,r=await e?.requestAdapter();if(!r)throw new Error("A WebGPU adapter is required for the editor.");let t=await r.requestDevice(),n=!1;t.lost.then(c=>{n||i(c.message||"The WebGPU device was lost.")});try{let ee=function(u,l,b,B){t.queue.writeTexture({texture:u},l,{bytesPerRow:b*4},[b,B])},te=function(u,l){return t.createTexture({size:[u,l],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})},me=function(u,l,b){R?.destroy(),R=te(l,b),ee(R,u,l,b),A=void 0},pe=function(u){let l=u.getContext("webgpu");if(!l)throw new Error("The browser could not create a WebGPU canvas.");return l.configure({device:t,format:c,alphaMode:"opaque"}),{draw(b,B,re,[ge,we,ye,xe]){let{buffer:ve,imageWidth:D,imageHeight:G,commands:C}=b;(!v||v.width!==D||v.height!==G)&&(v?.destroy(),v=te(D,G),Z=t.createBindGroup({layout:h.getBindGroupLayout(0),entries:[{binding:0,resource:X},{binding:1,resource:v.createView()}]})),ee(v,ve,D,G);let V=u.width/B,L=u.height/re,ie=t.createCommandEncoder(),m=ie.beginRenderPass({colorAttachments:[{view:l.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[.032,.049,.077,1]}]});m.setViewport(ge*V,we*L,ye*V,xe*L,0,1),m.setPipeline(h),m.setBindGroup(0,Z),m.draw(3),C?.byteLength&&((!E||E.size<C.byteLength)&&(E?.destroy(),E=t.createBuffer({size:Math.max(C.byteLength,(E?.size??0)*2,16*1024),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),A=void 0),A??=t.createBindGroup({layout:w.getBindGroupLayout(0),entries:[{binding:0,resource:X},{binding:2,resource:R.createView()},{binding:3,resource:{buffer:J}},{binding:4,resource:{buffer:E}}]}),t.queue.writeBuffer(J,0,new Float32Array([B,re,1/V,1/L])),t.queue.writeBuffer(E,0,C),m.setViewport(0,0,u.width,u.height,0,1),m.setPipeline(w),m.setBindGroup(0,A),m.draw(4,C.byteLength/64)),m.end(),t.queue.submit([ie.finish()])},dispose(){l.unconfigure()}}},c=e.getPreferredCanvasFormat(),a=t.createShaderModule({code:Me}),f={srcFactor:"one",dstFactor:"one-minus-src-alpha"},[h,w]=await Promise.all([t.createRenderPipelineAsync({layout:"auto",vertex:{module:a,entryPoint:"sceneVertex"},fragment:{module:a,entryPoint:"scenePixel",targets:[{format:c}]}}),t.createRenderPipelineAsync({layout:"auto",primitive:{topology:"triangle-strip"},vertex:{module:a,entryPoint:"uiVertex"},fragment:{module:a,entryPoint:"uiPixel",targets:[{format:c,blend:{color:f,alpha:f}}]}})]),X=t.createSampler({minFilter:"linear",magFilter:"linear"}),J=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),v,Z,R,A,E;return{attach:pe,setAtlas:me,dispose(){n=!0,t.destroy()}}}catch(c){throw n=!0,t.destroy(),c}}var N=document.documentElement,le=document.querySelector(".editor"),o=document.querySelector("canvas"),H=document.querySelector(".controls"),s=H.querySelector("input"),_e=document.querySelector("footer > [role=status]"),Ne=document.querySelector("#upgrade");var T=_,qe=new URLSearchParams(location.search),We=qe.get("backend")??"auto",q=!0,M,S,O;var j,d,g,P=!1,x=!1;var ke=!1;var U=!1,W=!1;function y(i){_e.textContent=i}function de(){return T[d.scene]}function ue(i,[e,r,t,n]){Object.assign(i.style,{left:`${e}px`,top:`${r}px`,width:`${t}px`,height:`${n}px`})}var k=new Map;function fe(i){i.disabled=i.dataset.disabled==="true",P?i.setAttribute("aria-disabled","true"):i.removeAttribute("aria-disabled")}function z(i){P=i;for(let e of k.values())fe(e)}function Pe(i){let e=new Set;for(let r of i.controls){let t=k.get(r.id);t||(t=document.createElement("button"),t.type="button",t.addEventListener("click",()=>{K(r.id)}),k.set(r.id,t),H.insertBefore(t,s)),t.textContent=r.label,ue(t,r.box),t.hidden=!1,t.dataset.disabled=String(r.state===2),fe(t),r.state===1?t.setAttribute("aria-pressed","true"):t.removeAttribute("aria-pressed"),e.add(r.id)}for(let[r,t]of k)t.hidden=!e.has(r);if(i.field){let r=s.hidden;ue(s,i.field),s.hidden=!1,s.setAttribute("aria-invalid",String(i.textError)),r&&(s.value=i.draft,s.focus(),s.select())}else s.hidden=!0,s.value=""}function he(){let{width:i,height:e}=le.getBoundingClientRect(),r=4096;return{width:Math.min(r,Math.max(320,Math.round(i))),height:Math.min(r,Math.max(256,Math.round(e))),touch:matchMedia("(pointer: coarse)").matches}}function Re(i,e){let r=Math.min(devicePixelRatio,4096/Math.max(i,e)),t=Math.max(1,Math.round(i*r)),n=Math.max(1,Math.round(e*r));o.width!==t&&(o.width=t),o.height!==n&&(o.height=n)}function Ae(i){return x?Promise.reject(new Error("The editor has closed.")):g?Promise.reject(new Error("The renderer is already drawing.")):new Promise((e,r)=>{g={frame:i,resolve:e,reject:r},M.resume()})}async function Y(i={}){let e=await Ae({view:he(),chromeHidden:W,...i});d=e;{e.atlas&&S.setAtlas(e.atlas.buffer,e.atlas.width,e.atlas.height);let{width:r,height:t,rect:n}=e.view;Re(r,t),O.draw(e,r,t,n)}return await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),q&&Pe(e),N.dataset.state="drawn",N.dataset.scene=T[e.scene],N.dataset.daylight=String(e.daylight),N.dataset.revision=String(e.revision),e}async function K(i,e){let r=k.get(i);if(x||P||r?.disabled)return;if(r?.textContent==="Image"||r?.textContent==="Render video"){Ne.showModal();return}if(r?.textContent==="Privacy policy"||r?.textContent==="Support"){let n=r.textContent==="Support"?"support":"privacy";window.open(new URL(`./${n}.html`,location.href),"_blank","noopener");return}let t={id:i,...e};if(i===d?.done){if(new TextEncoder().encode(s.value).length>=128){s.setAttribute("aria-invalid","true"),y("That text is too long.");return}t.text=s.value}r?.textContent&&T.includes(r.textContent)&&y("Drawing scene\u2026"),z(!0);try{(await Y({action:t})).textError?(y("Use one non-empty line for overlay text. Candle greetings must fit the available letters."),s.focus()):y(de())}catch(n){y(n.message)}finally{z(!1),I()}}function I(){!U||P||x||!d||(U=!1,z(!0),Y().catch(i=>y(i.message)).finally(()=>{z(!1),I()}))}s.addEventListener("keydown",i=>{i.isComposing||(i.key==="Enter"||i.key==="Escape")&&(i.preventDefault(),K(i.key==="Enter"?d.done:d.cancel))});{let i=document.querySelector("#toggle-controls");i.addEventListener("click",()=>{!d||d.field||P||x||(W=!W,i.textContent=W?"Show controls":"Hide controls",U=!0,I())})}function Q(){j?.disconnect(),g?.reject(new Error("The editor has closed.")),g=void 0,M?.destroy(),O?.dispose(),S?.dispose()}function $(i){x||(x=!0,N.dataset.state="error",y(i),H.hidden=!0,Q())}addEventListener("pagehide",({persisted:i})=>{i||(x=!0,Q())});try{let i=We;if(i!=="canvas2d")try{S=await se($),O=S.attach(o),i="webgpu"}catch(e){if(i==="webgpu")throw e;S?.dispose();let r=o.cloneNode();o.replaceWith(r),o=r,i="canvas2d"}if(i==="canvas2d"){let{createCanvasPainter:e}=await Promise.resolve().then(()=>(ce(),oe));S=e(),O=S.attach(o)}o.addEventListener("click",e=>{W||K(-1,{x:e.offsetX,y:e.offsetY})}),x?Q():(o.dataset.backend=i,q&&(o.dataset.ui=i),await new Promise((e,r)=>{M=new F(o,new URL("./cottage-worker.mjs",import.meta.url),{presenter:{submit(){}},frameInput:()=>g.frame,onStatus(t){if(t.type==="ready")M.resize(t.width,t.height),e();else if(t.type==="frame"){M.stop();let n=g;g=void 0,n.resolve(t)}},onError(t){let n=g;g=void 0,n?n.reject(new Error(t)):d?$(t):r(new Error(t))}}),M.init({editor:q,software:i==="canvas2d"})}),await Y(),y(de()),j=new ResizeObserver(()=>{let e=d?.view,{width:r,height:t}=he();(!q||!e||e.width!==r||e.height!==t)&&(U=!0,I())}),j.observe(le))}catch(i){$(i.message)}
