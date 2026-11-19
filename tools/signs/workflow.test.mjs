import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{createSignWorkflow}from'../../src/sign-workflow.mjs';import{signDecision,routeSignUtterance}from'../../public/lib/sign-intent.js';import{chooseImageModel,makeIllustration}from'../../src/signs.mjs';import{encodeIpp,decodeIpp,createPrinter}from'../../src/sign-printer.mjs';
const slots={eyebrow:'algorithm',headline:'Lock the door after opening',subphrase:'Except for short trips',illustration:'door',template:'directive',logo:'directive'};
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'garden-sign-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=100000;const calls=[];let failure=null;
 const printer={submit:async(file,title)=>{calls.push({bytes:await readFile(file,'utf8'),title});if(failure)throw failure;return{jobId:42,status:'submitted'};},find:async()=>null};
 const args={dir,now:()=>now,propose:async(intent,prev)=>({spec:{...(prev||slots),headline:intent},model:'fixture'}),render:async(spec,out)=>{await mkdir(out,{recursive:true});await writeFile(join(out,'print.jpg'),JSON.stringify(spec));return {illustration:{provider:'programmatic'}};},printer};
 const flow=createSignWorkflow(args);return {flow,args,calls,setFailure:e=>failure=e,advance:n=>now+=n,now:()=>now,async ready(){const s=await flow.create({slots});await flow.settled();const a=await flow.get(s.id);return flow.present({id:a.id,version:a.version,artifactHash:a.artifactHash});}};
}
const approve=(f,s,more={})=>f.approve({id:s.id,version:s.version,token:s.approval.token,source:'button',...more});
test('approved immutable artifact prints once even with concurrent duplicate events',async t=>{const x=await setup(t),s=await x.ready();await Promise.all([approve(x.flow,s),approve(x.flow,s)]);await x.flow.settled();assert.equal(x.calls.length,1);assert.deepEqual(JSON.parse(x.calls[0].bytes),{...slots,illustrationPrompt:''});assert.equal((await x.flow.get(s.id)).status,'submitted');await approve(x.flow,s);assert.equal(x.calls.length,1);});
test('revision invalidates old preview and old approval',async t=>{const x=await setup(t),s=await x.ready();await x.flow.revise({id:s.id,version:1,intent:'Keep the door secure'});await assert.rejects(approve(x.flow,s),/older preview/);await x.flow.settled();const next=await x.flow.get(s.id);assert.equal(next.version,2);assert.equal(next.spec.headline,'Keep the door secure');assert.equal(x.calls.length,0);});
test('negative, ambiguous, silence/expiry and explicit cancellation never print',async t=>{const x=await setup(t),s=await x.ready();for(const utterance of ['no','maybe','yes but change the headline','not yet',''])await assert.rejects(approve(x.flow,s,{source:'voice',utterance,startedAt:x.now()}));x.advance(90001);await assert.rejects(approve(x.flow,s),/expired/);const n=await x.flow.present({...s});await x.flow.cancel(n);await assert.rejects(approve(x.flow,n));assert.equal(x.calls.length,0);});
test('a yes begun before the current preview cannot approve it',async t=>{const x=await setup(t),s=await x.ready();await assert.rejects(approve(x.flow,s,{source:'voice',utterance:'yes',startedAt:x.now()-1}),/changed after/);await approve(x.flow,s,{source:'voice',utterance:'yes print it',startedAt:x.now()});await x.flow.settled();assert.equal(x.calls.length,1);});
test('closing/editing invalidates approval and artifact tampering is rejected',async t=>{const x=await setup(t),s=await x.ready();await x.flow.invalidate(s);await assert.rejects(approve(x.flow,s));const n=await x.flow.present(s);await writeFile(join(x.args.dir,s.id,'v1/print.jpg'),'changed');await assert.rejects(approve(x.flow,n),/artifact changed/);assert.equal(x.calls.length,0);});
test('definite printer failure can retry the same artifact after fresh approval',async t=>{const x=await setup(t),s=await x.ready();x.setFailure(Error('Printer unavailable'));await approve(x.flow,s);await x.flow.settled();assert.equal((await x.flow.get(s.id)).status,'print-failed');x.setFailure(null);const n=await x.flow.present(s);await approve(x.flow,n);await x.flow.settled();assert.equal(x.calls.length,2);assert.equal(x.calls[0].bytes,x.calls[1].bytes);assert.equal((await x.flow.get(s.id)).version,1);});
test('uncertain submissions and backend restart cannot silently print twice',async t=>{const x=await setup(t),s=await x.ready();x.setFailure(Object.assign(Error('Timeout'),{uncertain:true}));await approve(x.flow,s);await x.flow.settled();assert.equal((await x.flow.get(s.id)).status,'uncertain');const restarted=createSignWorkflow(x.args);await approve(restarted,s);assert.equal(x.calls.length,1);await assert.rejects(restarted.present(s));});
test('missing API key uses the image agent and never a hardcoded fallback',async()=>{let calls=0;const fetcher=async()=>{throw Error('unexpected API request')};const a=await makeIllustration({...slots,illustrationPrompt:'A hand locking a door'},'/tmp',{key:'',fetcher,generate:async(prompt)=>{calls++;assert.match(prompt,/hand locking/);return {provider:'openai-via-codex'};}});assert.equal(a.provider,'openai-via-codex');assert.equal(calls,1);const b=await chooseImageModel({key:'test',fetcher:async()=>({ok:false,status:403})});assert.equal(b.model,null);});
test('latest available numeric image generation is selected, explicit override respected',async()=>{const fetcher=async()=>({ok:true,json:async()=>({data:[{id:'gpt-image-2',created:10},{id:'gpt-image-2.6-flare',created:20},{id:'gpt-image-2.6-sunburst',created:20}]})});assert.equal((await chooseImageModel({key:'test',fetcher})).model,'gpt-image-2.6-flare');assert.equal((await chooseImageModel({key:'test',model:'gpt-image-2',fetcher})).model,'gpt-image-2');});
test('natural creation/revision routes stay native and ambiguity never becomes approval',()=>{assert.equal(routeSignUtterance('make a sign for the garden directive about dishes',null).input.action,'create');assert.equal(signDecision('yes, print it'),'approve');for(const s of ['yes but not yet','print it tomorrow','do not print','maybe yes'])assert.notEqual(signDecision(s),'approve');const ctx={id:'x',version:2,status:'awaiting',approval:{token:'x',issuedAt:10}};assert.equal(routeSignUtterance('make the phrase shorter',ctx,20).input.action,'revise');assert(routeSignUtterance('yes',ctx,9).error);});
test('IPP encoding preserves multivalue capabilities and rejects truncated payloads',()=>{const body=encodeIpp(0,[['formats','keyword',['image/jpeg','image/urf']],['copies','integer',1]]);const parsed=decodeIpp(body);assert.deepEqual(parsed.attributes.formats,['image/jpeg','image/urf']);assert.equal(parsed.attributes.copies,1);assert.throws(()=>decodeIpp(Buffer.from([1,1])));});
test('changed paper and unavailable printer are rejected before Print-Job',async()=>{let sent=0;const printer=createPrinter('ipp://example.test/ipp/print',{request:async(_,op)=>{if(op===2)sent++;return{status:0,attributes:{'printer-is-accepting-jobs':true,'media-default':'iso_a4_210x297mm'}};}});await assert.rejects(printer.submit('/nonexistent','job','na_letter_8.5x11in'),/paper default changed/);assert.equal(sent,0);});

