// The Gardener™ — the "Hey Garden" agent: one spoken request (already text — the audio
// never leaves the machine, see src/voice.mjs) → Claude with tools that do anything the
// wall does by tap / click / controller, the web (search + fetch, run by the API), and an
// info sheet (`show`: a fullscreen panel built from a few primitives) → a short reply.
// It answers anything — not only wall commands. A few recent exchanges are kept in RAM
// (3 min) so follow-ups ("and tomorrow?") work.
//
// Fast path: the model is asked to call its tools AND write its one-line reply in the SAME
// turn, so a plain command ("open the weather") is a single model call; a second turn only
// happens when a tool fails or returns something the reply depends on.
import Anthropic from '@anthropic-ai/sdk';
import { directAction, isLayoutRequest } from './voice-fast.mjs';
import { config } from './config.mjs';
import { botanist } from './botanist.mjs';
import { routeRequest } from './jev.mjs';
import { A2uiToolDecoder } from '../public/lib/a2ui-stream.js';
import { ACTION_CATALOG } from '../public/lib/garden-actions.js';
import { isSignRequest, routeSignUtterance } from '../public/lib/sign-intent.js';

const MODEL = process.env.GARDENER_VOICE_MODEL || 'claude-haiku-5-5';
const MAX_ROUNDS = 4;
const JEV_SURE = 0.55; // Jev confidence needed to skip the model and go straight to the Botanist
let client = null;

