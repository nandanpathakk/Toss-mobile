import bs58 from 'bs58';
import nacl from 'tweetnacl';

export type WalletError = 'SETUP' | 'UNAVAILABLE' | 'ENTROPY' | 'OPEN' | 'REJECTED' | 'INVALID' | 'TIMEOUT' | 'RETURNED' | 'DISCONNECT';
export type WalletState = {
  status: 'disconnected' | 'opening' | 'waiting' | 'connected' | 'disconnecting';
  address: string | null;
  error: WalletError | null;
};
export const emptyWalletState: WalletState = { status: 'disconnected', address: null, error: null };
export type WalletConnector = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  cancel: () => void;
  handleURL: (url: string) => void;
  leftApp: () => void;
  returnedToApp: () => void;
};
type Cluster = 'devnet' | 'testnet' | 'mainnet-beta';
type Session = { keypair: nacl.BoxKeyPair; shared: Uint8Array; token: string; address: string };
type Pending = {
  kind: 'connect' | 'disconnect';
  state: string;
  started: number;
  keypair: nacl.BoxKeyPair;
  away: boolean;
  controller: AbortController;
};
type Dependencies = {
  randomBytes: (length: number) => Uint8Array;
  openWallet: (url: string, signal: AbortSignal) => Promise<void>;
  onState: (state: WalletState) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => () => void;
};

const callbackBase = 'panta-hackathon://wallet/';
const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function decode(value: string | undefined, size?: number) {
  if (!value || value.length > 8192 || !base58.test(value)) throw new Error('Invalid encoding');
  const bytes = bs58.decode(value);
  if (size !== undefined && bytes.length !== size) throw new Error('Invalid length');
  if (bs58.encode(bytes) !== value) throw new Error('Noncanonical encoding');
  return bytes;
}

// Bounded UTF-8 conversion avoids relying on absent React Native TextEncoder/Buffer globals.
function encodeJson(value: unknown) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return new Uint8Array(bytes);
}

function decodeJson(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.length > 4096) throw new Error('Oversized message');
  const text = decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid message');
  return data as Record<string, unknown>;
}

function query(params: Record<string, string>) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

// Exact native routes: React Native's built-in URL parser does not parse custom-scheme hosts.
function callback(url: string): { kind: Pending['kind']; params: Map<string, string> } | null {
  if (url.length > 12288 || url.includes('#')) return null;
  const match = /^panta-hackathon:\/\/wallet\/(connect|disconnect)\?([^\s]*)$/.exec(url);
  if (!match) return null;
  const params = new Map<string, string>();
  for (const pair of match[2].split('&')) {
    const separator = pair.indexOf('=');
    if (separator < 1) throw new Error('Invalid parameter');
    const name = decodeURIComponent(pair.slice(0, separator));
    const value = decodeURIComponent(pair.slice(separator + 1));
    if (params.has(name)) throw new Error('Duplicate parameter');
    params.set(name, value);
  }
  return { kind: match[1] as Pending['kind'], params };
}

function validIdentity(url: string | null): url is string {
  return !!url && url.length <= 512 && /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?:\/[a-zA-Z0-9._~%/-]*)?$/.test(url);
}

