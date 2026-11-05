import { TOKEN_CONTRACT } from './design-contract.js';
import { canonicalToken } from './design-system.js';
// Drawing code reads the same semantic roles as CSS. Read on render/event, never
// poll computed styles per animation frame. Missing optional roles preserve defaults.
export function designValue(name, fallback = '', element = document.documentElement) {
  const canonical=canonicalToken(name);
  if(!TOKEN_CONTRACT[canonical]&&!canonical.startsWith('--ds-'))throw Error('Unknown design role '+name);
  return getComputedStyle(element).getPropertyValue(canonical).trim() || fallback;
}
let colorContext;
export function designColor(name, fallback, element = document.documentElement) {
  const value=designValue(name,'',element);
  if(!value)return [...fallback];
  if(!CSS.supports('color',value))return [...fallback];
  colorContext ||= document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  colorContext.clearRect(0,0,1,1);colorContext.fillStyle=value;colorContext.fillRect(0,0,1,1);
  const data=colorContext.getImageData(0,0,1,1).data;
  return [data[0]/255,data[1]/255,data[2]/255];
}
