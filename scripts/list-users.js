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

  const [rows] = await connection.execute(
    'SELECT username, password, name FROM users ORDER BY username'
  );

  if (rows.length === 0) {
    console.log('No users found.');
  } else {
    console.table(rows);
  }

  await connection.end();
}

main().catch(err => {
  console.error('Failed to list users:', err.message);
  process.exit(1);
});
