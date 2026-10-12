import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

test('installed Privy core has no console payload paths and analytics cannot dispatch requests', async () => {
  const root = path.join(process.cwd(), 'node_modules/@privy-io/js-sdk-core');
  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, '0.78.1');
  for (const entry of ['dist/cjs/index.js', 'dist/esm/index.mjs']) {
    const source = readFileSync(path.join(root, entry), 'utf8');
    assert.ok(!source.includes('console.'));
    const ast = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const bodies: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'createAnalyticsEvent' && node.body)
        bodies.push(node.body.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.deepEqual(bodies, ['{return;}']);
    const run = new Function('return async function(event,payload)' + bodies[0])();
    let calls = 0;
    await run.call(
      {
        fetch: () => {
          calls++;
        },
      },
      'embedded_wallet_sdk_rpc_failed',
      { error: 'synthetic-secret' }
    );
    assert.equal(calls, 0);
  }
});
