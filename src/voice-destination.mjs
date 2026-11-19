// Screen ownership is independent of the microphone, which remains on Garden.
const TV=/\b(?:on|onto|over on|over to)\s+(?:(?:the|my)\s+)?(?:garden\s*tv(?:\s+os)?|television|t[.\s]*v)\b\.?/ig;
const WALL=/\b(?:on|onto|over on|over to)\s+(?:(?:the|my)\s+)?(?:garden(?:\s+wall)?|wall)(?!\s*tv)\b/ig;
export function destinationPhrase(raw){
 const text=String(raw||'').normalize('NFKC');const matches=[...text.matchAll(TV)].map(m=>({at:m.index,to:'tv'})).concat([...text.matchAll(WALL)].map(m=>({at:m.index,to:'garden'}))).sort((a,b)=>a.at-b.at);
 if(!matches.length)return {text:text.trim(),destination:null};
 return {text:text.replace(TV,'').replace(WALL,'').replace(/\s+([,.!?])/g,'$1').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim(),destination:matches.at(-1).to};
}
export function makeDestination({now=Date.now,ttl=90000}={}){
 let current='garden',origin='garden',recent='garden',until=0;
 return {get current(){return current;},begin(explicit){origin=explicit==='tv'||explicit==='garden'?explicit:now()<until?recent:'garden';return current=origin;},preview(text){return current=destinationPhrase(text).destination||origin;},resolve(text){const p=destinationPhrase(text);current=p.destination||origin;return {...p,destination:current};},remember(){recent=current;until=now()+ttl;},end(){recent='garden';until=0;}};
}
