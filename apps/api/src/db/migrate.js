import { migrate, closeDb } from './index.js';

migrate()
  .then((res) => {
    console.log(`[migrate] schema applied via ${res.driver}`);
    return closeDb();
  })
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
