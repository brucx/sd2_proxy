// Provider factory — returns the appropriate upstream provider based on name.

import type { UpstreamProvider } from './types.js';
import { meituProvider } from './meitu.provider.js';
import { evolinkProvider } from './evolink.provider.js';
import { arkProvider } from './ark.provider.js';

export function getProvider(providerName: string): UpstreamProvider {
  switch (providerName) {
    case 'evolink':
      return evolinkProvider;
    case 'ark':
      return arkProvider;
    case 'meitu':
    default:
      return meituProvider;
  }
}

export { meituProvider, evolinkProvider, arkProvider };
export type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
