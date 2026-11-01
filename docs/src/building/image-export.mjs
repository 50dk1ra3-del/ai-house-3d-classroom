// Render a separate scene/camera/context: the live editor is never resized or hidden.
export const IMAGE_SIZES = Object.freeze({ full: [1920, 1080], light: [1280, 720], small: [960, 540] });

export function exportSize(key = 'full') {
  if (!Object.hasOwn(IMAGE_SIZES, key)) throw new Error('画像サイズを選び直してください。');
  return [...IMAGE_SIZES[key]];
}

export function exportFov(fov, oldAspect, newAspect) {
  if (![fov, oldAspect, newAspect].every(Number.isFinite) || fov <= 0 || fov >= 180 || oldAspect <= 0 || newAspect <= 0) throw new Error('3D視点をリセットして再試行してください。');
  // Expand rather than crop when the export is narrower than the current viewport.
  return Math.atan(Math.tan(fov * Math.PI / 360) * Math.max(1, oldAspect / newAspect)) * 360 / Math.PI;
}

export function cleanModelCopy(model) {
  const copy = model.clone(true);
  const excluded = [];
  copy.traverse(obj => {
    if (obj !== copy && (obj.isLine || obj.isPoints || obj.isSprite || obj.userData?.exportExclude || /Helper$/.test(obj.type || ''))) excluded.push(obj);
  });
  excluded.forEach(obj => obj.parent?.remove(obj));
  return copy;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('画像保存が時間内に完了しませんでした。軽量サイズで再試行してください。')), 15000);
    try {
      canvas.toBlob(blob => {
        clearTimeout(timer);
        if (blob?.size && blob.type === 'image/png') resolve(blob);
        else reject(new Error('PNGを作成できませんでした。軽量サイズで再試行してください。'));
      }, 'image/png');
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

export async function renderHousePng(runtime, { size = 'full', transparent = false } = {}, makeRenderer) {
  const [width, height] = exportSize(size);
  if (!runtime?.modelGroup || !runtime.renderer || !runtime.camera || !runtime.scene) throw new Error('表示できる住宅がありません。壁を描き、3Dモデルを表示してください。');
  const { THREE, camera, scene, renderer: liveRenderer, modelGroup } = runtime;
  if (!modelGroup.visible || !modelGroup.children.length) throw new Error('表示できる住宅がありません。壁と縮尺を確認してください。');
  let output;
  const photoScene = new THREE.Scene();
  try {
    output = makeRenderer ? makeRenderer() : new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    if (output.capabilities.maxTextureSize < Math.max(width, height)) throw new Error('この端末では指定サイズを保存できません。軽量サイズを選んでください。');
    output.setPixelRatio(1);
    output.setSize(width, height, false);
    output.outputColorSpace = liveRenderer.outputColorSpace;
    output.toneMapping = liveRenderer.toneMapping;
    output.toneMappingExposure = liveRenderer.toneMappingExposure;
    output.shadowMap.enabled = liveRenderer.shadowMap.enabled;
    output.shadowMap.type = liveRenderer.shadowMap.type;
    output.setClearColor('#ffffff', transparent ? 0 : 1);
    photoScene.background = transparent ? null : new THREE.Color('#ffffff');
    photoScene.add(cleanModelCopy(modelGroup));
    // Only the displayed house and lights are copied. No ground grid or editor overlays.
    for (const child of scene.children) if (child.isLight) {
      const light = child.clone();
      // Thin, coplanar wall fragments otherwise produce striped self-shadow artifacts.
      if (light.shadow) { light.shadow.normalBias = Math.max(.02, light.shadow.normalBias || 0); light.shadow.bias = Math.min(-.0001, light.shadow.bias || 0); }
      photoScene.add(light);
    }
    const photoCamera = camera.clone();
    photoCamera.fov = exportFov(camera.fov, camera.aspect, width / height);
    photoCamera.aspect = width / height;
    photoCamera.updateProjectionMatrix();
    photoCamera.updateMatrixWorld();
    output.render(photoScene, photoCamera);
    if (output.getContext?.().isContextLost()) throw new Error('画像用の描画に失敗しました。軽量サイズで再試行してください。');
    return await canvasBlob(output.domElement);
  } finally {
    // Model geometry/materials are shared with the live editor; do not dispose them.
    for (const child of photoScene.children) if (child.isLight) child.shadow?.dispose();
    output?.dispose();
    output?.forceContextLoss();
  }
}

export function mountImageExport(host, getRuntime, scene) {
  host.innerHTML = `<dialog id="imageDialog" aria-labelledby="imageDialogTitle" style="width:min(420px,calc(100vw - 48px));max-height:80vh;overflow:auto;border:1px solid #cbd5cb;border-radius:12px;padding:22px;background:#fff;color:#26352e"><h2 id="imageDialogTitle">3D作品を画像に保存</h2>
    <p class="hint">好きな角度・表示階にしてから保存します。操作ボタン・部屋名・補助線は写りません。屋根を含めるときは閲覧モードへ戻してください。</p>
    <label for="imageSize">画像サイズ</label><select id="imageSize"><option value="full">高画質 1920 × 1080</option><option value="light">軽量 1280 × 720</option><option value="small">小さめ 960 × 540</option></select>
    <label><input type="checkbox" id="imageTransparent"> 背景を透明にする（標準は白）</label>
    <button class="button" id="saveHouseImage" type="button">3D画像を保存</button>
    <p class="hint" id="imageStatus" role="status" aria-live="polite">PNGはこのブラウザ内で作成します。編集を再開するには作業JSONも保存してください。</p><button type="button" id="closeImageDialog">閉じる</button></dialog>`;
  const dialog=host.querySelector('dialog');scene.append(dialog);host.remove();
  const launch=document.createElement('button');launch.type='button';launch.id='openImageDialog';launch.textContent='📷 3D画像を保存';launch.style.cssText='position:absolute;right:16px;bottom:76px;z-index:6;padding:10px 14px;background:#fff;border:1px solid #647a69;border-radius:8px;color:#234c39;font-weight:600;box-shadow:0 2px 6px #0002';scene.append(launch);
  launch.onclick=()=>{scene.dispatchEvent(new Event('house-view-change'));if(!dialog.open)dialog.showModal();};
  dialog.querySelector('#closeImageDialog').onclick=()=>dialog.close();
  const button = dialog.querySelector('#saveHouseImage'), status = dialog.querySelector('#imageStatus');
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'PNG画像を作成しています…';
    try {
      const size = dialog.querySelector('#imageSize').value;
      const blob = await renderHousePng(getRuntime(), { size, transparent: dialog.querySelector('#imageTransparent').checked });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `ai-house-3d-${Date.now()}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = `${exportSize(size).join(' × ')} のPNGを保存しました。ダウンロード先を確認してください。`;
    } catch (error) {
      status.textContent = '画像を保存できませんでした。' + (error?.message || '軽量サイズで再試行してください。');
    } finally { button.disabled = false; }
  });
}
