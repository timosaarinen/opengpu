/* Tuonela Walk (c) 2026 Timo Saarinen. All rights reserved. */
const x="struct Params { size: vec2u, output: vec2u, jitter: vec2f, reset: u32, spare: u32, previousJitter:vec2f, padding:vec2f };",w=`
fn tone(v: vec3f) -> vec3f {
 let x=max(v,vec3f(0)); let a=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));
 return select(12.92*a,1.055*pow(a,vec3f(1./2.4))-.055,a>vec3f(.0031308));
}
fn luminance(c: vec3f) -> f32 { return dot(c,vec3f(.299,.587,.114)); }
`,U=`
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}`;class P{static async create(e,{onError:t=()=>{},modelBase:r=new URL("./models/",import.meta.url)}={}){if(!navigator.gpu)throw Error("WebGPU is required. Use a browser with WebGPU enabled.");const s=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!s)throw Error("No WebGPU adapter is available.");const n=s.features.has("timestamp-query"),o=await s.requestDevice({requiredFeatures:n?["timestamp-query"]:[]}),a=new P(e,o,t);o.addEventListener("uncapturederror",i=>a.fail(i.error.message)),o.lost.then(i=>{a.destroyed||a.fail(`WebGPU device lost: ${i.message}`)});try{await a.initialize(r)}catch(i){throw a.destroy(),i}return a.adapter=s,a.adapterInfo={vendor:s.info.vendor,architecture:s.info.architecture,device:s.info.device,description:s.info.description},a}constructor(e,t,r){if(this.canvas=e,this.device=t,this.onError=r,this.context=e.getContext("webgpu"),!this.context)throw Error("A WebGPU canvas could not be created.");this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:t,format:this.format,alphaMode:"opaque"}),this.stats={backend:"webgpu",neural:"ESPCN x2",sources:0,generated:0,presents:0,resets:0,uploadCpuMs:0,encodeCpuMs:0,refreshHz:60,queueFull:0},t.features.has("timestamp-query")&&(this.queries=t.createQuerySet({type:"timestamp",count:2}),this.queryResult=t.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.queryRead=t.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),this.pending=0,this.serial=0,this.current=-1,this.running=!1,this.linear=t.createSampler({magFilter:"linear",minFilter:"linear"})}fail(e){this.failed||this.destroyed||(this.failed=!0,this.pause(),this.onError(e))}async compute(e,t){const r=this.device.createShaderModule({code:e,label:t}),n=(await r.getCompilationInfo()).messages.filter(o=>o.type==="error");if(n.length)throw Error(`${t}: ${n.map(o=>o.message).join("; ")}`);return this.device.createComputePipelineAsync({label:t,layout:"auto",compute:{module:r,entryPoint:"main"}})}async initialize(e){const t=await(await fetch(new URL("espcn-x2.json",e))).json(),r=await(await fetch(new URL("espcn-x2.bin",e))).arrayBuffer(),s=[...new Uint8Array(await crypto.subtle.digest("SHA-256",r))].map(i=>i.toString(16).padStart(2,"0")).join("");if(r.byteLength!==t.bytes||s!==t.sha256)throw Error("Neural weights failed integrity validation.");this.model=t,this.weights=this.device.createBuffer({size:r.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.weights,0,r),this.params=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.displayParams=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.luma=await this.compute(`${x}${w}
@group(0) @binding(0) var input: texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> output: array<vec4f>;
@group(0) @binding(2) var<uniform> p: Params;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=p.size)){return;} let c=tone(textureLoad(input,vec2i(id.xy),0).rgb);
 output[id.y*p.size.x+id.x]=vec4f(luminance(c),0,0,0);
}`,"neural input"),this.convolutions=[];for(const i of t.layers){const{kernel:h,inputs:u,outputs:d,weightOffset:m,biasOffset:p}=i,v=Array.from({length:Math.min(u,4)},(f,c)=>`
 let w${c}=base+${c*d}u;
 sum+=v[${c}]*vec4f(weights[w${c}],weights[w${c}+1],weights[w${c}+2],weights[w${c}+3]);`).join("");this.convolutions.push(await this.compute(`${x}
@group(0) @binding(0) var<storage,read> input: array<vec4f>;
@group(0) @binding(1) var<storage,read_write> output: array<vec4f>;
@group(0) @binding(2) var<storage,read> weights: array<f32>;
@group(0) @binding(3) var<uniform> p: Params;
@compute @workgroup_size(8,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=p.size.x*${d/4}u||id.y>=p.size.y){return;}
 let pixel=vec2u(id.x/${d/4}u,id.y);let group=id.x%${d/4}u;
 let channel=group*4; var sum=vec4f(weights[${p}u+channel],weights[${p+1}u+channel],weights[${p+2}u+channel],weights[${p+3}u+channel]);
 for(var y=0;y<${h};y++){for(var x=0;x<${h};x++){
 let q=vec2i(pixel)+vec2i(x,y)-vec2i(${h>>1});
 if(any(q<vec2i(0))||any(q>=vec2i(p.size))){continue;}
 for(var g=0u;g<${Math.ceil(u/4)}u;g++){
 let v=input[(u32(q.y)*p.size.x+u32(q.x))*${Math.ceil(u/4)}u+g];
 let base=${m}u+((u32(y)*${h}u+u32(x))*${u}u+g*4)*${d}u+channel;
 ${v}
 }}}
 output[(pixel.y*p.size.x+pixel.x)*${d/4}u+group]=${i.activation==="relu"?"max(sum,vec4f(0))":"tanh(sum)"};
}`,`ESPCN convolution ${this.convolutions.length+1}`))}this.resolveLayout=this.device.createBindGroupLayout({entries:[...[0,1,2,3,4,5].map(i=>({binding:i,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:i===2||i===5?"unfilterable-float":"float"}})),{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"rgba16float"}},{binding:8,visibility:GPUShaderStage.COMPUTE,sampler:{type:"filtering"}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const n=`${x}${w}
@group(0) @binding(0) var raw: texture_2d<f32>;
@group(0) @binding(1) var history: texture_2d<f32>;
@group(0) @binding(2) var depth: texture_2d<f32>;
@group(0) @binding(3) var motion: texture_2d<f32>;
@group(0) @binding(4) var reactive: texture_2d<f32>;
@group(0) @binding(5) var oldDepth: texture_2d<f32>;
@group(0) @binding(6) var<storage,read> neural: array<vec4f>;
@group(0) @binding(7) var output: texture_storage_2d<rgba16float,write>;
@group(0) @binding(8) var bilinear: sampler;
@group(0) @binding(9) var<uniform> p: Params;
fn learnedAt(q:vec2i)->f32 {
 let v=clamp(q,vec2i(0),vec2i(p.size*2)-1);
 return neural[(u32(v.y)/2)*p.size.x+u32(v.x)/2][u32(v.y%2)*2+u32(v.x%2)];
}
fn at(uv:vec2f)->vec2i {return clamp(vec2i(uv*vec2f(p.size)),vec2i(0),vec2i(p.size)-1);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=p.output)){return;}
 let uv=(vec2f(id.xy)+.5)/vec2f(p.output);
 let source=uv-p.jitter/vec2f(p.size);
 let rgb=tone(textureSampleLevel(raw,bilinear,source,0).rgb);
 /* TensorFlow NHWC depth_to_space: channel = dy*2+dx. */
 let q=source*vec2f(p.size*2)-.5;let loq=vec2i(floor(q));let fraction=fract(q);
 let y=clamp(mix(mix(learnedAt(loq),learnedAt(loq+vec2i(1,0)),fraction.x),
   mix(learnedAt(loq+vec2i(0,1)),learnedAt(loq+vec2i(1,1)),fraction.x),fraction.y),0.,1.);
 var low=luminance(rgb);var high=low;
 let centre=at(source);
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let value=luminance(tone(textureLoad(raw,clamp(centre+vec2i(dx,dy),vec2i(0),vec2i(p.size)-1),0).rgb));
  low=min(low,value);high=max(high,value);
 }}
 let bound=max(.002,(high-low)*.35);
 let residual=select(clamp(y-luminance(rgb),-bound,bound),0.,p.spare==1u);
 // Flat sky does not need learned detail; suppress pixel-shuffle patterning there.
 var c=clamp(rgb+vec3f(select(residual,0.,textureLoad(depth,centre,0).x==0.)),vec3f(0),vec3f(1));
 let ij=at(source); let mv=textureLoad(motion,ij,0).xy; let back=uv+mv;
 let z=textureLoad(depth,ij,0).x; let oz=textureLoad(oldDepth,at(back-p.previousJitter/vec2f(p.size)),0).x;
 let sensitive=textureLoad(reactive,ij,0).x>0.;
 if(p.reset==0u&&!sensitive&&all(back>vec2f(0))&&all(back<vec2f(1))&&abs(z-oz)<max(.15,z*.025)){
  var lo=c;var hi=c;
  for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
   let n=tone(textureLoad(raw,clamp(ij+vec2i(dx,dy),vec2i(0),vec2i(p.size)-1),0).rgb);
   lo=min(lo,n);hi=max(hi,n);
  }}
  let h=clamp(textureSampleLevel(history,bilinear,back,0).rgb,lo,hi);
  c=mix(c,h,.65);
 }
 textureStore(output,vec2i(id.xy),vec4f(c,1));
}`,o=this.device.createShaderModule({code:n,label:"temporal reconstruction"});this.resolve=await this.device.createComputePipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.resolveLayout]}),compute:{module:o,entryPoint:"main"}}),this.presentLayout=this.device.createBindGroupLayout({entries:[...[0,1,2,3,4,5].map(i=>({binding:i,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:i===3||i===4?"unfilterable-float":"float"}})),{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:7,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const a=`${U}
@group(0) @binding(0) var current: texture_2d<f32>;
@group(0) @binding(1) var previous: texture_2d<f32>;
@group(0) @binding(2) var motion: texture_2d<f32>;
@group(0) @binding(3) var depth: texture_2d<f32>;
@group(0) @binding(4) var oldDepth: texture_2d<f32>;
@group(0) @binding(5) var reactive: texture_2d<f32>;
@group(0) @binding(6) var bilinear: sampler;
struct Display { screen:vec4f, jitter:vec4f };
@group(0) @binding(7) var<uniform> p: Display;
fn at(uv:vec2f)->vec2i{return clamp(vec2i(uv*vec2f(textureDimensions(depth))),vec2i(0),vec2i(textureDimensions(depth))-1);}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let uv=pos.xy/p.screen.xy; let t=p.screen.z;
 if(p.screen.w==0.||t>=1.){return vec4f(textureSampleLevel(current,bilinear,uv,0).rgb,1);}
 var q=uv;
 for(var i=0;i<2;i++){q=uv-(1.-t)*textureLoad(motion,at(q-p.jitter.xy),0).xy;}
 let mv=textureLoad(motion,at(q-p.jitter.xy),0).xy;let back=q+mv;
 let z=textureLoad(depth,at(q-p.jitter.xy),0).x; let oz=textureLoad(oldDepth,at(back-p.jitter.zw),0).x;
 if(any(q<vec2f(0))||any(q>vec2f(1))||any(back<vec2f(0))||any(back>vec2f(1))||
 textureLoad(reactive,at(q-p.jitter.xy),0).x>0.||abs(z-oz)>max(.15,z*.025)){
  return vec4f(select(textureSampleLevel(previous,bilinear,uv,0).rgb,
   textureSampleLevel(current,bilinear,uv,0).rgb,t>=.5),1);
 }
 let a=textureSampleLevel(previous,bilinear,back,0).rgb;
 let b=textureSampleLevel(current,bilinear,q,0).rgb;
 return vec4f(mix(a,b,t),1);
}`;this.present=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.presentLayout]}),vertex:{module:this.device.createShaderModule({code:a}),entryPoint:"vertex"},fragment:{module:this.device.createShaderModule({code:a}),entryPoint:"fragment",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}resources(e,t){const r=this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight),s=Math.max(16,Math.min(1080,Math.round(this.canvas.clientHeight*devicePixelRatio))),n=Math.max(16,Math.min(1920,Math.round(s*r)));if(this.width===e&&this.height===t&&this.outputWidth===n&&this.outputHeight===s)return;if(e*t*64*4>this.device.limits.maxStorageBufferBindingSize)throw Error("Trace extent exceeds the neural tensor budget.");for(const a of this.slots||[])for(const i of Object.values(a))i.destroy();for(const a of this.tensors||[])a.destroy();const o=(a,i=e,h=t,u=!1)=>this.device.createTexture({size:[i,h],format:a,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|(u?GPUTextureUsage.STORAGE_BINDING:0)});this.slots=Array.from({length:2},()=>({colour:o("rgba16float"),depth:o("r32float"),motion:o("rg16float"),reactive:o("r8unorm"),image:o("rgba16float",n,s,!0)})),this.tensors=[4,64,32,4].map(a=>this.device.createBuffer({size:e*t*a*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC})),this.width=e,this.height=t,this.current=-1,this.stats.traceWidth=e,this.stats.traceHeight=t,this.outputWidth=n,this.outputHeight=s,this.stats.reconstructionWidth=n,this.stats.reconstructionHeight=s,this.stats.resets++}group(e,t,r=e.getBindGroupLayout(0)){return this.device.createBindGroup({layout:r,entries:t.map((s,n)=>({binding:n,resource:s instanceof GPUBuffer?{buffer:s}:s instanceof GPUTexture?s.createView():s}))})}dispatch(e,t,r,s,n,o=1,a=void 0){const i=e.beginComputePass({timestampWrites:a});i.setPipeline(t),i.setBindGroup(0,r),i.dispatchWorkgroups(s,n,o),i.end()}submit(e){if(this.failed||this.destroyed)return;if(this.pending>=2){this.stats.queueFull++;return}const t=performance.now(),{width:r,height:s}=e,n=r*s;this.resources(r,s);const o=this.current<0?1:this.current,a=this.current<0?0:1-this.current,i=this.slots[a],h=this.slots[o],u=!!e.historyReset||this.current<0||!this.running||this.needsReset;this.needsReset=!1;const d=new Uint8Array(e.buffer);for(const[l,g,b]of[["colour",0,8],["depth",n*8,4],["motion",n*12,4],["reactive",n*16,1]])this.device.queue.writeTexture({texture:i[l]},d.subarray(g,g+n*b),{bytesPerRow:r*b},[r,s]);this.stats.uploadCpuMs=performance.now()-t;const m=new ArrayBuffer(48),p=new Uint32Array(m),v=new Float32Array(m);p.set([r,s,this.outputWidth,this.outputHeight]),v[4]=e.jitter?.[0]||0,v[5]=e.jitter?.[1]||0,p[6]=+u,p[7]=+!!e.spatialReference,v[8]=this.jitter?.[0]||0,v[9]=this.jitter?.[1]||0,this.device.queue.writeBuffer(this.params,0,m);const f=this.device.createCommandEncoder({label:"neural + temporal source"}),c=this.queries&&!this.readingTime&&performance.now()-(this.lastTiming||-1e3)>=1e3;c&&(this.readingTime=!0,this.lastTiming=performance.now()),e.spatialReference||(this.dispatch(f,this.luma,this.group(this.luma,[i.colour,this.tensors[0],this.params]),Math.ceil(r/8),Math.ceil(s/8),1,c?{querySet:this.queries,beginningOfPassWriteIndex:0}:void 0),this.convolutions.forEach((l,g)=>this.dispatch(f,l,this.group(l,[this.tensors[g],this.tensors[g+1],this.weights,this.params]),Math.ceil(r*(this.model.layers[g].outputs/4)/8),Math.ceil(s/4)))),this.dispatch(f,this.resolve,this.group(this.resolve,[i.colour,h.image,i.depth,i.motion,i.reactive,h.depth,this.tensors[3],i.image,this.linear,this.params],this.resolveLayout),Math.ceil(this.outputWidth/8),Math.ceil(this.outputHeight/8),1,c?{querySet:this.queries,...e.spatialReference?{beginningOfPassWriteIndex:0}:{},endOfPassWriteIndex:1}:void 0),c&&(f.resolveQuerySet(this.queries,0,2,this.queryResult,0),f.copyBufferToBuffer(this.queryResult,0,this.queryRead,0,16)),this.device.queue.submit([f.finish()]),c&&this.queryRead.mapAsync(GPUMapMode.READ).then(()=>{const l=new BigUint64Array(this.queryRead.getMappedRange());this.stats.reconstructionGpuMs=Number(l[1]-l[0])/1e6,this.queryRead.unmap(),this.readingTime=!1}).catch(l=>{this.readingTime=!1,this.destroyed||this.fail(l.message)}),this.pending++,this.device.queue.onSubmittedWorkDone().then(()=>this.pending--).catch(l=>this.fail(l.message)),this.stats.encodeCpuMs=performance.now()-t-this.stats.uploadCpuMs,this.stats.neural=e.spatialReference?"none (spatial reference)":"ESPCN x2",this.stats.sources++,u&&this.stats.resets++,this.previous=u?a:o,this.current=a,this.previousJitter=u?e.jitter||[0,0]:this.jitter||[0,0],this.jitter=e.jitter||[0,0];const y=performance.now();this.interval=Math.max(8,Math.min(250,y-(this.arrived||y-33.333))),this.arrived=y,this.canGenerate=!u,this.serial++,this.lastPresented="",this.running||this.draw(y,!0)}draw(e,t=!1){if(this.current<0||this.failed||this.pending>=2)return;const r=Math.max(1,Math.min(3840,Math.round(this.canvas.clientWidth*devicePixelRatio))),s=Math.max(1,Math.min(2160,Math.round(this.canvas.clientHeight*devicePixelRatio)));(this.canvas.width!==r||this.canvas.height!==s)&&(this.canvas.width=r,this.canvas.height=s);const n=t||!this.canGenerate?1:Math.min(1,Math.max(0,(e-this.arrived)/this.interval)),o=`${this.serial}:${n===1?"real":Math.round(n*1e4)}`;if(o===this.lastPresented)return;const a=this.slots[this.current],i=this.slots[this.previous];this.device.queue.writeBuffer(this.displayParams,0,new Float32Array([r,s,n,+this.canGenerate,this.jitter[0]/this.width,this.jitter[1]/this.height,this.previousJitter[0]/this.width,this.previousJitter[1]/this.height]));const h=this.device.createCommandEncoder({label:n<1?"generated presentation":"source presentation"}),u=h.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store"}]});u.setPipeline(this.present),u.setBindGroup(0,this.group(this.present,[a.image,i.image,a.motion,a.depth,i.depth,a.reactive,this.linear,this.displayParams],this.presentLayout)),u.draw(3),u.end(),this.device.queue.submit([h.finish()]),this.pending++,this.device.queue.onSubmittedWorkDone().then(()=>this.pending--).catch(d=>this.fail(d.message)),this.lastPresented=o,this.stats.presents++,n>0&&n<1&&this.stats.generated++}resume(){if(this.running||this.failed)return;this.running=!0,this.canGenerate=!1,this.needsReset=!0,this.lastTick=0;const e=t=>{if(this.running){if(this.lastTick){const r=t-this.lastTick;r>2&&r<60&&(this.refreshMs=this.refreshMs?this.refreshMs*.95+r*.05:r,this.stats.refreshHz=1e3/this.refreshMs)}this.lastTick=t;try{this.draw(t)}catch(r){this.fail(r.message);return}this.raf=requestAnimationFrame(e)}};this.raf=requestAnimationFrame(e)}pause(){this.needsReset=!0,this.running=!1,this.canGenerate=!1,cancelAnimationFrame(this.raf)}destroy(){this.destroyed=!0,this.pause(),this.device.destroy()}}export{P as WebGPUPresenter};
