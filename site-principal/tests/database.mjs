import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../netlify/database/migrations/202610140001_initial_schema.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../netlify/functions/api.mts', import.meta.url), 'utf8');

test('migration inicial e contador da API executam no PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(migration);

  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  assert.deepEqual(tables.rows.map(row => row.tablename), ['audit', 'bookings', 'configuration', 'rate_limits']);

  // Executa o SQL da API para detectar divergências entre a consulta e a migration.
  const match = api.match(/sql`(INSERT INTO rate_limits[^`]+)`/);
  assert.ok(match, 'Consulta do contador deve existir na API');
  const parameters = [];
  const query = match[1].replace(/\$\{(\w+)\}/g, (_, name) => {
    parameters.push(name);
    return `$${parameters.length}`;
  });
  assert.deepEqual(parameters, ['actor', 'window']);

  async function increment(actor, window) {
    const result = await db.query(query, [actor, window]);
    return result.rows[0].count;
  }

  assert.equal(await increment('usuario-a', 100), 1);
  for (let count = 2; count <= 41; count++) {
    assert.equal(await increment('usuario-a', 100), count);
  }
  assert.equal(await increment('usuario-b', 100), 1);
  assert.equal(await increment('usuario-a', 101), 1);
  assert.equal(await increment('usuario-a', 101), 2);
});
