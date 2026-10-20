import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Exercise the dependency actually used by the build tool, not a test stub.
let dependencyRequire = createRequire(import.meta.url);
for (const name of ['vinext', 'vite-plugin-commonjs', 'vite-plugin-dynamic-import', 'fast-glob', 'micromatch']) {
  const manifest = dependencyRequire.resolve.paths(name)
    .map(directory => join(directory, name, 'package.json'))
    .find(filename => existsSync(filename));
  assert.ok(manifest, `Missing build dependency: ${name}`);
  dependencyRequire = createRequire(realpathSync(manifest));
}
const braces = dependencyRequire('braces');
const rejectedDepth = error => error?.code === 'ERR_BRACES_DEPTH';

test('patched brace expansion preserves ordinary project glob patterns', () => {
  assert.deepEqual(braces.expand('src/{app,server}/*.{js,ts}'), [
    'src/app/*.js', 'src/app/*.ts', 'src/server/*.js', 'src/server/*.ts',
  ]);
  assert.equal(braces.compile('src/{app,server}/**'), 'src/(app|server)/**');
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
});

test('deep balanced, unbalanced and parenthesized input is rejected before recursive walking', () => {
  const inputs = ['{'.repeat(4000) + 'a,b' + '}'.repeat(4000), '{'.repeat(4000), '('.repeat(4000) + 'a' + ')'.repeat(4000)];
  for (const input of inputs) {
    for (const operation of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[operation](input), rejectedDepth);
    }
  }
});

test('prebuilt deep or cyclic ASTs cannot bypass the brace depth guard', () => {
  let deep = { type: 'text', value: 'a' };
  for (let index = 0; index < 4000; index++) deep = { type: 'root', nodes: [deep] };
  const cyclic = { type: 'root', nodes: [] };
  cyclic.nodes.push(cyclic);
  for (const ast of [deep, cyclic]) {
    for (const operation of ['compile', 'expand', 'stringify']) {
      assert.throws(() => braces[operation](ast), rejectedDepth);
    }
  }
});
