// Only recover confirmed input loss on an idle, readable dashboard.
export function inputDecision(state, sample) {
  const {now,rawCount,lastRaw,page,window:win,voiceIdle} = sample;
  const safe = win?.kiosk && !win.buttonsDown && page?.safe && voiceIdle;
  const lost = safe && !page.fresh && rawCount >= 10 && now-lastRaw < 2500 && now-page.lastInput > 7000;
  if (!lost) return {since:0,strikes:0,recover:false};
  const since=state.since||now,strikes=(state.strikes||0)+1;
  return {since,strikes,recover:strikes>=3 && now-since>=10000};
}

// Injected by a separate process, never logs keys, coordinates or household text.
export function probePage() {
  let fresh=false;
  if (!window.__gardenInputHealth) {
    fresh=true;
    const probe={lastInput:Date.now()};
    for (const type of ['pointermove','pointerdown','wheel','keydown']) {
      window.addEventListener(type,e=>{if(e.isTrusted)probe.lastInput=Date.now();},{capture:true,passive:true});
    }
    window.__gardenInputHealth=probe;
  }
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const ctx=window.gardenWall?.context();
  const drafts=[...document.querySelectorAll('textarea,input:not([type=checkbox]):not([type=radio]):not([type=range]),[contenteditable=true]')]
    .some(e=>visible(e)&&(e===document.activeElement||!!String(e.value||e.textContent||'').trim()));
  const overlays=[...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open],#volMenu,.widget-drawer,.widget-size-picker,#voiceCalib')].some(visible);
  const safe=!!ctx&&ctx.dashboard==='main'&&!ctx.open&&!ctx.palette&&!ctx.game?.playing&&!ctx.night&&!ctx.layout?.editing&&
    document.visibilityState==='visible'&&document.hasFocus()&&!document.pointerLockElement&&!drafts&&!overlays;
  return {safe,fresh,lastInput:window.__gardenInputHealth.lastInput,page:ctx?.layout?.page||1};
}
