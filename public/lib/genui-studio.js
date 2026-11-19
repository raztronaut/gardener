import {streamBriefing} from './briefing-data.js';
const CATALOG='https://garden.local/catalogs/house-v1.json';
export const FLOWS=[
 ['briefing','Your day, assembled','Weather, reading and the next ride. Real sources arrive independently.'],
 ['commute','Out the door','A quick weather check, nearby departures and a destination you can change.'],
 ['controls','The house, at your fingertips','Routes, volume, soundscapes and Garden views in one composition.'],
 ['focus','Make a little space','Choose a timer and a forest recording. Start each when you are ready.'],
 ['packing','Ready to leave','An editable checklist that stays put as you tick things off.'],
 ['catalog','The building blocks','Explore interactive fields, choices, progress, tables and a chart.'],
];
export async function showStudio(act,flow=''){
 flow=flow.trim().toLowerCase();if(['performance','benchmarks'].includes(flow))return act({name:'command',input:{name:'benchmarks'}});
 if(!FLOWS.some(f=>f[0]===flow))flow='home';
 const id='studio-'+crypto.randomUUID(),nodes=[],children=[];const data={destination:'Ferry Building',duration:'25',volume:35};
 const node=(component,props={},key)=>{const n={id:key||'n'+nodes.length,component,...props};nodes.push(n);return n.id;};
 const add=(type,props,key)=>{const n=node(type,props,key);children.push(n);return n;};
 const text=(value,variant='body')=>add('Text',{text:value,variant});
 const button=(label,name,context={})=>add('Button',{child:node('Text',{text:label}),action:{event:{name,context}}});
 const field=(label,path)=>add('TextField',{label,value:{path},variant:'shortText'});
 const choices=(title,items)=>{text(title,'h3');for(const [label,name,context]of items)button(label,name,context);};
 const heading=FLOWS.find(f=>f[0]===flow)?.[1]||'What shall we make?';
 if(flow==='home'){
  add('GardenNotice',{title:'A little thought becomes a useful place.',text:'Try a live briefing, plan your next journey, or compose a few house controls. Keep the useful things as widgets.'});
  for(const [key,title,description]of FLOWS){text(description,'caption');button(title,'garden.demo',{flow:key});}
  button('Explore the Performance lab','garden.open',{target:'benchmarks'});
 }else if(flow==='briefing'||flow==='commute'){
  const sections=flow==='commute'?['weather','departures']:['weather','departures','news'];
  for(const key of sections){data[key]={label:{weather:'Outside',departures:'Your next ride',news:'Today, in a nutshell'}[key],text:'Connecting…',value:'—'};add(key==='weather'?'GardenMetric':'GardenNotice',key==='weather'?{label:{path:'/weather/label'},value:{path:'/weather/value'},detail:{path:'/weather/text'}}:{title:{path:`/${key}/label`},text:{path:`/${key}/text`}},key);}
  field('Where are you heading?','/destination');button('Find a way · walking, rides & arrival','garden.directions',{destination:{path:'/destination'}});
  for(const [key,label]of [['weather','Explore the weather'],['transit','See buses on the map'],['rss','Open the reading room']])button(label,'garden.open',{target:key});
 }else if(flow==='controls'){
  add('GardenNotice',{title:'Your house, one gesture away.',text:'Settle in, head out, or change the mood. Choose what you need.'});
  field('Take me to','/destination');button('Plan this journey','garden.directions',{destination:{path:'/destination'}});
  add('Slider',{label:'Speaker volume',value:{path:'/volume'},min:0,max:100});button('Set speaker volume','garden.volume',{set:{path:'/volume'}});
  choices('Make it feel like home',[
   ['Amazon morning','garden.ambience',{place:'amazon'}],['Quiet, please','garden.ambience',{place:'off'}],
   ['Read the latest','garden.open',{target:'rss'}],['See my tasks','garden.open',{target:'todos'}],
   ['Arrange the wall','garden.layout',{action:'edit'}],['Back to the wall','garden.home',{}],
  ]);
 }else if(flow==='focus'){
  add('GardenNotice',{title:'A clearing for your attention.',text:'Choose how long you need. Timer and sound are independent, so you can keep either one quiet.'});
  field('Minutes to focus','/duration');button('Start my timer','garden.timer',{duration:{path:'/duration'}});
  button('Bring in the Olympic forest','garden.ambience',{place:'olympic'});button('Stop the timer','garden.timer',{duration:'off'});button('Quiet the forest','garden.ambience',{place:'off'});
 }else if(flow==='packing'){
  add('GardenNotice',{title:'The little things, remembered.',text:'A starting checklist you can use right now. It is a suggestion, not a weather forecast.'});
  for(const [i,label]of ['Keys and wallet','Phone and battery','Water bottle','A layer for later','Headphones'].entries()){data['check'+i]=false;add('CheckBox',{label,value:{path:'/check'+i}});}
  field('One more thing to remember','/extra');data.extra='';button('Check the actual weather','garden.open',{target:'weather'});
 }else if(flow==='catalog'){
  add('GardenNotice',{title:'A palette of possibilities.',text:'Example values below demonstrate composition. These are not live house measurements.'});
  add('GardenMetric',{label:'An idea, made visible',value:'24',detail:'Registered components · 13 house action types'});
  data.progress=64;add('GardenProgress',{label:'Example progress',value:{path:'/progress'}});add('Slider',{label:'Change the example',value:{path:'/progress'},min:0,max:100});
  add('GardenSteps',{title:'From a request to a useful surface',items:['Say what you need','Watch useful pieces appear','Adjust the details','Keep it as a widget']});
  add('GardenTable',{columns:['Composition','Purpose'],rows:[['Small','One essential thing'],['Wide','A little more context'],['Page','Explore and act']]});
  add('GardenBars',{label:'Example rhythm · illustrative values',values:[24,68,42,90],labels:['Morning','Noon','Afternoon','Evening']});
  field('Try an editable field','/destination');button('See measured performance instead','garden.open',{target:'benchmarks'});
 }
 nodes.unshift({id:'root',component:'Column',children});
 const wrap=(kind,body)=>({version:'v0.9',[kind]:{surfaceId:id,...body}});
 const sections=flow==='commute'?['weather','departures']:['weather','departures','news'];
 const result=await act({name:'a2ui',input:{title:heading,status:['briefing','commute'].includes(flow)?'Connecting the pieces…':'Ready when you are.',...(['briefing','commute'].includes(flow)?{recipe:{kind:'briefing',sections}}:{}),messages:[wrap('createSurface',{catalogId:CATALOG}),wrap('updateDataModel',{path:'/',value:data}),wrap('updateComponents',{components:nodes})]}});
 if(result.ok&&['briefing','commute'].includes(flow)){
  // Independent source requests; stable ids and bindings preserve focus/edits.
  let open=true;streamBriefing(sections,window.__GARDEN_STATE||{},async block=>{
   if(!open)return;const r=await act({name:'a2ui',input:{messages:[wrap('updateDataModel',{path:'/'+block.id,value:{label:block.label,value:block.value||'—',text:block.text||(block.items||[]).join('\n')}})]}});if(!r.ok)open=false;
  }).then(()=>open&&act({name:'a2ui',input:{status:'Ready · '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' · keep this as a living widget',messages:[wrap('updateDataModel',{path:'/ready',value:true})]}}));
 }
 return result;
}
