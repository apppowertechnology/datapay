const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { purchaseAirtime, purchaseData } = require('../services/maskawasub');
const paystackService = require('../services/paystack');
const strowallet = require('../services/strowallet');
const { reconcileDepositTransaction } = require('../services/paymentReconciliation');
const { authenticateToken } = require('../middleware/auth');
const { sendTransactionalAlert } = require('../services/smsAlertService');

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
        virtualBankName: user.virtualAccountNumber ? (user.virtualBankName || 'Sterling Bank') : null,
        virtualAccountNumber: user.virtualAccountNumber || null,
        virtualAccountName: user.virtualAccountName || (user.virtualAccountNumber ? (user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim()) : null),
        smsAlertsEnabled: user.smsAlertsEnabled === true,
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

    // Trigger Transactional SMS Debit Alert asynchronously if enabled
    sendTransactionalAlert({
      userId: user.id,
      alertType: 'debit',
      amount: sellingPrice,
      userBalance: user.walletBalance,
      balanceType: 'main',
      desc: `Debited ₦${sellingPrice}`,
      reference: txId,
      transactionType: 'airtime'
    }).catch(err => console.error('[Airtime SMS Alert Error]:', err.message));

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

    // Trigger Transactional SMS Debit Alert asynchronously if enabled
    sendTransactionalAlert({
      userId: user.id,
      alertType: 'debit',
      amount: sellingPrice,
      userBalance: user.walletBalance,
      balanceType: 'main',
      desc: `Debited ₦${sellingPrice}`,
      reference: txId,
      transactionType: 'data'
    }).catch(err => console.error('[Data SMS Alert Error]:', err.message));

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
    const { amount, callbackUrl } = req.body;
    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is ₦100.' });
    }

    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Determine return callback URL if not provided by client
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
    const resolvedCallbackUrl = callbackUrl || (origin ? `${origin}/?flow=deposit_return` : null);

    const metadata = {
      userId: user.id,
      userEmail: user.email,
      userFullName: user.fullName || '',
      depositAmount
    };

    const paystackData = await paystackService.initializeTransaction(
      depositAmount,
      user.email,
      metadata,
      resolvedCallbackUrl
    );

    // IMMEDIATELY persist pending transaction so state is preserved across reloads & app switching
    const tx = {
      id: paystackData.reference,
      userId: user.id,
      userFullName: user.fullName || 'StrictWallet User',
      userEmail: user.email,
      type: 'deposit',
      amount: depositAmount,
      chargedAmount: depositAmount,
      fee: 0,
      providerReference: paystackData.reference,
      paystackReference: paystackData.reference,
      status: 'Pending',
      credited: false,
      description: `Paystack Deposit (₦${depositAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })})`,
      balanceBefore: user.walletBalance || 0,
      createdAt: new Date().toISOString()
    };
    await db.createTransaction(tx);

    await db.saveDeposit({
      id: `DEP-${paystackData.reference}`,
      reference: paystackData.reference,
      providerReference: paystackData.reference,
      paystackReference: paystackData.reference,
      userId: user.id,
      userEmail: user.email,
      amount: depositAmount,
      status: 'Pending',
      credited: false,
      createdAt: new Date().toISOString()
    });

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

    const result = await reconcileDepositTransaction({
      reference,
      triggeredBy: `user_verify_${req.user.id}`
    });

    const user = await db.getUserById(req.user.id);

    return res.json({
      success: result.success,
      status: result.status,
      credited: result.credited || result.alreadyCredited || false,
      message: result.message || (result.status === 'Successful' ? 'Deposit successful.' : `Payment status: ${result.status}`),
      newBalance: user ? user.walletBalance : undefined,
      transaction: result.transaction
    });
  } catch (error) {
    console.error('[Deposit Verify Error]:', error);
    return res.status(500).json({ success: false, message: 'Error verifying deposit.' });
  }
});

