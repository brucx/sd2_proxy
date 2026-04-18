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
  ARK_API_KEY: process.env.ARK_API_KEY || '',
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
};
