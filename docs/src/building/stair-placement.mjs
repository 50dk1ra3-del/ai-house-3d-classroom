// Source drawing coordinates -> model metres. No dependency on canvas zoom.
import {rectangleBounds} from './layout.mjs';
export function stairFromRectangle(page,level,floors,fromId,a,b,direction=null,strict=false){
 if(!page?.calibration)throw new Error('階段の配置前に縮尺を設定してください。');
 const index=floors.findIndex(f=>f.id===fromId);if(index<0||!floors[index+1])throw new Error('上に接続する階がありません。下階を選択してください。');
 const bounds=rectangleBounds(page);if(!bounds)throw new Error('先に外壁を描いてください。');
 const c=page.calibration,scale=c.metres/Math.hypot(c.sourcePoints[1][0]-c.sourcePoints[0][0],c.sourcePoints[1][1]-c.sourcePoints[0][1]);
 const min=a.map((v,i)=>(Math.min(v,b[i])-bounds.min[i])*scale+level.offset[i]),max=a.map((v,i)=>(Math.max(v,b[i])-bounds.min[i])*scale+level.offset[i]);
 if(direction===null)direction=max[0]-min[0]>max[1]-min[1]?0:90;
 const region=floors[index].region;if(region&&[a,b].some(p=>p.some((v,i)=>v<region[i]*page.sourceSize[i]-1e-6||v>(region[i]+region[i+2])*page.sourceSize[i]+1e-6)))throw new Error('階段の四角形を出発階の登録範囲内に収めてください。');
 const vertical=direction===90||direction===270,width=max[vertical?0:1]-min[vertical?0:1],run=max[vertical?1:0]-min[vertical?1:0];
 if(strict&&(width<.6-1e-8||width>2+1e-8))throw new Error(`階段の幅は0.6〜2mです（現在${width.toFixed(2)}m）。四角形の短い辺を調整してください。`);
 if(strict&&(run<1-1e-8||run>12+1e-8))throw new Error(`階段の長さは1〜12mです（現在${run.toFixed(2)}m）。四角形の長い辺を調整してください。`);
 const start=vertical?[(min[0]+max[0])/2,direction===90?min[1]:max[1]]:[direction===0?min[0]:max[0],(min[1]+max[1])/2];
 return {strict,id:'stair-1',fromFloorId:fromId,toFloorId:floors[index+1].id,start,direction,width,run};
}
