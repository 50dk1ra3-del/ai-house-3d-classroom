export function validRegion(r){return Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[0]>=0&&r[1]>=0&&r[2]>=.01&&r[3]>=.01&&r[0]+r[2]<=1.000001&&r[1]+r[3]<=1.000001;}
export function regionFromPoints(a,b){const r=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])];if(!validRegion(r))throw new Error('解析範囲が小さすぎるか図面外です。');return r;}
export function mapRegionAnalysis(data,region){
 if(!validRegion(region))throw new Error('解析範囲が不正です。');
 const [x,y,w,h]=region,p=a=>[Math.min(1,x+a[0]*w),Math.min(1,y+a[1]*h)];
 return {...data,walls:data.walls.map(a=>({...a,start:p(a.start),end:p(a.end)})),rooms:data.rooms.map(a=>({...a,outline:a.outline.map(p)})),openings:data.openings.map(a=>({...a,position:p(a.position)})),furniture:data.furniture.map(a=>({...a,center:p(a.center),size:[a.size[0]*w,a.size[1]*h]})),annotations:data.annotations.map(a=>({...a,position:p(a.position)})),unknown:data.unknown.map(a=>({...a,position:p(a.position)}))};
}
export function selectedAnalysis(data,ids){const walls=data.walls.filter(w=>ids.includes(w.id)),kept=new Set(walls.map(w=>w.id));return {...data,walls,openings:data.openings.filter(o=>kept.has(o.wallId))};}
