const sql = require("mssql");
const config = require("./config");

let poolPromise;
let inventoryWriterPoolPromise;

function getPoolConfig(credentials = {}) {
  return {
    user: credentials.user || config.db.user,
    password: credentials.password || config.db.password,
    server: config.db.server,
    port: config.db.port,
    database: config.db.database,
    requestTimeout: config.db.requestTimeoutMs,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: config.db.encrypt,
      trustServerCertificate: config.db.trustServerCertificate,
      enableArithAbort: true,
    },
  };
}

async function getInventoryWriterPool() {
  if (!config.db.inventoryWriterUser || !config.db.inventoryWriterPassword) {
    const error = new Error("Inventory writer database credentials are not configured.");
    error.code = "INVENTORY_WRITER_NOT_CONFIGURED";
    throw error;
  }

  if (!inventoryWriterPoolPromise) {
    const pool = new sql.ConnectionPool(
      getPoolConfig({
        user: config.db.inventoryWriterUser,
        password: config.db.inventoryWriterPassword,
      })
    );
    inventoryWriterPoolPromise = pool.connect().catch((error) => {
      inventoryWriterPoolPromise = undefined;
      throw error;
    });
  }

  return inventoryWriterPoolPromise;
}

async function createInventoryWriterRequest(bind = []) {
  const pool = await getInventoryWriterPool();
  return bindInputs(pool.request(), bind);
}

async function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(getPoolConfig());
    poolPromise = pool.connect();

    try {
      await poolPromise;
      console.log(
        `Connected to SQL Server ${config.db.server}:${config.db.port}/${config.db.database}`
      );
    } catch (error) {
      poolPromise = undefined;
      throw error;
    }
  }

  return poolPromise;
}

function bindInputs(request, bind = []) {
  for (const param of bind) {
    if (param.type) {
      request.input(param.name, param.type, param.value);
    } else {
      request.input(param.name, param.value);
    }
  }

  return request;
}

async function createRequest(bind = []) {
  const pool = await getPool();
  return bindInputs(pool.request(), bind);
}

async function runQuery(query, bind = []) {
  const request = await createRequest(bind);
  return request.query(query);
}

async function pingDatabase() {
  const result = await runQuery(`
    SELECT
      DB_NAME() AS database_name,
      @@SERVERNAME AS server_name,
      SYSDATETIME() AS server_time
  `);

  return result.recordset[0];
}

async function listTables() {
  const result = await runQuery(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    ORDER BY s.name, t.name
  `);

  return result.recordset;
}

async function getTableColumns(schemaName, tableName) {
  const result = await runQuery(
    `
      SELECT
        c.COLUMN_NAME AS column_name,
        c.DATA_TYPE AS data_type,
        c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
        c.NUMERIC_PRECISION AS numeric_precision,
        c.NUMERIC_SCALE AS numeric_scale,
        c.IS_NULLABLE AS is_nullable
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = @schemaName AND c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `,
    [
      { name: "schemaName", type: sql.NVarChar, value: schemaName },
      { name: "tableName", type: sql.NVarChar, value: tableName },
    ]
  );

  return result.recordset;
}

function quoteIdentifier(identifier) {
  return `[${String(identifier).replace(/]/g, "]]")}]`;
}

async function getTablePreview(schemaName, tableName, limit) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const columns = await getTableColumns(schemaName, tableName);

  if (!columns.length) {
    const error = new Error("Table not found");
    error.statusCode = 404;
    throw error;
  }

  const query = `
    SELECT TOP ${safeLimit} *
    FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}
  `;

  const result = await runQuery(query);
  return result.recordset;
}

async function closePool() {
  const pools = [];
  if (poolPromise) pools.push(poolPromise);
  if (inventoryWriterPoolPromise) pools.push(inventoryWriterPoolPromise);
  poolPromise = undefined;
  inventoryWriterPoolPromise = undefined;
  await Promise.all(pools.map(async (pending) => (await pending).close()));
}

module.exports = {
  createRequest,
  createInventoryWriterRequest,
  closePool,
  getPool,
  getTableColumns,
  getTablePreview,
  listTables,
  pingDatabase,
  runQuery,
  sql,
};
