// Local-wall recipient management. No automatic invitations or test messages.
async function api(path,body) {
  const r=await fetch('/api/messages/residents'+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Could not update residents.');return d;
}
const displayPhone=p=>/^\+1\d{10}$/.test(p||'')?`+1 (${p.slice(2,5)}) ${p.slice(5,8)}-${p.slice(8)}`:p;
const notify=residents=>window.dispatchEvent(new CustomEvent('garden:recipients-changed',{detail:residents.map(({id,name})=>({id,name}))}));
export function openResidents({h,openPanel,toast}) {
  const root=h('section',{class:'garden-residents vs','aria-label':'Message residents'});
  const status=h('p',{class:'residents-status',role:'status','aria-live':'polite'},'Checking residents…');
  const list=h('div',{class:'residents-list'});
  const name=h('input',{type:'text',maxLength:40,required:true,'aria-label':'Resident name',placeholder:'Name',autoComplete:'off'});
  const phone=h('input',{type:'tel',maxLength:50,required:true,'aria-label':'Resident phone',placeholder:'+1 (555) 123-4567',autoComplete:'off'});
  const aliases=h('input',{type:'text',maxLength:328,'aria-label':'Voice nicknames',placeholder:'Optional, separated by commas',autoComplete:'off'});
  const editTitle=h('h2',{},'Add a resident');
  const phoneHelp=h('p',{class:'residents-help'},'US numbers can be entered with or without +1. Include the country code for other countries.');
  const save=h('button',{type:'submit',class:'gbtn'},'Add resident');
  const cancel=h('button',{type:'button',class:'gbtn',hidden:true,onClick:()=>reset()},'Cancel edit');
  let selected=null,busy=false,generation=0;
  const refresh=h('button',{type:'button',class:'gbtn',onClick:()=>load()},'Refresh activation');
  const field=(label,node)=>h('label',{},h('span',{},label),node);
  const form=h('form',{class:'residents-form',onSubmit:async e=>{
    e.preventDefault();if(busy)return;
    const input={...(selected?{id:selected}:{}),name:name.value,phone:phone.value,aliases:aliases.value.split(',').map(s=>s.trim()).filter(Boolean)};
    setBusy(true);status.textContent=selected?'Saving changes…':'Adding resident…';
    try{const result=await api('/save',input);reset();toast(`${result.resident.name} saved.`);await load();}
    catch(e){status.textContent=e.message;}
    finally{setBusy(false);}
  }},editTitle,field('Name',name),field('Phone number',phone),phoneHelp,
    h('details',{},h('summary',{},'Voice nicknames (optional)'),field('Other names Garden should recognize',aliases)),h('div',{class:'residents-actions'},save,cancel));
  const editor=h('details',{class:'residents-editor'},h('summary',{},'Add a resident'),form);
  function setBusy(value){busy=value;root.querySelectorAll('button,input').forEach(b=>b.disabled=value);}
  function reset(){editor.open=false;editor.querySelector('summary').textContent='Add a resident';selected=null;name.value='';phone.value='';phone.readOnly=false;aliases.value='';editTitle.textContent='Add a resident';save.textContent='Add resident';cancel.hidden=true;phoneHelp.textContent='US numbers can be entered with or without +1. Include the country code for other countries.';}
  function edit(r){editor.open=true;editor.querySelector('summary').textContent='Edit resident';selected=r.id;name.value=r.name;phone.value=r.phone;phone.readOnly=true;aliases.value=r.aliases.join(', ');editTitle.textContent='Edit '+r.name;save.textContent='Save changes';cancel.hidden=false;phoneHelp.textContent='To replace a phone number, remove this resident and add them again. The new phone must activate separately.';form.scrollIntoView({block:'nearest'});name.focus();}
  async function remove(r,box){
    const confirmation=h('div',{class:'residents-confirm',role:'group','aria-label':'Remove '+r.name},h('p',{},`Remove ${r.name} from message recipients? Already sent messages stay on their phone.`),
      h('button',{type:'button',class:'gbtn',onClick:async()=>{
        if(busy)return;setBusy(true);status.textContent='Removing '+r.name+'…';
        try{await api('/remove',{id:r.id});if(selected===r.id)reset();toast(r.name+' removed.');await load();}
        catch(e){status.textContent=e.message;}
        finally{setBusy(false);}
      }},'Remove '+r.name),h('button',{type:'button',class:'gbtn',onClick:()=>confirmation.remove()},'Keep resident'));
    box.querySelector('.residents-confirm')?.remove();box.append(confirmation);
  }
  async function load(){
    const turn=++generation;refresh.disabled=true;
    try {
      const d=await api('');if(turn!==generation||!root.isConnected)return;
      notify(d.residents);
      status.textContent=d.error||(!d.free&&d.configured?'Sending is paused: this project is not on the zero-billing configuration.':`Free messaging · ${d.residents.length} resident${d.residents.length===1?'':'s'} · no automatic messages`);
      list.replaceChildren();
      for(const r of d.residents){
        const label={ready:'Ready to receive',pending:'Needs activation',unknown:'Activation not checked',missing:'Phone route missing'}[r.state];
        const row=h('article',{class:'residents-row','data-resident-id':r.id},h('div',{class:'residents-person'},h('h2',{},r.name),h('p',{},displayPhone(r.phone)),h('strong',{class:'residents-state'},label)));
        const instructions=r.assignedPhoneNumber?`From ${displayPhone(r.phone)}, send “Hi Garden” to ${displayPhone(r.assignedPhoneNumber)}. Then choose Refresh activation.`:'Use Edit and Save changes to reconnect this phone route, then follow its activation instructions.';
        row.append(h('details',{open:r.state!=='ready'},h('summary',{},r.state==='ready'?'Phone connection details':'How to activate'),h('p',{},instructions),...(r.assignedPhoneNumber?[h('p',{},'GardenOS sender: '+displayPhone(r.assignedPhoneNumber))]:[])));
        row.append(h('div',{class:'residents-actions'},h('button',{type:'button',class:'gbtn',onClick:()=>edit(r)},'Edit'),h('button',{type:'button',class:'gbtn',onClick:()=>remove(r,row)},'Remove')));list.append(row);
      }
      if(!d.residents.length)list.append(h('p',{},'No message recipients yet. Add the first resident below.'));
      editor.hidden=!d.configured;
      if(busy)setBusy(true);
    }catch(e){if(turn===generation&&root.isConnected)status.textContent=e.message;}
    finally{if(turn===generation)refresh.disabled=busy;}
  }
  const help=h('details',{class:'residents-setup'},h('summary',{},'Setup and sending help'),
    h('ol',{},h('li',{},'Add a name and phone number. No resident account or extra app is needed.'),h('li',{},'The resident sends Hi Garden to their assigned GardenOS sender, from the phone number you added.'),h('li',{},'Choose Refresh activation. Ready to receive means the phone is activated.')),
    h('p',{},'Say “send this to Razi”, “send the daily news summary to Razi”, or “send a note to Razi saying hello”. You can also use Send to… on an open item.'),
    h('p',{},'Summaries and trips arrive directly in Messages. Adding someone sends no invitation or test message. If the free plan is full, adding stops; GardenOS never upgrades or adds billing. This list manages messaging only, not Roots accounts or task assignments.'));
  root.append(h('h1',{},'Residents'),h('p',{},'Choose who GardenOS can send messages to.'),status,refresh,editor,list,help);
  openPanel('Residents',root);load();return root;
}
