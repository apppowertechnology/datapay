const db = require('../db');
const paystackService = require('./paystack');

// Mutex locks keyed by transaction reference to prevent race conditions
const activeLocks = new Map();

/**
 * Execute an async function within a per-reference mutex lock.
 * Serializes concurrent requests (e.g. Webhook + User verify + Admin reconcile) for the same reference.
 */
async function withLock(reference, fn) {
  const refKey = (reference || '').trim();
  if (!refKey) return fn();

  while (activeLocks.has(refKey)) {
    try {
      await activeLocks.get(refKey);
    } catch (_) {}
  }

  let resolveLock;
  const lockPromise = new Promise(resolve => { resolveLock = resolve; });
  activeLocks.set(refKey, lockPromise);

  try {
    return await fn();
  } finally {
    activeLocks.delete(refKey);
    resolveLock();
  }
}

/**
 * Authoritative, idempotent reconciliation function for Paystack deposits.
 *
 * @param {object} params
 * @param {string} params.reference - The transaction/provider reference
 * @param {object} [params.paystackData] - Pre-fetched/verified Paystack payload (e.g. from webhook)
 * @param {string} [params.triggeredBy] - Who triggered reconciliation ('webhook', 'user_verify', 'admin_manual', 'background_worker')
 * @returns {Promise<{
 *   success: boolean,
 *   status: string,
 *   credited?: boolean,
 *   alreadyCredited?: boolean,
 *   newBalance?: number,
 *   transaction?: object,
 *   message?: string,
 *   error?: string
 * }>}
 */