/** Connection only. No transaction signing, broadcast, persistence or Panta authentication. */
export function createPhantomConnector(appUrl: string | null, cluster: Cluster, dependencies: Dependencies): WalletConnector {
  const now = dependencies.now ?? Date.now;
  const schedule =
    dependencies.schedule ??
    ((fn, delay) => {
      const timer = setTimeout(fn, delay);
      return () => clearTimeout(timer);
    });
  let pending: Pending | null = null;
  let session: Session | null = null;
  let stopTimeout: (() => void) | null = null;
  let stopReturn: (() => void) | null = null;
  function clearPending() {
    stopTimeout?.();
    stopReturn?.();
    stopTimeout = null;
    stopReturn = null;
    pending?.controller.abort();
    if (pending?.kind === 'connect' && pending.keypair !== session?.keypair) pending.keypair.secretKey.fill(0);
    pending = null;
  }
  function forget(error: WalletError | null = null) {
    clearPending();
    session?.keypair.secretKey.fill(0);
    session?.shared.fill(0);
    session = null;
    dependencies.onState({ ...emptyWalletState, error });
  }
  function entropy(size: number) {
    const bytes = dependencies.randomBytes(size);
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error('No secure entropy');
    return bytes;
  }
  function start(kind: Pending['kind'], keypair: nacl.BoxKeyPair) {
    const stateBytes = entropy(24);
    const state = bs58.encode(stateBytes);
    stateBytes.fill(0);
    const request: Pending = { kind, keypair, state, started: now(), away: false, controller: new AbortController() };
    pending = request;
    stopTimeout = schedule(() => {
      if (pending === request) forget(kind === 'disconnect' ? 'DISCONNECT' : 'TIMEOUT');
    }, 120000);
    return request;
  }
  async function open(request: Pending, url: string) {
    try {
      await dependencies.openWallet(url, request.controller.signal);
      if (pending === request && request.kind === 'connect') {
        dependencies.onState({ status: 'waiting', address: null, error: null });
      }
    } catch (error) {
      if (pending === request)
        forget(request.kind === 'disconnect' ? 'DISCONNECT' : error instanceof WalletUnavailable ? 'UNAVAILABLE' : 'OPEN');
    }
  }
  return {
    async connect() {
      if (pending) return;
      forget();
      if (!validIdentity(appUrl)) return forget('SETUP');
      dependencies.onState({ status: 'opening', address: null, error: null });
      let keypair: nacl.BoxKeyPair | null = null;
      let request: Pending;
      try {
        const secret = entropy(32);
        try {
          keypair = nacl.box.keyPair.fromSecretKey(secret);
        } finally {
          secret.fill(0);
        }
        request = start('connect', keypair);
      } catch {
        keypair?.secretKey.fill(0);
        return forget('ENTROPY');
      }
      await open(
        request,
        `https://phantom.com/ul/v1/connect?${query({
          app_url: appUrl,
          cluster,
          dapp_encryption_public_key: bs58.encode(request.keypair.publicKey),
          redirect_link: `${callbackBase}connect?${query({ state: request.state })}`,
        })}`
      );
    },
    async disconnect() {
      if (pending || !session) return;
      const connected = session;
      let request: Pending;
      let url: string;
      try {
        request = start('disconnect', connected.keypair);
        const nonce = entropy(nacl.box.nonceLength);
        const message = encodeJson({ session: connected.token });
        const payload = nacl.box.after(message, nonce, connected.shared);
        message.fill(0);
        url = `https://phantom.com/ul/v1/disconnect?${query({
          dapp_encryption_public_key: bs58.encode(connected.keypair.publicKey),
          nonce: bs58.encode(nonce),
          payload: bs58.encode(payload),
          redirect_link: `${callbackBase}disconnect?${query({ state: request.state })}`,
        })}`;
      } catch {
        return forget('DISCONNECT');
      }
      dependencies.onState({ status: 'disconnecting', address: null, error: null });
      await open(request, url);
    },
    cancel() {
      forget(pending?.kind === 'disconnect' ? 'DISCONNECT' : null);
    },
    handleURL(url) {
      if (!pending) return;
      let parsed: ReturnType<typeof callback>;
      try {
        parsed = callback(url);
      } catch {
        return;
      }
      if (!parsed || parsed.kind !== pending.kind || parsed.params.get('state') !== pending.state) return;
      const request = pending;
      if (now() - request.started > 120000 || now() < request.started)
        return forget(request.kind === 'disconnect' ? 'DISCONNECT' : 'TIMEOUT');
      const params = parsed.params;
      const allowed = new Set([
        'state',
        'errorCode',
        'errorMessage',
        ...(request.kind === 'connect' ? ['phantom_encryption_public_key', 'nonce', 'data'] : []),
      ]);
      if (Array.from(params.keys()).some(key => !allowed.has(key))) return forget('INVALID');
      if (params.has('errorCode') || params.has('errorMessage')) return forget(request.kind === 'disconnect' ? 'DISCONNECT' : 'REJECTED');
      if (request.kind === 'disconnect') return forget();
      let shared: Uint8Array | null = null;
      let plaintext: Uint8Array | null = null;
      let signedData: Uint8Array | null = null;
      try {
        const walletEncryptionKey = decode(params.get('phantom_encryption_public_key'), nacl.box.publicKeyLength);
        // Reject non-contributory X25519 inputs before accepting any session.
        const contribution = nacl.scalarMult(request.keypair.secretKey, walletEncryptionKey);
        if (contribution.every(byte => byte === 0)) throw new Error('Invalid key');
        contribution.fill(0);
        shared = nacl.box.before(walletEncryptionKey, request.keypair.secretKey);
        plaintext = nacl.box.open.after(decode(params.get('data')), decode(params.get('nonce'), nacl.box.nonceLength), shared);
        if (!plaintext) throw new Error('Invalid encryption');
        const data = decodeJson(plaintext);
        if (typeof data.public_key !== 'string' || typeof data.session !== 'string') throw new Error('Invalid session');
        const publicKey = decode(data.public_key, nacl.sign.publicKeyLength);
        signedData = nacl.sign.open(decode(data.session), publicKey);
        if (!signedData) throw new Error('Invalid signature');
        const claims = decodeJson(signedData);
        if (
          claims.app_url !== appUrl ||
          claims.chain !== 'solana' ||
          claims.cluster !== cluster ||
          typeof claims.timestamp !== 'number' ||
          !Number.isSafeInteger(claims.timestamp) ||
          claims.timestamp < Math.floor(request.started / 1000) - 300 ||
          claims.timestamp > Math.floor(now() / 1000) + 300
        ) {
          throw new Error('Wrong session claims');
        }
        session = { keypair: request.keypair, shared, token: data.session, address: data.public_key };
        shared = null;
        clearPending();
        dependencies.onState({ status: 'connected', address: session.address, error: null });
      } catch {
        forget('INVALID');
      } finally {
        shared?.fill(0);
        plaintext?.fill(0);
        signedData?.fill(0);
      }
    },
    leftApp() {
      if (pending) pending.away = true;
    },
    returnedToApp() {
      const request = pending;
      if (!request?.away || stopReturn) return;
      stopReturn = schedule(() => {
        if (pending === request) forget(request.kind === 'disconnect' ? 'DISCONNECT' : 'RETURNED');
      }, 2500);
    },
  };
}

export class WalletUnavailable extends Error {}
