import { config as loadEnv } from 'dotenv';
loadEnv();

// -- Environment Variable Validation --
const requiredEnvVars = ['JWT_SECRET'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Environment variable ${envVar} is not set.`);
    process.exit(1);
  }
}

export const config = {
  JWT_SECRET: process.env.JWT_SECRET!,
  UPSTREAM_URL: process.env.UPSTREAM_URL || 'http://127.0.0.1',
  MEITU_API_KEY: process.env.MEITU_API_KEY || '',
  PENDING_TIMEOUT_MS: (parseInt(process.env.PENDING_TIMEOUT_MINUTES || '60')) * 60 * 1000,
  PRICE_WITH_VIDEO: parseFloat(process.env.PRICE_WITH_VIDEO || '28'),
  PRICE_WITHOUT_VIDEO: parseFloat(process.env.PRICE_WITHOUT_VIDEO || '46'),
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || 'admin123',
  MODEL_MAPPING: process.env.MODEL_MAPPING 
    ? JSON.parse(process.env.MODEL_MAPPING) 
    : {
        'doubao-seedance-2.0-fast': 'ep-20260307130821-xw5wf',
        'doubao-seedance-2.0-fast-260128': 'ep-20260307130821-xw5wf',
        'doubao-seedance-2-0': 'ep-20260307130721-bx7tv',
        'doubao-seedance-2-0-260128': 'ep-20260307130721-bx7tv',
      } as Record<string, string>,

  // -- Evolink Provider --
  EVOLINK_API_KEY: process.env.EVOLINK_API_KEY || '',
  EVOLINK_URL: process.env.EVOLINK_URL || 'https://api.evolink.ai',
  USD_TO_CNY_RATE: parseFloat(process.env.USD_TO_CNY_RATE || '7.25'),
  // Evolink credit exchange rate: $100 = 6800 Credits → 68 Credits per USD
  EVOLINK_CREDITS_PER_USD: parseFloat(process.env.EVOLINK_CREDITS_PER_USD || '68'),
  // Evolink model base mapping: user model name → Evolink model base name
  // The actual mode (text/image/reference) is inferred dynamically from request body
  EVOLINK_MODEL_BASE: process.env.EVOLINK_MODEL_BASE
    ? JSON.parse(process.env.EVOLINK_MODEL_BASE)
    : {
        'doubao-seedance-2.0-fast': 'seedance-2.0-fast',
        'doubao-seedance-2.0-fast-260128': 'seedance-2.0-fast',
        'doubao-seedance-2-0': 'seedance-2.0',
        'doubao-seedance-2-0-260128': 'seedance-2.0',
      } as Record<string, string>,

  // -- Ark (Volcengine) Provider --
  ARK_API_KEY: process.env.ARK_API_KEY || '',
  ARK_URL: process.env.ARK_URL || 'https://ark.cn-beijing.volces.com',
  // Ark accepts model IDs directly; map from user-facing alias → upstream model/endpoint ID
  ARK_MODEL_MAPPING: process.env.ARK_MODEL_MAPPING
    ? JSON.parse(process.env.ARK_MODEL_MAPPING)
    : {
        'doubao-seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2.0-fast-260128': 'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0': 'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-260128': 'doubao-seedance-2-0-260128',
      } as Record<string, string>,
  // Ark pricing: CNY per 1,000,000 tokens — see docs/ark/pricing.md
  // Keyed by "<model>:<hasVideo>" where model is normalized to 2.0 vs 2.0-fast.
  ARK_PRICE_PER_MILLION: {
    '2.0:false:480p': 46,
    '2.0:false:720p': 46,
    '2.0:false:1080p': 51,
    '2.0:true:480p': 28,
    '2.0:true:720p': 28,
    '2.0:true:1080p': 31,
    '2.0-fast:false:480p': 37,
    '2.0-fast:false:720p': 37,
    '2.0-fast:true:480p': 22,
    '2.0-fast:true:720p': 22,
  } as Record<string, number>,
};
