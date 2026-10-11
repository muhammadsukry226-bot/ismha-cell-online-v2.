require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diatur.");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET harus berisi minimal 32 karakter acak.");
}
if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_PASSWORD_HASH.startsWith("$2")) {
  throw new Error("ADMIN_PASSWORD_HASH harus berisi hash bcrypt, bukan password biasa.");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined
});
app.set("trust proxy", isProduction ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "ismha.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, price BIGINT NOT NULL CHECK(price >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, price BIGINT NOT NULL CHECK(price >= 0),
      cost BIGINT NOT NULL CHECK(cost >= 0), method TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, amount BIGINT NOT NULL CHECK(amount > 0),
      category TEXT NOT NULL DEFAULT 'Operasional', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
function requireAuth(req, res, next) {
  if (!req.session || !req.session.admin) return res.status(401).json({ error: "Silakan login kembali." });
  next();
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan login. Coba lagi 15 menit." } });

app.post("/api/login", loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const expectedUser = process.env.ADMIN_USERNAME || "admin";
    const okUser = typeof username === "string" && username === expectedUser;
    const okPassword = typeof password === "string" && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!okUser || !okPassword) return res.status(401).json({ error: "Username atau password salah." });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.admin = { username: expectedUser };
      req.session.save(err2 => {
        if (err2) return next(err2);
        res.json({ ok: true, username: expectedUser });
      });
    });
  } catch (e) { next(e); }
});
app.post("/api/logout", (req, res) => req.session.destroy(() => {
  res.clearCookie("ismha.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
  res.json({ ok: true });
}));
app.get("/api/me", (req, res) => res.json({ authenticated: !!req.session?.admin, username: req.session?.admin?.username || null }));

app.get("/api/dashboard", requireAuth, async (req, res, next) => {
  try {
    const q = await pool.query(`
      SELECT
       COALESCE((SELECT SUM(price) FROM sales WHERE created_at::date = CURRENT_DATE),0) AS revenue,
       COALESCE((SELECT SUM(cost) FROM sales WHERE created_at::date = CURRENT_DATE),0) AS capital,
       COALESCE((SELECT SUM(amount) FROM expenses WHERE created_at::date = CURRENT_DATE),0) AS expenses,
       COALESCE((SELECT SUM(amount) FROM expenses WHERE created_at::date = CURRENT_DATE AND category='Operasional'),0) AS operational
    `);
    const x = q.rows[0];
    res.json({ ...x, profit: Number(x.revenue) - Number(x.capital) - Number(x.expenses) });
  } catch(e) { next(e); }
});
app.get("/api/sales", requireAuth, async (req,res,next) => {
  try { const r = await pool.query("SELECT id,name,price,cost,method,created_at FROM sales ORDER BY id DESC LIMIT 200"); res.json(r.rows); }
  catch(e){ next(e); }
});
app.post("/api/sales", requireAuth, async (req,res,next) => {
  const { name, price, cost, method } = req.body || {};
  const p = Number(price), c = Number(cost);
  if (typeof name !== "string" || !name.trim() || name.length > 180 || !Number.isSafeInteger(p) || p <= 0 ||
      !Number.isSafeInteger(c) || c < 0 || !["Tunai","QRIS","Transfer","Debit","Piutang"].includes(method)) {
    return res.status(400).json({ error: "Data transaksi tidak valid." });
  }
  try { const r = await pool.query("INSERT INTO sales(name,price,cost,method) VALUES($1,$2,$3,$4) RETURNING *",[name.trim(),p,c,method]); res.status(201).json(r.rows[0]); }
  catch(e){ next(e); }
});
app.get("/api/products", requireAuth, async (req,res,next) => {
  try { const r = await pool.query("SELECT id,name,price,stock FROM products ORDER BY id DESC LIMIT 500"); res.json(r.rows); }
  catch(e){ next(e); }
});
app.post("/api/products", requireAuth, async (req,res,next) => {
  const { name, price, stock } = req.body || {}; const p=Number(price), s=Number(stock);
  if(typeof name!=="string" || !name.trim() || name.length>180 || !Number.isSafeInteger(p) || p<0 || !Number.isSafeInteger(s) || s<0)
    return res.status(400).json({error:"Data produk tidak valid."});
  try { const r=await pool.query("INSERT INTO products(name,price,stock) VALUES($1,$2,$3) RETURNING *",[name.trim(),p,s]); res.status(201).json(r.rows[0]); }
  catch(e){next(e);}
});
app.get("/api/expenses", requireAuth, async (req,res,next) => {
  try { const r=await pool.query("SELECT id,name,amount,category,created_at FROM expenses ORDER BY id DESC LIMIT 200"); res.json(r.rows); }
  catch(e){next(e);}
});
app.post("/api/expenses", requireAuth, async (req,res,next) => {
  const {name,amount,category}=req.body||{};const a=Number(amount);const cat=category||"Operasional";
  if(typeof name!=="string"||!name.trim()||name.length>180||!Number.isSafeInteger(a)||a<=0||!["Operasional","Lainnya","Modal"].includes(cat))
    return res.status(400).json({error:"Data pengeluaran tidak valid."});
  try{const r=await pool.query("INSERT INTO expenses(name,amount,category) VALUES($1,$2,$3) RETURNING *",[name.trim(),a,cat]);res.status(201).json(r.rows[0]);}
  catch(e){next(e);}
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({error:"Terjadi kesalahan server. Silakan coba lagi."});
});
const port = Number(process.env.PORT || 3000);
initDb().then(() => app.listen(port, () => console.log(`Ismha Cell Online berjalan di port ${port}`)))
  .catch(err => { console.error("Gagal menyiapkan database:", err); process.exit(1); });
