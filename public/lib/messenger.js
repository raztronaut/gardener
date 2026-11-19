const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function json(path,options={}) {
  const r=await fetch(path,{...options,signal:AbortSignal.timeout(8000)});const d=await r.json();
  if(!r.ok)throw Error(d.error||'Could not send.');return d;
}
export function currentShare() {
  const panel=document.getElementById('panel');
  if(!panel?.classList.contains('open'))throw Error('Open an item first, or ask to send the daily news summary.');
  const body=document.getElementById('panelBody');
  const nodes=[...body.querySelectorAll('[data-garden-share]')].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length);
  if(nodes.length){const node=nodes.at(-1);if(!node.gardenShare)throw Error('This item is still loading. Try again when it is ready.');return {...node.gardenShare};}
  if(body.querySelector('.panel-game, video, .garden-send-compose, .garden-residents'))throw Error('Choose a summary, article, trip, or readable page to send.');
  const copy=body.cloneNode(true);copy.querySelectorAll('button,input,textarea,select,nav,script,style,iframe,[hidden]').forEach(n=>n.remove());
  copy.querySelectorAll('h1,h2,h3,h4,p,li,tr,section').forEach(n=>n.append(document.createTextNode('\n')));
  const content=copy.textContent.trim();
  if(!content)throw Error('There is no readable content open to send.');
  if(content.length>60000)throw Error('This page is too long. Open a single item to send.');
  return {kind:'snapshot',title:document.getElementById('panelTitle')?.textContent||'From the Garden',text:content};
}
export function createSendControls({h,toast}) {
  let menu=null,shareEnabled=true;
  const close=()=>{menu?.remove();menu=null;button?.setAttribute('aria-expanded','false');};
  const button=h('button',{id:'panelSend',type:'button',class:'gbtn garden-send-button','aria-label':'Send this to a resident','aria-expanded':'false',title:'Send to a resident',onClick:()=>menu?close():open()},'Send to…');
  document.getElementById('panelClose')?.before(button);
  function sync(){if(shareEnabled&&document.documentElement.dataset.theme==='classic'){document.getElementById('panelClose')?.before(button);button.hidden=false;}else button.remove();close();}
  window.addEventListener('garden:theme',sync);sync();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&!button.contains(e.target))close();});
  async function send(input) {
    try {
      const content=input.kind==='current'?currentShare():input;
      const result=await json('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...content,recipient:input.recipient,requestId:input.requestId||crypto.randomUUID()})});
      toast(`Sending to ${result.recipient}…`);
      // Do not hold voice's short wall-action RPC open during phone delivery.
      void watch(result).catch(()=>toast('Delivery status unavailable. Check the phone before sending again.'));
      return {ok:true,say:`Sending to ${result.recipient}.`};
    }catch(e){toast(e.message);return {ok:false,error:e.message};}
  }
  async function watch(initial) {
    let job=initial;
    for(let i=0;i<35&&job.state==='sending';i++){await pause(1000);job=await json('/api/messages/status/'+job.id);}
    const label=job.recipient;
    if(job.state==='delivered')toast(`Delivered to ${label}.`);
    else if(job.state==='sent')toast(`Sent to ${label} · awaiting phone confirmation.`);
    else if(job.state==='accepted')toast(`Photon accepted the message for ${label} · delivery unconfirmed.`);
    else if(job.state==='failed')toast(job.error||`Could not send to ${label}.`);
    else toast(job.error||'Delivery is uncertain. Check the phone before sending again.');
  }
  async function open() {
    close();
    let snapshot,error;try{snapshot=currentShare();}catch(e){error=e.message;}
    const status=h('p',{class:'garden-send-status',role:'status'},'Loading residents…');
    const note=h('textarea',{'aria-label':'Note to send',placeholder:'Write a note…',maxLength:4000,hidden:true});
    let noteMode=false,busy=false;
    const choices=h('div',{class:'garden-send-choices'});
    const mode=h('button',{type:'button',class:'gbtn',onClick:()=>{noteMode=!noteMode;note.hidden=!noteMode;mode.textContent=noteMode?'Send the open item instead':'Write a note instead';status.textContent=noteMode?'Your exact note will be sent.':snapshot?.title||error;if(noteMode)note.focus();}},'Write a note instead');
    const box=h('div',{class:'garden-send-menu','aria-label':'Send to a resident'},h('strong',{},'Send to…'),status,note,choices,mode);
    menu=box;button.setAttribute('aria-expanded','true');document.querySelector('.panel-head').append(box);
    try {
      const data=await json('/api/messages/recipients');if(menu!==box)return;
      status.textContent=snapshot?.title||error;
      if(!data.configured||!data.recipients.length){status.textContent='No residents are connected yet.';return;}
      for(const r of data.recipients)choices.append(h('button',{type:'button',class:'gbtn','data-psel':'',onClick:async()=>{
        if(busy)return;
        if(!noteMode&&!snapshot){status.textContent=error;return;}
        if(noteMode&&!note.value.trim()){status.textContent='Write a note first.';note.focus();return;}
        busy=true;choices.querySelectorAll('button').forEach(b=>b.disabled=true);
        const result=await send({...(noteMode?{kind:'note',text:note.value}:snapshot),recipient:r.id});
        if(result.ok)close();else{busy=false;status.textContent=result.error;choices.querySelectorAll('button').forEach(b=>b.disabled=false);}
      }},r.name));
    }catch(e){if(menu===box)status.textContent=e.message;}
  }
  return {send,close,open,setShareEnabled:value=>{shareEnabled=value;sync();}};
}