async function reconcileDepositTransaction({ reference, paystackData = null, triggeredBy = 'user_verify' }) {
  if (!reference) {
    return { success: false, status: 'Failed', message: 'No reference provided' };
  }

  return withLock(reference, async () => {
    // 1. Check existing transaction in DB
    let tx = await db.getTransactionByReference(reference);

    // 2. Exactly-once check: If already credited/successful, never credit again!
    if (tx && (tx.status === 'Successful' || tx.credited === true)) {
      return {
        success: true,
        alreadyCredited: true,
        status: 'Successful',
        transaction: tx,
        message: 'Transaction has already been credited.'
      };
    }

    // 3. Fetch from Paystack if verification payload wasn't pre-supplied
    let verification = paystackData;
    if (!verification) {
      try {
        verification = await paystackService.verifyTransaction(reference);
      } catch (err) {
        console.warn(`[PaymentReconciliation] Paystack verification error for ${reference}: ${err.message}`);
        // If network or provider error, keep current status without marking failed
        return {
          success: false,
          status: tx ? tx.status : 'Pending',
          transaction: tx,
          error: 'Payment gateway temporarily unreachable. Payment remains in current state.'
        };
      }
    }

    if (!verification) {
      return {
        success: false,
        status: tx ? tx.status : 'Pending',
        transaction: tx,
        message: 'Unable to verify payment status.'
      };
    }

    const paystackStatus = (verification.status || '').toLowerCase();

    // 4. Handle Paystack 'success'
    if (paystackStatus === 'success') {
      // Find matching user
      let user = null;
      if (tx && tx.userId) {
        user = await db.getUserById(tx.userId);
      }
      if (!user && verification.metadata && verification.metadata.userId) {
        user = await db.getUserById(verification.metadata.userId);
      }
      if (!user && verification.email) {
        user = await db.getUserByEmail(verification.email);
      }

      if (!user) {
        console.error(`[PaymentReconciliation] User not found for transaction ${reference}, email: ${verification.email}`);
        return {
          success: false,
          status: 'Failed',
          message: 'Matching user could not be found for this deposit.'
        };
      }

      const depositAmount = parseFloat(verification.amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return {
          success: false,
          status: 'Failed',
          message: 'Invalid deposit amount received from payment provider.'
        };
      }

      // Re-check inside lock right before crediting wallet
      tx = await db.getTransactionByReference(reference);
      if (tx && (tx.status === 'Successful' || tx.credited === true)) {
        return {
          success: true,
          alreadyCredited: true,
          status: 'Successful',
          transaction: tx,
          message: 'Transaction has already been credited.'
        };
      }

      // Authoritative Balance Increment
      const currentBalance = parseFloat(user.walletBalance || 0);
      const currentTotalDeposited = parseFloat(user.totalDeposited || 0);
      user.walletBalance = Math.round((currentBalance + depositAmount) * 100) / 100;
      user.totalDeposited = Math.round((currentTotalDeposited + depositAmount) * 100) / 100;
      await db.saveUser(user);

      const timestamp = verification.paidAt || new Date().toISOString();

      if (tx) {
        tx = await db.updateTransaction(tx.id, {
          status: 'Successful',
          credited: true,
          creditedAt: new Date().toISOString(),
          reconciledBy: triggeredBy,
          amount: depositAmount,
          chargedAmount: verification.chargedAmount || depositAmount,
          fee: verification.fee || 0,
          channel: verification.channel || 'unknown',
          cardType: verification.cardType || null,
          bank: verification.bank || null,
          paystackReference: reference,
          paystackId: verification.paystackId || null,
          balanceAfter: user.walletBalance,
          gatewayResponse: verification.gatewayResponse || 'Successful',
          updatedAt: new Date().toISOString()
        });
      } else {
        tx = {
          id: reference,
          userId: user.id,
          userFullName: user.fullName || 'StrictWallet User',
          userEmail: user.email,
          type: 'deposit',
          amount: depositAmount,
          chargedAmount: verification.chargedAmount || depositAmount,
          fee: verification.fee || 0,
          channel: verification.channel || 'unknown',
          cardType: verification.cardType || null,
          bank: verification.bank || null,
          providerReference: reference,
          paystackReference: reference,
          paystackId: verification.paystackId || null,
          status: 'Successful',
          credited: true,
          creditedAt: new Date().toISOString(),
          reconciledBy: triggeredBy,
          description: `Paystack Deposit (₦${depositAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })})`,
          balanceAfter: user.walletBalance,
          createdAt: timestamp,
          updatedAt: new Date().toISOString()
        };
        await db.createTransaction(tx);
      }

      // Record / Update deposit record
      const depRecord = await db.getDepositByReference(reference);
      if (depRecord) {
        await db.updateDeposit(depRecord.id, {
          status: 'Successful',
          credited: true,
          amount: depositAmount,
          channel: verification.channel || depRecord.channel || 'unknown',
          updatedAt: new Date().toISOString()
        });
      } else {
        await db.saveDeposit({
          id: `DEP-${reference}`,
          reference: reference,
          providerReference: reference,
          paystackReference: reference,
          userId: user.id,
          userEmail: user.email,
          amount: depositAmount,
          status: 'Successful',
          credited: true,
          channel: verification.channel || 'unknown',
          createdAt: timestamp,
          updatedAt: new Date().toISOString()
        });
      }

      console.log(`[PaymentReconciliation] Successfully credited ₦${depositAmount} to user ${user.id} (${user.email}) for ref ${reference} via ${triggeredBy}`);

      return {
        success: true,
        status: 'Successful',
        credited: true,
        newBalance: user.walletBalance,
        transaction: tx
      };
    }

    // 5. Handle Paystack 'failed'
    if (paystackStatus === 'failed') {
      if (tx && !tx.credited) {
        tx = await db.updateTransaction(tx.id, {
          status: 'Failed',
          gatewayResponse: verification.gatewayResponse || 'Payment failed',
          updatedAt: new Date().toISOString()
        });
      }
      return {
        success: false,
        status: 'Failed',
        message: verification.gatewayResponse || 'Payment failed at gateway.',
        transaction: tx
      };
    }

    // 6. Handle Paystack 'abandoned'
    if (paystackStatus === 'abandoned') {
      const createdAt = tx && tx.createdAt ? new Date(tx.createdAt).getTime() : Date.now();
      const ageMinutes = (Date.now() - createdAt) / (1000 * 60);

      // Keep transaction as Pending for up to 24 hours (1440 mins) because Nigerian bank transfers,
      // USSD, and interbank NIP clearance can take 15-45 minutes or longer.
      // Only mark Cancelled if older than 24 hours or if explicitly requested via user_cancel.
      if (ageMinutes > 1440 || triggeredBy === 'user_cancel') {
        if (tx && !tx.credited) {
          tx = await db.updateTransaction(tx.id, {
            status: 'Cancelled',
            gatewayResponse: 'Payment window expired or cancelled by user.',
            updatedAt: new Date().toISOString()
          });
        }
        return {
          success: false,
          status: 'Cancelled',
          message: 'Payment session expired or was cancelled.',
          transaction: tx
        };
      }

      // Preserve Pending state
      if (tx && tx.status !== 'Pending' && !tx.credited) {
        tx = await db.updateTransaction(tx.id, {
          status: 'Pending',
          updatedAt: new Date().toISOString()
        });
      }

      return {
        success: true,
        status: 'Pending',
        message: 'Payment is awaiting completion from your bank or payment channel. Please allow a few minutes for bank settlement.',
        transaction: tx
      };
    }

    // 7. Handle 'processing' or other in-flight states
    if (paystackStatus === 'processing' || paystackStatus === 'ongoing' || paystackStatus === 'queued') {
      if (tx && !tx.credited) {
        tx = await db.updateTransaction(tx.id, {
          status: 'Processing',
          updatedAt: new Date().toISOString()
        });
      }
      return {
        success: true,
        status: 'Processing',
        message: 'Payment is being processed by the bank.',
        transaction: tx
      };
    }

    // Default fallback: preserve current status
    return {
      success: true,
      status: tx ? tx.status : 'Pending',
      transaction: tx,
      message: `Current payment status: ${paystackStatus || 'Pending'}`
    };
  });
}

