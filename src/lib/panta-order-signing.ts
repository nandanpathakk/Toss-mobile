import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { sha256 } from 'viem/utils';

import { type OrderBuild } from './panta-order-build';

export class SigningError extends Error {
  constructor(public readonly code: 'INVALID_TRANSACTION' | 'MESSAGE_CHANGED' | 'INVALID_SIGNATURE' | 'EXPIRED') {
    super(code);
  }
}
function check(value: unknown): asserts value {
  if (!value) throw new SigningError('INVALID_TRANSACTION');
}
function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function base64(value: string) {
  check(value.length <= 1644 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const result: number[] = [];
  let bits = 0;
  let count = 0;
  for (const character of value.replace(/=+$/, '')) {
    bits = (bits << 6) | alphabet.indexOf(character);
    count += 6;
    if (count >= 8) {
      count -= 8;
      result.push((bits >> count) & 255);
      bits &= (1 << count) - 1;
    }
  }
  check(bits === 0);
  return Uint8Array.from(result);
}

/** Independent decoder, not an encoder or an authorization decision.
 * Supports only our one-signer, static-account v0 primary builds. No ALTs/nonces.
 * Checks the compiled message against the build without assuming encoder key order.
 */
export function inspectPrimaryWire(wire: Uint8Array, build: OrderBuild) {
  check(wire instanceof Uint8Array && wire.length >= 70 && wire.length <= 1232);
  // Buffer.slice is a view; normalize so all returned bytes are defensive copies.
  wire = Uint8Array.from(wire);
  let offset = 0;
  function read(length: number) {
    check(Number.isInteger(length) && length >= 0 && offset + length <= wire.length);
    const value = wire.slice(offset, offset + length);
    offset += length;
    return value;
  }
  const byte = () => read(1)[0];
  function compact() {
    let value = 0;
    for (let index = 0; index < 3; index++) {
      const part = byte();
      check(index !== 2 || part <= 3);
      value |= (part & 127) << (index * 7);
      if (!(part & 128)) {
        check(index === 0 || part !== 0);
        return value;
      }
    }
    throw new SigningError('INVALID_TRANSACTION');
  }
  check(compact() === 1);
  const signature = read(64);
  const messageOffset = offset;
  check(byte() === 128 && byte() === 1 && byte() === 0);
  const readonly = byte();
  const count = compact();
  check(count > 0 && count <= 64 && readonly < count);
  const keys = Array.from({ length: count }, () => bs58.encode(read(32)));
  check(keys[0] === build.wallet && new Set(keys).size === count);
  check(bs58.encode(read(32)) === build.recentBlockhash);
  check(build.instructions.length >= 1 && build.instructions.length <= 3);
  check(compact() === build.instructions.length);
  const expected = new Map<string, { signer: boolean; writable: boolean }>([[build.wallet, { signer: true, writable: true }]]);
  for (const instruction of build.instructions) {
    check(instruction.accounts.length <= 64);
    for (const account of instruction.accounts) {
      check(!account.isSigner || account.pubkey === build.wallet);
      const previous = expected.get(account.pubkey);
      expected.set(account.pubkey, {
        signer: account.isSigner || !!previous?.signer,
        writable: account.isWritable || !!previous?.writable,
      });
    }
    if (!expected.has(instruction.programId)) expected.set(instruction.programId, { signer: false, writable: false });
    check(keys[byte()] === instruction.programId);
    check(compact() === instruction.accounts.length);
    for (const account of instruction.accounts) check(keys[byte()] === account.pubkey);
    const data = base64(instruction.data);
    check(compact() === data.length && equal(read(data.length), data));
  }
  check(compact() === 0 && offset === wire.length && expected.size === keys.length);
  keys.forEach((key, index) => {
    const role = expected.get(key);
    check(role && role.signer === (index === 0) && role.writable === index < count - readonly);
  });
  for (const instruction of build.instructions) {
    const role = expected.get(instruction.programId)!;
    check(!role.signer && !role.writable);
  }
  const message = wire.slice(messageOffset);
  return { message, signature, messageHash: sha256(message).slice(2) };
}

/** Verifies a provider result against the exact unsigned message that was approved.
 * Never signs, persists or sends anything. Callers must also enforce authorization,
 * current wallet ownership, live block-height checks and one-use approval.
 */
export function validateSignedPrimary(
  signed: Uint8Array,
  unsigned: Uint8Array,
  build: OrderBuild,
  approvedMessageHash: string,
  now = Date.now()
) {
  if (!Number.isFinite(Date.parse(build.expiresAt)) || Date.parse(build.expiresAt) <= now) throw new SigningError('EXPIRED');
  const before = inspectPrimaryWire(unsigned, build);
  check(before.signature.every(value => value === 0));
  if (!/^[0-9a-f]{64}$/.test(approvedMessageHash) || before.messageHash !== approvedMessageHash) throw new SigningError('MESSAGE_CHANGED');
  check(signed instanceof Uint8Array && signed.length === unsigned.length && signed[0] === 1);
  if (!equal(signed.subarray(65), before.message)) throw new SigningError('MESSAGE_CHANGED');
  const signature = signed.slice(1, 65);
  let valid = false;
  try {
    valid = ed25519.verify(signature, before.message, bs58.decode(build.wallet), { zip215: false });
  } catch {
    // Do not expose provider payloads or cryptographic errors.
  }
  if (!valid) throw new SigningError('INVALID_SIGNATURE');
  return { signature: bs58.encode(signature), transaction: Uint8Array.from(signed), messageHash: before.messageHash };
}