// 9. CHECK DEPOSIT STATUS (For polling, state recovery and returns)
router.get('/deposit/status/:reference', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference is required.' });
    }

    let tx = await db.getTransactionByReference(reference);

    // If transaction belongs to another user, forbid access
    if (tx && tx.userId && tx.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized access to transaction.' });
    }

    // If transaction is still Pending or Processing, attempt a live reconciliation
    if (!tx || tx.status === 'Pending' || tx.status === 'Processing') {
      const rec = await reconcileDepositTransaction({
        reference,
        triggeredBy: `user_status_poll_${req.user.id}`
      });
      if (rec.transaction) {
        tx = rec.transaction;
      }
    }

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Deposit transaction not found.' });
    }

    const user = await db.getUserById(req.user.id);

    return res.json({
      success: true,
      status: tx.status,
      credited: tx.credited || false,
      amount: tx.amount,
      channel: tx.channel || null,
      createdAt: tx.createdAt,
      reference: tx.providerReference || tx.reference || tx.id,
      newBalance: user ? user.walletBalance : undefined,
      transaction: tx
    });
  } catch (error) {
    console.error('[Deposit Status Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve deposit status.' });
  }
});

// 10. GET ACTIVE PENDING DEPOSIT (For restoring state when user reloads or returns)
router.get('/deposit/active-pending', authenticateToken, async (req, res) => {
  try {
    const userTxs = await db.getUserTransactions(req.user.id);
    const now = Date.now();

    // Look for pending or processing deposit in the last 24 hours
    const pendingTx = userTxs.find(tx => {
      if (!tx || tx.type !== 'deposit') return false;
      const s = (tx.status || '').toLowerCase();
      if (tx.credited === true || s === 'successful' || s === 'failed' || s === 'cancelled') return false;
      const createdTime = new Date(tx.createdAt || 0).getTime();
      return (now - createdTime) <= 86400 * 1000;
    });

    if (!pendingTx) {
      return res.json({ success: true, pendingDeposit: null });
    }

    // Attempt live reconciliation in background
    const ref = pendingTx.providerReference || pendingTx.paystackReference || pendingTx.id;
    let latestTx = pendingTx;
    try {
      const rec = await reconcileDepositTransaction({
        reference: ref,
        triggeredBy: `user_active_pending_check_${req.user.id}`
      });
      if (rec.transaction) {
        latestTx = rec.transaction;
      }
    } catch (_) {}

    return res.json({
      success: true,
      pendingDeposit: (latestTx.status === 'Pending' || latestTx.status === 'Processing') ? latestTx : null,
      reconciled: latestTx.status === 'Successful',
      transaction: latestTx
    });
  } catch (error) {
    console.error('[Active Pending Deposit Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve pending deposit.' });
  }
});

