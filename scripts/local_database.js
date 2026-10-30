import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export async function initialize_local_database(options, {
  getPlatformProxy,
  unstable_splitSqlQuery,
  unstable_readConfig
}) {
  const configuration = unstable_readConfig({
    config: options.config
  });
  const configPath = join(options.temp_dir, 'database-init.json');
  await writeFile(configPath, JSON.stringify({
    name: 'findrss-database-init',
    compatibility_date: configuration.compatibility_date,
    d1_databases: configuration.d1_databases
  }));
  const proxy = await getPlatformProxy({
    configPath,
    persist: {
      path: join(options.persistTo, 'v3')
    },
    remoteBindings: false
  });
  try {
    const db = proxy.env.DB;
    if (!db) throw new Error('本地配置缺少 DB 绑定');
    await db.prepare("CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)").run();
    const directory = join(dirname(options.config), 'migrations');
    const applied = new Set((await db.prepare('SELECT name FROM d1_migrations').all()).results.map(row => row.name));
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      const statements = unstable_splitSqlQuery(await readFile(join(directory, name), 'utf8'));
      await db.batch([...statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name)]);
    }
  } finally {
    await proxy.dispose();
  }
}