test('spoken studio opening, bare descriptions and picture complaints never require typing',()=>{
 assert.equal(routeSignUtterance('Make a sign',null).input.action,'open');
 const brief={status:'brief'};
 assert.equal(routeSignUtterance('Clean mugs should go on this shelf',brief).input.action,'create');
 assert.equal(routeSignUtterance('no',brief).input.action,'cancel');
 const ready={id:'x',version:1,status:'awaiting',approval:{issuedAt:1,token:'t'}};
 for(const text of ['The picture is bad, draw a hand instead','The XML tag should be ontology','The exception for short trips is missing','Yes but make the headline shorter'])assert.equal(routeSignUtterance(text,ready,2).input.action,'revise');
 assert.equal(routeSignUtterance('maybe',ready,2).input.action,'clarify');
 assert.equal(routeSignUtterance('open weather',ready),null);
});

test('image generation failure cannot become a hardcoded placeholder',async()=>{
 await assert.rejects(makeIllustration({...slots,illustrationPrompt:'A hand turning the lock'},'/tmp',{key:'',generate:async()=>{throw Error('Image tool unavailable');}}),/Image tool unavailable/);
});

test('monochrome policy is enforced in the JPEG and IPP job group before submission',async t=>{
 const {isMonochromeJpeg}=await import('../../src/sign-printer.mjs');
 const mono=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
 assert(isMonochromeJpeg(mono));const color=Buffer.from(mono);color[11]=3;assert.equal(isMonochromeJpeg(color),false);
 const dir=await mkdtemp(join(tmpdir(),'garden-mono-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'print.jpg');await writeFile(file,mono);
 let job;const p=createPrinter('ipp://fixture/ipp/print',{request:async(uri,op,attrs,bytes,jobAttrs)=>{if(op===11)return {status:0,attributes:{'printer-is-accepting-jobs':true,'media-default':'na_letter_8.5x11in','document-format-supported':['image/jpeg'],'print-color-mode-supported':['monochrome']}};job=encodeIpp(op,attrs,jobAttrs);return {status:0,attributes:{'job-id':2}};}});
 await p.submit(file,'test','na_letter_8.5x11in');assert.equal(decodeIpp(job).groups[1]['print-color-mode'],'monochrome');
 job=null;await writeFile(file,color);await assert.rejects(p.submit(file,'test','na_letter_8.5x11in'),/contains color/);assert.equal(job,null);
});

test('Codex image bridge matches each receipt and does not reuse another request',async t=>{
 const {createImageAgent}=await import('../../src/sign-image-agent.mjs');
 const dir=await mkdtemp(join(tmpdir(),'garden-image-agent-'));t.after(()=>rm(dir,{recursive:true,force:true}));let sent=0;
 const rpc=async(name,args)=>{
  if(name==='get_agent_status')return {status:'idle'};
  if(name==='send_agent_prompt'){
   sent++;const specFile=JSON.parse(args.prompt.match(/Read ("[^"]+") for/)[1]);const q=JSON.parse(await readFile(specFile,'utf8'));
   await writeFile(q.file,Buffer.from('89504e470d0a1a0a','hex'));
   await writeFile(q.receipt,JSON.stringify({...q,ok:true,provider:'openai-via-codex',tool:'image_gen.imagegen'}));return {};
  }throw Error('unexpected '+name);
 };
 const generate=createImageAgent({rpc,setup:async()=>({agentId:'fixture'}),pause:async()=>{}});
 const a=await generate('A new hand locking a door',dir);const b=await generate('A new set of clean mugs',dir);
 assert.equal(sent,2);assert.notEqual(a.requestId,b.requestId);assert.equal(a.provider,'openai-via-codex');
});

test('cancelled image requests never start and failed image tools remain failures',async t=>{
 const {createImageAgent}=await import('../../src/sign-image-agent.mjs');
 const dir=await mkdtemp(join(tmpdir(),'garden-image-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));let sent=0;
 const generate=createImageAgent({rpc:async()=>{sent++;return {status:'idle'};},setup:async()=>({agentId:'fixture'}),pause:async()=>{},timeoutMs:1});
 const c=new AbortController();c.abort();await assert.rejects(generate('Do not generate',dir,{signal:c.signal}),/aborted/);assert.equal(sent,0);
});

test('image failure keeps the composed brief for a spoken retry',async t=>{
 const x=await setup(t);let fail=true,previous;
 const flow=createSignWorkflow({...x.args,propose:async(intent,old)=>{previous=old;return {spec:old||slots,model:'fixture'};},render:async(spec,out)=>{if(fail)throw Error('Image service unavailable');await x.args.render(spec,out);return {illustration:{provider:'openai-via-codex'}};}});
 const a=await flow.create({intent:'Lock the door except for short trips'});await flow.settled();const failed=await flow.get(a.id);assert.equal(failed.status,'failed');assert.equal(failed.spec.headline,slots.headline);
 fail=false;await flow.revise({id:a.id,version:1,intent:'Try again'});await flow.settled();assert.equal(previous.headline,slots.headline);assert.equal((await flow.get(a.id)).status,'ready');
});
