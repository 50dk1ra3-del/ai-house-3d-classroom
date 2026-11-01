import { calibrateTrace } from './data.mjs';
import { validRegion } from '../ai/regions.mjs';

// Tolerances are screen pixels: zoom changes neither stored points nor snapping distance.
export function assistedPoint(position,page,rect,{anchor=null,snap=true,axis=true,disabled=false}={}){
 let p=[...position];if(disabled)return p;
 const screen=(a,b)=>Math.hypot((a[0]-b[0])*rect.width/page.sourceSize[0],(a[1]-b[1])*rect.height/page.sourceSize[1]);
 if(anchor&&axis){const dx=(p[0]-anchor[0])*rect.width/page.sourceSize[0],dy=(p[1]-anchor[1])*rect.height/page.sourceSize[1];
  if(Math.abs(dy)<=Math.abs(dx)*Math.tan(Math.PI/22.5))p[1]=anchor[1];
  else if(Math.abs(dx)<=Math.abs(dy)*Math.tan(Math.PI/22.5))p[0]=anchor[0];
 }
 if(snap){const endpoints=page.sourceWalls.flatMap(w=>[w.start,w.end]).filter(a=>!anchor||screen(a,anchor)>1);let nearest=null,limit=8;
  for(const a of endpoints){const d=screen(p,a);if(d<limit){nearest=a;limit=d;}}
  if(nearest)p=[...nearest];
 }
 return p;
}
export function estimatedFloorCalibration(page,region){if(!validRegion(region))throw new Error('階の範囲を登録してください。');const[x,y,w]=region;return calibrateTrace(page,[x*page.sourceSize[0],y*page.sourceSize[1]],[(x+w)*page.sourceSize[0],y*page.sourceSize[1]],10);}
