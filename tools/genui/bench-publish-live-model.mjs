// Publishes an existing opt-in observation; never starts a model or browser.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const path='docs/performance/v6/live-model.json';
if(!existsSync(path)){console.log('No opt-in live-model artifact; keeping model suite absent.');process.exit(0);}
const d=JSON.parse(readFileSync(path,'utf8'));
if(d.samples!==1||!Number.isFinite(d.firstUsefulMs)||!Number.isFinite(d.providerCompleteMs))throw Error('Expected one valid recorded live-model observation.');
const round=x=>Math.round(x*100)/100;
const notes=[
 'One live observation using '+d.model+'. Forced tool choice and a synthetic prompt; the result does not compare models or measure normal intent routing.',
 'Fine-grained tool streaming is enabled on the A2UI tool using eager_input_streaming:true. Official documentation: https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming',
 'First rendered content is the first GardenMetric observed in the actual isolated browser. It does not include wake word, speech capture, ASR or physical screen presentation.',
];
const buffered='docs/performance/v6/live-model-buffered.json';
if(existsSync(buffered)){
 const b=JSON.parse(readFileSync(buffered,'utf8'));
 notes.push(`An earlier buffered observation rendered content at ${round(b.firstUsefulMs)} ms, after provider completion at ${round(b.providerCompleteMs)} ms. Its renderedBeforeProviderComplete flag was false. The saved passed flag reflects the older completion criterion; it does not establish progressive visibility. Raw observation retained in live-model-buffered.json.`);
 notes.push('The current call and the buffered call are single independent observations. Their timing difference is not a statistical speedup estimate; the demonstrated behavior is rendering before provider completion.');
}
const suite={id:'live-model-stream',title:'The model starts drawing before it finishes',description:'A real Haiku tool response reaches the production stream bridge and official A2UI browser renderer.',measuredAt:d.measuredAt,method:d.method,limits:d.limits+' No p95 or latency distribution is estimated. This opt-in cloud test incurs provider usage; the ordinary benchmark runner only republishes its existing artifact.',metrics:[
 {id:'live-model-first-content',label:'First rendered content','unit':'ms',median:round(d.firstUsefulMs),p95:null,samples:1,warmth:'one live provider observation; forced A2UI tool',values:[round(d.firstUsefulMs)]},
 {id:'live-model-provider-complete',label:'Provider response complete','unit':'ms',median:round(d.providerCompleteMs),p95:null,samples:1,warmth:'same live provider observation',values:[round(d.providerCompleteMs)]},
 ],checks:{passed:d.renderedBeforeProviderComplete===true?1:0,total:1},notes};
for(const reportPath of ['docs/performance/v6/benchmarks.json','public/genui/benchmarks.json']){
 const report=JSON.parse(readFileSync(reportPath,'utf8'));report.generatedAt=new Date().toISOString();if(report.environment?.notes)report.environment.notes=report.environment.notes.replace('No microphone capture, model inference or production device actions.','No microphone capture or production device actions. The separately labelled live-model suite republishes one opt-in provider observation.');report.suites=report.suites.filter(s=>s.id!==suite.id);report.suites.push(suite);writeFileSync(reportPath,JSON.stringify(report,null,2));
}
console.log('Published existing live-model observation; progressive visibility:',d.renderedBeforeProviderComplete===true);
