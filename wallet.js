const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { purchaseAirtime, purchaseData } = require('../services/maskawasub');
const paystackService = require('../services/paystack');
const { authenticateToken } = require('../middleware/auth');

// Network mapping
const NETWORK_NAMES = {
  1: 'MTN',
  2: 'GLO',
  3: '9MOBILE',
  4: 'AIRTEL'
};

// 1. GET USER WALLET OVERVIEW
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const recentTx = await db.getUserTransactions(user.id);

    return res.json({
      success: true,
      wallet: {
        balance: parseFloat(user.walletBalance || 0),
        totalDeposited: parseFloat(user.totalDeposited || 0),
        totalAirtimeSpent: parseFloat(user.totalAirtimeSpent || 0),
        totalDataSpent: parseFloat(user.totalDataSpent || 0),
        // Virtual account fields removed; funding via Paystack
        hasPin: !!user.transactionPinHash,
        status: user.status
      },
      recentTransactions: recentTx.slice(0, 5)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error loading wallet details.' });
  }
});

// 2. SET / UPDATE TRANSACTION PIN
router.post('/set-pin', authenticateToken, async (req, res) => {
  try {
    const { pin, currentPassword, currentPin } = req.body;

    if (!pin || !/^\d{4}$/.test(pin.toString())) {
      return res.status(400).json({ success: false, message: 'Transaction PIN must be exactly 4 digits (numbers only).' });
    }

    const user = await db.getUserById(req.user.id);

    // If user already has a PIN, verify either currentPassword or currentPin
    if (user.transactionPinHash) {
      if (currentPin) {
        const pinMatch = await bcrypt.compare(currentPin.toString(), user.transactionPinHash);
        if (!pinMatch) {
          return res.status(400).json({ success: false, message: 'Current transaction PIN is incorrect.' });
        }
      } else if (currentPassword) {
        const passMatch = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!passMatch) {
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }
      } else {
        return res.status(400).json({ success: false, message: 'Please provide your current PIN or password to authorize this change.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    user.transactionPinHash = await bcrypt.hash(pin.toString(), salt);
    await db.saveUser(user);

    return res.json({
      success: true,
      message: 'Transaction PIN successfully set/updated! Keep it secure.'
    });
  } catch (error) {
    console.error('[Set PIN Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to update transaction PIN.' });
  }
});

// 3. GET DATA PLANS (Active only for users)
router.get('/data-plans', async (req, res) => {
  try {
    const allPlans = await db.getAllDataPlans();
    const activePlans = allPlans.filter(p => p.status === 'active');
    
    // Sort plans by network, planType, then sellingPrice
    activePlans.sort((a, b) => {
      if (a.network !== b.network) return a.network.localeCompare(b.network);
      if (a.planType !== b.planType) return (a.planType || '').localeCompare(b.planType || '');
      return (parseFloat(a.sellingPrice) || 0) - (parseFloat(b.sellingPrice) || 0);
    });

    // Map to consumer-safe objects (do not expose provider costPrice to regular users)
    const safePlans = activePlans.map(p => ({
      id: p.id,
      network: p.network,
      networkId: p.networkId,
      planType: p.planType,
      size: p.size,
      name: p.name,
      validity: p.validity,
      sellingPrice: p.sellingPrice,
      status: p.status
    }));

    // Group by network
    const grouped = {
      MTN: safePlans.filter(p => p.network.toUpperCase() === 'MTN'),
      GLO: safePlans.filter(p => p.network.toUpperCase() === 'GLO'),
      AIRTEL: safePlans.filter(p => p.network.toUpperCase() === 'AIRTEL'),
      '9MOBILE': safePlans.filter(p => p.network.toUpperCase() === '9MOBILE')
    };

    return res.json({
      success: true,
      plans: safePlans,
      grouped
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load data plans.' });
  }
});

// 4. BUY AIRTIME
router.post('/buy-airtime', authenticateToken, async (req, res) => {
  try {
    const { network, phone, amount, pin } = req.body;
    const netId = parseInt(network, 10);
    const purchaseAmount = parseFloat(amount);

    if (!netId || ![1, 2, 3, 4].includes(netId)) {
      return res.status(400).json({ success: false, message: 'Please select a valid network.' });
    }

    if (!phone || phone.toString().length < 10) {
      return res.status(400).json({ success: false, message: 'Please provide a valid Nigerian phone number.' });
    }

    if (isNaN(purchaseAmount) || purchaseAmount < 50 || purchaseAmount > 50000) {
      return res.status(400).json({ success: false, message: 'Airtime amount must be between ₦50 and ₦50,000.' });
    }

    if (!pin) {
      return res.status(400).json({ success: false, message: 'Transaction PIN is required.' });
    }

    // Load fresh user
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.transactionPinHash) {
      return res.status(400).json({ success: false, message: 'Please set up a 4-digit Transaction PIN in Settings before transacting.' });
    }

    const isPinValid = await bcrypt.compare(pin.toString(), user.transactionPinHash);
    if (!isPinValid) {
      return res.status(400).json({ success: false, message: 'Invalid Transaction PIN.' });
    }

    const currentBalance = parseFloat(user.walletBalance || 0);
    if (currentBalance < purchaseAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. You have ₦${currentBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, required: ₦${purchaseAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}. Please fund your wallet.`
      });
    }

    // Financial Calculation (2% provider discount = cost is 98% of face value)
    const costPrice = Math.round(purchaseAmount * 0.98 * 100) / 100;
    const sellingPrice = purchaseAmount;
    const profit = Math.round((sellingPrice - costPrice) * 100) / 100;

    // Server-side Atomic Balance Deduction
    user.walletBalance = Math.round((currentBalance - sellingPrice) * 100) / 100;
    user.totalAirtimeSpent = Math.round(((user.totalAirtimeSpent || 0) + sellingPrice) * 100) / 100;
    await db.saveUser(user);

    const txId = `TXN-AIR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Call Provider API
    const apiResult = await purchaseAirtime(netId, phone, purchaseAmount);

    let status = 'Successful';
    if (!apiResult.success) {
      // If immediate failure, refund balance
      status = 'Failed';
      user.walletBalance = Math.round((user.walletBalance + sellingPrice) * 100) / 100;
      user.totalAirtimeSpent = Math.round((user.totalAirtimeSpent - sellingPrice) * 100) / 100;
      await db.saveUser(user);
    }

    // Ledger Transaction Record
    const tx = {
      id: txId,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      type: 'airtime',
      network: NETWORK_NAMES[netId],
      networkId: netId,
      phoneNumber: phone.toString().trim(),
      amount: sellingPrice,
      costPrice: costPrice,
      sellingPrice: sellingPrice,
      profit: status === 'Successful' ? profit : 0,
      providerReference: apiResult.reference || `REF-${Date.now()}`,
      status: status,
      description: `${NETWORK_NAMES[netId]} Airtime Recharge (₦${sellingPrice.toLocaleString()}) to ${phone}`,
      createdAt: new Date().toISOString()
    };

    await db.createTransaction(tx);

    if (status === 'Failed') {
      return res.status(400).json({
        success: false,
        message: apiResult.message || "We couldn't complete your transaction at this time. Please try again shortly.",
        newBalance: user.walletBalance
      });
    }

    return res.json({
      success: true,
      message: `₦${sellingPrice.toLocaleString()} ${NETWORK_NAMES[netId]} Airtime delivered successfully to ${phone}!`,
      transaction: tx,
      newBalance: user.walletBalance
    });
  } catch (error) {
    console.error('[Buy Airtime Error]:', error);
    return res.status(500).json({ success: false, message: "We couldn't complete your transaction at this time. Please try again shortly." });
  }
});

// 5. BUY DATA
router.post('/buy-data', authenticateToken, async (req, res) => {
  try {
    const { planId, phone, pin } = req.body;

    if (!planId || !phone || !pin) {
      return res.status(400).json({ success: false, message: 'Plan, phone number, and transaction PIN are required.' });
    }

    if (phone.toString().length < 10) {
      return res.status(400).json({ success: false, message: 'Please provide a valid Nigerian phone number.' });
    }

    const plan = await db.getDataPlanById(planId);
    if (!plan || plan.status !== 'active') {
      return res.status(400).json({ success: false, message: 'The selected data bundle is currently unavailable.' });
    }

    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.transactionPinHash) {
      return res.status(400).json({ success: false, message: 'Please set up a 4-digit Transaction PIN in Settings before purchasing.' });
    }

    const isPinValid = await bcrypt.compare(pin.toString(), user.transactionPinHash);
    if (!isPinValid) {
      return res.status(400).json({ success: false, message: 'Invalid Transaction PIN.' });
    }

    const sellingPrice = parseFloat(plan.sellingPrice);
    const costPrice = parseFloat(plan.costPrice);
    const profit = Math.round((sellingPrice - costPrice) * 100) / 100;

    const currentBalance = parseFloat(user.walletBalance || 0);
    if (currentBalance < sellingPrice) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. You have ₦${currentBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, required: ₦${sellingPrice.toLocaleString('en-NG', { minimumFractionDigits: 2 })}. Please fund your wallet.`
      });
    }

    // Atomic Deduction
    user.walletBalance = Math.round((currentBalance - sellingPrice) * 100) / 100;
    user.totalDataSpent = Math.round(((user.totalDataSpent || 0) + sellingPrice) * 100) / 100;
    await db.saveUser(user);

    const txId = `TXN-DAT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Call Provider API
    const apiResult = await purchaseData(plan.networkId || 1, phone, plan.providerPlanId);

    let status = 'Successful';
    if (!apiResult.success) {
      status = 'Failed';
      user.walletBalance = Math.round((user.walletBalance + sellingPrice) * 100) / 100;
      user.totalDataSpent = Math.round((user.totalDataSpent - sellingPrice) * 100) / 100;
      await db.saveUser(user);
    }

    const tx = {
      id: txId,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      type: 'data',
      network: plan.network,
      networkId: plan.networkId,
      planName: plan.name,
      validity: plan.validity,
      phoneNumber: phone.toString().trim(),
      amount: sellingPrice,
      costPrice: costPrice,
      sellingPrice: sellingPrice,
      profit: status === 'Successful' ? profit : 0,
      providerReference: apiResult.reference || `REF-${Date.now()}`,
      status: status,
      description: `${plan.network} ${plan.name} (${plan.validity}) Data to ${phone}`,
      createdAt: new Date().toISOString()
    };

    await db.createTransaction(tx);

    if (status === 'Failed') {
      return res.status(400).json({
        success: false,
        message: apiResult.message || "We couldn't complete your data purchase at this time. Please try again shortly.",
        newBalance: user.walletBalance
      });
    }

    return res.json({
      success: true,
      message: `${plan.network} ${plan.name} activated successfully for ${phone}!`,
      transaction: tx,
      newBalance: user.walletBalance
    });
  } catch (error) {
    console.error('[Buy Data Error]:', error);
    return res.status(500).json({ success: false, message: "We couldn't complete your transaction at this time. Please try again shortly." });
  }
});

// 6. TRANSACTION HISTORY WITH FILTERING & SEARCH
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, status, search } = req.query;
    let list = await db.getUserTransactions(req.user.id);

    if (type && type !== 'all') {
      list = list.filter(t => t.type && t.type.toLowerCase() === type.toLowerCase());
    }

    if (status && status !== 'all') {
      list = list.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.providerReference && t.providerReference.toLowerCase().includes(q)) ||
        (t.phoneNumber && t.phoneNumber.includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    return res.json({
      success: true,
      transactions: list
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve transactions.' });
  }
});

// 7. INITIALIZE PAYSTACK DEPOSIT
router.post('/deposit/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is ₦100.' });
    }

    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const paystackData = await paystackService.initializeTransaction(amount, user.email);

    return res.json({
      success: true,
      reference: paystackData.reference,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY,
      authorization_url: paystackData.authorization_url
    });
  } catch (error) {
    console.error('[Deposit Init Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to initialize deposit.' });
  }
});

