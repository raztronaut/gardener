// One allowlist for generated controls, voice discovery and direct wall actions.
export const ACTION_CATALOG={
 'garden.send':{description:'Explicitly send an open item, daily summary or note to a connected resident',fields:['recipient','kind','text']},
 'garden.open':{description:'Open an existing widget or panel',fields:['target']},
 'garden.close':{description:'Close the current panel',fields:[]},
 'garden.home':{description:'Return to the house wall',fields:[]},
 'garden.volume':{description:'Set speaker volume 0–100',fields:['set']},
 'garden.layout':{description:'Arrange existing widgets/pages',fields:['action','widget','size','page','before','after']},
 'garden.theme':{description:'Switch an existing theme',fields:['theme']},
 'garden.timer':{description:'Start a countdown, or stop it',fields:['duration']},
 'garden.ambience':{description:'Play a real rainforest recording, or stop it',fields:['place']},
 'garden.directions':{description:'Plan a real journey to a destination',fields:['destination']},
 'garden.feeds':{description:'Discover/manage/connect RSS feeds',fields:['query']},
 'garden.briefing':{description:'Compose a live weather/news/departures brief',fields:['sections']},
 'garden.pin':{description:'Save the open composition as a widget',fields:[]},
 'garden.demo':{description:'Open a working GenUI scenario',fields:['flow']},
};
const str=(v,max=180)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('A non-empty bounded text value is required.');return v.trim();};
export function resolveGardenAction(name,c={}){
 if(!Object.hasOwn(ACTION_CATALOG,name)||!c||typeof c!=='object'||Array.isArray(c))throw Error('Unknown Garden action.');
 const command=(name,arg='')=>({name:'command',input:{name,arg}});
 switch(name){
 case 'garden.send':if(!['daily','current','note'].includes(c.kind))throw Error('Unknown message kind.');return {name:'send',input:{recipient:str(c.recipient,60),kind:c.kind,...(c.kind==='note'?{text:str(c.text,4000)}:{})}};
 case 'garden.open':return {name:'open',input:{target:str(c.target,80)}};
 case 'garden.close':return {name:'close',input:{}};
 case 'garden.home':return {name:'dashboard',input:{id:'main'}};
 case 'garden.volume':if(!Number.isInteger(c.set)||c.set<0||c.set>100)throw Error('Volume must be 0–100.');return {name:'volume',input:{set:c.set}};
 case 'garden.layout':if(!['inspect','resize','reorder','move','add','remove','page','add_page','remove_page','edit','done'].includes(c.action))throw Error('Unknown layout operation.');return {name:'layout',input:Object.fromEntries(ACTION_CATALOG[name].fields.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]))};
 case 'garden.theme':if(!['classic','moonstone'].includes(c.theme))throw Error('Unknown theme.');return command('theme',c.theme);
 case 'garden.timer':return command('timer',str(c.duration,20));
 case 'garden.ambience':if(!['amazon','borneo','daintree','olympic','yosemite','atlantic','off'].includes(c.place))throw Error('Unknown soundscape.');return command('rainforest',c.place);
 case 'garden.directions':return command('transit',str(c.destination));
 case 'garden.feeds':return command('rss',str(c.query));
 case 'garden.briefing':return command('briefing',typeof c.sections==='string'?c.sections.slice(0,180):'');
 case 'garden.pin':return command('pin');
 case 'garden.demo':return command('genui',str(c.flow,40));
 }
}
