import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { parse } from '@babel/parser';
import ts from 'typescript';

import { isPrivyWalletUrl, readPrivyWalletMessage } from '../../src/lib/panta-privy-webview';

const expected = 'https://auth.privy.io/apps/development_app/embedded-wallets?client_id=public_client';
const packet = JSON.stringify({ event: 'privy:iframe:ready', id: 'request-1', data: {} });

test('wallet page permits the configured app, query/hash variations and HTTPS default port', () => {
  for (const url of [
    expected,
    expected + '#ready',
    expected.replace('embedded-wallets?', 'embedded-wallets/?'),
    expected.replace('?client_id=public_client', '?caid=public_device'),
    expected.replace('.io/', '.io:443/'),
  ]) {
    assert.ok(isPrivyWalletUrl(url, expected));
    assert.ok(readPrivyWalletMessage(packet, url, expected));
  }
});

for (const url of [
  'https://auth.privy.io.evil.example/apps/development_app/embedded-wallets',
  'https://auth.privy.io@evil.example/apps/development_app/embedded-wallets',
  'https://evil.example@auth.privy.io/apps/development_app/embedded-wallets',
  expected.replace('https:', 'http:'),
  expected.replace('.io/', '.io:8443/'),
  expected.replace('development_app', 'different_app'),
  expected.replace('embedded-wallets', 'other-page'),
  expected.replace('embedded-wallets', 'embedded-wallets//'),
  expected.replace('/apps/', '/apps/../apps/'),
  expected.replace('/apps/', '\\apps/'),
  expected.replace('/apps/', '/%61pps/'),
  'about:blank',
  'javascript:alert(1)',
  'file:///private/tmp/wallet.html',
  'panta-hackathon://wallet/connect',
  ' ' + expected,
  expected + '\n',
  undefined,
]) {
  test(`rejects untrusted wallet page ${JSON.stringify(url)}`, () => {
    assert.equal(isPrivyWalletUrl(url, expected), false);
    assert.equal(readPrivyWalletMessage(packet, url, expected), null);
  });
}

test('rejects malformed, oversized and unsupported bridge messages without throwing', () => {
  for (const value of [
    '{',
    'null',
    '[]',
    '1',
    '{}',
    packet.replace('request-1', ''),
    JSON.stringify({ event: 'app:secure-storage:unknown', id: '1', data: {} }),
    'x'.repeat(1024 * 1024 + 1),
    null,
  ]) {
    assert.equal(readPrivyWalletMessage(value, expected, expected), null);
  }
});

test('accepts SDK storage request shapes and rejects invalid native storage arguments', () => {
  for (const event of ['app:secure-storage:get', 'app:secure-storage:remove', 'app:secure-storage:set']) {
    const value = JSON.stringify({ event, id: '1', data: { key: 'privy:wallet-key', value: 'sensitive fixture' } });
    assert.ok(readPrivyWalletMessage(value, expected, expected));
  }
  for (const data of [{ key: '../../other' }, { key: null }, [], { key: '' }, { key: 'privy:key', value: {} }]) {
    assert.equal(readPrivyWalletMessage(JSON.stringify({ event: 'app:secure-storage:set', id: '1', data }), expected, expected), null);
  }
});

// Before project installation, run with the isolated package path. After installation,
// the published SDK export resolves its guarded package automatically.
const requirePackage = createRequire(path.join(process.cwd(), 'package.json'));
let sdkRoot = process.env.PANTA_PRIVY_REVIEW_SDK_ROOT;
if (!sdkRoot) {
  try {
    sdkRoot = path.resolve(path.dirname(requirePackage.resolve('@privy-io/expo')), '..');
  } catch {
    // The initial review deliberately precedes SDK installation.
  }
}

test('installed SDK policy exactly matches its reviewed TypeScript source', { skip: !sdkRoot }, () => {
  assert.ok(sdkRoot);
  const policy = readFileSync(path.join(import.meta.dirname, '../../src/lib/panta-privy-webview.ts'), 'utf8');
  const compiled = ts.transpileModule(policy, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed },
  }).outputText;
  assert.equal(readFileSync(path.join(sdkRoot, 'dist/panta-wallet-webview.js'), 'utf8'), compiled);
});