// 11. CANCEL PENDING DEPOSIT (Checks actual Paystack status first; if unpaid, marks Cancelled; if successful, credits wallet safely)
router.post('/deposit/cancel', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Transaction reference is required.' });
    }

    let tx = await db.getTransactionByReference(reference);
    const depRecord = await db.getDepositByReference(reference);

    const txUserId = (tx && tx.userId) || (depRecord && depRecord.userId);
    if (!txUserId || (txUserId !== req.user.id && req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    const currentStatus = ((tx && tx.status) || (depRecord && depRecord.status) || '').toLowerCase();
    const isCredited = (tx && tx.credited === true) || (depRecord && depRecord.credited === true);

    // 1. If transaction is already credited or successful in DB, reject cancellation and return current state
    if (isCredited || currentStatus === 'successful') {
      const user = await db.getUserById(req.user.id);
      return res.json({
        success: true,
        wasSuccessful: true,
        credited: true,
        status: 'Successful',
        message: 'Payment was already confirmed and credited to your wallet.',
        transaction: tx,
        newBalance: user ? user.walletBalance : undefined
      });
    }

    // 2. Authoritative check with Paystack before cancelling
    let verification = null;
    try {
      verification = await paystackService.verifyTransaction(reference);
    } catch (err) {
      console.warn(`[Deposit Cancel Verify Warning for ${reference}]: ${err.message}`);
    }

    const paystackStatus = verification ? (verification.status || '').toLowerCase() : '';

    // 3. If payment was ACTUALLY successful at Paystack, DO NOT CANCEL IT! Reconcile and credit wallet once.
    if (paystackStatus === 'success') {
      const rec = await reconcileDepositTransaction({
        reference,
        paystackData: verification,
        triggeredBy: `user_cancel_verify_${req.user.id}`
      });

      const user = await db.getUserById(req.user.id);
      return res.json({
        success: true,
        wasSuccessful: true,
        credited: true,
        status: 'Successful',
        message: `Payment was confirmed successful at Paystack! ₦${parseFloat(rec.transaction?.amount || (tx && tx.amount) || (depRecord && depRecord.amount) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been credited to your wallet.`,
        transaction: rec.transaction || tx,
        newBalance: user ? user.walletBalance : undefined
      });
    }

    // 4. Re-check database state before cancelling in case an asynchronous webhook or background check reconciled it during Paystack verify round-trip
    const freshTx = await db.getTransactionByReference(reference);
    const freshDep = await db.getDepositByReference(reference);
    const freshStatus = ((freshTx && freshTx.status) || (freshDep && freshDep.status) || '').toLowerCase();
    const freshCredited = (freshTx && freshTx.credited === true) || (freshDep && freshDep.credited === true);

    if (freshCredited || freshStatus === 'successful') {
      const user = await db.getUserById(req.user.id);
      return res.json({
        success: true,
        wasSuccessful: true,
        credited: true,
        status: 'Successful',
        message: 'Payment was confirmed and credited to your wallet.',
        transaction: freshTx || tx,
        newBalance: user ? user.walletBalance : undefined
      });
    }

    // 5. Payment has NOT been received or confirmed as successful -> Mark as Cancelled
    let updatedTx = freshTx || tx;
    if (updatedTx && !updatedTx.credited) {
      updatedTx = await db.updateTransaction(updatedTx.id, {
        status: 'Cancelled',
        gatewayResponse: verification?.gatewayResponse || 'Cancelled by customer',
        cancelledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    if (freshDep && !freshDep.credited) {
      await db.updateDeposit(freshDep.id, {
        status: 'Cancelled',
        updatedAt: new Date().toISOString()
      });
    }

    return res.json({
      success: true,
      wasSuccessful: false,
      credited: false,
      status: 'Cancelled',
      message: 'Payment attempt was cancelled. No funds were debited.',
      transaction: updatedTx
    });
  } catch (error) {
    console.error('[Cancel Deposit Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel deposit.' });
  }
});

// 12. GENERATE STERLING BANK VIRTUAL ACCOUNT (For existing users who don't have one yet)
const vaGenerationLocks = new Set();

router.post('/virtual-account/generate', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  if (vaGenerationLocks.has(userId)) {
    return res.status(429).json({
      success: false,
      message: 'Virtual account generation is currently in progress. Please wait a moment.'
    });
  }

  vaGenerationLocks.add(userId);

  try {
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Check if user already has an assigned virtual account (prevent duplicate creation)
    if (user.virtualAccountNumber) {
      return res.json({
        success: true,
        alreadyExists: true,
        message: 'You already have an assigned Sterling Bank virtual account.',
        virtualAccount: {
          bankName: user.virtualBankName || 'Sterling Bank',
          accountNumber: user.virtualAccountNumber,
          accountName: user.virtualAccountName || user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim()
        }
      });
    }

    const reqFirstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
    const reqLastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';

    const resolvedFirstName = reqFirstName || (user.firstName || '').trim() || (user.fullName ? user.fullName.split(' ')[0] : '');
    const resolvedLastName = reqLastName || (user.lastName || '').trim() || (user.fullName ? user.fullName.split(' ').slice(1).join(' ') : resolvedFirstName);

    if (!resolvedFirstName || !resolvedLastName) {
      return res.status(400).json({
        success: false,
        message: 'Customer First Name and Last Name are required for virtual account creation. Please update your details in Settings first.'
      });
    }

    const resolvedAccountName = user.virtualAccountName || user.fullName || `${resolvedFirstName} ${resolvedLastName}`.trim();

    const { createSterlingVirtualAccount } = require('../services/strowallet');
    const vaResult = await createSterlingVirtualAccount({
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      accountName: resolvedAccountName,
      email: user.email,
      phone: user.phone
    });

    if (!vaResult.success || !vaResult.accountNumber) {
      return res.status(400).json({
        success: false,
        message: vaResult.message || 'Unable to generate Sterling Bank virtual account. Please try again shortly.'
      });
    }

    // Save actual account details against authenticated user record
    user.virtualBankName = 'Sterling Bank';
    user.virtualAccountNumber = vaResult.accountNumber;
    user.virtualAccountName = vaResult.accountName || resolvedAccountName;
    user.virtualAccountCreatedAt = new Date().toISOString();
    user.virtualAccountProvider = 'strowallet';
    await db.saveUser(user);

    console.info(`[Wallet VA Generation] Successfully assigned Sterling Bank virtual account to user ${user.id}: ${vaResult.accountNumber}`);

    return res.json({
      success: true,
      message: 'Sterling Bank virtual account generated successfully!',
      virtualAccount: {
        bankName: 'Sterling Bank',
        accountNumber: vaResult.accountNumber,
        accountName: user.virtualAccountName
      }
    });
  } catch (err) {
    console.error('[Generate Sterling VA Error]:', err);
    return res.status(500).json({ success: false, message: 'Server error generating Sterling virtual account. Please try again.' });
  } finally {
    vaGenerationLocks.delete(userId);
  }
});

