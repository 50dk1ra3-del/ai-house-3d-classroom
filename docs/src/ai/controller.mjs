import {CLASSROOM_MODE} from '../config.mjs';
import { validateAnalysis } from './analysis.mjs';
import { validRegion, regionFromPoints, mapRegionAnalysis, selectedAnalysis } from './regions.mjs';

export function mountAIControls(host,{getContext,trace,showPlanTab,preview,activatePage=async()=>{}}){
 host.innerHTML=`<h2 class="section-heading">1. 階の範囲を決める</h2>
 <p class="hint" id="aiConfig">解析サーバーを確認中です。</p>
 <label>作業する階<select id="aiFloor"><option value="">全体・既存の手動作業</option></select></label>
 <label>新しい階の名前<input id="aiFloorName" maxlength="40" value="1階" /></label>
 <button class="button" id="aiRenameFloor">選択中の階をこの名前に変更</button><button class="button" id="aiSelectRegion">図面上の2点で解析範囲を指定</button>
 <button class="button" id="aiUseRegion" hidden>この範囲を新しい階として登録</button>
 <details><summary>解析範囲を数値で指定（%）</summary><label>左<input id="aiRegionX" type="number" min="0" max="100" value="0" /></label><label>上<input id="aiRegionY" type="number" min="0" max="100" value="0" /></label><label>幅<input id="aiRegionW" type="number" min="1" max="100" value="100" /></label><label>高さ<input id="aiRegionH" type="number" min="1" max="100" value="100" /></label><button id="aiNumericRegion" class="button">数値の範囲を確認</button></details><p class="hint" id="aiRegionInfo">階の建物だけを囲んでください。庭・駐車場・別の階を範囲に入れないでください。</p>
 <details><summary>AIで壁候補を探す（任意）</summary><label class="hint"><input type="checkbox" id="aiConsent" /> <span id="aiConsentLabel">解析先を確認してください。</span></label>
 <button class="button" id="aiAnalyze" disabled>解析して候補を確認</button><button class="button" id="aiCancel" hidden>解析を取り消す</button>
 <p class="hint">紫＝AI推定／AIが支持した線、橙＝画像補助、緑＝手動。候補の線または一覧のチェックで採用・除外できます。画像補助は最初は採用しません。</p>
 <div id="aiCandidates"></div>
 <button class="button" id="aiApply" hidden>選んだ壁を追加してこの階を3D表示</button><button class="button" id="aiDiscard" hidden>候補を取り消す</button>
 <p class="hint" id="aiScale"></p></details><p class="hint" id="aiResult" role="status" aria-live="polite">図面を読み込んでください。</p>`;
 const $=id=>host.querySelector('#'+id),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.classList.add('ai-overlay');svg.setAttribute('aria-label','解析範囲と壁候補');preview.append(svg);
 let config=null,busy=false,pending=null,request=null,generation=0,lastKey=null,selecting=false,points=[],region=null;
 const report=text=>{$('aiResult').textContent=text;};
 const chosen=()=>Array.from($('aiCandidates').querySelectorAll('input:checked')).map(el=>el.value);
 function clearCandidates(){pending=null;$('aiCandidates').replaceChildren();}
 function controls(){
  const ctx=getContext(),floor=trace.getFloor();
  if(ctx?.key!==lastKey){lastKey=ctx?.key;generation++;request?.abort();busy=false;clearCandidates();selecting=false;points=[];region=null;$('aiConsent').checked=false;report(ctx?'解析範囲と階を選び、候補を確認してください。':'図面の読み込み完了を待ってください。');}
  if(selecting&&!trace.isNavigating){selecting=false;points=[];region=null;report('範囲指定を取り消して、壁の手動入力へ戻りました。');}
  if(pending&&!trace.isNavigating){clearCandidates();report('手動編集へ切り替えました。未採用のAI候補だけ取り消しました。登録済みの壁は保持しています。');}
  const signature=JSON.stringify(trace.getFloors());
  if($('aiFloor').dataset.signature!==signature){$('aiFloor').replaceChildren(new Option('全体・既存の手動作業',''));for(const f of trace.getFloors())$('aiFloor').add(new Option(`${f.name}（${f.sourcePage}ページ）`,f.id));$('aiFloor').dataset.signature=signature;}
  $('aiFloor').value=floor?.id||'';
  $('aiSelectRegion').disabled=!ctx||busy; $('aiFloor').disabled=busy;
  $('aiUseRegion').hidden=!region||selecting;
  $('aiAnalyze').disabled=busy||!ctx||!config?.enabled||!$('aiConsent').checked||(!floor&&!config.mock);
  $('aiCancel').hidden=!busy;$('aiApply').hidden=!pending;$('aiDiscard').hidden=!pending;
  $('aiScale').textContent=trace.getAnalysis()?.assumedScale?'仮縮尺：この階の解析範囲の横幅を10mとしています。実寸は縮尺設定で指定してください。':'';
  if(!selecting&&!region)$('aiRegionInfo').textContent=floor?`${floor.name}の範囲だけを解析します。階は自動判定していません。`:'解析する階の建物だけを囲んでください。全体・手動作業と階別データは独立しています。';
  syncOverlay();
 }
 function syncOverlay(){
  svg.replaceChildren();const ctx=getContext(),rgn=region||trace.getFloor()?.region;
  svg.style.display=ctx&&preview.classList.contains('visible')&&(selecting||pending||rgn)?'block':'none';
  svg.style.pointerEvents=selecting||pending?'auto':'none';
  if(!ctx)return;
  const r=ctx.element.getBoundingClientRect(),p=preview.getBoundingClientRect();
  Object.assign(svg.style,{left:`${r.left-p.left-preview.clientLeft}px`,top:`${r.top-p.top-preview.clientTop}px`,width:`${r.width}px`,height:`${r.height}px`});
  svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');
  function node(tag,attrs){const el=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el;}
  if(rgn)node('rect',{x:rgn[0]*1000,y:rgn[1]*1000,width:rgn[2]*1000,height:rgn[3]*1000,fill:'none',stroke:'#175dc0','stroke-width':2,'vector-effect':'non-scaling-stroke'});
  for(const p of points)node('circle',{cx:p[0]*1000,cy:p[1]*1000,r:5,fill:'#175dc0'});
  const ids=chosen();
  for(const w of pending?.analysis.walls||[]){const line=node('line',{x1:w.start[0]*1000,y1:w.start[1]*1000,x2:w.end[0]*1000,y2:w.end[1]*1000,stroke:w.confidence===.4?'#b86612':'#7937b3','stroke-width':5,'stroke-dasharray':'6 3',opacity:ids.includes(w.id)?1:.3,'vector-effect':'non-scaling-stroke'});line.dataset.candidate=w.id;}
 }
 svg.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();});
 svg.addEventListener('click',e=>{
  e.stopPropagation();
  if(selecting){const r=svg.getBoundingClientRect(),p=[Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];points.push(p);
   if(points.length===2){try{region=regionFromPoints(...points);selecting=false;report('青枠を確認し、階の名前を入力して登録してください。');}catch(error){points=[];report(error.message);}}controls();
  }else if(pending&&e.target.dataset.candidate){const input=Array.from($('aiCandidates').querySelectorAll('input')).find(a=>a.value===e.target.dataset.candidate);input.checked=!input.checked;syncOverlay();}
 });
 $('aiRenameFloor').addEventListener('click',()=>{try{trace.renameFloor($('aiFloorName').value);controls();}catch(e){report(e.message);}});
 $('aiSelectRegion').addEventListener('click',()=>{clearCandidates();selecting=true;points=[];region=null;trace.setMode('navigate');showPlanTab();report('建物の左上と右下の2点をクリックしてください。庭・別の階は除外してください。');controls();});
 $('aiNumericRegion').addEventListener('click',()=>{try{if(['X','Y','W','H'].some(k=>$('aiRegion'+k).value.trim()===''))throw new Error('範囲の4項目を入力してください。');const next=['X','Y','W','H'].map(k=>Number($('aiRegion'+k).value)/100);if(!validRegion(next))throw new Error('範囲は図面内の1%以上にしてください。');region=next;selecting=false;points=[];showPlanTab();controls();report('青枠を確認して新しい階として登録してください。');}catch(e){report(e.message);}});
 $('aiUseRegion').addEventListener('click',()=>{try{const name=$('aiFloorName').value.trim();if(!name)throw new Error('階の名前を入力してください。');trace.addFloor(name,region);region=null;points=[];controls();report('この階の独立した作業を作成しました。元の作業は残っています。');}catch(e){report(e.message);}});
 $('aiFloor').addEventListener('change',async()=>{try{trace.selectFloor($('aiFloor').value||null);const floor=trace.getFloor();if(floor)await activatePage(floor.sourcePage);showPlanTab();controls();}catch(e){report(e.message);}});
 $('aiConsent').addEventListener('change',controls);
 $('aiDiscard').addEventListener('click',()=>{clearCandidates();controls();report('候補を取り消しました。現在の壁は維持しています。');});
 $('aiCancel').addEventListener('click',()=>{generation++;request?.abort();busy=false;controls();report('解析待ちを取り消しました。現在の作業は維持しています。');});
 $('aiApply').addEventListener('click',()=>{try{if(!pending)return;const data=selectedAnalysis(pending.analysis,chosen());if(!data.walls.length)throw new Error('採用する壁を選んでください。画像補助は必要な線だけ選べます。');trace.appendAI(data,pending.model);clearCandidates();controls();report('選んだ壁をこの階へ追加しました。プレビューの「壁を選択・位置修正」で削除し、「壁の2点を入力」で追加できます。');}catch(e){report(e.message);}});
 $('aiAnalyze').addEventListener('click',async()=>{
  if(CLASSROOM_MODE){report('授業版はAI送信を無効にしています。壁を手動で描いてください。');return;}
  const ctx=getContext(),floor=trace.getFloor();if(!ctx||busy||!$('aiConsent').checked||(!floor&&!config?.mock))return;
  const crop=floor?.region||[0,0,1,1];showPlanTab();trace.setMode('navigate');clearCandidates();busy=true;const id=++generation,abort=new AbortController();request=abort;controls();
  const timer=setTimeout(()=>abort.abort(),config.local?250000:95000);
  report(config.mock?'模擬応答です。画像を認識しません。':'選択した階の範囲だけをMac内で解析しています。');
  try{
   const el=ctx.element,canvas=document.createElement('canvas'),width=el.naturalWidth||el.width,height=el.naturalHeight||el.height;
   const [x,y,w,h]=crop,scale=Math.min(1,1536/Math.max(width*w,height*h));canvas.width=Math.max(1,Math.round(width*w*scale));canvas.height=Math.max(1,Math.round(height*h*scale));
   const drawing=canvas.getContext('2d');drawing.fillStyle='white';drawing.fillRect(0,0,canvas.width,canvas.height);drawing.drawImage(el,x*width,y*height,w*width,h*height,0,0,canvas.width,canvas.height);
   const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:canvas.toDataURL('image/png'),consent:true}),signal:abort.signal});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'解析に失敗しました。');
   if(id!==generation||getContext()?.key!==ctx.key)return;
   const checked=validateAnalysis(data.analysis);if(!checked.valid)throw new Error('解析結果を拒否しました。'+checked.errors.join('\n'));
   data.analysis=mapRegionAnalysis(data.analysis,crop);pending=data;
   for(const wall of data.analysis.walls){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=wall.id;input.checked=wall.confidence!==.4;input.addEventListener('change',syncOverlay);label.append(input,document.createTextNode(`${wall.id}：${wall.confidence===.4?'画像補助（要確認）':'AI推定／支持'}`));$('aiCandidates').append(label);}
   report(`${data.mock?'【模擬】':''}${floor?.name||'全体'}：壁候補${data.analysis.walls.length}件。まだ壁データを変更していません。必要な線だけ選び「追加して3D表示」を押してください。\n${data.analysis.summary}\n解析時間：${data.metrics?.elapsedSeconds??'未計測'}秒。`);
  }catch(e){if(id===generation)report((e.name==='AbortError'?'解析待ちを中止しました。':e.message)+' 現在の作業は維持しています。');}
  finally{clearTimeout(timer);if(id===generation){busy=false;controls();}}
 });
 trace.subscribe(controls);
 if(CLASSROOM_MODE){config={enabled:false,mock:false,local:false};$('aiAnalyze').closest('details').hidden=true;$('aiConfig').textContent='授業版：図面・作業データはこのブラウザ内だけで処理します。AI送信なし。';}else fetch('/api/config',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(data=>{config=data;$('aiConfig').textContent=data.mock?'模擬解析：画像認識なし':data.local?`ローカル実AI：${data.model}＋画像補助。Mac内だけで解析。`:'AI解析は未設定です。手動編集は使えます。';$('aiConsentLabel').textContent=data.mock?'模擬解析をMac内で実行します。':data.local?'選択範囲だけをMac内のOllamaで解析します。外部送信・課金なし。':'解析は無効です。';if(!data.mock&&!data.local)config.enabled=false;controls();}).catch(()=>{$('aiConfig').textContent='解析サーバーが起動していません。';controls();});
 controls();return{syncOverlay};
}
