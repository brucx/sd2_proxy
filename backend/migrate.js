import { client } from './src/db/index.js';

async function run() {
  try {
    console.log('Altering users.balance...');
    await client`ALTER TABLE users ALTER COLUMN balance DROP DEFAULT`;
    await client`ALTER TABLE users ALTER COLUMN balance TYPE numeric(20,4) USING (CASE WHEN balance ~ '^[0-9]+(\\.[0-9]+)?$' THEN balance::numeric(20,4) ELSE 0 END)`;
    await client`ALTER TABLE users ALTER COLUMN balance SET DEFAULT 0`;
    
    console.log('Altering balance_audit.amount...');
    await client`ALTER TABLE balance_audit ALTER COLUMN amount DROP DEFAULT`;
    await client`ALTER TABLE balance_audit ALTER COLUMN amount TYPE numeric(20,4) USING (CASE WHEN amount ~ '^[0-9]+(\\.[0-9]+)?$' THEN amount::numeric(20,4) ELSE 0 END)`;
    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

run();
