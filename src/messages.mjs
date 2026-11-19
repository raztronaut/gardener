// Explicit household sends only. No timers, reminders, paid upgrades or background SDK.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { paths, config } from './config.mjs';
import { readingState, readingEditions } from './editorial.mjs';

const ROOT = join(paths.DATA, 'messages');
const DAYS = 30 * 86400000;
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (s, max, label) => { if (typeof s !== 'string' || !s.trim() || s.length > max) throw Error(`${label} is empty or too long.`); return s.trim(); };
const validURL = value => { if (!value) return ''; const u = new URL(value); if (!['https:','http:'].includes(u.protocol) || u.username || u.password) throw Error('Unsupported content link.'); return u.href; };
const loadConfig = async () => JSON.parse(await fs.readFile(join(ROOT,'config.json'),'utf8'));
export { loadConfig as readMessageConfig };

export function editionContent(e) {
  if (!e) throw Error('No daily news summary has been published yet.');
  const lines=[e.intro];
  for(const section of e.sections||[]) {
    lines.push(section.title,section.summary,...section.paragraphs||[]);
    for(const source of section.sources||[]) lines.push(`${source.source||'Source'}: ${source.title}\n${validURL(source.url)}`);
    for(const story of section.stories||[]) {
      lines.push(story.title,...story.paragraphs||[]);
      for(const source of story.sources||[])lines.push(`${source.source||'Source'}: ${source.title}\n${validURL(source.url)}`);
    }
  }
  lines.push(e.closing);
  const unavailable=e.feeds?.filter(f=>f.error).map(f=>f.title);
  if(unavailable?.length)lines.push('Unavailable sources: '+unavailable.join(', '));
  return {title:`Daily news · ${e.day} · ${e.title}`,text:lines.filter(Boolean).join('\n\n')};
}

