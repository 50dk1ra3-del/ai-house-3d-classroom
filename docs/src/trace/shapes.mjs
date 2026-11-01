import {addTraceWall,validateTracePage} from './data.mjs';
const clone=v=>JSON.parse(JSON.stringify(v)),eps=1e-6;
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
function checked(p){const r=validateTracePage(p);if(!r.valid)throw new Error(r.errors.map(e=>e.message).join('\n'));return p;}
// Subtract collinear coverage only. Crossings remain independent walls.
export function insertSegments(page,segments,height=2.7,thickness=.16){
 let next=clone(page);
 for(const [a,b] of segments){const d=sub(b,a),len=Math.hypot(...d);if(len<eps)continue;let spans=[[0,1]];
  for(const w of next.sourceWalls){if(Math.abs(cross(d,sub(w.start,a)))/len>eps||Math.abs(cross(d,sub(w.end,a)))/len>eps)continue;
   const t=p=>sub(p,a).reduce((n,v,i)=>n+v*d[i],0)/(len*len);const lo=Math.min(t(w.start),t(w.end)),hi=Math.max(t(w.start),t(w.end));
   spans=spans.flatMap(([s,e])=>hi<=s+eps||lo>=e-eps?[[s,e]]:[[s,Math.min(e,lo)],[Math.max(s,hi),e]].filter(([x,y])=>y-x>eps));
  }
  for(const [s,e]of spans)next=addTraceWall(next,lerp(a,b,s),lerp(a,b,e),height,thickness);
 }
 return checked(next);
}
export function rectangleSegments(a,b){const l=Math.min(a[0],b[0]),r=Math.max(a[0],b[0]),t=Math.min(a[1],b[1]),u=Math.max(a[1],b[1]);if(r-l<eps||u-t<eps)throw new Error('幅と高さを持つ四角形を描いてください。');return [[[l,t],[r,t]],[[r,t],[r,u]],[[r,u],[l,u]],[[l,u],[l,t]]];}
export function eraseBox(page,a,b){const min=a.map((v,i)=>Math.min(v,b[i])),max=a.map((v,i)=>Math.max(v,b[i]));let next=clone(page);delete next.openings;next.sourceWalls=[];
 for(const w of page.sourceWalls){let lo=0,hi=1;const d=sub(w.end,w.start);let hit=true;
  for(let i=0;i<2;i++){if(Math.abs(d[i])<eps){if(w.start[i]<min[i]||w.start[i]>max[i])hit=false;}else{const x=(min[i]-w.start[i])/d[i],y=(max[i]-w.start[i])/d[i];lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}}
  if(!hit||hi-lo<eps){next.sourceWalls.push(clone(w));continue;}
  if(page.openings?.some(o=>o.wallId===w.id))throw new Error('窓付き壁の部分消去は、先に窓を削除してください。元の壁は保持しました。');
  const pieces=[[0,lo],[hi,1]].filter(([s,e])=>e-s>eps);for(let i=0;i<pieces.length;i++){const[s,e]=pieces[i];if(i===0)next.sourceWalls.push({...clone(w),start:lerp(w.start,w.end,s),end:lerp(w.start,w.end,e)});else next=addTraceWall(next,lerp(w.start,w.end,s),lerp(w.start,w.end,e),w.height,w.thickness);}
 }
 if(page.openings)next.openings=clone(page.openings);return checked(next);
}
export function wallAt(page,p,tolerance){let best=null,limit=tolerance;for(const w of page.sourceWalls){const d=sub(w.end,w.start),t=Math.max(0,Math.min(1,sub(p,w.start).reduce((n,v,i)=>n+v*d[i],0)/(d[0]**2+d[1]**2)));const dist=Math.hypot(...sub(p,lerp(w.start,w.end,t)));if(dist<=limit){best=w;limit=dist;}}return best;}
export function rectangleAt(page,wall){if(!wall)return null;const same=(a,b)=>Math.hypot(...sub(a,b))<eps;const axis=w=>Math.abs(w.start[0]-w.end[0])<eps||Math.abs(w.start[1]-w.end[1])<eps;
 let budget=2000;function walk(ids,vertices){if(--budget<0)return null;if(ids.length===4){if(!same(vertices.at(-1),vertices[0]))return null;const unique=values=>values.reduce((out,v)=>out.some(n=>Math.abs(n-v)<eps)?out:[...out,v],[]);const xs=unique(vertices.map(p=>p[0])),ys=unique(vertices.map(p=>p[1]));return xs.length===2&&ys.length===2?ids:null;}for(const w of page.sourceWalls){if(ids.includes(w.id)||!axis(w))continue;const end=same(w.start,vertices.at(-1))?w.end:same(w.end,vertices.at(-1))?w.start:null;if(end){const found=walk([...ids,w.id],[...vertices,end]);if(found)return found;}}return null;}
 const ids=axis(wall)?walk([wall.id],[wall.start,wall.end]):null;if(!ids)return null;const corners=page.sourceWalls.filter(w=>ids.includes(w.id)).flatMap(w=>[w.start,w.end]);if(page.sourceWalls.some(w=>!ids.includes(w.id)&&[w.start,w.end].some(p=>corners.some(q=>same(p,q)))))return null;return ids;
}
export function transformWalls(page,ids,from,to,resize=false){const chosen=page.sourceWalls.filter(w=>ids.includes(w.id));if(!chosen.length)throw new Error('図形を選択してください。');const pts=chosen.flatMap(w=>[w.start,w.end]),min=[0,1].map(i=>Math.min(...pts.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...pts.map(p=>p[i])));
 const map=p=>resize?p.map((v,i)=>min[i]+(v-min[i])*(to[i]-min[i])/(max[i]-min[i]||1)):p.map((v,i)=>v+to[i]-from[i]);
 if(resize&&max.some((v,i)=>v-min[i]<eps))throw new Error('壁線の長さは端点ハンドルで変更してください。');
 if(resize&&to.some((v,i)=>v-min[i]<eps))throw new Error('四角形の幅と高さを保ってください。');
 // Reinsert to avoid overlapping segments after a move. Existing unselected walls win.
 let next=clone(page);delete next.openings;next.sourceWalls=next.sourceWalls.filter(w=>!ids.includes(w.id));
 for(const w of chosen){const before=new Set(next.sourceWalls.map(w=>w.id));next=insertSegments(next,[[map(w.start),map(w.end)]],w.height,w.thickness);const added=next.sourceWalls.filter(w=>!before.has(w.id));if(added.length===1)added[0].id=w.id;else if(page.openings?.some(o=>o.wallId===w.id))throw new Error('窓付き壁を重複・分割する移動はできません。先に窓を削除してください。');}if(page.openings)next.openings=clone(page.openings);
 return checked(next);
}

export function resizeSegment(page,id,start,end){const w=page.sourceWalls.find(w=>w.id===id);if(!w||Math.hypot(start[0]-end[0],start[1]-end[1])<1e-6)throw new Error('壁の長さを保ってください。');const base=clone(page);delete base.openings;base.sourceWalls=base.sourceWalls.filter(w=>w.id!==id);const next=insertSegments(base,[[start,end]],w.height,w.thickness),added=next.sourceWalls.filter(w=>!base.sourceWalls.some(old=>old.id===w.id));if(added.length===1)added[0].id=id;else if(page.openings?.some(o=>o.wallId===id))throw new Error('窓付き壁を重複・分割する変更はできません。');if(page.openings)next.openings=clone(page.openings);return checked(next);}