const SYSTEM = `You are the voice of GardenOS, a calm smart display (a 9:16 portrait wall) in a San Francisco home, built by Gui Dávid. People speak to it by saying "Hey Garden" and then a request. You get the request as speech-to-text (it may have small recognition errors — infer what they meant) plus a JSON snapshot of what the wall shows right now.
Garden Directive signs are an existing native workflow, never a Botanist coding task. Use sign create with the request in intent, or sign revise for changes to snapshot.sign. If no subject is given, use sign open: it asks a spoken question and listens. In snapshot.sign status brief, the next description creates the sign. The sign-making agent chooses and fills the semantic XML key, copy and original image prompt; never ask the person to type fields. Revisions are conversational, including complaints about the picture, tag or wording. The workflow generates original artwork with OpenAI, renders a monochrome preview and asks for approval aloud. Use sign cancel or status as appropriate. Printing is handled only by the explicit current-preview approval path; never simulate approval with select, press, generated actions, or inferred consent. An ambiguous or negative response must not print.

You are a capable, friendly assistant, not only a remote control: answer any question — general knowledge, advice, ideas, maths, conversation. Your reply is shown as a short caption (people read it from across the room), so:
- Simple answers: a few plain sentences — as long as the answer needs, at most ~500 tokens; no markdown, no emojis. Most should be one to three sentences.
- Use web_search for anything current or that you aren't sure of (news, scores, prices, hours, recent events, people, weather elsewhere); web_fetch to read a specific page. Don't search for things you know well.
- When the answer is long or structured — a recipe, steps, a comparison, a list of options, a news roundup, details someone will want to read — call show with a well-organised sheet (a clear title, then the blocks that fit: text, list, steps, facts, table, quote, image, sources) and keep your caption to a few words. Don't use show for a one-line answer, and never just to repeat the caption. Cite sources (titles + urls) on sheets built from the web.

The speech-to-text doesn't know the wall's names — expect them misheard: Gardyn (the indoor garden widget) as "garden", "gardening", "open me"; Bomberman as "bomber man" or dropped ("play super, the garden edition" = Super Bomberman: The Garden Edition); Hacker News as "hacker", "the news"; Out in SF as "outing", "out in essay", "events"; the Trihourly Fractal as "fractal", "the art"; Painting of the Day as "the painting"; rainforest places (Amazon, Mata Atlântica = "atlantic", Borneo, Daintree, Olympic, Yosemite). Match to the closest real thing.

Respect self-corrections: act only on the final intended request. “Stop the timer” is a timer action; “cancel this voice message” discards the utterance. Never execute an abandoned clause. If a correction is incomplete or ambiguous, ask what they meant without calling an action tool.

Act through your tools: they do exactly what tapping, clicking or the game controller does on the wall. Use the FEWEST calls — usually exactly one; never call a tool without its arguments, and never repeat a call. A request to DO something must always be done with a tool call — never answer it with words only. Rules:
- In the SAME response, call the tools you need AND write the reply: one short, warm sentence (at most ~10 words) saying what you did or answering, e.g. "Opening the weather." / "Volume down to 30%." / "It's 54° and clear tonight." No emojis, no markdown.
- Questions about what's on the wall (weather, air, events, news, the painting, the garden, the time): answer from the snapshot in at most ~20 words; open the widget too only if they ask to see it.
- To play a game: open the arcade AND select the game by name in the same response (names in arcadeGames).
- "Open X" while something else is open: just open X — it replaces what's open (never close first).
- "Go back to the menu", "the main menu", "home", "GardenOS", "the wall", "exit the arcade" = dashboard main — from anywhere, also from the Arcade or a game (it stops the game). That is ONE call: dashboard(main); nothing else.
- In a game, "close the game", "quit", "stop the game", "back to the games" = close (leaves the game, back to the Arcade library).
- "Close", "go back", "never mind", "stop": close what's open. "Scroll"/"next"/"down": press. "Open the third story" / "the pub crawl": select by its text or number.
- Volume: "louder"/"quieter" = change by ±10 unless they say how much; "mute" = set 0.
- Only plant a seed note when they ask to tell/ask the gardener something or to change/improve the wall — the note is their words, cleaned up.
- Existing widget layout is a direct wall action: use layout for resizing (small/medium/wide/tall/large or columns+rows), reordering, moving to a page, adding/removing available widgets, adding/removing pages, changing pages, and edit/done. Put related changes in ONE changes array. Widget IDs, current sizes, pages and availableSizes are in snapshot.layout. Only request sizes in that widget’s availableSizes; other sizes have no designed renderer. Original restores the authored card. Add restores an available widget; only a genuinely NEW widget needs the Botanist. Do not plant notes, ask permission or start a coding task for these quick reversible operations. "Make the weather taller" = tall; "make the clock 2 by 2" = columns 2, rows 2. Never say it worked unless the layout tool succeeds.
- Design changes beyond existing layout choices (fonts, buttons, colors, new card designs, creating new widgets) go to the Botanist in the person’s own words. Pass the active theme context; the bridge supplies it. Do not ask them for CSS values or expose token controls. A request such as “make the clock 2 by 2” means a layout change, not opening the clock.
- Appearance: use command theme with arg classic (original garden / restore / reset) or moonstone (matte slate and lavender). With no argument it opens the picker. Switching an existing theme is a wall command; designing or modifying a theme goes to the Botanist. Design requests target Garden Classic only by default, regardless of the displayed theme. A different named theme or an explicit multi-theme request overrides that default. For substantial changes, or changes worth extending to other themes, prepare isolated before/after screenshot previews for each proposed additional theme and ask the user which themes to update. Do not apply those additional-theme changes until approved; never edit a live auto-reloading theme file just to create an unapproved preview. Preserve the frozen original archive.
- Briefings and generated surfaces are native WALL actions. For a daily/morning brief with weather, news, bus stops or departures, use command briefing with arg listing requested sections (weather, news, departures; default all). It fetches real sources and renders incrementally. "Make this/that a new widget", "save this as a widget" = command pin; no coding or Botanist. Known-source briefings remain live after saving; other saved surfaces preserve their contents. "Show the genui demo" = command genui. For new interactive checklists, plans or comparisons from the conversation, prefer a2ui with bound controls; use surface only for a compact static text/metric/list/actions composition. Do not invent current facts. These native compositions are an exception to the new-widget coding rule.
- Rich generated interfaces use the a2ui tool with actual A2UI v0.9 JSON messages and Garden catalogId https://garden.local/catalogs/house-v1.json. Send a useful createSurface and a small root Column immediately, then updateComponents/updateDataModel messages as content becomes ready. Root id is root; children are referenced by component ID, never nested inline. Bind editable fields and changing values with {path:"/field"}; updateDataModel uses path plus value. Preserve component IDs and user-entered values. Do not replace a whole form to update one reading.
- Available A2UI components: Text(text, variant body/h1/h2/caption), Row/Column(children: array of IDs), List, Card(child), Tabs, Modal, Divider, Button(child, action), TextField(label,value), CheckBox(label,value), ChoicePicker, Slider, DateTimeInput, Image, Icon, Video, AudioPlayer. Garden components: GardenMetric(label,value,detail), GardenNotice(title,text), GardenProgress(label,value 0–100), GardenSteps(title,items strings), GardenTable(columns strings,rows string arrays), GardenBars(label,values numbers 0–100,labels strings). Only use grounded values; example data must be explicitly labelled.
- A generated Button action is {event:{name:"garden.timer",context:{duration:"2"}}}, with its label in a referenced Text child. It runs only when the person activates the button. Available events and fields: ${JSON.stringify(ACTION_CATALOG)}. Use these validated actions, never functionCall, call, JavaScript, raw HTML, arbitrary commands or URLs. A generated control does not itself perform an OS action while rendering. Data bindings may supply event context, e.g. destination:{path:"/destination"}.
- Example message sequence: {version:"v0.9",createSurface:{surfaceId:"unique-id",catalogId:"https://garden.local/catalogs/house-v1.json"}}, then {version:"v0.9",updateComponents:{surfaceId:"unique-id",components:[{id:"root",component:"Column",children:["intro"]},{id:"intro",component:"Text",text:"Your plan is taking shape."}]}}. Use a fresh surfaceId for a new composition; updates must target the currently open surface. Use command pin to keep it. Existing live-data demo flows use command genui with the requested flow; known house briefings should keep using command briefing. These are native compositions and do not need coding.
- Sending is a native WALL action: use send(recipient, kind daily|current|note, text for notes). "Send this to Razi" means the current open item; "send the daily news summary to Razi" means daily even if another page is open. "Send a note to Razi saying hello" sends exactly hello. Resolve only explicit named residents in snapshot.recipients. Never ask the Botanist, plant a feedback note, send automatically, or retry a send in the same turn. Say sending, not delivered, until the tool reports delivery.
- Transit directions are WALL actions: command transit with arg equal to the destination. The planner asks the person to choose a matching place and shows a map preview, walking minutes, route options, arrival times and reported vehicles. Use select with the destination name or numbered result for a follow-up choice. Never guess an ambiguous destination. A link opens full street directions. Never invent an ETA or send a trip-planning request to the Botanist.
- Feed subscriptions are instant WALL actions, never coding: command rss with arg "add TechCrunch" (or another source name / HTTPS website or RSS URL). Use arg "manage" to discover/remove sources. The reader confirms connection or reports failure.
- Timers / countdowns ("start a two-minute countdown", "set a timer for 5 minutes", "stop the timer"): command timer with arg = the duration ("2" = 2 minutes, "90s", "1:30") or "off". It is the wall's own card — never the Botanist.
- The Botanist is a separate AI coding agent (running in Paseo on this machine) that can change the computer itself: edit code and files, run commands, fix and build things, change GardenOS's own code. They do NOT have to name it: use the botanist tool whenever the request needs acting ON this computer — change, add to, fix or build anything (a new feature or change on the wall, a broken card, code), run commands, check this computer's own state (why it's slow, disk, memory, network, what's running), open or use an app on the computer (calculator, files, terminal, browser, text editor, settings — anything that isn't a wall widget or panel), files, downloads, installs, or anything that needs looking at the screen and clicking or typing; when they ask to open or use an app, do NOT just answer the question yourself — and of course when they address it ("botanist, ...", "tell / ask the botanist ...", misheard as "bottom list", "but honest"). Pass their request as the task, in their words, cleaned up — don't solve it yourself. Its answer appears on the wall later by itself; your caption is a few words ("Sent to the Botanist."). "What is the botanist doing?" = status. "Allow it" / "yes, do it" / "approve" right after the Botanist asked for permission = allow; "deny it" / "no" = deny; "stop the botanist" = stop. Never hand the Botanist something your own tools or the wall's commands can already do (open, close, volume, timers, dashboards, sounds...).
- If something isn't possible, say so kindly in a few words. Never invent widgets, commands or facts that aren't in the snapshot or your sources.`;