// 8. VERIFY PAYSTACK DEPOSIT
router.post('/deposit/verify', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Transaction reference is required.' });
    }

    const verification = await paystackService.verifyTransaction(reference);

    if (verification.status === 'success') {
      const user = await db.getUserById(req.user.id);
      
      // Ensure we haven't processed this transaction already
      const existingTx = await db.getTransactionById(reference);
      if (existingTx) {
         return res.json({ success: true, message: 'Transaction already processed.', newBalance: user.walletBalance });
      }

      // Update balances
      const amount = parseFloat(verification.amount);
      user.walletBalance = (parseFloat(user.walletBalance || 0) + amount);
      user.totalDeposited = (parseFloat(user.totalDeposited || 0) + amount);
      
      await db.saveUser(user);

      // Record transaction
      const tx = {
        id: reference,
        userId: user.id,
        type: 'deposit',
        amount: amount,
        description: `Paystack Deposit (₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })})`,
        status: 'Successful',
        balanceAfter: user.walletBalance,
        createdAt: new Date().toISOString()
      };
      await db.createTransaction(tx);

      return res.json({ success: true, message: 'Deposit successful.', newBalance: user.walletBalance });
    } else {
      return res.status(400).json({ success: false, message: 'Payment verification failed or pending.' });
    }

  } catch (error) {
    console.error('[Deposit Verify Error]:', error);
    return res.status(500).json({ success: false, message: 'Error verifying deposit.' });
  }
});

module.exports = router;
