// One validated forecast shared by the card, fullscreen and native briefing.
// Cached data can paint immediately; an unavailable provider never erases it.
const KEY='garden.forecast.v1',FRESH=15*60e3,MAX_AGE=6*3600e3;
let memory=null,pending=null,pendingKey='';
const locationKey=c=>JSON.stringify([c.lat??37.7577,c.lon??-122.4727,c.tz||'America/Los_Angeles']);
export const validForecast=d=>Number.isFinite(d?.current?.temperature_2m)&&['time','temperature_2m','weather_code'].every(k=>Array.isArray(d?.hourly?.[k])&&d.hourly[k].length>0)&&['time','temperature_2m_max','temperature_2m_min'].every(k=>Array.isArray(d?.daily?.[k])&&d.daily[k].length>0);
export function forecastSnapshot(config={}){
 if(!memory)try{memory=JSON.parse(localStorage.getItem(KEY));}catch{}
 return memory?.key===locationKey(config)&&validForecast(memory.data)&&Date.now()-memory.at<MAX_AGE&&memory.at<=Date.now()?memory:null;
}
export async function fetchForecast(config={}){
 const key=locationKey(config),saved=forecastSnapshot(config);if(saved&&Date.now()-saved.at<FRESH)return saved;
 if(pending&&pendingKey===key)return pending;
 const [lat,lon,tz]=JSON.parse(key),url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day&hourly=temperature_2m,weather_code,precipitation_probability,uv_index,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}&forecast_days=4`;
 pendingKey=key;
 const task=(async()=>{const r=await fetch('/api/proxy?url='+encodeURIComponent(url),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Forecast provider unavailable');const data=await r.json();if(!validForecast(data))throw Error('Incomplete forecast');const value={key,data,at:Date.now()};memory=value;try{localStorage.setItem(KEY,JSON.stringify(value));}catch{}return value;})();
 pending=task;try{return await task;}finally{if(pending===task)pending=null;}
}
