import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const root = process.argv[2];
if (!root) throw new Error('Pass the Bun-prepared @privy-io/js-sdk-core directory.');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.name !== '@privy-io/js-sdk-core' || manifest.version !== '0.78.1')
  throw new Error('Review SDK changes before applying this patch.');
for (const entry of ['dist/cjs/index.js', 'dist/esm/index.mjs']) {
  const file = path.join(root, entry);
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: { start: number; end: number; text: string }[] = [];
  let analytics = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(ast) === 'console'
    ) {
      edits.push({ start: node.getStart(ast), end: node.end, text: '(void 0)' });
      return;
    }
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'createAnalyticsEvent' && node.body) {
      analytics++;
      // The app supplies a silent logger. Disabling SDK telemetry here also keeps
      // signing/recovery errors and provider payloads out of analytics requests.
      edits.push({ start: node.body.getStart(ast), end: node.body.end, text: '{return;}' });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (edits.length !== 16 || analytics !== 1) throw new Error('SDK logging/analytics source changed; inspect it before patching.');
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (next.includes('console.') || !next.includes('async createAnalyticsEvent(e,t){return;}'))
    throw new Error('SDK patch did not cover the expected paths.');
  writeFileSync(file, next);
}
