// Convex perimeter estimate, including rotated and slightly uneven sketches.
// Concave/recessed boundaries still need the existing manual override.
export function outerWallIds(page){
 const pts=page.sourceWalls.flatMap(w=>[w.start,w.end]).map(p=>[...p]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const unique=pts.filter((p,i)=>!i||p[0]!==pts[i-1][0]||p[1]!==pts[i-1][1]);if(unique.length<3)return new Set(page.sourceWalls.map(w=>w.id));
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),half=arr=>{const h=[];for(const p of arr){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
 const hull=[...half(unique).slice(0,-1),...half([...unique].reverse()).slice(0,-1)];
 const extent=Math.max(...[0,1].map(i=>Math.max(...pts.map(p=>p[i]))-Math.min(...pts.map(p=>p[i])))),tol=Math.max(1e-6,extent*.015);
 const near=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy,t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2;return t>=-tol/Math.sqrt(l2)&&t<=1+tol/Math.sqrt(l2)&&Math.abs(cross(a,b,p))/Math.sqrt(l2)<=tol;};
 return new Set(page.sourceWalls.filter(w=>hull.some((a,i)=>near(w.start,a,hull[(i+1)%hull.length])&&near(w.end,a,hull[(i+1)%hull.length]))).map(w=>w.id));
}
