// Turn editing is deliberately conservative. Partial text is display-only.
const norm = t => String(t || '').toLowerCase().replace(/[,.!?;:]+/g,' ').replace(/\s+/g,' ').trim();
const CANCEL = /^(?:please )?(?:cancel(?: that| this| my request| the request| this message| the voice message)?|never mind|nevermind|scratch that|stop listening|stop (?:the |this )?(?:voice )?(?:message|recording|request)|discard (?:that|this|the message))$/;
export function editUtterance(raw) {
  const text=String(raw||'').trim(), t=norm(text);
  if(CANCEL.test(t) || /^(?:stop|please stop|stop that|don't do that|do not do that)$/.test(t))return {kind:'cancel',text:''};
  // Quoted/dictated content stays with the model, including literal “cancel that”.
  if(/\b(?:say|type|write|quote|search for|look up)\b/i.test(text) || /\b(?:don't|do not|not|never) (?:cancel|stop|discard)\b/i.test(text) || (/^(?:how|why|what|when|explain|tell me)\b/i.test(text) && !/\b(?:and|because|for|to|the|actually|i mean|wait|no)$/i.test(t)))return {kind:'submit',text};
  const suffix=t.match(/^(.*?)\b(?:actually )?(cancel that|never mind|scratch that|stop listening|discard that)$/);
  if(suffix && suffix[1].trim())return {kind:'cancel',text:''};
  const restart=/(?:^|[\s,;.])(?:no[ ,]+actually|actually|i mean|instead)[ ,:]+((?:open|show|start|set|stop|cancel|go|make|move|hide|add|remove|turn|what|how|why)\b[\s\S]*)$/i.exec(text);
  if(restart) { const next=restart[1].trim(); return CANCEL.test(norm(next)) || norm(next)==='stop' ? {kind:'cancel',text:''} : {kind:'correct',text:next}; }
  const number='(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)';
  const timer=new RegExp(`^((?:start|set)(?: a)? (?:timer|countdown) for )${number}(?: (?:seconds?|minutes?))?[, ]+(?:no|sorry|actually|i mean)[, ]+(${number} (?:seconds?|minutes?))$`,'i').exec(t);
  if(timer)return {kind:'correct',text:timer[1]+timer[2]};
  const noun=t.match(/^(open|show)(?: the)? (weather|clock|hacker news|air quality|transit|rss)[, ]+(?:no|actually|i mean)[, ]+(?:the )?(weather|clock|hacker news|air quality|transit|rss)$/);
  if(noun)return {kind:'correct',text:`${noun[1]} the ${noun[3]}`};
  // An unfinished correction must not execute the abandoned request.
  if(/\b(?:actually|i mean|wait|hold on|no sorry|no|sorry|uh|um|and|because|for|to|the)$/i.test(t))return {kind:'wait',text};
  return {kind:'submit',text};
}
export function silenceBudget(text) { return editUtterance(text).kind==='wait' ? 2200 : 750; }

export class VoiceTurns {
  current=null; sequence=0;
  begin() { this.cancel(); const turn={id:++this.sequence,controller:new AbortController()}; this.current=turn; return turn; }
  cancel() { this.current?.controller.abort(); this.current=null; }
  isCurrent(turn) { return this.current===turn && !turn.controller.signal.aborted; }
}