// 12B. VERIFY AND RECONCILE STERLING BANK VIRTUAL ACCOUNT TRANSFER BY SESSION ID
router.post('/virtual-account/verify-session', authenticateToken, async (req, res) => {
  try {
    const { sessionId, amount } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Transaction session ID is required.' });
    }

    const user = await db.getUserById(req.user.id);
    if (!user || !user.virtualAccountNumber) {
      return res.status(400).json({ success: false, message: 'You do not have an assigned virtual account.' });
    }

    const { verifySessionId } = require('../services/strowallet');
    const { reconcileStrowalletTransfer } = require('../services/paymentReconciliation');

    let checkAmount = amount;
    if (!checkAmount) {
      const existingTx = await db.getTransactionByReference(sessionId);
      if (existingTx && (existingTx.grossAmount || existingTx.amount)) {
        checkAmount = existingTx.grossAmount || existingTx.amount;
      }
    }

    const verifyRes = await verifySessionId(sessionId, checkAmount || 0);
    if (!verifyRes.success || !verifyRes.data) {
      return res.status(400).json({
        success: false,
        message: verifyRes.message || 'Transaction session not found or not yet confirmed by the bank.'
      });
    }

    const providerData = verifyRes.data;
    const transferPayload = {
      sessionId: String(sessionId).trim(),
      accountNumber: user.virtualAccountNumber,
      transactionAmount: providerData.transactionAmount || providerData.amount || amount,
      settledAmount: providerData.settledAmount || providerData.amount || amount,
      raw: providerData
    };

    const reconResult = await reconcileStrowalletTransfer(transferPayload, { skipVerification: true });
    return res.json({
      success: reconResult.success,
      alreadyCredited: reconResult.alreadyCredited,
      message: reconResult.message || 'Transfer reconciled successfully.',
      newBalance: reconResult.newBalance
    });
  } catch (err) {
    console.error('[Verify Sterling Session Error]:', err);
    return res.status(500).json({ success: false, message: 'Server error verifying transfer session.' });
  }
});

// 13. UPDATE TRANSACTIONAL SMS ALERT SETTINGS (ON / OFF)
router.post('/sms/settings', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Invalid settings format: enabled (boolean) required.' });
    }

    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.smsAlertsEnabled = enabled;
    await db.saveUser(user);

    return res.json({
      success: true,
      message: user.smsAlertsEnabled ? 'Transactional SMS alerts are now active.' : 'Transactional SMS alerts turned off.',
      smsAlertsEnabled: user.smsAlertsEnabled
    });
  } catch (err) {
    console.error('[SMS Settings Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to update SMS alert settings.' });
  }
});

