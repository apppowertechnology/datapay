require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Parsing Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files directly from project root
app.use(express.static(path.join(__dirname)));
// Development cache control - disable caching for frontend assets
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Public health check endpoint
app.get('/health', (req, res) => {
  const dbStatus = db.isReady() ? 'connected' : 'disconnected';
  res.status(200).json({
    status: 'OK',
    database: dbStatus,
    databaseUrl: process.env.FIREBASE_DATABASE_URL || 'https://strictwallet-b8418-default-rtdb.firebaseio.com/'
  });
});

// Temporary endpoint to check outbound server IP
app.get('/my-ip', async (req, res) => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) {
      throw new Error(`IP service returned ${response.status}`);
    }
    const data = await response.json();
    res.json({
      ip: data.ip
    });
  } catch (error) {
    console.error('Server IP check failed:', error);
    res.status(500).json({
      error: 'Unable to determine server IP'
    });
  }
});

// Mount API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/events', require('./routes/events'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/support', require('./routes/support'));
app.use('/api/admin', require('./routes/admin'));

// Public Settings & Active Social Links for Users
app.get('/api/settings/social-links', async (req, res) => {
  try {
    const links = await db.getActiveSocialLinks();
    return res.json({ success: true, links });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load social links' });
  }
});

// Clean URLs for Admin and Public Information Pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

const publicPages = ['about', 'services', 'event-ticketing', 'data-airtime', 'pricing', 'how-it-works', 'terms', 'privacy', 'contact'];
publicPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, `${page}.html`));
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error Handler]:', err.stack);
  res.status(500).json({
    success: false,
    message: "We couldn't complete your request at this time. Please try again shortly."
  });
});

// Initialize Database and seed default admin
async function startServer() {
  try {
    await db.init();
    console.log('[Server Startup] Firebase Realtime Database initialization succeeded.');

    // Ensure Default Administrator exists and has matching credentials
    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@strictwallet.com').toLowerCase();
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'StrictAdmin2026!#';
    const existingAdmin = await db.getUserByEmail(adminEmail);

    if (!existingAdmin) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(adminPass, salt);

      const defaultAdmin = {
        id: 'admin_root_01',
        fullName: 'STRICTWALLET Master Administrator',
        email: adminEmail,
        phone: '08000000000',
        passwordHash: passwordHash,
        nextOfKin: 'Strictwallet Security',
        nextOfKinAnswer: 'strictwallet security',
        transactionPinHash: null,
        role: 'admin',
        status: 'active',
        walletBalance: 0.00,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.saveUser(defaultAdmin);
      console.log(`[Admin Seed] Default administrator initialized: ${adminEmail}`);
    } else {
      let needsUpdate = false;
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        needsUpdate = true;
      }
      if (existingAdmin.status !== 'active') {
        existingAdmin.status = 'active';
        needsUpdate = true;
      }
      const isPasswordValid = await bcrypt.compare(adminPass, existingAdmin.passwordHash);
      if (!isPasswordValid) {
        const salt = await bcrypt.genSalt(10);
        existingAdmin.passwordHash = await bcrypt.hash(adminPass, salt);
        needsUpdate = true;
        console.log(`[Admin Seed] Synchronized administrator password with configured master password.`);
      }
      if (needsUpdate) {
        await db.saveUser(existingAdmin);
      }
    }
  } catch (err) {
    console.error(`[Server Startup] Firebase initialization FAILED: ${err.message}`);
    console.error('[Server Startup] Database-dependent operations are BLOCKED until valid Firebase credentials are provided.');
    console.error('[Server Startup] Local data_backup.json fallback is strictly disabled in production.');
  }

  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` STRICTWALLET FinTech Engine Running on Port ${PORT}`);
    console.log(` Web Interface: http://localhost:${PORT}`);
    console.log(` Admin Portal:  http://localhost:${PORT}/admin.html`);
    console.log(` Database Ready: ${db.isReady() ? 'YES (Live RTDB)' : 'NO (Connection Required)'}`);
    console.log(`====================================================`);
  });
}

startServer();
