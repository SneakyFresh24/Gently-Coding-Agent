const fs = require('fs/promises');
const path = require('path');
const { Level } = require('level');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const root = process.cwd();
  const testDir = path.join(root, '.gently', 'cache', `rca-leveldb-${Date.now()}`);
  const dbPath = path.join(testDir, 'embeddings.db');
  const lockFilePath = path.join(dbPath, 'LOCK');
  const report = {
    dbPath,
    putGetRoundtrip: false,
    concurrentOpenRejected: false,
    staleLockFileRemoved: false,
    staleLockOpenWorked: false,
    details: {}
  };

  await fs.mkdir(testDir, { recursive: true });

  const db1 = new Level(dbPath);
  await db1.open();

  await db1.put('k1', JSON.stringify({ embedding: [0.1, 0.2], timestamp: Date.now() }));
  const v1 = await db1.get('k1');
  report.putGetRoundtrip = typeof v1 === 'string' && v1.includes('embedding');

  let db2 = null;
  try {
    db2 = new Level(dbPath);
    await db2.open();
    report.details.concurrentOpen = 'opened unexpectedly';
  } catch (error) {
    report.concurrentOpenRejected = true;
    report.details.concurrentOpen = String(error && error.message ? error.message : error);
  } finally {
    if (db2) {
      try { await db2.close(); } catch {}
    }
  }

  await db1.close();

  await fs.mkdir(dbPath, { recursive: true });
  await fs.writeFile(lockFilePath, 'stale-lock');
  report.staleLockFileRemoved = await exists(lockFilePath);

  try {
    const db3 = new Level(dbPath);
    await db3.open();
    await db3.put('k2', JSON.stringify({ ok: true }));
    report.staleLockOpenWorked = true;
    await db3.close();
  } catch (error) {
    report.details.staleLockOpen = String(error && error.message ? error.message : error);
  }

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error('[leveldb-isolation-test] failed:', error);
  process.exit(1);
});
