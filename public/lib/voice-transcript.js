// Only the active utterance, in memory. Nothing goes to storage.
export function makeTranscript({ cancel, style = '' } = {}) {
  if(style && !document.getElementById('voice-transcript-style')) { const s=document.createElement('style');s.id='voice-transcript-style';s.textContent=style;document.head.append(s); }
  const root=document.createElement('section');root.id='voiceTranscript';root.hidden=true;root.setAttribute('aria-label','Voice input');
  const label=document.createElement('div');label.className='vt-label';
  const text=document.createElement('div');text.className='vt-text';text.setAttribute('aria-live','polite');text.setAttribute('aria-atomic','true');
  const button=document.createElement('button');button.type='button';button.textContent='Cancel';button.addEventListener('click',()=>cancel?.());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden){e.preventDefault();e.stopImmediatePropagation();cancel?.();}},true);
  root.append(label,text,button);document.body.append(root);let hideTimer;
  return { update(words='',phase='Listening') {clearTimeout(hideTimer);root.hidden=false;label.textContent=phase;text.textContent=words || 'Speak when you’re ready…';}, hide(delay=0) {clearTimeout(hideTimer);hideTimer=setTimeout(()=>{root.hidden=true;text.textContent='';},delay);}, root };
}