const LAYOUT_CHANGE = { type:'object', properties: {
  action:{type:'string',enum:['inspect','resize','reorder','move','add','remove','page','add_page','remove_page','edit','done']},
  widget:{type:'string',description:'Available widget ID or title from snapshot.layout; clock is pinned on all pages.'},
  size:{type:'string',enum:['original','small','medium','wide','tall','large']},
  columns:{type:'integer',enum:[2,4]}, rows:{type:'integer',minimum:1,maximum:4},
  page:{anyOf:[{type:'integer',minimum:1,maximum:20},{type:'string',enum:['next','previous']}]},
  before:{type:'string'},after:{type:'string'},position:{type:'integer',minimum:1},direction:{type:'string',enum:['earlier','later']},
},required:['action'] };
const TOOLS = [
  {name:'sign',description:'Make or revise a Garden Directive sign with the existing preview/approval workflow. Pass the requested meaning or edits as intent. Review asks for fresh approval of the same retained artifact, including after printer failure. Never use this tool to approve printing.',input_schema:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['open','create','revise','review','clarify','cancel','status']},intent:{type:'string',maxLength:2000}}}},
  { name:'send', description:'Send the daily news summary, the open item, or an exact dictated note to a connected resident. Names are in snapshot.recipients. Do not invent a recipient or note. This sends a real phone message; call only on an explicit send request. No reminders.', input_schema:{type:'object',additionalProperties:false,required:['recipient','kind'],properties:{recipient:{type:'string'},kind:{type:'string',enum:['daily','current','note']},text:{type:'string',maxLength:4000}}}},
  { name:'layout', description:'Instantly arrange existing wall widgets and pages without the Botanist. Send one or more changes in order. resize uses size or columns+rows; add restores an available widget, optionally on a page; reorder uses before/after widget IDs, position or direction. Pages are 1-based. Overflow automatically moves to another page. inspect returns the current layout. This does not create new widget code.',
    input_schema:{type:'object',properties:{changes:{type:'array',items:LAYOUT_CHANGE,minItems:1,maxItems:20}},required:['changes']} },
  { name: 'open', description: 'Open a widget fullscreen or a panel. target = a widget id from the snapshot (e.g. weather, air-quality, clock, daily = the painting, hacker-news, sf-events, gardyn, fractal) or one of: arcade, events, hn, help, tendings, notes, controls, credits, architecture, camera.',
    input_schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } },
  { name: 'close', description: 'Close whatever is open: the fullscreen panel, a menu, the palette, or the running game (back to the wall).',
    input_schema: { type: 'object', properties: {} } },
  { name: 'select', description: 'Click an item in what is open (a story, an event, a game in the Arcade, a row, a button), by its visible text or by its 1-based position.',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: 'words from the item' }, index: { type: 'integer', minimum: 1 } } } },
  { name: 'press', description: 'Press a controller button like the game pad does: up/down/left/right move the selection or scroll, ok = select, back = go back, page_up/page_down scroll a page.',
    input_schema: { type: 'object', properties: { button: { type: 'string', enum: ['up', 'down', 'left', 'right', 'ok', 'back', 'page_up', 'page_down'] }, times: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['button'] } },
  { name: 'volume', description: 'Speaker volume 0-100: set it, or change it by a signed amount.',
    input_schema: { type: 'object', properties: { set: { type: 'integer', minimum: 0, maximum: 100 }, change: { type: 'integer', minimum: -100, maximum: 100 } } } },
  { name: 'command', description: 'Run one of the wall\'s slash commands (the list is in the snapshot), with an optional argument — e.g. rainforest + amazon / off, night, refresh, grow, fps.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, arg: { type: 'string' } }, required: ['name'] } },
  { name: 'dashboard', description: 'Switch to a dashboard: main (the wall), arcade (the game library), gui (Gui\'s notes for Louise), razi (Razi\'s dashboard: NASA\'s astronomy picture of the day).',
    input_schema: { type: 'object', properties: { id: { type: 'string', enum: ['main', 'arcade', 'gui', 'razi'] } }, required: ['id'] } },
  { name: 'zoom', description: 'Zoom the wall in, out, or back to 100%.',
    input_schema: { type: 'object', properties: { to: { type: 'string', enum: ['in', 'out', 'reset'] } }, required: ['to'] } },
  { name: 'plant', description: 'Plant a seed note for tonight\'s tending (how people ask the gardener to change or add something to the wall).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  {"name": "surface", "description": "Create or update an interactive panel using native Garden components. Stable ids, increasing revisions. Updates only apply while open. Prefer show for long prose.", "input_schema": {"type": "object", "required": ["id", "operation", "revision", "blocks"], "properties": {"id": {"type": "string"}, "operation": {"type": "string", "enum": ["create", "update"]}, "revision": {"type": "integer", "minimum": 1}, "title": {"type": "string"}, "status": {"type": "string"}, "blocks": {"type": "array", "maxItems": 12, "items": {"type": "object", "required": ["id", "type"], "properties": {"id": {"type": "string"}, "type": {"type": "string", "enum": ["text", "metric", "list", "actions"]}, "label": {"type": "string"}, "text": {"type": "string"}, "value": {"type": "string"}, "items": {"type": "array", "items": {"type": "string"}}, "actions": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["target", "label"], "properties": {"target": {"type": "string", "enum": ["weather", "transit", "rss", "clock", "gardyn", "home", "close"]}, "label": {"type": "string"}}}}}}}}}},
  {"name": "a2ui", "eager_input_streaming": true, "description": "Progressively render official A2UI v0.9 messages using the Garden catalog. Emit create/root early; each complete message renders before the tool finishes. Buttons act only on user activation.", "input_schema": {"type": "object", "additionalProperties": false, "required": ["title", "messages"], "properties": {"title": {"type": "string", "maxLength": 120}, "status": {"type": "string", "maxLength": 180}, "messages": {"type": "array", "minItems": 1, "maxItems": 200, "items": {"type": "object", "required": ["version"], "properties": {"version": {"type": "string", "enum": ["v0.9"]}, "createSurface": {"type": "object"}, "updateComponents": {"type": "object"}, "updateDataModel": {"type": "object"}, "deleteSurface": {"type": "object"}}}}}}},
  { name: 'show', description: 'Open an info sheet fullscreen on the wall for answers worth reading (recipes, steps, comparisons, lists, news, details). Built from blocks, in order.',
    input_schema: { type: 'object', required: ['title', 'blocks'], properties: {
      title: { type: 'string', description: 'short, plain title' },
      subtitle: { type: 'string', description: 'optional one-line context (a date, a place, a source)' },
      blocks: { type: 'array', maxItems: 14, items: { type: 'object', required: ['type'], properties: {
        type: { type: 'string', enum: ['text', 'list', 'steps', 'facts', 'table', 'quote', 'image', 'sources'] },
        heading: { type: 'string', description: 'optional small heading above the block' },
        text: { type: 'string', description: 'text: a paragraph (2-4 sentences); quote: the quote' },
        by: { type: 'string', description: 'quote: who said it' },
        items: { type: 'array', items: {}, description: 'list / steps: strings; facts: {label, value}; sources: {title, url}' },
        columns: { type: 'array', items: { type: 'string' }, description: 'table: column names' },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: rows of cells' },
        url: { type: 'string', description: 'image: an https image url from your sources' },
        caption: { type: 'string', description: 'image: a short caption' },
      } } },
    } } },
  { name: 'botanist', description: 'Talk to the Botanist (the coding agent that can change the computer and GardenOS itself). ask = hand it a task (async: its answer shows on the wall when done); status = what it is doing; allow / deny = answer the permission it is waiting for; stop = cancel its current task.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['ask', 'status', 'allow', 'deny', 'stop'] }, task: { type: 'string', description: 'ask: the request, in the person\'s words' } }, required: ['action'] } },
  // run by the API (results come back inside the same response)
  { type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'San Francisco', region: 'California', country: 'US', timezone: 'America/Los_Angeles' } },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 },
];

