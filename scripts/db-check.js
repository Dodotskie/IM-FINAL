require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'faceapp',
  });

  const [rows] = await connection.execute('SELECT DATABASE() AS db, NOW() AS now_time');
  console.table(rows);
  await connection.end();
  console.log('Database connection OK');
}

main().catch(err => {
  console.error('Database connection failed:', err.message);
  process.exit(1);
});
