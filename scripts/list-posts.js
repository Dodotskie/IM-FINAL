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
    'SELECT id, author, author_name, text, image_url, created_at FROM posts ORDER BY created_at DESC'
  );

  if (rows.length === 0) {
    console.log('No posts found.');
  } else {
    const formatted = rows.map((row) => {
      const ts = Number(row.created_at);
      const postedAt =
        Number.isFinite(ts) && ts > 0
          ? new Date(ts).toLocaleString()
          : new Date(row.created_at).toLocaleString();

      return {
        id: row.id,
        author: row.author,
        author_name: row.author_name,
        text: row.text,
        image_url: row.image_url,
        posted_at: postedAt,
      };
    });

    console.table(formatted);
  }

  await connection.end();
}

main().catch(err => {
  console.error('Failed to list posts:', err.message);
  process.exit(1);
});