const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
// recent exchanges (text only, RAM only) for follow-up questions
const HISTORY_MS = 3 * 60 * 1000;
const histories = new Map();

// Stream only declarative A2UI, never ordinary OS tools before their arguments
// finish. The routing gate prevents a Jev-selected coding task painting a UI.
export function createA2uiToolStream({call,signal}) {
  const states=new Map();let firstId=null,releaseGate,resolveReady;
  const gate=new Promise(resolve=>releaseGate=resolve),ready=new Promise(resolve=>resolveReady=resolve);
  let queue=Promise.resolve();
  const release=()=>releaseGate();
  signal?.addEventListener('abort',release,{once:true});
  const enqueue=(state,message)=>{
    queue=queue.then(async()=>{
      await gate;signal?.throwIfAborted();if(state.error)return;
      try {
        const result=await call([{name:'a2ui',input:{title:state.title,messages:[message]}}]);
        signal?.throwIfAborted();state.result=Array.isArray(result)?result[0]:result;
        if(!state.result||state.result.ok===false)state.error=state.result?.error||'Generated interface could not be displayed.';
        else {state.applied=(state.applied||0)+1;if(message?.createSurface?.surfaceId)state.surfaceId=message.createSurface.surfaceId;}
      } catch(e){if(signal?.aborted)throw e;state.error=e.message||'Generated interface could not be displayed.';}
    });
    // Do not leave a rejected queue unobserved while provider output continues.
    queue.catch(()=>{});
  };
  const handle=(event,snapshot)=>{
    if(signal?.aborted)return;
    if(event.type==='content_block_start'&&event.content_block?.type==='tool_use'&&event.content_block.name==='a2ui'){
      if(firstId!==null)return; // ordinary tool de-duplication also permits one a2ui per round
      firstId=event.content_block.id;
      const state={id:firstId,index:event.index,title:undefined,result:null,error:null};
      state.decoder=new A2uiToolDecoder(message=>enqueue(state,message));states.set(firstId,state);resolveReady();
    }
    const state=states.get(firstId);
    if(!state||state.index!==event.index||state.error)return;
    const input=snapshot?.content?.[event.index]?.input;
    if(typeof input?.title==='string')state.title=input.title.slice(0,120);
    if(event.type==='content_block_stop'){try{state.decoder.finish();}catch(e){state.error=e.message;}}
    if(event.type==='content_block_delta'&&event.delta?.type==='input_json_delta'){
      try{state.decoder.push(event.delta.partial_json);}catch(e){state.error=e.message;}
    }
  };
  const finish=async response=>{
    release();
    try {
      signal?.throwIfAborted();
      for(const state of states.values()){
        const tool=response.content.find(x=>x.type==='tool_use'&&x.id===state.id);
        if(!tool||!Array.isArray(tool.input?.messages)||!tool.input.messages.length||tool.input.messages.length>200||typeof tool.input.title!=='string')state.error='Incomplete A2UI tool arguments.';
        else {
          try{state.decoder.finish?.();}catch(e){state.error=e.message;}
          if(state.decoder.count!==tool.input.messages.length)state.error='Incomplete A2UI message stream.';
          if(response.stop_reason==='max_tokens')state.error='The generated interface was interrupted before completion.';
        }
      }
      await queue;signal?.throwIfAborted();
      // A malformed tail must not leave a provisional composition looking complete.
      // Delete targets its exact id; the host rejects it if the user navigated away.
      for(const state of states.values())if(state.error&&state.applied&&state.surfaceId){
        signal?.throwIfAborted();
        try{await call([{name:'a2ui',input:{messages:[{version:'v0.9',deleteSurface:{surfaceId:state.surfaceId}}]}}]);}catch{/* retain the original failure */}
      }
      signal?.throwIfAborted();
      return new Map([...states].map(([id,s])=>[id,s.error?{ok:false,error:s.error}:s.result||{ok:false,error:'No A2UI messages were rendered.'}]));
    } finally {signal?.removeEventListener('abort',release);}
  };
  return {handle,ready,release,finish,dispose:()=>{signal?.removeEventListener('abort',release);release();}};
}

