// Provider factory — returns the appropriate upstream provider based on name

import type { UpstreamProvider } from './types.js';
import { arkProvider } from './ark.provider.js';
import { evolinkProvider } from './evolink.provider.js';

export function getProvider(providerName: string): UpstreamProvider {
  switch (providerName) {
    case 'evolink':
      return evolinkProvider;
    case 'ark':
    default:
      return arkProvider;
  }
}

export { arkProvider, evolinkProvider };
export type { UpstreamProvider, CreateTaskResult, QueryTaskResult } from './types.js';
