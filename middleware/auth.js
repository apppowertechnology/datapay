const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'strictwallet_jwt_secret_production_ready_key_2026_!98#x';

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found or expired.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your STRICTWALLET account has been suspended. Please contact customer care.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired session. Please sign in again.' });
  }
}

async function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin authorization required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.getUserById(decoded.id);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied: Administrator privileges required.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your STRICTWALLET administrator account is suspended.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid admin token.' });
  }
}

module.exports = {
  authenticateToken,
  requireAdmin
};
