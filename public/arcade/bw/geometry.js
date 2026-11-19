// Signed fixed-point projection reproduced from original routines 178d0/17908.
const s16=n=>n<<16>>16;
export function projectWorld(wx,wy,cameraX=184,cameraY=-40){
 const y=s16((s16(wy)>>4)-cameraY);
 return [s16((s16(wx)>>4)-cameraX+Math.trunc((480-y)/2)),y];
}

// Portrait camera: same height/verticals, shallower depth shear. Original helper
// above remains the binary-conformance reference; every solid face uses this
// same ground-plane change rather than moving untouched angled blocks.
export const PORTRAIT_SHEAR=1/10, PORTRAIT_X=34, PORTRAIT_Y=60;
export function projectPortrait(wx,wy){const x=s16(wx)>>4,y=s16(wy)>>4;return [Math.round(x-PORTRAIT_SHEAR*y+PORTRAIT_X),y+PORTRAIT_Y];}
