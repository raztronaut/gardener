// Local wall address book, separate from Roots profiles and task assignees.
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {paths} from './config.mjs';
import {readMessageConfig,photonRequest,requireFreeProject} from './messages.mjs';

const key=s=>String(s).trim().toLowerCase().replace(/\s+/g,' ');
export function normalizePhone(value) {
  if(typeof value!=='string'||value.length>50||!/^[+\d\s().-]+$/.test(value))throw Error('Enter a phone number with country code, such as +1 (555) 123-4567.');
  let digits=value.replace(/[^\d]/g,'');
  if(!value.trim().startsWith('+')&&digits.length===10)digits='1'+digits;
  else if(!value.trim().startsWith('+')&&!(digits.length===11&&digits.startsWith('1')))throw Error('Include + and the country code for international numbers.');
  if(!/^[1-9]\d{6,14}$/.test(digits))throw Error('That phone number is incomplete or invalid.');
  return '+'+digits;
}
async function writeConfig(value) {
  const directory=join(paths.DATA,'messages');await fs.mkdir(directory,{recursive:true,mode:0o700});
  const file=join(directory,'config.json'),tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(tmp,file);
}
function validate(input,c) {
  if(!input||typeof input!=='object')throw Error('Enter a name and phone number.');
  const name=typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):'';
  if(!name||name.length>40||!/[\p{L}]/u.test(name)||/[\p{Cc}\p{Cf}<>]/u.test(name))throw Error('Use a resident name of 1–40 characters.');
  const phone=normalizePhone(input.phone);
  const previous=input.id?c.recipients.find(r=>r.id===input.id):null;
  if(input.id&&!previous)throw Error('This resident was removed. Refresh the list.');
  if(previous&&previous.phone!==phone)throw Error('To replace a phone number, remove this resident and add them again. The new phone must activate separately.');
  const raw=input.aliases??previous?.aliases??[];
  if(!Array.isArray(raw)||raw.length>8||raw.some(a=>typeof a!=='string'||!a.trim()||a.length>40||/[\p{Cc}\p{Cf}<>]/u.test(a)))throw Error('Use up to eight short voice nicknames.');
  const aliases=[...new Set(raw.map(key))].filter(a=>a!==key(name));
  const id=previous?.id||name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'resident-'+randomBytes(4).toString('hex');
  const names=new Set([id,key(name),...aliases]);
  for(const r of c.recipients.filter(r=>r.id!==previous?.id)) {
    if(r.phone===phone)throw Error(`That number is already connected as ${r.name}. Use Edit for that resident.`);
    if([r.id,key(r.name),...(r.aliases||[])].some(n=>names.has(key(n))))throw Error(`That name or nickname is already used by ${r.name}.`);
  }
  return {...previous,id,name,phone,aliases};
}
const view=(r,users,known)=>{
  const remote=users?.find(u=>u.phoneNumber===r.phone&&u.meta?.opt_in===true)||users?.find(u=>u.phoneNumber===r.phone);
  return {id:r.id,name:r.name,phone:r.phone,aliases:r.aliases||[],assignedPhoneNumber:remote?.assignedPhoneNumber||r.assignedPhoneNumber||null,state:known?(remote?remote.meta?.opt_in===true?'ready':'pending':'missing'):'unknown'};
};
export function createResidentManager({read=readMessageConfig,write=writeConfig,request=photonRequest}={}) {
  let queue=Promise.resolve();
  const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function list() {
    let c;try{c=await read();}catch{return {configured:false,remoteAvailable:false,residents:[],error:'Messaging has not been connected. See the setup instructions.'};}
    try {
      const [bill,data]=await Promise.all([request(c,'billing/subscription'),request(c,'users/')]);
      return {configured:true,remoteAvailable:true,free:bill.tier==='free'&&!bill.subscription_id&&!bill.customer_id,residents:c.recipients.map(r=>view(r,data.users,true))};
    }catch{return {configured:true,remoteAvailable:false,residents:c.recipients.map(r=>view(r,null,false)),error:'Photon is unavailable. Saved residents are shown; activation could not be checked.'};}
  }
  function save(input) {return serial(async()=>{
    const c=await read(),r=validate(input,c);await requireFreeProject(c,request);
    const remote=await request(c,'users/','POST',{type:'shared',phoneNumber:r.phone,firstName:r.name});
    if(!remote?.id||remote.phoneNumber!==r.phone||remote.type!=='shared')throw Error('Photon did not confirm this free recipient. Refresh before trying again.');
    const latest=await read();validate(input,latest);
    const next={...r,photonUserId:remote.id,assignedPhoneNumber:remote.assignedPhoneNumber};
    latest.recipients=latest.recipients.filter(x=>x.id!==r.id);latest.recipients.push(next);await write(latest);
    return {ok:true,resident:view(next,[remote],true)};
  });}
  function remove(id) {return serial(async()=>{
    const c=await read(),r=c.recipients.find(r=>r.id===id);if(!r)throw Error('That resident is already removed. Refresh the list.');
    // Removal is also allowed after a plan change; it never enables paid use.
    const data=await request(c,'users/');
    for(const u of data.users.filter(u=>u.type==='shared'&&u.phoneNumber===r.phone))await request(c,'users/'+encodeURIComponent(u.id)+'/','DELETE');
    const latest=await read();latest.recipients=latest.recipients.filter(x=>x.id!==id);await write(latest);
    return {ok:true};
  });}
  return {list,save,remove};
}
export const residentManager=createResidentManager();
