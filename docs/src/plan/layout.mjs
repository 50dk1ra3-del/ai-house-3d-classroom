import { validatePlan } from './validate.mjs';
const EPS = 1e-6;
const error = (path, message) => ({ path, code: 'unsupported_geometry', message });
function rectangle(points) {
  if (points.length !== 4) return false;
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return points.every((p, i) => (Math.abs(p[0] - minX) < EPS || Math.abs(p[0] - maxX) < EPS)
    && (Math.abs(p[1] - minZ) < EPS || Math.abs(p[1] - maxZ) < EPS)
    && (Math.abs(p[0] - points[(i + 1) % 4][0]) < EPS || Math.abs(p[1] - points[(i + 1) % 4][1]) < EPS));
}

// Generates numerical box descriptions only: no DOM, Three.js, input mutation, or scene changes.
export function createPlanLayout(plan) {
  const checked = validatePlan(plan);
  if (!checked.valid) return checked;
  const errors = [];
  if (plan.levels.length !== 1) errors.push(error('/levels', '現在の3D生成は1階建てに対応しています。'));
  const level = plan.levels[0];
  if (!rectangle(level.footprint.outline)) errors.push(error('/levels/0/footprint', '現在の3D生成は座標軸に沿った矩形外形に対応しています。'));
  for (const key of ['floors', 'rooms']) level[key].forEach((item, i) => {
    if (!rectangle(item.outline)) errors.push(error(`/levels/0/${key}/${i}/outline`, '現在の3D生成は矩形の床・部屋に対応しています。'));
  });
  if (!level.walls.length || !level.floors.length) errors.push(error('/levels/0', '3D生成には壁と床を1件以上指定してください。'));
  if (errors.length) return { valid: false, errors, warnings: checked.warnings };
  const boxes = [], labels = [];
  for (const wall of level.walls) {
    const dx = wall.end[0] - wall.start[0], dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
    const holes = level.openings.filter(o => o.wallId === wall.id);
    // A grid in wall-local coordinates handles both lintels and sills, including stacked openings.
    const xs = [...new Set([0, length, ...holes.flatMap(o => [o.offset, Math.min(length, o.offset + o.width)])])].sort((a,b) => a-b);
    const ys = [...new Set([0, wall.height, ...holes.flatMap(o => [o.bottom, Math.min(wall.height, o.bottom + o.height)])])].sort((a,b) => a-b);
    for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
      const left = xs[i-1], right = xs[i], bottom = ys[j-1], top = ys[j];
      if (right-left <= EPS || top-bottom <= EPS) continue;
      const x = (left+right)/2, y = (bottom+top)/2;
      if (holes.some(o => x > o.offset && x < o.offset+o.width && y > o.bottom && y < o.bottom+o.height)) continue;
      boxes.push({ kind: 'wall', sourceId: wall.id, size: [right-left, top-bottom, wall.thickness],
        position: [wall.start[0]+ux*x, level.elevation+y, wall.start[1]+uz*x], rotationY: -Math.atan2(dz,dx),
        local: { left, right, bottom, top } });
    }
  }
  for (const floor of level.floors) {
    const xs = floor.outline.map(p => p[0]), zs = floor.outline.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    boxes.push({ kind: 'floor', sourceId: floor.id, size: [maxX-minX, floor.thickness, maxZ-minZ],
      position: [(minX+maxX)/2, level.elevation+floor.top-floor.thickness/2, (minZ+maxZ)/2], rotationY: 0 });
  }
  for (const room of level.rooms) labels.push({ id: room.id, text: room.name,
    position: [room.outline.reduce((v,p)=>v+p[0],0)/4, level.elevation+0.04, room.outline.reduce((v,p)=>v+p[1],0)/4] });
  const bounds = { min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity] };
  for (const b of boxes) {
    const c = Math.abs(Math.cos(b.rotationY)), s = Math.abs(Math.sin(b.rotationY));
    const half = [(c*b.size[0]+s*b.size[2])/2, b.size[1]/2, (s*b.size[0]+c*b.size[2])/2];
    for (let k=0;k<3;k++) { bounds.min[k]=Math.min(bounds.min[k],b.position[k]-half[k]);bounds.max[k]=Math.max(bounds.max[k],b.position[k]+half[k]); }
  }
  const finite = boxes.every(b=>[...b.position,...b.size,b.rotationY].every(Number.isFinite))
    && [...bounds.min,...bounds.max].every(Number.isFinite);
  if (!finite) return { valid:false, errors:[error('/levels/0','寸法や座標が大きすぎるため生成できません。')], warnings:checked.warnings };
  return { valid:true, errors:[], warnings:[...checked.warnings, {path:'/',code:'omitted_surfaces',message:'この表示は壁・床・開口・部屋名のみです。天井・屋根・建具本体は生成しません。'}], boxes, labels, bounds };
}