export async function runAgent(text, { context, call, notify = () => {}, log = () => {}, signal, destination='garden', startedAt=Date.now() }) {
  let history=histories.get(destination)||[];
  try {
  signal?.throwIfAborted();
  const direct = destination==='tv'?null:directAction(text);
  if (direct) {
    const began = performance.now();
    try {
      signal?.throwIfAborted();
      const got = await call([direct]);
      signal?.throwIfAborted();
      const result = Array.isArray(got) ? got[0] : got;
      log(`direct ${direct.name}: ${Math.round(performance.now() - began)} ms`);
      if (result?.ok === true) {
        history.push({ q: clip(text, 300), a: '(did it)', at: Date.now() });
        history = history.slice(-6);
        return { ok: true, reply: '' };
      }
      return { ok: false, reply: result?.error || 'The wall could not do that.' };
    } catch { return { ok: false, reply: 'The wall did not answer.' }; }
  }
  const snap = await context();
  const signRoute=destination==='garden'?routeSignUtterance(text,snap?.sign,startedAt):null;
  if(signRoute){
    if(signRoute.error)return {ok:false,reply:signRoute.error};
    signal?.throwIfAborted();const got=await call([signRoute]);const result=Array.isArray(got)?got[0]:got;
    return {ok:result?.ok===true,reply:result?.say||result?.error||'The sign workflow did not answer.'};
  }
  if (!config.apiKey) return { ok: false, reply: 'I need an API key to do that.' };
  client ||= new Anthropic({ apiKey: config.apiKey });
  const t0 = Date.now();
  // Jev (src/jev.mjs) routes the request IN PARALLEL with the model call: when it is sure this
  // is a job for the Botanist, the model call is cancelled and the task goes straight there
  // (~1 s sooner); otherwise it adds nothing. Control phrases about the Botanist itself
  // (allow / deny / stop / status) always go through the model.
  const control = /\b(allow|approve|deny|reject|stop|cancel|halt|what('s| is) the botanist|botanist doing|status)\b/i.test(text);
  const jevP = (destination==='tv' || control || snap?.sign || isSignRequest(text) || isLayoutRequest(text) || /\b(send|text|message)\b/i.test(text)) ? Promise.resolve(null) : routeRequest(text, { timeoutMs: 1200 }).catch(() => null);
  signal?.throwIfAborted();
  if (process.env.GARDENER_VOICE_DEBUG === '1') log(`QA request: ${JSON.stringify(text)} snapshot: ${JSON.stringify(snap).slice(0, 300)}`);
  const now = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
  const openNow = snap && snap.open ? `the "${snap.open.title}" panel is open` : snap && snap.dashboard && snap.dashboard !== 'main' ? `the ${snap.dashboard} dashboard is showing` : 'nothing is open (the main wall)';
  history = history.filter((h) => Date.now() - h.at < HISTORY_MS).slice(-6);
  const past = history.flatMap((h) => [{ role: 'user', content: `(earlier) "${h.q}"` }, { role: 'assistant', content: h.a || 'Done.' }]);
  const messages = [...past, { role: 'user', content: `It is ${now}. Right now ${openNow}${snap && snap.game && snap.game.playing ? ' and a game is running' : ''}. The wall:\n${clip(JSON.stringify(snap), 9000)}\n\nThe request: "${clip(text, 500)}"` }];
  let reply = '', lastFailed = false, acted = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const ctl = new AbortController();
    const modelSignal=signal?AbortSignal.any([signal,ctl.signal]):ctl.signal;
    const progressive=createA2uiToolStream({call,signal:modelSignal});
    const stream=client.messages.stream({ model: MODEL, max_tokens: 6000, system: [{type:'text',text:SYSTEM+(destination==='tv'?'\nThis request targets GardenTV OS, not the portrait wall. The snapshot lists the actual TV capabilities. Use open for listed TV app IDs and panels; command game for an exact file from games, screensaver for its mode. Do not send existing TV app launches or TV controls to the Botanist. Never execute a wall action as a fallback for an unsupported TV action. For a named Netflix show/movie, use a matching verifiedNetflix catalog entry in the snapshot, or search Netflix official title links, then use media. Respect the animated flag and requested adaptation. Never replace a matching verified catalog entry with a guessed link. If multiple adaptations match, ask which one; do not guess. Open alone does not satisfy a request to play a title. Media tool outcomes override assumptions about playback. Only new features, repairs or source changes need the Botanist. Replies stay in the compact TV overlay.':''),cache_control:{type:'ephemeral'}}], tools: destination==='tv'?[...TOOLS.filter(t=>['open','close','press','volume','command','dashboard','show','botanist','web_search','web_fetch'].includes(t.name)),{name:'media',description:'Open or attempt playback of a verified Netflix movie/series title. First use web_search restricted to netflix.com to resolve the requested title and distinguish remakes. Never invent a title ID. Include any requested animated/live-action adaptation in title so the catalog can validate it. The tool verifies official metadata before launching and rejects mismatched adaptations. url must be an official Netflix /title/NUMBER or /watch/NUMBER link from search. Playback may require a profile/sign-in; report the tool outcome, never claim playing without confirmation.',input_schema:{type:'object',additionalProperties:false,required:['service','title','url'],properties:{service:{type:'string',enum:['netflix']},title:{type:'string',maxLength:180},url:{type:'string',maxLength:300}}}}]:TOOLS, messages }, {signal:modelSignal});
    stream.on('streamEvent',progressive.handle);
    const resP=stream.finalMessage();
    resP.catch(()=>{ctl.abort();progressive.dispose();}); // routing may still be pending when the model rejects
    if (round === 0) {
      // A slow router must not hold a completed answer/tool response hostage.
      const first = await Promise.race([jevP.then(j => ({j})), resP.then(res => ({res})), progressive.ready.then(()=>({ui:true}))]);
      const j = first.j;
      if (j) log(`jev: ${j.route} ${Math.round(j.confidence * 100)}% (${j.ms} ms)`);
      if (j && j.route === 'botanist' && j.confidence >= JEV_SURE && (j.p.botanist ?? 0) >= 0.7) {
        ctl.abort(); resP.catch(() => {});
        signal?.throwIfAborted();
        const r = await botanist({ action: 'ask', task: text, design: { ...snap?.design, wallLayout: snap?.layout } }, { notify, log, signal });
        log(`tools: botanist (via jev)${r.ok ? '' : ' (failed)'}`);
        history.push({ q: clip(text, 300), a: r.ok ? `(${r.say || 'sent to the Botanist'})` : r.error, at: Date.now() });
        return r.ok ? { ok: true, reply: '' } : { ok: false, reply: r.error || 'I couldn’t reach the Botanist.' };
      }
    }
    progressive.release();
    const res = await resP;
    const streamedResults=await progressive.finish(res);
    signal?.throwIfAborted();
    log(`model round ${round + 1}: ${Date.now() - t0} ms, ${res.usage?.input_tokens ?? '?'} in / ${res.usage?.output_tokens ?? '?'} out / ${res.usage?.cache_read_input_tokens ?? 0} cache-read / ${res.usage?.cache_creation_input_tokens ?? 0} cache-write`);
    const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (said) reply = said;
    // a long server-side search can pause the turn: hand it back to carry on
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    // one call per tool per turn (a second select/open after the first one navigated is
    // always a misfire); presses may repeat
    const seen = new Set();
    let uses = res.content.filter((b) => b.type === 'tool_use' && (b.name === 'press' || !seen.has(b.name)) && seen.add(b.name));
    // opening something replaces what's open — a close in the same turn would undo it
    if (uses.some((u) => u.name === 'open' || u.name === 'dashboard')) uses = uses.filter((u) => u.name !== 'close');
    if (!uses.length) break;                     // answered (or explained a failure)
    // the botanist runs here (the Paseo bridge); everything else is the wall's
    const wallUses = uses.filter((u) => u.name !== 'botanist'&&!streamedResults.has(u.id));
    signal?.throwIfAborted();
    const got = wallUses.length ? await call(wallUses.map((u) => u.name==='sign'&&!['create','revise','review','clarify','cancel','status','open'].includes(u.input?.action)?{name:'sign',input:{action:'status'}}:({ name: u.name, input: u.input }))) : [];
    const wallList = Array.isArray(got) ? got : wallUses.map(() => got);
    const list = [];
    for (const u of uses) list.push(u.name === 'botanist' ? await botanist({ ...(u.input || {}), design: { ...snap?.design, wallLayout: snap?.layout } }, { notify, log, signal }) : streamedResults.has(u.id)?streamedResults.get(u.id):wallList[wallUses.indexOf(u)]);
    // tool names + ok/failed only; the inputs (which can carry the person's words) only with
    // GARDENER_VOICE_DEBUG=1 (QA) — never in normal running
    log(`tools: ${uses.map((u, i) => `${u.name}${process.env.GARDENER_VOICE_DEBUG === '1' ? JSON.stringify(u.input) + '→' + JSON.stringify(list[i]) : list[i]?.ok === false ? ' (failed)' : ''}`).join(', ')}`);
    lastFailed = list.some((r) => !r || r.ok === false);
    if (list.some((r) => r && r.ok !== false && !r.info)) acted = true;
    const informative = list.some((r) => r && r.info);
    // the fast path — one model call: everything worked, nothing to read back; the reply is
    // the model's own line, else the wall's plain description of what it did
    if (!lastFailed && !informative) { if (destination==='tv'||!said) reply = list.map((r) => r && r.say).filter(Boolean).pop() || ''; break; } // the last step says it
    if (round === MAX_ROUNDS - 1) break;
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: uses.map((u, i) => ({ type: 'tool_result', tool_use_id: u.id, is_error: !list[i] || list[i].ok === false,
      content: clip(!list[i] || list[i].ok === false ? (list[i]?.error || 'failed') : (list[i].info || 'done'), 2000) })) });
  }
  signal?.throwIfAborted();
  const ok = !lastFailed;
  reply = clip(reply.replace(/\s+/g, ' ').replace(/[*_#`]/g, ''), 2400); // shown whole (long ones as a sheet, lib/voice.js)
  history.push({ q: clip(text, 300), a: acted ? `(did it${reply ? ': ' + reply : ''})` : reply, at: Date.now() });
  // an action that happened speaks for itself (the glow + the chime close it): words only
  // for answers and for things that couldn't be done (humans, 2026-11-03)
  if (ok && acted && destination!=='tv') return { ok, reply: '' };
  const final = reply || (ok ? '' : 'Sorry — I couldn’t do that.');
  // Presentation is local: an already completed answer must not wait on another
  // network/model request just to choose its container. Structured answers use show.
  const format = final.length > 480 ? 'sheet' : 'caption';
  return { ok, reply: final, ...(destination==='tv'?{kind:acted?'action':'answer'}:{}), ...(format ? { format } : {}) };
  } finally { histories.set(destination,history.slice(-6)); }
}
