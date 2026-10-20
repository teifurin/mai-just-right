// Annotation keywords do not affect whether a value satisfies a schema.
const ANNOTATIONS = new Set([
  '$schema', '$id', '$anchor', '$comment', '$defs', 'definitions',
  'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
]);
const IMPLEMENTED = new Set([
  '$ref', 'const', 'enum', 'type', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength',
  'minItems', 'maxItems', 'uniqueItems', 'prefixItems', 'items',
  'required', 'properties', 'additionalProperties', 'dependentRequired',
]);
const STRING_ONLY = new Set(['pattern', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema']);
const NUMBER_ONLY = new Set(['multipleOf']);
const ARRAY_ONLY = new Set(['contains', 'minContains', 'maxContains', 'additionalItems', 'unevaluatedItems']);
const OBJECT_ONLY = new Set(['minProperties', 'maxProperties', 'patternProperties', 'propertyNames', 'dependentSchemas', 'dependencies', 'unevaluatedProperties']);

function hasDeferredConstraint(value, schema) {
  return Object.keys(schema).some(key => {
    if (ANNOTATIONS.has(key) || IMPLEMENTED.has(key)) return false;
    if (STRING_ONLY.has(key)) return typeof value === 'string';
    if (NUMBER_ONLY.has(key)) return typeof value === 'number';
    if (ARRAY_ONLY.has(key)) return Array.isArray(value);
    if (OBJECT_ONLY.has(key)) return value !== null && typeof value === 'object' && !Array.isArray(value);
    // Unknown extensions/references may assert constraints. Do not assume true.
    return true;
  });
}

function outcome(result) {
  return result.errors.length ? 'invalid' : result.unknown ? 'unknown' : 'valid';
}

/** Internal tri-state evaluation: errors are definite violations; unknown means
 * the authoritative server must evaluate a constraint we intentionally defer. */
function evaluate(value, schema, root, path, depth, budget) {
  const errors = [];
  let unknown = false;
  const check = (v, s, p = path) => evaluate(v, s, root, p, depth + 1, budget);
  const merge = result => { errors.push(...result.errors); unknown ||= result.unknown; };
  if (depth > 30 || --budget.remaining < 0) return { errors, unknown: true };
  if (schema === false) return { errors: [`${path}: value is not allowed`], unknown: false };
  if (schema === true || schema === undefined) return { errors, unknown: false };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { errors, unknown: true };
  unknown = hasDeferredConstraint(value, schema);
  if (schema.$ref) {
    if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) unknown = true;
    else {
      const target = schema.$ref.slice(2).split('/').reduce((v, k) => {
        const key = k.replace(/~1/g, '/').replace(/~0/g, '~');
        return v !== null && typeof v === 'object' && Object.hasOwn(v, key) ? v[key] : undefined;
      }, root);
      if (target === undefined) unknown = true;
      else merge(check(value, target));
    }
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if ('const' in schema && !equal(value, schema.const)) errors.push(`${path}: does not match const`);
  if (schema.enum && !schema.enum.some(v => equal(value, v))) errors.push(`${path}: not in enum`);
  const matches = (type) => ({ null: value === null, array: Array.isArray(value), object: value !== null && typeof value === 'object' && !Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isSafeInteger(value) })[type] ?? false;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches)) return { errors: [...errors, `${path}: expected ${schema.type}`], unknown: false };
  if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) merge(check(value, sub));
  if (Array.isArray(schema.anyOf)) {
    const states = schema.anyOf.map(s => outcome(check(value, s)));
    if (!states.includes('valid')) {
      if (states.includes('unknown')) unknown = true;
      else errors.push(`${path}: does not match any allowed variant`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const states = schema.oneOf.map(s => outcome(check(value, s)));
    const valid = states.filter(s => s === 'valid').length;
    const uncertain = states.includes('unknown');
    if (valid > 1 || (valid === 0 && !uncertain)) errors.push(`${path}: must match exactly one variant`);
    else if (uncertain) unknown = true;
  }
  if (Object.hasOwn(schema, 'not')) {
    const state = outcome(check(value, schema.not));
    if (state === 'valid') errors.push(`${path}: matches a forbidden variant`);
    else if (state === 'unknown') unknown = true;
  }
  if (Object.hasOwn(schema, 'if')) {
    const condition = outcome(check(value, schema.if));
    if (condition !== 'unknown') merge(check(value, condition === 'valid' ? schema.then : schema.else));
    else {
      const branches = [check(value, schema.then), check(value, schema.else)].map(outcome);
      if (branches.every(state => state === 'invalid')) errors.push(`${path}: neither conditional branch accepts this value`);
      else if (!branches.every(state => state === 'valid')) unknown = true;
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: below exclusive minimum`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path}: above exclusive maximum`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${path}: too long`);
    // Pattern/format remain deferred; their unknown result must not determine a
    // oneOf count, negate into a rejection, or select an if/then/else branch.
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(`${path}: duplicate items`);
    for (let i = 0; i < value.length; i++) merge(check(value[i], schema.prefixItems?.[i] ?? (Array.isArray(schema.items) ? schema.items[i] : schema.items), `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    if (Object.keys(value).length > 1000) return { errors: [`${path}: too many properties`], unknown: false };
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) { errors.push(`${path}: unsafe property name`); continue; }
      if (Object.hasOwn(schema.properties ?? {}, key)) merge(check(item, schema.properties[key], `${path}.${key}`));
      // A deferred patternProperties match may make this a declared property.
      else if (schema.patternProperties && Object.keys(schema.patternProperties).length) unknown = true;
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional property not allowed`);
      else if (typeof schema.additionalProperties === 'object') merge(check(item, schema.additionalProperties, `${path}.${key}`));
    }
    for (const [key, needed] of Object.entries(schema.dependentRequired ?? {})) if (Object.hasOwn(value, key)) for (const other of needed) if (!Object.hasOwn(value, other)) errors.push(`${path}.${other}: required with ${key}`);
  }
  return { errors: errors.slice(0, 30), unknown: errors.length ? false : unknown };
}

/** Validate common JSON Schema constraints without coercion. Unknown constraints
 * are deferred to the authoritative MCP server, never assumed to match. */
export function validateArguments(value, schema, root = schema, path = '$', depth = 0) {
  return evaluate(value, schema, root, path, depth, { remaining: 10000 }).errors;
}

export function assertPlainArguments(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).length > 65536) throw new Error('Tool arguments exceed 64 KiB.');
  const visit = (v, depth = 0) => {
    if (depth > 25) throw new Error('Tool arguments are nested too deeply.');
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Non-finite numbers are not allowed.');
    if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe property name.');
      visit(child, depth + 1);
    }
  };
  visit(value);
  return value;
}
