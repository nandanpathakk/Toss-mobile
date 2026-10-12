import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const requirePackage = createRequire(path.join(process.cwd(), 'package.json'));
const braces = requirePackage('braces');

test('normal build glob patterns retain compilation and expansion behavior', () => {
  assert.deepEqual(braces.expand('src/{app,features}/**/*.{ts,tsx}'), [
    'src/app/**/*.ts',
    'src/app/**/*.tsx',
    'src/features/**/*.ts',
    'src/features/**/*.tsx',
  ]);
  assert.deepEqual(braces.expand('a{1..5}'), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(braces.expand('{a,{b,c}}'), ['a', 'b', 'c']);
  assert.equal(braces.compile('{a,b}'), '(a|b)');
  assert.equal(braces.stringify(braces.parse('{a,b}')), '{a,b}');
});

for (const count of [65, 1000, 4000]) {
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    test(`rejects ${count} levels of ${open}${close} nesting before recursive processing`, () => {
      const pattern = open.repeat(count) + 'a' + close.repeat(count);
      for (const method of ['parse', 'compile', 'expand', 'stringify']) {
        assert.throws(() => braces[method](pattern), /Panta: brace/);
      }
    });
  }
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method} rejects excessive and cyclic caller-provided ASTs`, () => {
    let ast: { type: string; value?: string; nodes?: unknown[] } = { type: 'text', value: 'a' };
    for (let i = 0; i < 1000; i++) ast = { type: 'root', nodes: [ast] };
    assert.throws(() => braces[method](ast), /Panta: brace/);
    const cycle: { type: string; nodes: unknown[] } = { type: 'root', nodes: [] };
    cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), /Panta: brace/);
  });
}

// Metro 0.83 passes a file path to image-size 1.x; patched 2.x requires bytes.
// Exercise the real development asset pipeline, not just image-size directly.
test('Metro reads React Native development PNG assets with the patched image parser', async () => {
  const { getAssetData } = requirePackage('metro/private/Assets');
  const asset = path.join(process.cwd(), 'node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/chevron-left.png');
  for (const platform of ['ios', 'android']) {
    const result = await getAssetData(
      asset,
      'node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/chevron-left.png',
      [],
      platform,
      '/assets'
    );
    assert.equal(result.type, 'png');
    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
  }
});