// ============================================================
// 14. MAIN WALLET BANK WITHDRAWAL
// ============================================================

// A. Get Nigerian Bank Lists (Strowallet API)
router.get('/withdraw/banks', async (req, res) => {
  try {
    const result = await strowallet.getBankLists();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load bank list.' });
  }
});

// B. Verify Nigerian Bank Account Name (Strowallet Name Enquiry API)
router.post('/withdraw/verify-account', authenticateToken, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    if (!bankCode || !accountNumber) {
      return res.status(400).json({ success: false, message: 'Bank code and account number are required.' });
    }

    const result = await strowallet.getCustomerName(bankCode, accountNumber.trim());
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to verify account.' });
  }
});

// In-flight concurrency lock to prevent duplicate withdrawal processing / double deduction
const mainWithdrawalLocks = new Set();

// C. Process Main Wallet Withdrawal Request
router.post('/withdraw/request', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  if (mainWithdrawalLocks.has(userId)) {
    return res.status(429).json({
      success: false,
      message: 'A withdrawal transaction is currently being processed. Please wait a moment.'
    });
  }

  mainWithdrawalLocks.add(userId);

  try {
    const {
      amount,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      narration,
      nameEnquiryRef,
      pin
    } = req.body;

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₦100.' });
    }

    if (!bankCode || !accountNumber || !accountName) {
      return res.status(400).json({ success: false, message: 'Destination bank selection and verified account name are required.' });
    }

    const cleanAccountNum = accountNumber.toString().trim();
    if (cleanAccountNum.length !== 10) {
      return res.status(400).json({ success: false, message: 'Bank account number must be exactly 10 digits.' });
    }

    if (!pin) {
      return res.status(400).json({ success: false, message: 'STRICTWALLET Transaction PIN is required.' });
    }

    // Verify User & Transaction PIN
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.status && user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account is suspended. Please contact customer support.' });
    }

    if (!user.transactionPinHash) {
      return res.status(400).json({
        success: false,
        message: 'Please set up your 4-digit Transaction PIN in Settings before withdrawing.'
      });
    }

    const isPinValid = await bcrypt.compare(pin.toString(), user.transactionPinHash);
    if (!isPinValid) {
      return res.status(400).json({ success: false, message: 'Invalid Transaction PIN.' });
    }

    // Withdrawal Fee Calculations:
    // API provider charge = ₦12.00
    // STRICTWALLET customer charge = ₦20.00
    // Expected STRICTWALLET gross profit = ₦20.00 - ₦12.00 = ₦8.00 per successful withdrawal
    // Statutory Stamp duty = ₦50.00 for withdrawals >= ₦10,000 (₦0.00 for < ₦10,000)
    const charge = 20.00;
    const providerFee = 12.00;
    const stampDuty = withdrawAmount >= 10000 ? 50.00 : 0.00;
    const profit = Math.round((charge - providerFee) * 100) / 100; // Exactly ₦8.00 profit
    const totalDeduction = Math.round((withdrawAmount + charge + stampDuty) * 100) / 100;

    // Check Available Main Wallet Balance
    const availableBalance = parseFloat(user.walletBalance || 0);
    if (availableBalance < totalDeduction) {
      const feeDetails = stampDuty > 0
        ? 'including ₦20.00 withdrawal fee and ₦50.00 stamp duty'
        : 'including ₦20.00 withdrawal fee';
      return res.status(400).json({
        success: false,
        message: `Insufficient main wallet balance. Available: ₦${availableBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, Required (${feeDetails}): ₦${totalDeduction.toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`
      });
    }

    // 1. Temporarily Debit Main Wallet with safe transaction state
    user.walletBalance = Math.round((availableBalance - totalDeduction) * 100) / 100;
    await db.saveUser(user);

    const txId = `WTH-WAL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const cleanNarration = (narration && narration.trim()) || 'Main wallet withdrawal';

    const withdrawalTx = {
      id: txId,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      type: 'withdrawal',
      amount: withdrawAmount,
      charge: charge,
      stampDuty: stampDuty,
      providerFee: providerFee,
      profit: 0, // only credited upon confirmed success
      totalDeducted: totalDeduction,
      bankCode: bankCode,
      bankName: bankName || 'Bank',
      accountNumber: cleanAccountNum,
      accountName: accountName.trim(),
      narration: cleanNarration,
      nameEnquiryReference: nameEnquiryRef || `NER-${Date.now()}`,
      providerReference: null,
      status: 'Processing',
      balanceBefore: availableBalance,
      balanceAfter: user.walletBalance,
      description: `Withdrawal of ₦${withdrawAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} to ${bankName || 'Bank'} (${cleanAccountNum.slice(-4)})`,
      createdAt: new Date().toISOString()
    };

    await db.createTransaction(withdrawalTx);

    // 2. Execute Transfer via Strowallet Bank Transfer API
    const transferResult = await strowallet.requestBankTransfer({
      amount: withdrawAmount,
      bankCode,
      accountNumber: cleanAccountNum,
      narration: cleanNarration,
      nameEnquiryRef: withdrawalTx.nameEnquiryReference,
      senderName: 'STRICTWALLET'
    });

    if (transferResult.success) {
      // Transfer Succeeded!
      withdrawalTx.status = 'Successful';
      withdrawalTx.providerReference = transferResult.reference;
      withdrawalTx.profit = profit;
      await db.updateTransaction(withdrawalTx.id, withdrawalTx);

      // Trigger Transactional SMS Debit Alert asynchronously if enabled
      sendTransactionalAlert({
        userId: user.id,
        alertType: 'debit',
        amount: withdrawAmount,
        userBalance: user.walletBalance,
        balanceType: 'main',
        desc: `Debited ₦${withdrawAmount}`,
        reference: withdrawalTx.id,
        transactionType: 'withdrawal'
      }).catch(err => console.error('[Main Wallet Withdrawal SMS Alert Error]:', err.message));

      return res.json({
        success: true,
        message: `Withdrawal of ₦${withdrawAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} transferred successfully!`,
        transaction: withdrawalTx,
        newBalance: user.walletBalance
      });
    } else if (transferResult.status === 'Pending' || transferResult.status === 'Processing') {
      // Transfer Pending / Processing at Provider
      withdrawalTx.status = transferResult.status;
      withdrawalTx.providerReference = transferResult.reference;
      await db.updateTransaction(withdrawalTx.id, withdrawalTx);

      return res.json({
        success: true,
        message: `Withdrawal submitted and currently ${transferResult.status.toLowerCase()} with provider.`,
        transaction: withdrawalTx,
        newBalance: user.walletBalance
      });
    } else {
      // Transfer Failed at Provider: Restore Main Wallet Balance Immediately
      user.walletBalance = Math.round((parseFloat(user.walletBalance) + totalDeduction) * 100) / 100;
      await db.saveUser(user);

      withdrawalTx.status = 'Failed';
      withdrawalTx.profit = 0;
      withdrawalTx.failureReason = transferResult.message || 'Transfer failed at bank provider';
      withdrawalTx.balanceAfter = user.walletBalance;
      await db.updateTransaction(withdrawalTx.id, withdrawalTx);

      return res.status(502).json({
        success: false,
        message: `Transfer failed: ${transferResult.message || 'Bank network error'}. Your wallet balance has been restored.`,
        transaction: withdrawalTx,
        newBalance: user.walletBalance
      });
    }
  } catch (error) {
    console.error('[Main Wallet Withdrawal Request Error]:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while processing withdrawal.' });
  } finally {
    mainWithdrawalLocks.delete(userId);
  }
});

// D. Get Single Transaction by ID
router.get('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const tx = await db.getTransactionById(req.params.id);
    if (!tx || (tx.userId !== req.user.id && req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    return res.json({ success: true, transaction: tx });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load transaction.' });
  }
});

module.exports = router;
