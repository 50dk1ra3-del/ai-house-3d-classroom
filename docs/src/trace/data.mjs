import { validateWindows, cutWall } from '../building/openings.mjs';
// Source coordinates: image pixels or rotated PDF viewport points, origin top-left.
// Model coordinates: metres, X right, Z down, Y up. Zoom/pan never enter this data.
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const positive = n => Number.isFinite(n) && n > 0;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const copy = value => JSON.parse(JSON.stringify(value));
const inside = (p, size) => point(p) && p.every((v, i) => v >= 0 && v <= size[i]);
export function validateTracePage(page) {
  const errors = [];
  const issue = message => errors.push({ path: '/trace', message });
  if (!page || !Number.isSafeInteger(page.page) || page.page < 1
      || !point(page.sourceSize) || !page.sourceSize.every(positive)
      || !['px', 'pt'].includes(page.sourceUnit) || !Array.isArray(page.sourceWalls)
      || !Number.isSafeInteger(page.nextId) || page.nextId < 1) {
    issue('図面のページ・寸法・座標単位が不正です。');
    return { valid: false, errors };
  }
  if (page.sourceWalls.length > 500) issue('1ページの壁は500件までです。');
  const ids = new Set();
  for (const wall of page.sourceWalls) {
    if (!wall || typeof wall.id !== 'string' || !wall.id || ids.has(wall.id)) issue('壁IDが空、または重複しています。');
    ids.add(wall?.id);
    if (!inside(wall?.start, page.sourceSize) || !inside(wall?.end, page.sourceSize)) issue('壁の端点は図面の範囲内にしてください。');
    else if (distance(wall.start, wall.end) < 1e-6) issue('壁の始点と終点を離してください。');
    if (!positive(wall?.height) || !positive(wall?.thickness)) issue('壁の高さ・厚みは正のメートル値にしてください。');
  }
  if (page.calibration) {
    const c = page.calibration;
    if (!Array.isArray(c.sourcePoints) || c.sourcePoints.length !== 2
        || !c.sourcePoints.every(p => inside(p, page.sourceSize)) || !positive(c.metres)
        || distance(c.sourcePoints[0], c.sourcePoints[1]) < 1e-6) issue('縮尺の2点と実距離を正しく指定してください。');
  }
  errors.push(...validateWindows(page).errors);return { valid: errors.length === 0, errors };
}
function requirePage(page) {
  const checked = validateTracePage(page);
  if (!checked.valid) throw new Error(checked.errors.map(e => e.message).join('\n'));
  return page;
}
export function createTracePage(page, sourceSize, sourceUnit) {
  return requirePage({ page, sourceSize: [...sourceSize], sourceUnit, calibration: null, sourceWalls: [], nextId: 1 });
}
export function calibrateTrace(page, a, b, metres) {
  return requirePage({ ...copy(page), calibration: { sourcePoints: [a, b].map(p => [...p]), metres } });
}
export function addTraceWall(page, start, end, height = 2.7, thickness = .16) {
  const next = copy(requirePage(page));
  next.sourceWalls.push({ id: `manual-p${page.page}-w${page.nextId}`, start: [...start], end: [...end], height, thickness });
  next.nextId++;
  return requirePage(next);
}
export function updateTraceWall(page, id, changes) {
  const next = copy(requirePage(page));
  const wall = next.sourceWalls.find(w => w.id === id);
  if (!wall) throw new Error('選択した壁がありません。');
  for (const key of ['start', 'end', 'height', 'thickness']) if (key in changes) wall[key] = copy(changes[key]);
  return requirePage(next);
}
export function deleteTraceWall(page, id) {
  const next = copy(requirePage(page));
  next.sourceWalls = next.sourceWalls.filter(w => w.id !== id);if(next.openings)next.openings=next.openings.filter(o=>o.wallId!==id);
  return next;
}
export function sourcePointFromClient(client, rect, size) {
  if (!point(client) || !positive(rect.width) || !positive(rect.height)) return null;
  const p = [(client[0] - rect.left) / rect.width * size[0], (client[1] - rect.top) / rect.height * size[1]];
  return inside(p, size) ? p : null;
}
export function toWallDraft(page) {
  requirePage(page);
  const calibration = page.calibration;
  const scale = calibration ? calibration.metres / distance(...calibration.sourcePoints) : null;
  if (calibration && (!positive(scale) || calibration.sourcePoints.flat().some(v => !Number.isFinite(v * scale) || Math.abs(v * scale) > 100000))) throw new Error('縮尺が生成可能な範囲外です。実距離を確認してください。');
  const modelPoint = p => p.map(v => v * scale);
  const walls = scale ? page.sourceWalls.map(w => ({ ...copy(w), start: modelPoint(w.start), end: modelPoint(w.end) })) : [];
  if (walls.some(w => [...w.start, ...w.end, w.height, w.thickness].some(v => !Number.isFinite(v) || Math.abs(v) > 100000)
      || distance(w.start, w.end) < 1e-6)) throw new Error('実寸が生成可能な範囲外です。縮尺・壁寸法を確認してください（上限100,000m）。');
  return {
    format: 'ai-house-wall-draft', schemaVersion: 1, status: 'incomplete', units: 'm',
    coordinateSystem: { plane: 'xz', up: 'y' },
    drawing: { id: `drawing-page-${page.page}`, page: page.page, sourceSize: [...page.sourceSize], sourceUnit: page.sourceUnit,
      ...(calibration ? { calibration: { sourcePoints: copy(calibration.sourcePoints), modelPoints: calibration.sourcePoints.map(modelPoint), reflection: false, status: 'confirmed' } } : {}) },
    sourceWalls: copy(page.sourceWalls), walls,
    wallLengths: walls.map(w => ({ wallId: w.id, metres: distance(w.start, w.end) })),
    review: { source: 'manual', status: 'draft', unconfirmed: ['建物外形・床・部屋・開口・天井・屋根は未定義'] }
  };
}
export function createWallPreview(page) {
  const checked = validateTracePage(page);
  if (!checked.valid) return checked;
  if (!page.calibration) return { valid: false, errors: [{ path: '/trace/calibration', message: '縮尺が未設定です。図面上の2点と実際の距離を設定してから3D表示してください。' }] };
  let draft;
  try { draft = toWallDraft(page); } catch (error) { return { valid: false, errors: [{ path: '/trace', message: error.message }] }; }
  const boxes=draft.walls.flatMap(w=>cutWall(w,(page.openings||[]).filter(o=>o.wallId===w.id)));
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of boxes) {
    const c = Math.abs(Math.cos(b.rotationY)), s = Math.abs(Math.sin(b.rotationY));
    const half = [(c*b.size[0]+s*b.size[2])/2, b.size[1]/2, (s*b.size[0]+c*b.size[2])/2];
    for (let k=0;k<3;k++) { bounds.min[k]=Math.min(bounds.min[k],b.position[k]-half[k]);bounds.max[k]=Math.max(bounds.max[k],b.position[k]+half[k]); }
  }
  return { valid: true, errors: [], warnings: [], boxes, bounds, labels: [], wallFrames:draft.walls.map(w=>({...w,base:0})), draft };
}
