// Compiled into the reviewed SDK patch by tools/security/prepare-privy-patch.ts.
// Keep this policy independent of native URL parser normalization differences.
const walletPage = /^https:\/\/auth\.privy\.io(?::443)?\/apps\/([A-Za-z0-9_-]+)\/embedded-wallets\/?(?:\?[^\s\\#]*)?(?:#[^\s\\]*)?$/;
const maxMessageLength = 1024 * 1024;

export function isPrivyWalletUrl(value: unknown, expected: unknown): boolean {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const actualPage = walletPage.exec(value);
  const expectedPage = walletPage.exec(expected);
  return Boolean(actualPage && expectedPage && actualPage[1] === expectedPage[1]);
}

export function readPrivyWalletMessage(value: unknown, url: unknown, expected: unknown): Record<string, unknown> | null {
  if (!isPrivyWalletUrl(url, expected) || typeof value !== 'string' || value.length > maxMessageLength) return null;
  try {
    const message: unknown = JSON.parse(value);
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    const packet = message as Record<string, unknown>;
    if (typeof packet.id !== 'string' || !packet.id || packet.id.length > 256) return null;
    if (typeof packet.event !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(packet.event)) return null;
    if (packet.event.startsWith('privy:')) return packet; // SDK still binds responses to its outstanding request IDs/events.
    if (!['app:secure-storage:get', 'app:secure-storage:set', 'app:secure-storage:remove'].includes(packet.event)) return null;
    if (!packet.data || typeof packet.data !== 'object' || Array.isArray(packet.data)) return null;
    const data = packet.data as Record<string, unknown>;
    if (typeof data.key !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(data.key)) return null;
    if (packet.event === 'app:secure-storage:set' && typeof data.value !== 'string') return null;
    return packet;
  } catch {
    return null;
  }
}