export async function photonRequest(c, path, method='GET', body) {
  const r=await fetch(`https://spectrum.photon.codes/projects/${c.projectId}/${path}`,{method,headers:{Authorization:'Basic '+Buffer.from(c.projectId+':'+c.projectSecret).toString('base64'),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Photon could not be reached. No paid fallback was used.');
  if(r.status===204)return null;
  const d=await r.json();if(!d.succeed)throw Error('Photon refused the request.');return d.data;
}

export async function requireFreeProject(c, request=photonRequest) {
  const bill=await request(c,'billing/subscription');
  if(bill.tier!=='free' || bill.subscription_id || bill.customer_id)throw Error('Sending paused: this project no longer matches the zero-billing configuration.');
  return bill;
}

export async function photonSend({credentials,recipient,message,id,onAccepted=()=>{}}) {
  // Fail closed on subscription changes. The only transport used is iMessage.
  await requireFreeProject(credentials);
  const users=await photonRequest(credentials,'users/');
  const user=users.users?.find(u=>u.phoneNumber===recipient.phone && u.meta?.opt_in===true);
  if(!user)throw Error(`${recipient.name} needs to text “Hi Garden” to their GardenOS number first.`);
  const auth=await photonRequest(credentials,'imessage/tokens','POST');
  if(auth.type!=='shared')throw Error('Only the free shared route is enabled.');
  const {createGrpcClient}=await import('@photon-ai/advanced-imessage/grpc');
  const client=createGrpcClient({address:'imessage.spectrum.photon.codes:443',token:auth.token,tls:true,retry:false,timeout:12000});
  try {
    // Photon currently rejects MessageService.sendText for opted-in users.
    // ChatService with an opening message works, even for an existing DM.
    const result=await client.chats.create([recipient.phone],{message,clientMessageId:id});
    const m=result.initialMessage;
    if(!m)throw Error('Photon did not acknowledge the message. Check your phone before sending again.');
    onAccepted(m.guid);
    let latest=m;
    for(let i=0;i<4 && !latest.isDelivered && !latest.sendErrorCode;i++) {
      await new Promise(resolve=>setTimeout(resolve,750));
      try { latest=await client.messages.get(m.guid); } catch { break; }
    }
    if(latest.sendErrorCode)throw Error('The phone delivery failed. No paid fallback was used.');
    return {state:latest.isDelivered?'delivered':latest.isSent?'sent':'accepted',messageId:m.guid};
  } finally { await client.close(); }
}

export function createMessenger({directory=ROOT,readConfig=loadConfig,readEdition=id=>id?readingEditions().find(e=>e.id===id):readingState().edition,transport=photonSend,now=Date.now}={}) {
  const pending=new Map();let serial=Promise.resolve();
  const file=id=>join(directory,id+'.json');
  const store=async job=>{await fs.mkdir(directory,{recursive:true,mode:0o700});const tmp=file(job.id)+'.tmp';await fs.writeFile(tmp,JSON.stringify(job),{mode:0o600});await fs.rename(tmp,file(job.id));};
  const read=async id=>{if(!/^[a-f0-9]{48}$/.test(id))return null;try{const j=JSON.parse(await fs.readFile(file(id),'utf8'));return now()-j.at<DAYS?j:null;}catch{return null;}};
  const publicJob=j=>({id:j.id,recipient:j.recipientName||j.recipient,state:j.state,error:j.error||null,title:j.content.title});
  async function recipients() {try{const c=await readConfig();return {configured:!!c.projectId&&!!c.projectSecret,recipients:c.recipients.map(r=>({id:r.id,name:r.name}))};}catch{return {configured:false,recipients:[]};}}
  async function enqueue(input) {
    // Serialize validation/deduplication, not network calls.
    const task=serial.then(async()=>{
      const c=await readConfig();
      const who=text(input.recipient,60,'Recipient').toLowerCase();
      const recipient=c.recipients.find(r=>r.id===who || r.name.toLowerCase()===who || r.aliases?.includes(who));
      if(!recipient)throw Error('That resident is not connected. Choose a name from Send to.');
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId||''))throw Error('A send request ID is required.');
      let content;
      if(input.kind==='daily')content=editionContent(await readEdition(input.editionId));
      else if(input.kind==='note')content={title:'A note from the Garden',text:text(input.text,4000,'Note')};
      else if(input.kind==='snapshot')content={title:text(input.title,240,'Title'),text:text(input.text,60000,'Content'),url:validURL(input.url)};
      else throw Error('Choose the daily summary, an open item, or a note.');
      const hash=createHash('sha256').update(JSON.stringify([recipient.id,content])).digest('hex');
      let recent=0;
      for(const entry of await fs.readdir(directory).catch(()=>[])) {
        if(!/^[a-f0-9]{48}\.json$/.test(entry))continue;
        const j=await read(entry.slice(0,-5));
        if(!j){await fs.unlink(join(directory,entry)).catch(()=>{});continue;}
        if(j.requestId===input.requestId){if(j.hash!==hash)throw Error('This request ID belongs to a different message.');return publicJob(j);}
        if(j.hash===hash && now()-j.at<15000)return publicJob(j);
        if(j.recipient===recipient.id && now()-j.at<60000)recent++;
      }
      if(recent>=10)throw Error('Too many messages just now. Try again in a minute.');
      const id=randomBytes(24).toString('hex');
      const job={id,requestId:input.requestId,hash,recipient:recipient.id,recipientName:recipient.name,at:now(),state:'sending',content,kind:input.kind};
      // Deliver the actual content in Messages. A link through the house tunnel
      // adds an ngrok interstitial and makes old messages depend on its uptime.
      const message=input.kind==='note'?`Note from GardenOS\n\n${content.text}`:`${content.title}\n\n${content.text}${content.url?'\n\nOriginal / directions: '+content.url:''}`;
      await store(job);
      const work=(async()=>{
        try {
          const result=await transport({credentials:c,recipient,message,id,onAccepted:()=>{job.state='accepted';}});
          Object.assign(job,result);
        } catch(e) {
          // Unknown network outcomes must never be automatically retried.
          job.state=/delivery failed/.test(e.message)?'failed':job.state==='accepted'?'accepted':/needs to text|zero-billing|Only the free|Target not allowed|Photon could not be reached|Photon refused/.test(e.message)?'failed':'uncertain';
          job.error=job.state==='uncertain'?'Delivery is uncertain. Check the phone before sending again.':String(e.message).includes('Target not allowed')?'Photon has not activated this recipient. Ask them to text Hi Garden first.':e.message.includes('needs to text')||e.message.includes('zero-billing')?e.message:'Photon could not finish delivery. No paid fallback was used.';
        }
        await store(job);
      })().finally(()=>pending.delete(id));
      pending.set(id,work);
      return publicJob(job);
    });
    serial=task.catch(()=>{});return task;
  }
  async function status(id){const j=await read(id);if(!j)return null;if(j.state==='sending'&&!pending.has(id)){j.state='uncertain';j.error='Sending was interrupted. Check the phone before sending again.';}return publicJob(j);}
  return {enqueue,recipients,status,read,drain:()=>Promise.all([...pending.values()])};
}
export const messenger=createMessenger();

export async function serveSharedItem(req,res,path,directory=ROOT) {
  const match=path.match(/^\/s\/([a-f0-9]{48})$/);if(!match)return false;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return true;}
  let j;try{j=JSON.parse(await fs.readFile(join(directory,match[1]+'.json'),'utf8'));}catch{}
  if(!j||j.kind==='note'||Date.now()-j.at>DAYS){res.writeHead(404,{'Content-Type':'text/plain'});res.end('This shared item is unavailable or has expired.');return true;}
  const c=j.content;
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(c.title)} · GardenOS</title><style>body{margin:0;background:#092018;color:#edfff5;font:18px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:28px 22px}h1{font-size:clamp(26px,6vw,40px);line-height:1.2}p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#a1eabb}small{color:#a0b9ac}</style><main><small>GARDENOS · SAVED ${escape(new Date(j.at).toLocaleString('en-US',{timeZone:config.tz}))}</small><h1>${escape(c.title)}</h1>${c.url?`<p><a href="${escape(c.url)}" rel="noreferrer">Open original / directions ↗</a></p>`:''}<p>${escape(c.text).replace(/https?:\/\/[^\s<]+/g,url=>`<a href="${url}" rel="noreferrer">${url}</a>`)}</p><small>Saved snapshot · times and live information may have changed. Available for 30 days. Anyone with this link can read this item.</small></main></html>`;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?'':html);return true;
}
