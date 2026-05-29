require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

async function main() {
  const db = await initDb();
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const mimetype = file.mimetype || '';
      if (mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    },
  });

  // ================= USERS =================
  async function getUser(username) {
    const [rows] = await db.execute('SELECT username, name FROM users WHERE username = ?', [username]);
    return rows[0] || null;
  }
  async function getUserWithPassword(username) {
    const [rows] = await db.execute(
      'SELECT username, password, name FROM users WHERE username = ?',
      [username]
    );
    return rows[0] || null;
  }
  async function insertUser(username, password, name) {
    await db.execute('INSERT INTO users (username, password, name) VALUES (?, ?, ?)', [
      username,
      password,
      name,
    ]);
  }

  // ================= SESSIONS =================
  async function insertSession(id, username) {
    await db.execute(
      'INSERT INTO sessions (id, username, login_at) VALUES (?, ?, NOW())',
      [id, username]
    );
  }
  async function getSession(id) {
    const [rows] = await db.execute('SELECT username FROM sessions WHERE id = ? AND logout_at IS NULL', [id]);
    return rows[0] || null;
  }
  async function deleteSession(id) {
    await db.execute('UPDATE sessions SET logout_at = NOW() WHERE id = ?', [id]);
  }

  // ================= SESSION HELPERS =================
  async function setSession(res, username) {
    const id = crypto.randomUUID();
    await insertSession(id, username);
    res.cookie('sid', id, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
  async function currentUsername(req) {
    const sid = req.cookies.sid;
    if (!sid) return null;
    const row = await getSession(sid);
    return row ? row.username : null;
  }
  async function clearSession(req, res) {
    const sid = req.cookies.sid;
    if (sid) await deleteSession(sid);
    res.clearCookie('sid');
  }

  // ================= LIKES =================
  async function getLikes(postId) {
    const [rows] = await db.execute('SELECT username FROM post_likes WHERE post_id = ?', [postId]);
    return rows.map(r => r.username);
  }

  // ================= POST FORMAT =================
  async function postToJson(row) {
    let createdAt;
    
    try {
      // If created_at is a Date object, use it directly
      if (row.created_at instanceof Date) {
        createdAt = row.created_at.toISOString();
      } else if (typeof row.created_at === 'string') {
        // If it's already a string, check if it's valid ISO format
        const date = new Date(row.created_at);
        if (!isNaN(date.getTime())) {
          createdAt = date.toISOString();
        } else {
          // Invalid date string, use current time
          createdAt = new Date().toISOString();
        }
      } else if (typeof row.created_at === 'number') {
        // If it's a number, treat as milliseconds since epoch
        const date = new Date(row.created_at);
        if (!isNaN(date.getTime())) {
          createdAt = date.toISOString();
        } else {
          createdAt = new Date().toISOString();
        }
      } else {
        // Fallback to current time if format is unknown
        createdAt = new Date().toISOString();
      }
    } catch (err) {
      console.error('Date conversion error for post', row.id, ':', err);
      createdAt = new Date().toISOString();
    }

    return {
      id: row.id,
      author: row.author,
      authorName: row.author_name,
      text: row.text,
      imageUrl: row.image_url,
      likes: await getLikes(row.id),
      createdAt,
    };
  }

  // ================= AUTH =================
  app.get('/api/me', async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) return res.json({ user: null });
      const user = await getUser(username);
      res.json({ user: user ? { username: user.username, name: user.name } : null });
    } catch (err) {
      console.error('GET /api/me error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { username, password, name } = req.body;
      if (!username || !password || !name)
        return res.status(400).json({ error: 'Name, username, and password required' });
      if (await getUser(username)) return res.status(409).json({ error: 'Username taken' });

      await insertUser(username, password, name);
      await setSession(res, username);
      res.json({ user: { username, name } });
    } catch (err) {
      console.error('POST /api/register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await getUserWithPassword(username);
      if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid login' });

      await setSession(res, username);
      res.json({ user: { username: user.username, name: user.name } });
    } catch (err) {
      console.error('POST /api/login error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      const sid = req.cookies.sid;
      if (sid) {
        await db.execute('UPDATE sessions SET logout_at = NOW() WHERE id = ?', [sid]);
      }
      res.clearCookie('sid');
      res.json({ ok: true });
    } catch (err) {
      console.error('POST /api/logout error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ================= IMAGE UPLOAD =================
  app.post('/api/uploads', upload.single('image'), async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(401).json({ error: 'Not logged in' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image selected' });
      }

      const imageUrl = `/uploads/${req.file.filename}`;
      res.json({ imageUrl });
    } catch (err) {
      console.error('POST /api/uploads error:', err);
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
    }
  });

  // ================= POSTS =================
  app.get('/api/posts', async (req, res) => {
    try {
      const [rows] = await db.execute('SELECT * FROM posts ORDER BY created_at DESC');
      const posts = await Promise.all(rows.map(postToJson));
      res.json({ posts });
    } catch (err) {
      console.error('GET /api/posts error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/posts', async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) return res.status(401).json({ error: 'Not logged in' });

      const { text, imageUrl } = req.body;
      if (!text?.trim() && !imageUrl?.trim())
        return res.status(400).json({ error: 'Post needs text or image' });

      const user = await getUser(username);
      if (!user) return res.status(401).json({ error: 'Not logged in' });

      const [result] = await db.execute(
        `INSERT INTO posts (author, author_name, text, image_url, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [user.username, user.name, (text || '').trim(), (imageUrl || '').trim()]
      );

      const insertedId = result.insertId;
      const [rows] = await db.execute('SELECT * FROM posts WHERE id = ?', [insertedId]);
      const row = rows[0];
      res.json({ post: await postToJson(row) });
    } catch (err) {
      console.error('POST /api/posts error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ================= EDIT POST =================
  app.put('/api/posts/:id', async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) return res.status(401).json({ error: 'Not logged in' });

      const { text, imageUrl } = req.body;
      if (!text?.trim() && !imageUrl?.trim())
        return res.status(400).json({ error: 'Post needs text or image' });

      const [rows] = await db.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const post = rows[0];
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.author !== username) return res.status(403).json({ error: 'Unauthorized' });

      await db.execute(
        'UPDATE posts SET text = ?, image_url = ? WHERE id = ?',
        [(text || '').trim(), (imageUrl || '').trim(), req.params.id]
      );

      const [updatedRows] = await db.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const updatedPost = updatedRows[0];
      res.json({ post: await postToJson(updatedPost) });
    } catch (err) {
      console.error('PUT /api/posts/:id error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ================= DELETE POST =================
  app.delete('/api/posts/:id', async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) return res.status(401).json({ error: 'Not logged in' });

      const [rows] = await db.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const post = rows[0];
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.author !== username) return res.status(403).json({ error: 'Unauthorized' });

      await db.execute('DELETE FROM post_likes WHERE post_id = ?', [req.params.id]);
      await db.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);

      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/posts error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ================= LIKE SYSTEM =================
  app.post('/api/posts/:id/like', async (req, res) => {
    try {
      const username = await currentUsername(req);
      if (!username) return res.status(401).json({ error: 'Not logged in' });

      const [rows] = await db.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'Post not found' });

      const [existingRows] = await db.execute(
        'SELECT 1 FROM post_likes WHERE post_id = ? AND username = ?',
        [req.params.id, username]
      );
      const existing = existingRows.length > 0;

      if (existing) {
        await db.execute('DELETE FROM post_likes WHERE post_id = ? AND username = ?', [
          req.params.id,
          username,
        ]);
      } else {
        await db.execute('INSERT INTO post_likes (post_id, username) VALUES (?, ?)', [
          req.params.id,
          username,
        ]);
      }

      res.json({ post: await postToJson(row) });
    } catch (err) {
      console.error('POST /api/posts/:id/like error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ================= START SERVER =================
  app.listen(PORT, () => {
    console.log(`Face App running at http://localhost:${PORT}`);
    console.log('Database: MySQL');
  });
}

main().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});