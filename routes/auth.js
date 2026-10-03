const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyAccount } = require('../services/strowallet');
const { authenticateToken } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'strictwallet_jwt_secret_production_ready_key_2026_!98#x';

function normalizePhoneNumber(phone) {
  if (typeof db.normalizePhoneNumber === 'function') {
    return db.normalizePhoneNumber(phone);
  }
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('234') && cleaned.length === 13) {
    cleaned = '0' + cleaned.slice(3);
  }
  return cleaned;
}

// Password Strength Validator
function validateStrongPassword(password) {
  if (!password || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  return hasUpper && hasLower && hasNumber && hasSpecial;
}

// 1. USER REGISTRATION
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, confirmPassword, nextOfKin } = req.body;

    // Validation
    if (!fullName || !email || !phone || !password || !confirmPassword || !nextOfKin) {
      return res.status(400).json({ success: false, message: 'All registration fields are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    const cleanPhone = normalizePhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ success: false, message: 'Please provide a valid phone number.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (!validateStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      });
    }

    // Check if user already exists by email
    const existingUser = await db.getUserByEmail(cleanEmail);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email address already exists.' });
    }

    // Check if user already exists by phone
    const existingPhone = await db.getUserByPhone(cleanPhone);
    if (existingPhone) {
      return res.status(400).json({ success: false, message: 'An account with this phone number already exists.' });
    }

    // Hash password & nextOfKin
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const nextOfKinAnswer = nextOfKin.trim().toLowerCase();

    const userId = `usr_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

    // Prepare initial user object
    const newUser = {
      id: userId,
      fullName: fullName.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: passwordHash,
      nextOfKin: nextOfKin.trim(), // Stored for security verification
      nextOfKinAnswer: nextOfKinAnswer,
      transactionPinHash: null,
      role: 'user',
      status: 'active',
      walletBalance: 0.00,
      totalDeposited: 0.00,
      totalAirtimeSpent: 0.00,
      totalDataSpent: 0.00,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to Firebase Realtime Database
    await db.saveUser(newUser);

    // Confirm that the user record was persistently written to Firebase RTDB
    const verifiedUser = await db.getUserById(newUser.id);
    if (!verifiedUser || !verifiedUser.id || verifiedUser.email !== cleanEmail) {
      const dbErr = new Error(`Firebase persistence confirmation failed for user ${newUser.id} (${cleanEmail})`);
      dbErr.isDbError = true;
      throw dbErr;
    }

    // Generate JWT token only after verified write
    const token = jwt.sign(
      { id: verifiedUser.id, email: verifiedUser.email, role: verifiedUser.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Return safe user object (without passwordHash)
    const { passwordHash: _, nextOfKinAnswer: __, ...safeUser } = verifiedUser;

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully!',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('[Registration Error]:', error);
    if (error.isDbError || (error.message && (error.message.includes('Firebase') || error.message.includes('Database connection') || error.message.includes('persistence')))) {
      return res.status(503).json({
        success: false,
        message: 'Database service is temporarily unavailable. Your account was not registered. Please try again shortly.'
      });
    }
    return res.status(500).json({ success: false, message: 'Server error occurred during registration. Please try again.' });
  }
});

// 2. USER LOGIN
router.post('/login', async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.email || req.body.phone || '').trim();
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email or phone number and password are required.' });
    }

    const user = await db.getUserByIdentifier(identifier);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email address, phone number, or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your STRICTWALLET account is suspended. Please contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email address, phone number, or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const { passwordHash, nextOfKinAnswer, transactionPinHash, ...safeUser } = user;
    safeUser.hasPin = !!transactionPinHash;

    return res.json({
      success: true,
      message: 'Welcome back to STRICTWALLET!',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    if (error.isDbError || (error.message && (error.message.includes('Firebase') || error.message.includes('Database connection')))) {
      return res.status(503).json({
        success: false,
        message: 'Database service is temporarily unavailable. Please try again shortly.'
      });
    }
    return res.status(500).json({ success: false, message: 'Unable to sign in. Please try again later.' });
  }
});

// 3. PASSWORD RECOVERY - VERIFY EMAIL & NEXT OF KIN
router.post('/recover-verify', async (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.email || req.body.phone || '').trim();
    const { nextOfKinAnswer } = req.body;

    if (!identifier || !nextOfKinAnswer) {
      return res.status(400).json({ success: false, message: 'Email or phone number and Next of Kin answer are required.' });
    }

    const user = await db.getUserByIdentifier(identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email or phone number.' });
    }

    const storedAnswer = (user.nextOfKinAnswer || user.nextOfKin || '').trim().toLowerCase();
    const providedAnswer = nextOfKinAnswer.trim().toLowerCase();

    if (storedAnswer !== providedAnswer) {
      return res.status(400).json({ success: false, message: 'Next of Kin answer does not match our records.' });
    }

    // Generate short-lived reset token (15 mins)
    const resetToken = jwt.sign(
      { id: user.id, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.json({
      success: true,
      message: 'Verification successful. You may now set a new password.',
      resetToken
    });
  } catch (error) {
    console.error('[Recover Verify Error]:', error);
    return res.status(500).json({ success: false, message: 'Error processing recovery verification.' });
  }
});

// 4. PASSWORD RECOVERY - SET NEW PASSWORD
router.post('/recover-reset', async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (!validateStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(400).json({ success: false, message: 'Reset token has expired or is invalid. Please restart recovery.' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ success: false, message: 'Invalid token purpose.' });
    }

    const user = await db.getUserById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await db.saveUser(user);

    return res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.'
    });
  } catch (error) {
    console.error('[Recover Reset Error]:', error);
    return res.status(500).json({ success: false, message: 'Error resetting password.' });
  }
});

// 5. GET CURRENT USER PROFILE
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { passwordHash, nextOfKinAnswer, transactionPinHash, ...safeUser } = user;
    safeUser.hasPin = !!transactionPinHash;

    return res.json({
      success: true,
      user: safeUser
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
});

// 6. CHANGE PASSWORD (AUTHENTICATED)
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match.' });
    }

    if (!validateStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password does not meet security requirements.'
      });
    }

    const user = await db.getUserById(req.user.id);
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await db.saveUser(user);

    return res.json({
      success: true,
      message: 'Your password has been changed successfully!'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error changing password.' });
  }
});

// 7. BANK ACCOUNT VERIFICATION
router.post('/bank/verify', authenticateToken, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    if (!bankCode || !accountNumber) {
      return res.status(400).json({ success: false, message: 'Bank code and account number are required.' });
    }
    const result = await verifyAccount(bankCode, accountNumber);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Verification failed.' });
    }
    const { data } = result;
    const responsePayload = {
      success: true,
      bankName: data.bank_name || data.bankName || bankCode,
      accountName: data.account_name || data.accountName || '',
      accountNumber: data.account_number || data.accountNumber || accountNumber,
      status: data.status || 'verified',
      message: data.message || 'Account verified successfully.'
    };
    return res.json(responsePayload);
  } catch (error) {
    console.error('[Bank Verify Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error during account verification.' });
  }
});

module.exports = router;
