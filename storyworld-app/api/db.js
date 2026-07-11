import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
let pool = null;
if (connectionString) {
  const url = new URL(connectionString);
  pool = new Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
    max: 5
  });
}

function taggedQuery(strings, ...values) {
  const text = strings.reduce((query, part, index) => query + part + (index < values.length ? `$${index + 1}` : ''), '');
  return pool.query(text, values);
}

taggedQuery.query = (text, values) => pool.query(text, values);

export const sql = taggedQuery;
export const closeDb = () => pool?.end();
