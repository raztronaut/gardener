let current=null;
const VOICE=()=>`http://${location.hostname}:${new URLSearchParams(location.search).get('voiceport')||8797}`;
async function request(action,body,signal){const r=await fetch('/api/signs/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const out=await r.json();if(!r.ok)throw Error(out.error||'Sign operation failed.');return out;}
export function signContext(){
 if(!current?.visible())return null;
 const s=current.state;
 return s?{id:s.id,version:s.version,status:s.status,spec:s.spec,dirty:current.dirty,approval:!current.dirty&&current.approval?.expires>Date.now()?current.approval:null}:{status:'brief',id:null,version:null,approval:null};
}
export function disposeSign(){current?.dispose();}
function createPanel({h,openPanel,toast},initial,{silent=false,begin=false}={}){
 const p={state:initial,approval:null,dirty:false,root:h('div',{class:'garden-signs'}),timer:null,expired:null,disposed:false,shownVersion:0,askedVersion:0,silent,promptEpoch:0,audio:null,announced:new Set()};
 const title=h('p',{},'Tell me what this sign should help people do.');
 const status=h('p',{'aria-live':'polite'},'Describe it aloud. I’ll choose the key, write the copy and generate the illustration.');
 const preview=h('div',{class:'sign-preview'});
 const intent=h('textarea',{rows:3,placeholder:'Describe the sign, if you prefer typing.'});
 const fields={eyebrow:h('input',{type:'text',maxlength:32}),headline:h('textarea',{rows:2,maxlength:180}),subphrase:h('textarea',{rows:2,maxlength:240}),illustrationPrompt:h('textarea',{rows:3,maxlength:1500}),template:h('select'),logo:h('select')};
 const editForm=h('div',{class:'sign-slots',hidden:true},...Object.entries(fields).map(([k,v])=>h('label',{},({eyebrow:'XML key',headline:'Main phrase',subphrase:'Supporting phrase',illustrationPrompt:'Describe the generated illustration',template:'Template',logo:'Logo'})[k],v)));
 const start=h('button',{class:'gbtn',type:'button'},'Create preview');
 const revise=h('button',{class:'gbtn',type:'button',hidden:true},'Apply changes');
 const talk=h('button',{class:'gbtn',type:'button'},'Speak');
 const review=h('button',{class:'gbtn',type:'button',hidden:true},'Review again');
 const print=h('button',{class:'gbtn',type:'button',disabled:true,hidden:true,'data-sign-print':'true'},'Yes, print this version');
 const cancel=h('button',{class:'gbtn',type:'button'},'Cancel');
 const check=h('button',{class:'gbtn',type:'button',hidden:true},'Check printer status');
 const download=h('a',{class:'gbtn',hidden:true,target:'_blank',rel:'noopener'},'Download PDF');
 const source=h('p',{class:'sign-source'});
 const compose=h('div',{class:'sign-compose'},h('label',{},'Describe your sign',intent),start);
 const manual=h('details',{class:'sign-manual'},h('summary',{},'Edit by hand'),compose,editForm,revise);
 const actions=h('div',{class:'sign-actions'},talk,review,print,cancel,check,download);
 p.root.append(title,preview,status,actions,manual,source);
 if(!document.querySelector('link[data-sign-styles]'))document.head.append(h('link',{rel:'stylesheet',href:'/lib/signs.css','data-sign-styles':'true'}));
 openPanel('Garden Directive',p.root);current=p;
 function active(){return !p.disposed&&p.root.isConnected;}
 p.visible=()=>active()&&!!p.root.getClientRects().length&&!document.hidden&&document.querySelector('#panel')?.getAttribute('aria-hidden')!=='true';
 function stopPrompt(){p.promptEpoch++;p.audio?.pause();p.audio=null;p.abortSpeech?.abort();p.abortSpeech=null;}
 function badge(){print.disabled=!p.approval||p.approval.expires<=Date.now()||p.dirty;}
 async function invalidate(){const token=p.approval?.token;stopPrompt();p.approval=null;badge();if(p.state)await request('invalidate',{id:p.state.id,version:p.state.version,token}).catch(()=>{});}
 p.invalidate=invalidate;
 for(const field of Object.values(fields))field.addEventListener('input',()=>{p.dirty=true;invalidate();status.textContent='Apply these changes to see a new preview before printing.';});
 p.dispose=()=>{if(p.disposed)return;p.disposed=true;clearTimeout(p.timer);clearTimeout(p.expired);window.removeEventListener('garden:voice-cancel',onVoiceCancel);invalidate();if(current===p)current=null;};
 function onVoiceCancel(e){if(!active())return;invalidate();if(p.state){review.hidden=false;status.textContent='Nothing was printed. Say “Hey Garden, review this sign” when ready.';if(e.detail?.why==='spoken-cancel')request('cancel',{id:p.state.id,version:p.state.version}).then(update).catch(()=>{});}}
 window.addEventListener('garden:voice-cancel',onVoiceCancel);
 async function listen(){
  if(!p.visible())return;
  const v=await fetch(VOICE()+'/status').then(r=>r.json()).catch(()=>null);
  if(!v?.enabled)throw Error('Voice is turned off. Enable Garden voice to continue speaking.');
  if(v.state!=='idle')throw Error('Garden is still listening or working. Try speaking again in a moment.');
  await fetch(VOICE()+'/ptt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({down:true,auto:true,destination:'garden'})});
 }
 async function speak(kind,followup=false){
  stopPrompt();const epoch=p.promptEpoch,valid=()=>p.visible()&&p.promptEpoch===epoch;
  for(let n=0;n<30;n++){
   if(!valid())return;
   const v=await fetch(VOICE()+'/status').then(r=>r.json()).catch(()=>null);
   if(v?.state==='idle')break;
   if(n===29)throw Error('Voice is busy. Say “Hey Garden, review this sign” when ready.');
   await new Promise(r=>setTimeout(r,400));
  }
  if(!valid())return;
  const before=p.state,token=p.approval?.token;p.abortSpeech=new AbortController();
  const out=await request('speak',{kind,id:before?.id,version:before?.version,token},p.abortSpeech.signal);
  if(!valid())return;
  const audio=p.audio=new Audio(out.audio);
  await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=()=>reject(Error('The spoken prompt could not play.'));audio.onpause=resolve;audio.play().catch(reject);});
  if(!valid())return;
  if(followup&&(!before||p.state?.version===before.version)&&(!token||p.approval?.token===token))await listen();
 }
 p.speak=speak;
 async function ask(){
  if(!active()||p.dirty)return;
  if(!p.state){await speak('brief',true);return;}
  if(!p.state.artifactHash)return;
  const before=p.state;
  try{
   for(let n=0;n<20&&!p.visible();n++)await new Promise(r=>setTimeout(r,100));
   const img=preview.querySelector('img');if(!p.visible()||!img?.complete||!img.naturalWidth){review.hidden=false;return;}
   const lease=await request('present',{id:before.id,version:before.version,artifactHash:before.artifactHash});
   if(!active()||p.dirty||p.state.version!==before.version){request('invalidate',{id:before.id,version:before.version,token:lease.approval.token}).catch(()=>{});return;}
   p.approval=lease.approval;p.state=lease;badge();review.hidden=true;
   clearTimeout(p.expired);p.expired=setTimeout(()=>{invalidate();if(active()){review.hidden=false;status.textContent='Nothing was printed. Ask to review this sign whenever you’re ready.';}},Math.max(1,p.approval.expires-Date.now()));
   status.textContent='Ready to print? Say “yes, print it”, or tell me what to change.';
   await speak(before.version>1?'revised':'review',true);
  }catch(e){if(active()&&e.name!=='AbortError'){status.textContent=e.message;review.hidden=false;}}
 }
 p.ask=ask;
 async function poll(){
  if(!active()||!p.state)return;
  try{const r=await fetch('/api/signs/'+p.state.id,{cache:'no-store'});if(!r.ok)throw Error('Could not refresh this sign.');update(await r.json());}catch(e){if(active())status.textContent=e.message;}
  if(active()&&['rendering','submitting'].includes(p.state?.status))p.timer=setTimeout(poll,900);
 }
 p.poll=poll;
 function update(s){
  if(!active())return;const old=p.state;p.state=s;
  if(old?.version!==s.version||old?.status!==s.status&&['rendering','submitting','cancelled','submitted','failed'].includes(s.status))stopPrompt();
  const busy=['rendering','submitting'].includes(s.status);
  title.textContent=s.spec?'Your Garden Directive':'Tell me what this sign should help people do.';
  for(const field of Object.values(fields))field.disabled=busy;
  editForm.hidden=!s.spec;compose.hidden=!!s.spec;start.disabled=busy;revise.disabled=busy||!s.spec;revise.hidden=!s.spec;
  check.hidden=s.status!=='uncertain';download.hidden=!s.pdf;if(s.pdf)download.href=s.pdf;print.hidden=!s.artifactHash;
  print.textContent=s.status==='print-failed'?'Retry this exact preview':'Yes, print this version';
  const messages={rendering:'Writing your sign and generating its illustration… This can take a minute or two.',ready:'Preview ready. Everything prints in black and white.',awaiting:'Ready to print? Say “yes, print it”, or tell me what to change.',submitting:'Submitting your approved sign…',submitted:`Accepted by the printer${s.print?.jobId?' — job '+s.print.jobId:''}.`,cancelled:'Cancelled. Nothing was printed.',uncertain:'Receipt is uncertain. Check the printer before trying again.','print-failed':s.error||'Printing failed. Your exact preview is saved.',failed:s.error||'The sign could not be prepared. Tell me what to try again.'};
  status.textContent=messages[s.status]||s.status;
  if(['submitting','submitted','cancelled','uncertain','failed','rendering'].includes(s.status)){p.approval=null;badge();review.hidden=true;}
  if(s.spec&&p.shownVersion!==s.version&&s.artifactHash){for(const[k,v]of Object.entries(fields))v.value=s.spec[k]||'';p.dirty=false;p.shownVersion=s.version;}
  source.textContent=s.illustration?.provider==='none'?'No illustration, as requested.':s.illustration?s.illustration.provider==='programmatic'?'Older placeholder artwork. Ask for a new illustration.':'Original image-model artwork. Black-and-white print.':'I’ll fill the XML key, copy and illustration from your request.';
  if(s.artifactHash&&preview.dataset.hash!==s.artifactHash){
   preview.dataset.hash=s.artifactHash;const img=h('img',{src:s.preview,alt:s.spec?.headline||'Sign preview'});preview.replaceChildren(img);
   img.onload=()=>{if(!active()||p.state.version!==s.version)return;if(p.silent){review.hidden=false;return;}if(['ready','awaiting'].includes(s.status)&&p.askedVersion!==s.version){p.askedVersion=s.version;ask();}};
  }
  if(s.status==='rendering'){preview.replaceChildren();delete preview.dataset.hash;}
  if(s.status==='print-failed'||s.status==='ready'&&p.askedVersion===s.version&&!p.approval)review.hidden=false;
  const announcement=s.id+':'+s.version+':'+s.status;
  if(!p.silent&&!p.announced.has(announcement)&&['submitted','print-failed','uncertain','failed','cancelled'].includes(s.status)){
   p.announced.add(announcement);speak(s.status,['print-failed','failed'].includes(s.status)).catch(e=>{if(active()&&e.name!=='AbortError')status.textContent+=' '+e.message;});
  }
 }
 p.update=update;
 async function safe(fn){try{await fn();}catch(e){if(active())status.textContent=e.message;toast?.(e.message);}}
 start.onclick=()=>safe(async()=>{update(await request('create',{intent:intent.value}));manual.open=false;poll();});
 revise.onclick=()=>safe(async()=>{await invalidate();const slots={...p.state.spec,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value]))};slots.illustration=slots.illustrationPrompt?'generated':'none';slots.regenerateIllustration=slots.illustrationPrompt!==p.state.spec?.illustrationPrompt;update(await request('revise',{id:p.state.id,version:p.state.version,slots}));manual.open=false;poll();});
 talk.onclick=()=>safe(async()=>{p.silent=false;stopPrompt();await listen();});review.onclick=()=>safe(async()=>{p.silent=false;await ask();});
 print.onclick=()=>safe(async()=>{if(p.dirty||!p.approval)return;const approval=p.approval;stopPrompt();p.approval=null;badge();update(await request('approve',{id:p.state.id,version:p.state.version,token:approval.token,source:'button'}));poll();});
 cancel.onclick=()=>safe(async()=>{if(!p.state){disposeSign();return;}await invalidate();update(await request('cancel',{id:p.state.id,version:p.state.version}));});
 check.onclick=()=>safe(async()=>update(await request('reconcile',{id:p.state.id,version:p.state.version})));
 fetch('/api/signs/catalog').then(r=>r.json()).then(c=>{if(!active())return;for(const key of ['template','logo']){fields[key].replaceChildren(...Object.entries(c[key==='template'?'templates':'logos']).map(([id,v])=>h('option',{value:id},v.label)));if(p.state?.spec)fields[key].value=p.state.spec[key];}}).catch(()=>{status.textContent='The sign template assets are unavailable.';});
 if(initial){update(initial);if(['rendering','submitting'].includes(initial.status))poll();}else if(begin&&!silent)setTimeout(()=>{if(active())ask().catch(e=>{status.textContent=e.message;});},300);
 return p;
}
export async function signAction(input,api){
 const action=input.action||'open';
 try{
  if(action==='open'){const s=input.id?await fetch('/api/signs/'+input.id).then(r=>r.json()):null;createPanel(api,s,{silent:!!input.silent,begin:!s});return {ok:true,say:'Tell me what the sign should help people do.'};}
  if(action==='create'){const p=createPanel(api,null);const s=await request('create',{intent:input.intent});p.update(s);p.poll();return {ok:true,say:'Preparing your sign and generating the illustration.'};}
  const ctx=signContext();if(!ctx)throw Error('Open the sign preview first.');
  if(input.id&&input.id!==ctx.id||input.version&&input.version!==ctx.version)throw Error('The sign preview changed.');
  if(action==='status')return {ok:true,say:current.state?.status==='submitted'?`Accepted by the printer as job ${current.state.print.jobId}.`:current.state?.error||'The sign is '+ctx.status+'.'};
  if(action==='review'){current.silent=false;current.ask();return {ok:true,say:'Let’s review this sign.'};}
  if(action==='clarify'){current.speak(ctx.id?'clarify':'brief',true).catch(()=>{});return {ok:true,say:'Tell me what you would like to change.'};}
  if(action==='approve'){
   if(ctx.dirty||!ctx.approval)throw Error('Review the current preview before approving it.');
   if(input.token!==ctx.approval.token)throw Error('That approval belongs to another preview.');
   const s=await request('approve',{id:ctx.id,version:ctx.version,token:input.token,source:'voice',utterance:input.utterance,startedAt:input.startedAt});current.update(s);current.poll();return {ok:true,say:'Submitting this approved sign.'};
  }
  if(action==='cancel'){if(!ctx.id){current.dispose();return {ok:true,say:'Cancelled.'};}await current.invalidate();current.update(await request('cancel',{id:ctx.id,version:ctx.version}));return {ok:true,say:'Cancelled. Nothing was printed.'};}
  if(action==='revise'){if(!ctx.id)return signAction({action:'create',intent:input.intent},api);await current.invalidate();current.update(await request('revise',{id:ctx.id,version:ctx.version,intent:input.intent}));current.poll();return {ok:true,say:'Preparing the revised sign.'};}
  throw Error('Unknown sign action.');
 }catch(e){return {ok:false,error:e.message};}
}
