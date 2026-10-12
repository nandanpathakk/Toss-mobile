import { IS_DEV } from '@/lib/env/dev-mode';

// Public configuration only: set your deployed HTTPS gateway URL before a release build.
// PANTA_API_KEY stays in the server environment and must never be added here.
const deployedGatewayUrl: string | null = null;
export const pantaGatewayUrl = deployedGatewayUrl ?? (IS_DEV ? 'http://127.0.0.1:8787' : null);
