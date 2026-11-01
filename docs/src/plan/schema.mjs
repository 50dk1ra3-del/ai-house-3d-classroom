// JSON Schema 2020-12, shared by browser tools and the dependency-free validator.
const number = { type: 'number' };
const positive = { type: 'number', exclusiveMinimum: 0 };
const nonnegative = { type: 'number', minimum: 0 };
const text = { type: 'string', minLength: 1 };
const ref = name => ({ $ref: `#/$defs/${name}` });
const array = (items, minItems = 0) => ({ type: 'array', items, minItems });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const entity = (properties, required) => object({ id: text, ...properties }, required);
export const planSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AI House Plan v1',
  ...object({
    format: { const: 'ai-house-plan' }, schemaVersion: { const: 1 }, id: text,
    units: { const: 'm' },
    coordinateSystem: object({ plane: { const: 'xz' }, up: { const: 'y' } }),
    levels: array(ref('level'), 1), roof: ref('roof'),
    drawings: array(ref('drawing')), review: ref('review')
  }),
  $defs: {
    point: { type: 'array', items: number, minItems: 2, maxItems: 2 },
    outline: array(ref('point'), 3),
    wall: entity({ start: ref('point'), end: ref('point'), height: positive, thickness: positive }),
    room: entity({ name: text, outline: ref('outline') }),
    opening: entity({ kind: { enum: ['door', 'window'] }, wallId: text, offset: nonnegative, width: positive, height: positive, bottom: nonnegative }),
    floor: entity({ outline: ref('outline'), top: number, thickness: positive }),
    ceiling: entity({ outline: ref('outline'), bottom: number, thickness: positive }),
    level: entity({ name: text, elevation: number,
      footprint: object({ reference: { const: 'exterior-wall-centerline' }, outline: ref('outline') }),
      walls: array(ref('wall')), rooms: array(ref('room')), openings: array(ref('opening')),
      floors: array(ref('floor')), ceilings: array(ref('ceiling')) }),
    roof: object({ levelId: text, type: { enum: ['gable', 'hip', 'shed', 'flat'] }, eaveHeight: positive,
      pitchDeg: { type: 'number', minimum: 0, exclusiveMaximum: 90 }, overhang: nonnegative, ridgeDirection: ref('point') }),
    drawing: entity({ page: { type: 'integer', minimum: 1 }, sourceSize: { type: 'array', items: positive, minItems: 2, maxItems: 2 },
      sourceUnit: { enum: ['px', 'pt'] }, calibration: object({
        sourcePoints: { type: 'array', items: ref('point'), minItems: 2, maxItems: 2 },
        modelPoints: { type: 'array', items: ref('point'), minItems: 2, maxItems: 2 },
        reflection: { type: 'boolean' }, status: { enum: ['draft', 'confirmed'] }
      }) }, ['id', 'page', 'sourceSize', 'sourceUnit']),
    review: object({ source: { enum: ['manual', 'ai', 'sample'] }, status: { enum: ['draft', 'confirmed'] },
      unconfirmed: array(text) })
  }
};
