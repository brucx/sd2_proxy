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
  PENDING_TIMEOUT_MS: (parseInt(process.env.PENDING_TIMEOUT_MINUTES || '20')) * 60 * 1000,
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
};
