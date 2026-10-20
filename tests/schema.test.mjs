import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArguments } from '../server/schema.mjs';

test('oneOf defers pattern and format branches instead of counting them as matches', () => {
  assert.deepEqual(validateArguments('A', { type: 'string', oneOf: [{ pattern: '^A$' }, { pattern: '^B$' }] }), []);
  assert.deepEqual(validateArguments('person@example.test', { oneOf: [{ type: 'string', format: 'email' }, { type: 'string', format: 'uri' }] }), []);
  assert.deepEqual(validateArguments(2, { oneOf: [{ multipleOf: 2 }, { multipleOf: 3 }] }), []);
});

test('oneOf still rejects definitely zero or multiple matching branches', () => {
  assert.ok(validateArguments(true, { oneOf: [{ type: 'string' }, { type: 'number' }] }).length);
  assert.ok(validateArguments('A', { oneOf: [{ type: 'string' }, { minLength: 1 }, { pattern: '^B$' }] }).length);
});

test('not propagates unknown while retaining definite known-schema rejection', () => {
  assert.deepEqual(validateArguments('good', { not: { pattern: '^bad$' } }), []);
  assert.ok(validateArguments('bad', { not: { const: 'bad' } }).length);
  assert.ok(validateArguments('A', { not: { anyOf: [{ type: 'string' }, { pattern: '^B$' }] } }).length);
  assert.deepEqual(validateArguments('A', { not: { allOf: [{ type: 'number' }, { pattern: '^B$' }] } }), []);
});

test('unknown if condition does not select a branch but rejects impossible alternatives', () => {
  const schema = { if: { pattern: '^A$' }, then: { const: 'A' }, else: { const: 'B' } };
  assert.deepEqual(validateArguments('A', schema), []);
  assert.deepEqual(validateArguments('B', schema), []);
  assert.ok(validateArguments('C', schema).length);
  assert.deepEqual(validateArguments('B', { if: { pattern: '^A$' }, then: { const: 'A' } }), []);
});

test('known and boolean conditions keep enforcing the selected branch', () => {
  assert.ok(validateArguments('A', { if: { const: 'A' }, then: { minLength: 2 }, else: true }).length);
  assert.ok(validateArguments('A', { if: false, then: true, else: false }).length);
  assert.deepEqual(validateArguments('A', { if: true, then: true, else: false }), []);
});

test('deferred constraints do not hide definite ordinary validation errors', () => {
  assert.ok(validateArguments('abc', { minLength: 5, pattern: '^a' }).length);
  assert.ok(validateArguments(2, { minimum: 3, multipleOf: 2 }).length);
  assert.ok(validateArguments({ count: 0 }, { type: 'object', required: ['name'], properties: { count: { type: 'integer', minimum: 1 } } }).length);
  assert.ok(validateArguments({ other: 1 }, { properties: {}, additionalProperties: false }).length);
  assert.ok(validateArguments([0], { type: 'array', items: { type: 'integer', minimum: 1 } }).length);
});

test('unknown states propagate through local refs and nested properties', () => {
  const schema = { oneOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }], $defs: { a: { properties: { kind: { pattern: '^A$' } } }, b: { properties: { kind: { pattern: '^B$' } } } } };
  assert.deepEqual(validateArguments({ kind: 'A' }, schema), []);
  assert.ok(validateArguments({}, { $defs: { item: { required: ['id'] } }, $ref: '#/$defs/item' }).length);
});

test('annotations do not make known schemas uncertain', () => {
  assert.ok(validateArguments('A', { not: { type: 'string', title: 'Label', description: 'Annotation', examples: ['A'] } }).length);
  assert.deepEqual(validateArguments('A', { oneOf: [{ type: 'string', title: 'Label' }, { type: 'number' }] }), []);
});

test('deferred patternProperties cannot cause a false additional-property rejection', () => {
  assert.deepEqual(validateArguments({ matching: 1 }, { type: 'object', patternProperties: { '^match': { type: 'number' } }, additionalProperties: false }), []);
  assert.ok(validateArguments({ count: 'bad' }, { type: 'object', properties: { count: { type: 'number' } }, patternProperties: { '^c': {} } }).length);
});