for (const entry of ['dist/chunk-JEAOUXOJ.js', 'dist/esm/chunk-JEAOUXOJ.js']) {
  test(`actual SDK handler blocks foreign messages and redacts failures (${entry})`, { skip: !sdkRoot }, async () => {
    assert.ok(sdkRoot);
    const source = readFileSync(path.join(sdkRoot, entry), 'utf8');
    const ast = parse(source, { sourceType: 'unambiguous' });
    let handler: { start: number; end: number } | undefined;
    let navigation: { start: number; end: number } | undefined;
    let initialSource: { start: number; end: number } | undefined;
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (typeof node.start === 'number' && typeof node.end === 'number') {
        const text = source.slice(node.start, node.end);
        if (node.type === 'FunctionExpression' && node.generator && text.includes('pantaWalletPolicy.readPrivyWalletMessage'))
          handler = { start: node.start, end: node.end };
        if (node.type === 'ObjectProperty' && (node.key as { name?: string })?.name === 'onShouldStartLoadWithRequest')
          navigation = node.value as { start: number; end: number };
        if (
          node.type === 'ObjectProperty' &&
          (node.key as { name?: string })?.name === 'source' &&
          text.includes('pantaWalletPolicy.isPrivyWalletUrl')
        )
          initialSource = node.value as { start: number; end: number };
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'extra'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
      }
    }
    visit(ast);
    assert.ok(handler);
    assert.ok(navigation);
    assert.ok(initialSource);
    const policy = requirePackage(path.join(sdkRoot, 'dist/panta-wallet-webview.js'));
    const forwarded: unknown[] = [];
    const storage: unknown[] = [];
    const logged: string[] = [];
    const context = {
      pantaWalletPolicy: policy,
      c: { nativeEvent: { data: packet, url: 'https://evil.example/' } },
      e: {
        embeddedWallet: { getURL: () => expected, onMessage: (p: unknown) => forwarded.push(p) },
        logger: { error: (s: string) => logged.push(s) },
      },
      _t: (p: { event: string }) => p.event.startsWith('app:secure-storage:'),
      kt: async (p: unknown) => {
        storage.push(p);
        return { ok: true };
      },
      r: { current: { postMessage: () => undefined } },
    };
    const sourceExpression = '(' + source.slice(initialSource.start, initialSource.end) + ')';
    assert.equal(vm.runInNewContext(sourceExpression, context).uri, expected);
    context.e.embeddedWallet.getURL = () => 'https://evil.example/';
    const blocked = vm.runInNewContext(sourceExpression, context);
    assert.equal(blocked.html, '');
    assert.equal(blocked.uri, undefined);
    context.e.embeddedWallet.getURL = () => expected;
    const navigate = vm.runInNewContext('(' + source.slice(navigation.start, navigation.end) + ')', context);
    assert.equal(navigate({ url: expected }), true);
    assert.equal(navigate({ url: 'https://evil.example/' }), false);
    const onMessage = vm.runInNewContext('(' + source.slice(handler.start, handler.end) + ')', context);
    async function run() {
      const iterator = onMessage();
      let step = iterator.next();
      while (!step.done) step = iterator.next(await step.value);
    }
    await run();
    assert.equal(forwarded.length, 0);
    context.c.nativeEvent.data = JSON.stringify({ event: 'app:secure-storage:get', id: '1', data: { key: 'privy:key' } });
    await run();
    assert.equal(storage.length, 0);
    context.c.nativeEvent.url = expected;
    await run();
    assert.equal(storage.length, 1);
    context.c.nativeEvent.data = packet;
    await run();
    assert.equal(forwarded.length, 1);
    context.e.embeddedWallet.onMessage = () => {
      throw new Error('sensitive fixture');
    };
    await run();
    assert.deepEqual(logged, ['Wallet bridge message failed']);
    assert.ok(source.includes('webviewDebuggingEnabled:!1'));
    assert.ok(source.includes('setSupportMultipleWindows:!1'));
    assert.ok(source.includes('onError:()=>e.logger.error("Wallet service failed")'));
    assert.ok(!source.includes('console.error'));
  });
}
