// Guided calibration controls. Audio is owned exclusively by the local voice service.
export function makeRoomCalibration({origin,sound=()=>{}}){
 const el=document.createElement('div');el.id='voiceCalib';el.setAttribute('role','dialog');el.setAttribute('aria-label','Room voice calibration');
 el.innerHTML='<div class="vk-card"><div class="vk-kicker">Hey Garden · room calibration</div><div class="vk-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg"/></svg><b class="vk-num"></b></div><div class="vk-title"></div><div class="vk-sub"></div><div class="vk-dots" aria-live="polite"></div><div class="vk-results"></div><div class="vk-actions"></div></div>';
 (document.getElementById('zoomroot')||document.body).append(el);const $=q=>el.querySelector(q),circumference=2*Math.PI*52;$('.fg').style.strokeDasharray=String(circumference);
 let lastStep=-1,active=false,lastPaused=false,phase="";
 const ring=f=>$('.fg').style.strokeDashoffset=String(circumference*(1-Math.max(0,Math.min(1,f))));
 const close=()=>{el.className='';};
 const request=async action=>{const r=await fetch(origin+'/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({calibrationAction:action})});const d=await r.json();if(!d.ok)throw Error(d.error||'Calibration is unavailable.');return d;};
 function buttons(items){const focused=el.contains(document.activeElement),label=document.activeElement?.textContent;$('.vk-actions').replaceChildren(...items.map(([label,fn])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.pointerEvents='auto';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){$('.vk-sub').textContent=e.message;}finally{b.disabled=false;}};return b;}));if(focused)([...$('.vk-actions').children].find(b=>b.textContent===label)||$('.vk-actions button'))?.focus();}
 function show(mode,title,sub){el.className='on '+mode;$('.vk-ring').hidden=false;$('.vk-title').textContent=title;$('.vk-sub').textContent=sub;$('.vk-results').replaceChildren();}
 const api={
 async welcome(){
  const r=await fetch(origin+'/calibration'),d=await r.json();if(d.active){api[d.session.phase==='record'?'record':'analyze'](d.session);return;}
  active=false;phase='ready';lastStep=-1;show('ready','Let’s learn the room.','About three minutes of recording, then local tuning: room noise, ordinary conversation, then three “Hey Garden”s at each of four positions. Near the screen → across the room → doorway → your hardest spot. Speak normally after each chime.');$('.vk-ring').hidden=true;
  $('.vk-dots').textContent='12 labelled trials · extra noisy variations · separate validation';
  const p=document.createElement('p');p.textContent='Audio stays on this Jetson in memory and is erased afterward. Only settings and numerical results are saved. This tunes sensitivity and microphone gain; it does not retrain the speech model.';$('.vk-results').append(p);
  const actions=[['Start room calibration',async()=>{lastStep=-1;await request('start');}],['Close',close]];
  if(d.canUndo)actions.push(['Restore previous settings',async()=>{await request('undo');$('.vk-sub').textContent='Previous settings restored.';}]);
  if(d.session?.phase==='done')actions.push(['Last result',()=>api.done(d.session)]);buttons(actions);$('.vk-actions button')?.focus();
 },
 record(ev){
  const changed=phase!=="record"||ev.step!==lastStep||lastPaused!==!!ev.paused;phase="record";lastPaused=!!ev.paused;
  active=true;show('rec',ev.paused?'Paused — move when you’re ready.':ev.label||'Room calibration',ev.kind==='positive'?`Position ${(ev.zone||0)+1} of 4 · take ${(ev.repeat||0)+1} of 3. Say it once, then leave a pause.`:ev.kind==='move'?'Take your time getting there. Three chimes will follow, at slightly different intervals.':ev.kind==='noise'?'Stay quiet. Leave ordinary fans, music and room sounds as they normally are.':'Talk or read normally. Avoid the wake phrase during this part.');
  $('.vk-num').textContent=String(ev.left);$('.vk-dots').textContent=`${ev.heard||0}/12 trials captured · ${Math.floor(ev.totalLeft/60)}:${String(ev.totalLeft%60).padStart(2,'0')} left`;
  ring(ev.totalLeft/ev.seconds);if(changed)buttons([[ev.paused?'Resume calibration':'Pause to move',()=>request(ev.paused?'resume':'pause')],['Cancel calibration',()=>request('cancel')]]);
  if(ev.step!==lastStep){lastStep=ev.step;if(ev.kind==='positive'&&ev.cue)sound('listen');else if(ev.kind==='move')sound('done');}
 },
 analyze(ev){const changed=phase!=='analyze';phase='analyze';active=true;show('ana','Finding a better listening balance.',ev.label||'Testing noisy variations and reserved trials. Settings change only if a better candidate passes.');$('.vk-num').textContent=Math.round((ev.progress||0)*100)+'%';$('.vk-dots').textContent='Calibration only · normal voice commands resume afterward';ring(ev.progress||0);if(changed)buttons([['Cancel calibration',()=>request('cancel')]]);},
 done(r){
  active=false;phase='done';show(r.ok?'ok':'bad',r.applied?'Room profile updated.':r.ok?'Kept your current profile.':r.cancelled?'Calibration cancelled.':'Let’s try that again.',r.why||'');$('.vk-num').textContent=r.ok?'✓':'—';ring(1);
  $('.vk-dots').textContent=r.tests?`${r.takes} real takes · ${r.tests} stress tests · ${r.candidates} settings`:'';
  const lines=[];
  if(r.wakeCheck){lines.push(`Reserved real wake trials: ${r.wakeCheck.before}/${r.wakeCheck.total} before → ${r.wakeCheck.after}/${r.wakeCheck.total} candidate.`);for(const z of r.wakeCheck.positions)lines.push(`${z.position}: ${z.after?'candidate heard it':'candidate missed it'}${z.before?' · heard before':' · missed before'}`);}
  if(r.validation)lines.push(`Reserved negative audio: ${r.validation.falseTriggers} wake candidates in ${r.validation.negativeSeconds} seconds. This is a short check, not an all-day false-wake estimate.`);
  if(r.quietPositions)lines.push('Retry: '+r.quietPositions.join(', '));
  for(const line of lines){const p=document.createElement('p');p.textContent=line;$('.vk-results').append(p);}
  buttons([['Close',close],['Try another room session',()=>api.welcome()],...(r.applied?[['Undo this calibration',async()=>{await request('undo');$('.vk-title').textContent='Previous settings restored.';}]]:[])]);
 },
 disconnected(){if(active){active=false;show('bad','Connection interrupted.','Reconnect to check calibration. Current progress is managed by the local voice service.');buttons([['Reconnect',()=>api.welcome()],['Close',close]]);}},
 };
 el.addEventListener('keydown',e=>{if(e.key==='Tab'){const all=[...el.querySelectorAll('button:not([disabled])')];const i=all.indexOf(document.activeElement);if((e.shiftKey&&i<=0)||(!e.shiftKey&&i===all.length-1)){e.preventDefault();all[e.shiftKey?all.length-1:0]?.focus();}}if(e.key==='Escape'){e.stopPropagation();if(active)request('cancel').catch(()=>{});else close();}});
 return api;
}
