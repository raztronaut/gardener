// Printing decisions are deliberately literal; the LLM never infers consent.
export function signDecision(text){
 const t=String(text||'').toLowerCase().replace(/[.!?,]+/g,' ').replace(/\s+/g,' ').trim();
 if(/^(?:please )?(?:cancel(?: (?:it|this|that|the sign))?|never mind|nevermind|stop|no(?: thanks| thank you)?|don['’]?t print(?: it| that| this)?|do not print(?: it| that| this)?)$/.test(t))return 'cancel';
 if(/^(?:(?:yes|yeah|yep|sure|okay|ok)(?: please)?(?: (?:print(?: it| this| that| the sign)?|go ahead(?: and print(?: it)?)?))?|(?:please )?print (?:it|this|that|the sign)(?: please)?|looks good(?: print it)?|it['’]s ready to print)$/.test(t))return 'approve';
 return 'other';
}
export function isSignRequest(text){return /\b(?:sign|signage|placard|poster|garden directive|organization research|organisation research)\b/i.test(String(text||''));}
export function routeSignUtterance(text,sign,startedAt=Date.now()){
 const decision=signDecision(text);
 const t=String(text||'').trim().replace(/[.!?]+$/,'');
 const bare=/^(?:(?:hey garden|please|can you|could you|i want to|i need to|let['’]s)\s+)*(?:make|create|design|print|open|start)(?: me)? (?:a |the )?(?:new )?(?:sign|sign studio|garden directive(?: on organi[sz]ation research)?)(?: please)?$/i.test(t);
 if(!sign&&(bare||/^(?:i (?:want|need)|i['’]d like) (?:a |the )?(?:new )?(?:sign|garden directive(?: on organi[sz]ation research)?)$/i.test(t)))return {name:'sign',input:{action:'open'}};
 if(sign&&/^(?:please )?(?:review(?: this| that| the)?(?: preview| sign| version)?|retry(?: printing)?|try (?:printing )?again)$/i.test(t))return {name:'sign',input:{action:sign.status==='failed'?'revise':'review',...(sign.status==='failed'?{intent:'Try again with the same meaning and a newly generated illustration.'}:{})}};
 if(sign&&decision==='approve'){
  if(['submitted','submitting','uncertain'].includes(sign.status))return {name:'sign',input:{action:'status'}};
  if(sign.dirty||!sign.approval||startedAt<sign.approval.issuedAt)return {error:'Please review the current preview before approving it.'};
  return {name:'sign',input:{action:'approve',id:sign.id,version:sign.version,token:sign.approval.token,utterance:text,startedAt}};
 }
 if(sign&&decision==='cancel')return {name:'sign',input:{action:'cancel',id:sign.id,version:sign.version}};
 // Navigation leaves the sign conversation available to the ordinary wall router.
 const navigation=/^(?:hey garden[,]? )?(?:open|show|close|go back|play|stop playing|turn|switch|send|text|message)\b/i.test(t)&&!isSignRequest(t);
 if(sign&&!navigation){
  if(/^(?:maybe|perhaps|not yet|i don['’]?t know|i['’]?m not sure)$/i.test(t))return {name:'sign',input:{action:'clarify'}};
  if(sign.status==='brief')return {name:'sign',input:{action:'create',intent:text}};
  if(!/^(?:what|why|how|when|where|is|are|do|does|can)\b/i.test(t)||/\b(?:change|replace|regenerate|draw|image|picture|illustration|xml|tag|key|headline|phrase|shorter|longer|instead|missing|exception)\b/i.test(t))return {name:'sign',input:{action:'revise',intent:text,id:sign.id,version:sign.version}};
 }
 if(isSignRequest(text)&&/\b(?:make|create|design|generate|print|need|want)\b/i.test(text))return {name:'sign',input:{action:'create',intent:text}};
 return null;
}
