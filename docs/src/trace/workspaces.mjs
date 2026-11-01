const copy=v=>JSON.parse(JSON.stringify(v));
export class FloorWorkspaces{
 constructor(){this.base=null;this.floors=[];this.activeId=null;}
 capture(state){if(this.activeId)this.floors.find(f=>f.id===this.activeId).state=copy(state);else this.base=copy(state);}
 active(){return this.floors.find(f=>f.id===this.activeId)||null;}
 add(name,sourcePage,region,state){this.capture(state);let n=1;while(this.floors.some(f=>f.id===`floor-${n}`))n++;const f={id:`floor-${n}`,name,sourcePage,region:copy(region),state:copy(state)};this.floors.push(f);this.activeId=f.id;return f;}
 activate(id,state){if(id!==null&&!this.floors.some(f=>f.id===id))throw new Error('階がありません。');this.capture(state);this.activeId=id;return copy(this.active()?.state||this.base);}
 save(state){this.capture(state);return this.floors.length?{...copy(this.base),floors:copy(this.floors),activeFloorId:this.activeId}:copy(state);}
 restore(project){this.base=copy({pages:project.pages,editor:project.editor,analyses:project.analyses||[]});this.floors=copy(project.floors||[]);this.activeId=project.activeFloorId||null;return copy(this.active()?.state||this.base);}
}
