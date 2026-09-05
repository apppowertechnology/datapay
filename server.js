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

// Mount API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/support', require('./routes/support'));
app.use('/api/admin', require('./routes/admin'));

// Catch-all route to serve index.html for frontend routing
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
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

    // Ensure Default Administrator exists
    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@strictwallet.com').toLowerCase();
    const existingAdmin = await db.getUserByEmail(adminEmail);

    if (!existingAdmin) {
      const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'StrictAdmin2026!#';
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
    }

    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(` STRICTWALLET FinTech Engine Running on Port ${PORT}`);
      console.log(` Web Interface: http://localhost:${PORT}`);
      console.log(` Admin Portal:  http://localhost:${PORT}/admin.html`);
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

startServer();