/**
 * Background auto-reconciliation job.
 * Scans transactions with status 'Pending' or 'Processing' created in the last 24h.
 */
async function runAutomaticReconciliation() {
  try {
    const allTxs = await db.getAllTransactions();
    const now = Date.now();
    const candidateTxs = allTxs.filter(tx => {
      if (!tx || tx.type !== 'deposit') return false;
      if (tx.status !== 'Pending' && tx.status !== 'Processing') return false;
      if (tx.credited === true) return false;

      const createdTime = new Date(tx.createdAt || 0).getTime();
      const ageSeconds = (now - createdTime) / 1000;
      // Must be at least 45 seconds old to prevent racing user actions, and under 24 hours
      return ageSeconds >= 45 && ageSeconds <= 86400;
    });

    if (candidateTxs.length === 0) return;

    // Limit to batch of 10 per cycle
    const batch = candidateTxs.slice(0, 10);
    console.log(`[Auto-Reconciliation] Checking ${batch.length} pending/processing deposit(s)...`);

    for (const tx of batch) {
      const ref = tx.providerReference || tx.reference || tx.paystackReference || tx.id;
      if (!ref) continue;

      try {
        await reconcileDepositTransaction({ reference: ref, triggeredBy: 'background_worker' });
      } catch (err) {
        console.warn(`[Auto-Reconciliation] Error reconciling ref ${ref}: ${err.message}`);
      }

      // Throttle 500ms between calls to avoid hitting Paystack rate limits
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.error('[Auto-Reconciliation Worker Error]:', err.message);
  }
}

let workerIntervalId = null;

function startPaymentReconciliationWorker(intervalMs = 180000) { // Every 3 minutes
  if (workerIntervalId) return;
  console.log(`[Payment Reconciliation Worker] Started (interval: ${intervalMs / 1000}s).`);
  workerIntervalId = setInterval(runAutomaticReconciliation, intervalMs);
  // Also run initial check after 15 seconds
  setTimeout(runAutomaticReconciliation, 15000);
}

function stopPaymentReconciliationWorker() {
  if (workerIntervalId) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    console.log('[Payment Reconciliation Worker] Stopped.');
  }
}

module.exports = {
  reconcileDepositTransaction,
  runAutomaticReconciliation,
  startPaymentReconciliationWorker,
  stopPaymentReconciliationWorker
};
