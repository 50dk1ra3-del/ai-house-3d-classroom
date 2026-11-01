import { planSchema } from './schema.mjs';

// Metres. Coordinate coincidence uses distance, rather than an area tolerance.
const EPS = 1e-6;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= EPS * distance(a, b)
  && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
function intersects(a, b, c, d) {
  const turn = (p, q, r) => {
    const v = cross(p, q, r), tolerance = EPS * distance(p, q);
    return v > tolerance ? 1 : v < -tolerance ? -1 : 0;
  };
  const abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0)
    || (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
}

/** No mutation, DOM, network, Three.js or implicit defaults. Paths use JSON Pointer. */
export function validatePlan(data) {
  const errors = [], warnings = [];
  const issue = (path, code, message) => errors.push({ path: path || '/', code, message });
  const pointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  function check(value, schema, path) {
    if (schema.$ref) return check(value, planSchema.$defs[schema.$ref.split('/').pop()], path);
    if ('const' in schema && value !== schema.const) issue(path, 'constant', `値は ${JSON.stringify(schema.const)} にしてください。`);
    if (schema.enum && !schema.enum.includes(value)) issue(path, 'enum', `値は ${schema.enum.join(' / ')} から選んでください。`);
    const type = schema.type;
    const matches = !type || (type === 'object' ? record(value) : type === 'array' ? Array.isArray(value)
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : type === 'integer' ? Number.isSafeInteger(value) : typeof value === type);
    if (!matches) { issue(path, 'type', `${type} 型の値が必要です（数値は有限値）。`); return; }
    if (type === 'object') {
      for (const key of schema.required || []) if (!Object.hasOwn(value, key)) issue(`${path}/${pointer(key)}`, 'required', '必須項目がありません。');
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(schema.properties, key)) check(value[key], schema.properties[key], `${path}/${pointer(key)}`);
        else if (schema.additionalProperties === false) issue(`${path}/${pointer(key)}`, 'unknown_field', '未定義の項目です。項目名を確認してください。');
      }
    }
    if (type === 'array') {
      if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) issue(path, 'array_length', `要素数は ${schema.minItems || 0}〜${schema.maxItems ?? '上限なし'} にしてください。`);
      value.forEach((v, i) => check(v, schema.items, `${path}/${i}`));
    }
    if (type === 'string' && value.trim().length < (schema.minLength || 0)) issue(path, 'empty', '空白だけの文字列は使用できません。');
    if (type === 'number' || type === 'integer') {
      if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)
        || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity)) issue(path, 'range', '数値が許可された範囲外です。寸法は正の値、位置・軒の出は0以上、傾斜は0以上90度未満にしてください。');
    }
  }
  check(data, planSchema, '');
  // Structural failures cannot safely enter geometry checks. Report all structural errors first.
  if (errors.length) return { valid: false, errors, warnings };
  const ids = new Map();
  function register(item, path) {
    if (ids.has(item.id)) issue(`${path}/id`, 'duplicate_id', `IDが重複しています。最初の場所: ${ids.get(item.id)}`);
    else ids.set(item.id, path);
  }
  function polygon(points, path) {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (distance(points[i], points[j]) <= EPS) issue(path, 'duplicate_vertex', '同じ頂点が重複しています。末尾に始点を再記載しないでください。');
      // Adjacent collinear edges may continue straight, but must not backtrack.
      const a = points[(i + n - 1) % n], b = points[i], c = points[(i + 1) % n];
      if (distance(a, b) > EPS && distance(b, c) > EPS && Math.abs(cross(a, b, c)) <= EPS * distance(a, b)
        && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0) issue(path, 'backtracking_edge', '輪郭の辺が折り返して重なっています。');
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (intersects(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) issue(path, 'self_intersection', '輪郭の辺が交差または接触しています。');
      }
    }
    // Translate to the first vertex to avoid cancellation for large offsets.
    let twiceArea = 0, perimeter = 0;
    for (let i = 0; i < n; i++) { twiceArea += cross(points[0], points[i], points[(i + 1) % n]); perimeter += distance(points[i], points[(i + 1) % n]); }
    if (Math.abs(twiceArea) <= EPS * perimeter) issue(path, 'zero_area', '輪郭の面積がゼロ、または細すぎます。');
  }
  register(data, '');
  data.levels.forEach((level, li) => {
    const base = `/levels/${li}`;
    register(level, base); polygon(level.footprint.outline, `${base}/footprint/outline`);
    for (const key of ['walls', 'rooms', 'openings', 'floors', 'ceilings']) level[key].forEach((item, i) => {
      const path = `${base}/${key}/${i}`; register(item, path);
      if (item.outline) polygon(item.outline, `${path}/outline`);
      if (key === 'walls' && distance(item.start, item.end) <= EPS) issue(path, 'zero_wall', '壁の始点と終点が同じです。');
    });
    const walls = new Map(level.walls.map(w => [w.id, w]));
    level.openings.forEach((o, oi) => {
      const path = `${base}/openings/${oi}`, wall = walls.get(o.wallId);
      if (!wall) { issue(`${path}/wallId`, 'missing_wall', '同じ階に参照先の壁がありません。'); return; }
      if (o.offset + o.width > distance(wall.start, wall.end) + EPS) issue(path, 'opening_outside_length', '開口部が壁の端からはみ出しています。');
      if (o.bottom + o.height > wall.height + EPS) issue(path, 'opening_outside_height', '開口部が壁の上端からはみ出しています。');
      for (let j = 0; j < oi; j++) {
        const other = level.openings[j];
        if (o.wallId === other.wallId && Math.min(o.offset + o.width, other.offset + other.width) - Math.max(o.offset, other.offset) > EPS
          && Math.min(o.bottom + o.height, other.bottom + other.height) - Math.max(o.bottom, other.bottom) > EPS) issue(path, 'overlapping_openings', `開口部が ${base}/openings/${j} と重なっています。`);
      }
    });
  });
  if (!data.levels.some(l => l.id === data.roof.levelId)) issue('/roof/levelId', 'missing_level', '屋根の参照先の階がありません。');
  if (distance([0, 0], data.roof.ridgeDirection) <= EPS) issue('/roof/ridgeDirection', 'zero_direction', '屋根の方向にはゼロ以外のベクトルを指定してください。');
  if (data.roof.type !== 'flat' && data.roof.pitchDeg === 0) issue('/roof/pitchDeg', 'roof_pitch', '勾配屋根の傾斜は0度より大きくしてください。');
  data.drawings.forEach((drawing, i) => {
    const path = `/drawings/${i}`; register(drawing, path);
    const c = drawing.calibration;
    if (!c || c.status !== 'confirmed') warnings.push({ path, code: 'uncalibrated', message: '図面の縮尺は未確認です。実寸が確定した図面として扱わないでください。' });
    if (c && (distance(...c.sourcePoints) <= EPS || distance(...c.modelPoints) <= EPS)) issue(`${path}/calibration`, 'zero_calibration', '縮尺の基準には異なる2点を指定してください。');
  });
  if (data.review.status === 'draft' || data.review.unconfirmed.length) warnings.push({ path: '/review', code: 'unconfirmed', message: '未確認または仮のデータです。検査通過は寸法の正しさや建築上の安全性を保証しません。' });
  return { valid: errors.length === 0, errors, warnings };
}

/** JSON syntax errors are also returned as data; nothing is executed from the input. */
export function parseAndValidatePlan(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { valid: false, errors: [{ path: '/', code: 'json_syntax', message: 'JSONの書式が不正です。括弧、引用符、カンマを確認してください。' }], warnings: [] }; }
  return { ...validatePlan(data), data };
}
