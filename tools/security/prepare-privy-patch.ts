import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const sdkRoot = process.argv[2];
if (!sdkRoot) throw new Error('Pass the isolated @privy-io/expo package directory after bun patch prepares it.');
const manifest = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
if (manifest.name !== '@privy-io/expo' || manifest.version !== '0.76.1')
  throw new Error('Review a new SDK version before changing this patch.');
const policy = readFileSync(path.join(import.meta.dirname, '../../src/lib/panta-privy-webview.ts'), 'utf8');
const compiled = ts.transpileModule(policy, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed },
}).outputText;
writeFileSync(path.join(sdkRoot, 'dist/panta-wallet-webview.js'), compiled);

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`SDK source changed at ${before.slice(0, 60)}; inspect it before patching.`);
  return source.replace(before, after);
}

for (const entry of ['dist/chunk-JEAOUXOJ.js', 'dist/esm/chunk-JEAOUXOJ.js']) {
  const file = path.join(sdkRoot, entry);
  let source = readFileSync(file, 'utf8');
  const esm = entry.includes('/esm/');
  source =
    (esm
      ? 'import*as pantaWalletPolicy from"../panta-wallet-webview.js";'
      : 'var pantaWalletPolicy=require("./panta-wallet-webview.js");') + source;
  source = replaceOnce(
    source,
    'var m;let{data:u}=c.nativeEvent,p=JSON.parse(u);if(_t(p))',
    'var m;try{let p=pantaWalletPolicy.readPrivyWalletMessage(c.nativeEvent.data,c.nativeEvent.url,e.embeddedWallet.getURL());if(!p)return;if(_t(p))'
  );
  source = replaceOnce(
    source,
    'e.embeddedWallet.onMessage(p)}),[e])',
    'e.embeddedWallet.onMessage(p)}catch{e.logger.error("Wallet bridge message failed")}}),[e])'
  );
  source = replaceOnce(
    source,
    'source:{uri:e.embeddedWallet.getURL()},webviewDebuggingEnabled:e.logger.level==="DEBUG"',
    // WebView's restrictive originWhitelist opens rejected URLs through Linking before invoking
    // onShouldStartLoadWithRequest. Match all origins there so this callback denies them without
    // external handoff. The callback and validated initial source are the actual URL allowlist.
    'source:pantaWalletPolicy.isPrivyWalletUrl(e.embeddedWallet.getURL(),e.embeddedWallet.getURL())?{uri:e.embeddedWallet.getURL()}:{html:""},originWhitelist:["*"],onShouldStartLoadWithRequest:c=>pantaWalletPolicy.isPrivyWalletUrl(c.url,e.embeddedWallet.getURL()),setSupportMultipleWindows:!1,javaScriptCanOpenWindowsAutomatically:!1,onOpenWindow:()=>{},mixedContentMode:"never",allowFileAccess:!1,allowFileAccessFromFileURLs:!1,allowUniversalAccessFromFileURLs:!1,webviewDebuggingEnabled:!1'
  );
  source = replaceOnce(
    source,
    'onError:console.error,onMessage:s',
    'onError:()=>e.logger.error("Wallet service failed"),onHttpError:()=>e.logger.error("Wallet service failed"),onMessage:s'
  );
  for (const [label, variable] of [
    ['get the value from', 'o'],
    ['remove the value from', 'o'],
    ['write the value to', 'n'],
  ]) {
    source = replaceOnce(
      source,
      `console.warn("Failed to ${label} secure store",${variable})`,
      `console.warn("Wallet secure storage failed")`
    );
  }
  writeFileSync(file, source);
}
