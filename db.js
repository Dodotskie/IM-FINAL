const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const JSON_PATH = path.join(__dirname, 'data', 'store.json');

function mysqlConfigFromEnv() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'faceapp',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  };
}

async function ensureDatabaseExists(cfg) {
  // XAMPP often ships without the target DB pre-created.
  const base = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    connectionLimit: 1,
  });
  try {
    await base.execute(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``);
  } finally {
    await base.end();
  }
}

async function initDb() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error('Face App needs Node.js 18+. You have', process.versions.node);
    process.exit(1);
  }

  const cfg = mysqlConfigFromEnv();
  await ensureDatabaseExists(cfg);
  const pool = mysql.createPool(cfg);

  // Validate connection early for clear errors.
  try {
    const conn = await pool.getConnection();
    conn.release();
  } catch (err) {
    const target = `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
    console.error(`MySQL connection failed (${target})`);
    console.error('Tip: In XAMPP, confirm MySQL is running and check its port in XAMPP Control Panel -> Config -> my.ini.');
    throw err;
  }

  await ensureSchema(pool);
  await migrateFromJson(pool);

  return pool;
}

async function ensureSchema(pool) {
  // Keep types simple and aligned with existing app behavior.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(64) PRIMARY KEY,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS posts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      author VARCHAR(64) NOT NULL,
      author_name VARCHAR(255) NOT NULL,
      text TEXT NOT NULL,
      image_url TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_posts_created_at (created_at),
      INDEX idx_posts_author (author),
      CONSTRAINT fk_posts_author FOREIGN KEY (author) REFERENCES users(username)
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  // Upgrade old schema: BIGINT epoch milliseconds -> DATETIME.
  const [colRows] = await pool.execute(
    `SELECT DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'posts'
       AND COLUMN_NAME = 'created_at'
     LIMIT 1`
  );

  const createdAtType = (colRows[0]?.DATA_TYPE || '').toLowerCase();
  if (createdAtType === 'bigint') {
    await pool.execute(`
      ALTER TABLE posts
      ADD COLUMN created_at_dt DATETIME NULL
    `);

    await pool.execute(`
      UPDATE posts
      SET created_at_dt = FROM_UNIXTIME(created_at / 1000)
      WHERE created_at IS NOT NULL
    `);

    await pool.execute(`
      ALTER TABLE posts
      DROP COLUMN created_at
    `);

    await pool.execute(`
      ALTER TABLE posts
      CHANGE COLUMN created_at_dt created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
  }

  // Ensure posts.id is an INT AUTO_INCREMENT starting from 1..N
  const [idColRows] = await pool.execute(
    `SELECT DATA_TYPE, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'posts'
       AND COLUMN_NAME = 'id'
     LIMIT 1`
  );

  const idType = (idColRows[0]?.DATA_TYPE || '').toLowerCase();
  const idExtra = (idColRows[0]?.EXTRA || '').toLowerCase();
  const needsIdMigration = !(idType === 'int' && idExtra.includes('auto_increment'));

  if (needsIdMigration) {
    // Read existing posts and rebuild IDs + likes with a clean schema.
    const [postsRows] = await pool.execute(
      'SELECT id, author, author_name, text, image_url, created_at FROM posts ORDER BY created_at ASC, id ASC'
    );

    const idMap = new Map();
    postsRows.forEach((p, idx) => idMap.set(String(p.id), idx + 1));

    await pool.execute('SET FOREIGN_KEY_CHECKS = 0');

    await pool.execute('DROP TABLE IF EXISTS post_likes_new');
    await pool.execute('DROP TABLE IF EXISTS posts_new');

    await pool.execute(`
      CREATE TABLE posts_new (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        author VARCHAR(64) NOT NULL,
        author_name VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        image_url TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_posts_created_at (created_at),
        INDEX idx_posts_author (author)
      )
    `);

    await pool.execute(`
      CREATE TABLE post_likes_new (
        post_id INT NOT NULL,
        username VARCHAR(64) NOT NULL,
        PRIMARY KEY (post_id, username),
        INDEX idx_post_likes_user (username)
      )
    `);

    for (const p of postsRows) {
      const newId = idMap.get(String(p.id));
      await pool.execute(
        'INSERT INTO posts_new (id, author, author_name, text, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [newId, p.author, p.author_name, p.text, p.image_url, p.created_at]
      );
    }

    const [likesRows] = await pool.execute('SELECT post_id, username FROM post_likes');
    for (const l of likesRows) {
      const newPostId = idMap.get(String(l.post_id));
      if (newPostId == null) continue;
      await pool.execute(
        'INSERT INTO post_likes_new (post_id, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE post_id = post_id',
        [newPostId, l.username]
      );
    }

    await pool.execute('DROP TABLE IF EXISTS post_likes');
    await pool.execute('DROP TABLE IF EXISTS posts');

    await pool.execute('RENAME TABLE posts_new TO posts, post_likes_new TO post_likes');

    // Recreate FK constraints.
    await pool.execute(`
      ALTER TABLE posts
      ADD CONSTRAINT fk_posts_author
        FOREIGN KEY (author) REFERENCES users(username)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    await pool.execute(`
      ALTER TABLE post_likes
      ADD CONSTRAINT fk_post_likes_post
        FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    `);

    await pool.execute(`
      ALTER TABLE post_likes
      ADD CONSTRAINT fk_post_likes_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    await pool.execute('SET FOREIGN_KEY_CHECKS = 1');
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INT NOT NULL,
      username VARCHAR(64) NOT NULL,
      PRIMARY KEY (post_id, username),
      INDEX idx_post_likes_user (username),
      CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_post_likes_user FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  // ===== NEW: SESSIONS TABLE WITH LOGIN/LOGOUT TIMESTAMPS =====
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(36) PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      logout_at DATETIME NULL,
      INDEX idx_sessions_user (username),
      INDEX idx_sessions_login (login_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
}

async function migrateFromJson(pool) {
  if (!fs.existsSync(JSON_PATH)) return;

  const [rows] = await pool.execute('SELECT COUNT(*) AS n FROM users');
  const n = Number(rows?.[0]?.n || 0);
  if (n > 0) return;

  try {
    const store = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const u of store.users || []) {
        await conn.execute(
          'INSERT IGNORE INTO users (username, password, name) VALUES (?, ?, ?)',
          [u.username, u.password, u.name]
        );
      }

      for (const p of store.posts || []) {
        const createdAt =
          p.createdAt != null && p.createdAt !== ''
            ? Number(p.createdAt)
            : Date.now();

        // Let MySQL assign INT ids.
        const [insertResult] = await conn.execute(
          'INSERT IGNORE INTO posts (author, author_name, text, image_url, created_at) VALUES (?, ?, ?, ?, ?)',
          [p.author, p.authorName, p.text || '', p.imageUrl || '', new Date(createdAt)]
        );

        const newPostId = insertResult.insertId;
        if (!newPostId) continue;

        for (const liker of p.likes || []) {
          await conn.execute(
            'INSERT IGNORE INTO post_likes (post_id, username) VALUES (?, ?)',
            [newPostId, liker]
          );
        }
      }

      await conn.commit();
      console.log('Migrated data from store.json to MySQL');
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.warn('Could not migrate store.json:', err.message);
  }
}

module.exports = { initDb };