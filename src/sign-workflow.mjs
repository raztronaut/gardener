import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { signDecision } from '../public/lib/sign-intent.js';
const ID=/^[a-f0-9-]{36}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateSign(input){
 if(!input||typeof input!=='object')throw Error('A sign needs its text slots.');
 const out={};for(const [key,max]of [['eyebrow',32],['headline',180],['subphrase',240]]){
  if(typeof input[key]!=='string'||input[key].length>max)throw Error('Keep the '+key+' short enough for a sign.');
  out[key]=input[key].trim();
 }
 out.eyebrow=out.eyebrow.replace(/^<|>$/g,'').toLowerCase();
 if(!/^[a-z][a-z0-9_-]{0,30}$/.test(out.eyebrow)||!out.headline)throw Error('Use a short key and a main phrase.');
 const art=['generated','none','dishes','stack','pots','door','trash','reset','shelf','arrow','lifecycle'];
 if(!art.includes(input.illustration))throw Error('Choose a supported illustration.');
 out.illustration=input.illustration;out.illustrationPrompt=String(input.illustrationPrompt||'').slice(0,1500);
 if(['key','tag','xml','category','placeholder'].includes(out.eyebrow))throw Error('The XML key must describe the sign’s actual meaning.');
 if(input.keyMeaning)out.keyMeaning=String(input.keyMeaning).slice(0,300);
 if(input.regenerateIllustration)out.regenerateIllustration=true;
 if(out.illustration==='generated'&&out.illustrationPrompt.length<12)throw Error('Describe a specific illustration for this sign.');
 out.template=input.template||'directive';out.logo=input.logo||'directive';
 if(!/^[a-z][a-z0-9-]{0,39}$/.test(out.template)||!/^[a-z][a-z0-9-]{0,39}$/.test(out.logo))throw Error('Invalid template or logo.');
 return out;
}
export function createSignWorkflow({dir,propose,render,printer,now=Date.now,uuid=randomUUID,leaseMs=90000}){
 const locks=new Map(),tasks=new Map(),activePrints=new Set(),builds=new Map();
 const file=id=>{if(!ID.test(id))throw Error('Invalid sign ID');return join(dir,id,'state.json');};
 async function read(id){return JSON.parse(await readFile(file(id),'utf8'));}
 async function save(s){await mkdir(join(dir,s.id),{recursive:true});const p=file(s.id);await writeFile(p+'.tmp',JSON.stringify(s,null,2)+'\n',{mode:0o600});await rename(p+'.tmp',p);}
 function lock(id,fn){const next=(locks.get(id)||Promise.resolve()).then(fn);locks.set(id,next.catch(()=>{}));return next;}
 function publicState(s){return {id:s.id,version:s.version,status:s.status,spec:s.spec,error:s.error||null,artifactHash:s.artifactHash||null,illustration:s.illustration||null,textModel:s.textModel||null,print:s.print||null,preview:s.artifactHash?`/api/signs/${s.id}/${s.version}/preview.png`:null,pdf:s.artifactHash?`/api/signs/${s.id}/${s.version}/sign.pdf`:null};}
 function build(s,intent,slots){
  const key=s.id+':'+s.version;const controller=new AbortController();builds.set(s.id,controller);
  const task=(async()=>{
   try{
    const proposed=slots?{spec:validateSign(slots),model:'edited slots'}:await propose(intent,s.spec);
    const spec=validateSign(proposed.spec);const output=join(dir,s.id,'v'+s.version);
    await lock(s.id,async()=>{const latest=await read(s.id);if(latest.version===s.version&&latest.status!=='cancelled')await save({...latest,spec,textModel:proposed.model});});
    controller.signal.throwIfAborted();
    const result=await render(spec,output,{previous:s.spec,previousOutput:s.version>1?join(dir,s.id,'v'+(s.version-1)):null,signal:controller.signal});const digest=hash(await readFile(join(output,'print.jpg')));
    await lock(s.id,async()=>{const latest=await read(s.id);if(latest.version!==s.version||latest.status==='cancelled')return;await save({...latest,spec,status:'ready',artifactHash:digest,textModel:proposed.model,illustration:result.illustration,error:null});});
   }catch(e){await lock(s.id,async()=>{const latest=await read(s.id);if(latest.version===s.version&&latest.status!=='cancelled')await save({...latest,status:'failed',error:e.message,approval:null});});}
  })().finally(()=>{tasks.delete(key);if(builds.get(s.id)===controller)builds.delete(s.id);});tasks.set(key,task);
 }
 const api={
  async create({intent,slots}){
   if(!slots&&(typeof intent!=='string'||!intent.trim()||intent.length>2000))throw Error('Describe the sign you want.');
   const s={id:uuid(),version:1,status:'rendering',spec:null,createdAt:now(),approval:null};await save(s);build(s,intent,slots);return publicState(s);
  },
  async revise({id,version,intent,slots}){return lock(id,async()=>{
   const s=await read(id);if(s.version!==version)throw Error('That preview is stale. Review the current version.');
   if(['submitting','uncertain'].includes(s.status))throw Error('Resolve the pending print submission before revising.');
   if(!slots&&(typeof intent!=='string'||!intent.trim()||intent.length>2000))throw Error('Describe your changes.');
   builds.get(id)?.abort();
   const next={...s,version:s.version+1,status:'rendering',artifactHash:null,approval:null,print:null,error:null};await save(next);build(next,intent,slots);return publicState(next);
  });},
  async get(id){return lock(id,async()=>{let s=await read(id);
   if(s.status==='rendering'&&!tasks.has(id+':'+s.version)){s={...s,status:'failed',approval:null,error:'Preparation was interrupted. Revise or retry the sign.'};await save(s);}
   if(s.status==='submitting'&&!activePrints.has(id)){s={...s,status:'uncertain',approval:null,error:'Submission was interrupted. Check printer status before retrying.'};await save(s);}
   return publicState(s);
  });},
  async present({id,version,artifactHash}){return lock(id,async()=>{
   const s=await read(id);if(s.version!==version||s.artifactHash!==artifactHash||!['ready','awaiting','print-failed'].includes(s.status))throw Error('This preview is not ready for approval.');
   s.approval={token:uuid(),issuedAt:now(),expires:now()+leaseMs,artifactHash};s.status=s.status==='print-failed'?'print-failed':'awaiting';await save(s);return {...publicState(s),approval:s.approval};
  });},
  async checkApproval({id,version,token}){const s=await read(id);if(s.version!==version||!s.approval||s.approval.token!==token||s.approval.expires<now()||!['awaiting','print-failed'].includes(s.status))throw Error('This preview is no longer awaiting approval.');return s.approval;},
  async invalidate({id,version,token}){return lock(id,async()=>{const s=await read(id);if(s.version===version&&(!token||s.approval?.token===token)){s.approval=null;if(s.status==='awaiting')s.status='ready';await save(s);}return publicState(s);});},
  async cancel({id,version}){return lock(id,async()=>{const s=await read(id);if(s.version!==version)throw Error('That sign version has changed.');if(['submitted','submitting','uncertain'].includes(s.status))throw Error('This job may already be at the printer. Check its queue.');builds.get(id)?.abort();s.status='cancelled';s.approval=null;await save(s);return publicState(s);});},
  async approve({id,version,token,source,utterance,startedAt}){
   const prepared=await lock(id,async()=>{
    const s=await read(id);if(s.version!==version)throw Error('That approval belongs to an older preview.');
    if(['submitting','submitted','uncertain'].includes(s.status))return {existing:publicState(s)};
    if(!['awaiting','print-failed'].includes(s.status)||!s.approval||s.approval.token!==token||s.approval.expires<now())throw Error('Approval expired or the preview changed. Review it again.');
    if(source!=='button'&&(source!=='voice'||signDecision(utterance)!=='approve'))throw Error('Print only follows an explicit yes to this preview.');
    if(source==='voice'&&(!Number.isFinite(startedAt)||startedAt<s.approval.issuedAt))throw Error('The preview changed after you started speaking. Please review it again.');
    const output=join(dir,id,'v'+version,'print.jpg');if(hash(await readFile(output))!==s.approval.artifactHash)throw Error('The print artifact changed. Generate a fresh preview.');
    const title='Garden sign '+id+' v'+version;
    s.status='submitting';s.approval=null;s.print={title,artifactHash:s.artifactHash,requestedAt:now()};s.error=null;activePrints.add(id);try{await save(s);}catch(e){activePrints.delete(id);throw e;}
    return {s,output,title};
   });
   if(prepared.existing)return prepared.existing;
   const {s,output,title}=prepared;
   const task=(async()=>{
    try{const result=await printer.submit(output,title,'na_letter_8.5x11in',s.artifactHash);return lock(id,async()=>{const latest=await read(id);latest.status='submitted';latest.print={...latest.print,...result};await save(latest);return publicState(latest);});}
    catch(e){return lock(id,async()=>{const latest=await read(id);latest.status=e.uncertain?'uncertain':'print-failed';latest.error=e.message;await save(latest);return publicState(latest);});}
   })().finally(()=>{tasks.delete(id+':print');activePrints.delete(id);});tasks.set(id+':print',task);
   // The voice bridge has a short tool deadline; status is polled in the panel.
   return publicState(s);
  },
  async reconcile({id,version}){return lock(id,async()=>{const s=await read(id);if(s.version!==version||s.status!=='uncertain')return publicState(s);const result=await printer.find(s.print.title);if(result){s.status='submitted';s.print={...s.print,...result};s.error=null;await save(s);}return publicState(s);});},
  async artifact(id,version,name){if(!['preview.png','sign.pdf','print.jpg'].includes(name)||!Number.isInteger(version)||version<1)throw Error('Invalid artifact');file(id);return readFile(join(dir,id,'v'+version,name));},
  async settled(){await Promise.all([...tasks.values()]);},
 };
 return api;
}
