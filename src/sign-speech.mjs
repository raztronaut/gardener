export const SIGN_PROMPTS={
 brief:'What should this sign help people do? Tell me in your own words.',
 review:'Here is your sign. Is this version ready to print, or would you like to change something?',
 revised:'Here is the updated sign. Is this version ready to print, or would you like another change?',
 submitted:'The printer accepted your sign. Please collect it from the printer.',
 'print-failed':'The printer could not accept the sign. Your preview is saved. Say retry printing when you are ready.',
 uncertain:'The printer did not confirm receipt. I will not send it twice. Please check the printer.',
 failed:'I could not finish that sign. Nothing was printed. You can tell me what to try again.',
 cancelled:'Cancelled. Nothing was printed.',
 clarify:'Nothing was printed. Tell me what you would like to change, or say yes, print it.',
};
export async function playSignSpeech(kind){
 if(!Object.hasOwn(SIGN_PROMPTS,kind))throw Error('Unknown sign prompt.');
 // Playback belongs to this preview's browser: closing it stops speech immediately.
 return {ok:true,audio:'/api/signs/speech/'+kind+'.wav',text:SIGN_PROMPTS[kind]};
}
