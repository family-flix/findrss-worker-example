import { AsyncLocalStorage } from "node:async_hooks";
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const bind_value = value => Array.isArray(value) ? new Uint8Array(value).buffer : value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value;

// Reads are optimistic; all observed values are checked again inside the committing D1 batch.
export class D1Store {
  constructor(database) {
    if (!database) throw new Error("缺少 DB（D1）绑定，请先初始化数据库");
    this.database = database;
    this.context = new AsyncLocalStorage();
    this.sql = this;
  }
  prepare(sql, values = []) {
    return this.database.prepare(sql).bind(...values.map(bind_value));
  }
  job_guard() {
    return this.job ? [this.prepare("INSERT INTO transaction_guard(ok) SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND status='running' AND lease_until>?)", [this.job.id, this.job.token, Date.now()])] : [];
  }
  async exec(sql, ...values) {
    const transaction = this.context.getStore();
    const read = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
    if (transaction && !read) {
      transaction.writes.push(this.prepare(sql, values));
      return {
        toArray: () => []
      };
    }
    const statement = this.prepare(sql, values);
    let result = !read && this.job ? (await this.database.batch([...this.job_guard(), statement])).at(-1) : await statement.all();
    if (transaction) {
      const query = sql.trim().replace(/;$/, '');
      if (!result.results?.length) transaction.reads.push({
        sql: query,
        values,
        empty: true
      });else {
        const columns = Object.keys(result.results[0]);
        const signature_sql = `SELECT json_group_array(json_array(${columns.flatMap(name => [`typeof(${quote(name)})`, `hex(${quote(name)})`]).join(',')})) AS signature FROM (${query})`;
        // Re-read data and its fingerprint in one database transaction, avoiding a read/check race.
        const snapshot = await this.database.batch([statement, this.prepare(signature_sql, values)]);
        result = snapshot[0];
        transaction.reads.push({
          sql: signature_sql,
          values,
          signature: snapshot[1].results[0].signature
        });
      }
    }
    const rows = result.results || [];
    return {
      toArray: () => rows,
      rowsWritten: result.meta?.changes || 0
    };
  }
  guard({
    sql,
    values,
    empty,
    signature
  }) {
    if (empty) return this.prepare(`INSERT INTO transaction_guard(ok) SELECT 0 WHERE EXISTS (${sql})`, values);
    return this.prepare(`INSERT INTO transaction_guard(ok) SELECT 0 WHERE (${sql}) IS NOT ?`, [...values, signature]);
  }
  async transaction(action) {
    if (this.context.getStore()) return action();
    const transaction = {
      reads: [],
      writes: [],
      committed: []
    };
    const value = await this.context.run(transaction, action);
    if (transaction.writes.length) {
      try {
        await this.database.batch([...this.job_guard(), ...transaction.reads.map(read => this.guard(read)), ...transaction.writes]);
      } catch (error) {
        if (/transaction_guard|CHECK constraint/i.test(error.message)) {
          const conflict = new Error("数据已被其他请求修改，请重试");
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      }
    }
    for (const notify of transaction.committed) await this.notify(notify);
    return value;
  }
  after_commit(action) {
    const transaction = this.context.getStore();
    if (transaction) transaction.committed.push(action);else return this.notify(action);
  }
  async notify(action) {
    try {
      await action();
    } catch (error) {
      console.warn('业务已提交，派生状态更新失败', error.message);
    }
  }
  async get(key) {
    const row = (await this.exec("SELECT value_json FROM application_settings WHERE key = ?", key)).toArray()[0];
    return row ? JSON.parse(row.value_json) : undefined;
  }
  async put(key, value) {
    if (typeof key === "object") {
      for (const [name, item] of Object.entries(key)) await this.put(name, item);
      return;
    }
    await this.exec("INSERT INTO application_settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", key, JSON.stringify(value));
  }
  async delete(key) {
    await this.exec("DELETE FROM application_settings WHERE key = ?", key);
  }
}
