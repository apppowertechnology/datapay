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

      // Trigger Transactional SMS Credit Alert asynchronously
      try {
        const { sendTransactionalAlert } = require('./smsAlertService');
        sendTransactionalAlert({
          userId: user.id,
          alertType: 'credit',
          amount: depositAmount,
          userBalance: user.walletBalance,
          balanceType: 'main',
          desc: `Credited ₦${depositAmount}`,
          reference: reference,
          transactionType: 'deposit'
        }).catch(err => console.error('[Paystack SMS Alert Error]:', err.message));
      } catch (smsErr) {
        console.warn('[PaymentReconciliation] SMS alert error:', smsErr.message);
      }

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
        const isVirtualAccount = tx.channel === 'virtual_account' || tx.bank === 'Sterling Bank' || Boolean(tx.sessionId);
        if (isVirtualAccount) {
          console.info(`[Auto-Reconciliation] Attempting Strowallet session re-verification for ${tx.sessionId || ref}...`);
          const transferPayload = tx.raw || {
            sessionId: tx.sessionId || ref,
            accountNumber: tx.virtualAccountNumber,
            amount: tx.grossAmount ?? tx.amount,
            settledAmount: tx.availableAmount ?? tx.grossAmount ?? tx.amount,
            currency: tx.currency || 'NGN'
          };
          await reconcileStrowalletTransfer(transferPayload);
        } else {
          await reconcileDepositTransaction({ reference: ref, triggeredBy: 'background_worker' });
        }
      } catch (err) {
        console.warn(`[Auto-Reconciliation] Error reconciling ref ${ref}: ${err.message}`);
      }

      // Throttle 500ms between calls to avoid hitting rate limits
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

/**
 * Authoritative, idempotent reconciliation function for Strowallet Sterling Bank virtual account transfers.
 * Strictly charges ₦25 per successfully verified incoming transfer.
 *
 * @param {object} payload - Incoming Strowallet webhook payload
 * @returns {Promise<{
 *   success: boolean,
 *   status: string,
 *   credited?: boolean,
 *   alreadyCredited?: boolean,
 *   newBalance?: number,
 *   transaction?: object,
 *   message?: string
 * }>}
 */
/**
 * Authoritative, idempotent reconciliation function for Strowallet Sterling Bank virtual account transfers.
 * Strictly charges ₦25 per successfully verified incoming transfer.
 *
 * @param {object} payload - Incoming Strowallet webhook payload
 * @param {object} [options] - Reconciliation options (e.g. { skipVerification: boolean })
 * @returns {Promise<{
 *   success: boolean,
 *   status: string,
 *   credited?: boolean,
 *   alreadyCredited?: boolean,
 *   newBalance?: number,
 *   transaction?: object,
 *   message?: string,
 *   unconfirmed?: boolean,
 *   timeout?: boolean
 * }>}
 */
async function reconcileStrowalletTransfer(payload, options = {}) {
  if (!payload) {
    return { success: false, status: 'Failed', message: 'No payload provided' };
  }

  // Support unwrapping if nested inside data or response
  const data = (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object')
    ? payload.data
    : (payload && typeof payload === 'object' && payload.response && typeof payload.response === 'object')
      ? payload.response
      : (payload || {});

  const sessionId = String(
    data.sessionId || data.session_id || data.sessionID || data.reference ||
    payload.sessionId || payload.session_id || payload.sessionID || payload.reference || ''
  ).trim();

  const accountNumber = String(
    data.accountNumber || data.account_number || data.account ||
    payload.accountNumber || payload.account_number || payload.account || ''
  ).trim();

  const rawTransactionAmount = data.transactionAmount ?? data.transaction_amount ?? data.amount ??
    payload.transactionAmount ?? payload.transaction_amount ?? payload.amount;

  const rawSettledAmount = data.settledAmount ?? data.settled_amount ??
    payload.settledAmount ?? payload.settled_amount;

  const rawFeeAmount = data.feeAmount ?? data.fee_amount ??
    payload.feeAmount ?? payload.fee_amount;

  const rawVatAmount = data.vatAmount ?? data.vat_amount ??
    payload.vatAmount ?? payload.vat_amount;

  const currency = String(data.currency || payload.currency || 'NGN').trim().toUpperCase();

  const initiationTranRef = (data.initiationTranRef && data.initiationTranRef !== 'null')
    ? String(data.initiationTranRef).trim()
    : (payload.initiationTranRef && payload.initiationTranRef !== 'null' ? String(payload.initiationTranRef).trim() : null);

  const settlementId = (data.settlementId && data.settlementId !== 'null')
    ? String(data.settlementId).trim()
    : (payload.settlementId && payload.settlementId !== 'null' ? String(payload.settlementId).trim() : null);

  if (!sessionId) {
    return { success: false, status: 'Failed', message: 'Missing sessionId in transfer notification' };
  }
  if (!accountNumber) {
    return { success: false, status: 'Failed', message: 'Missing accountNumber in transfer notification' };
  }

  return withLock(sessionId, async () => {
    // 1. Idempotency Check: verify if already credited by sessionId, initiationTranRef, or settlementId
    let tx = await db.getTransactionByReference(sessionId);
    if (!tx && initiationTranRef) {
      tx = await db.getTransactionByReference(initiationTranRef);
    }
    if (!tx && settlementId) {
      tx = await db.getTransactionByReference(settlementId);
    }

    if (tx && (tx.status === 'Successful' || tx.credited === true)) {
      console.log(`[PaymentReconciliation] Strowallet transfer ${sessionId} already processed and credited.`);
      return {
        success: true,
        alreadyCredited: true,
        status: 'Successful',
        transaction: tx,
        message: 'Transfer has already been processed.'
      };
    }

    // 2. Validate Currency: STRICTWALLET wallet operates strictly in NGN
    if (currency !== 'NGN') {
      console.warn(`[PaymentReconciliation] Rejected non-NGN transfer currency (${currency}) for session: ${sessionId}`);
      return {
        success: false,
        status: 'Failed',
        message: `Unsupported transfer currency: ${currency}. Only NGN transfers are supported.`
      };
    }

    // 3. Identify the matching STRICTWALLET user by virtual account number
    let user = await db.getUserByVirtualAccount(accountNumber);
    if (!user && (data.email || payload.email)) {
      user = await db.getUserByEmail(data.email || payload.email);
    }
    if (!user && (data.phone || payload.phone)) {
      user = await db.getUserByPhone(data.phone || payload.phone);
    }

    if (!user) {
      const maskedAcc = accountNumber.length > 4 ? `****${accountNumber.slice(-4)}` : '****';
      console.error(`[PaymentReconciliation] No user found for virtual account: ${maskedAcc} (session: ${sessionId})`);
      return {
        success: false,
        status: 'Failed',
        message: `No matching user found for virtual account number ${accountNumber}`
      };
    }

    // 4. Validate Amount
    // The gross amount transferred by the payer
    const incomingGross = parseFloat(rawTransactionAmount ?? rawSettledAmount);
    if (isNaN(incomingGross) || incomingGross <= 0) {
      console.error(`[PaymentReconciliation] Invalid gross transfer amount: ${rawTransactionAmount} for session: ${sessionId}`);
      return {
        success: false,
        status: 'Failed',
        message: 'Invalid transfer amount'
      };
    }

    // 5. Authoritative Session Verification via Strowallet Verify SessionID API
    // Endpoint: GET https://strowallet.com/api/verifysessionid/?public_key=...&amount=...&sessionID=...
    if (!options.skipVerification) {
      const { verifySessionId } = require('./strowallet');
      const verifyRes = await verifySessionId(sessionId, incomingGross);

      if (!verifyRes.success) {
        if (verifyRes.timeout) {
          console.warn(`[PaymentReconciliation] Provider verification timed out for session ${sessionId}. Keeping transaction Pending.`);

          // Record or maintain Pending deposit record in database without crediting wallet
          const pendingTx = {
            id: sessionId,
            userId: user.id,
            userFullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'STRICTWALLET User',
            userEmail: user.email,
            type: 'deposit',
            channel: 'virtual_account',
            bank: 'Sterling Bank',
            virtualAccountNumber: accountNumber,
            amount: Math.max(0, Math.round((incomingGross - 25.00) * 100) / 100),
            grossAmount: incomingGross,
            availableAmount: (rawSettledAmount && !isNaN(parseFloat(rawSettledAmount)) && parseFloat(rawSettledAmount) > 0)
              ? parseFloat(rawSettledAmount)
              : incomingGross,
            chargedAmount: incomingGross,
            fee: 25.00,
            providerFee: parseFloat(rawFeeAmount || 0),
            vatAmount: parseFloat(rawVatAmount || 0),
            currency: currency,
            providerReference: sessionId,
            sessionId: sessionId,
            initiationTranRef: initiationTranRef,
            settlementId: settlementId,
            sourceAccountNumber: data.sourceAccountNumber || payload.sourceAccountNumber || null,
            sourceAccountName: data.sourceAccountName || payload.sourceAccountName || null,
            sourceBankName: data.sourceBankName || payload.sourceBankName || null,
            channelId: data.channelId || payload.channelId || null,
            status: 'Pending',
            credited: false,
            description: `Sterling Bank Virtual Account Transfer (Pending Verification - Provider Timed Out)`,
            raw: payload,
            createdAt: data.tranDateTime || payload.tranDateTime || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          if (!tx) {
            await db.createTransaction(pendingTx);
          } else {
            await db.updateTransaction(tx.id, {
              status: 'Pending',
              updatedAt: new Date().toISOString()
            });
          }

          // Ensure pending deposit record is also preserved
          await db.saveDeposit({
            id: `DEP-VA-${sessionId}`,
            reference: sessionId,
            providerReference: sessionId,
            userId: user.id,
            userEmail: user.email,
            amount: pendingTx.amount,
            grossAmount: incomingGross,
            fee: 25.00,
            channel: 'virtual_account',
            bank: 'Sterling Bank',
            status: 'Pending',
            credited: false,
            createdAt: pendingTx.createdAt,
            updatedAt: new Date().toISOString()
          });

          return {
            success: false,
            timeout: true,
            status: 'Pending',
            message: 'Strowallet session verification timed out. Notification recorded as Pending for retry.'
          };
        }

        console.warn(`[PaymentReconciliation] Session verification failed at provider for session ${sessionId}: ${verifyRes.message}`);

        const unconfirmedTx = {
          id: sessionId,
          userId: user.id,
          userFullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'STRICTWALLET User',
          userEmail: user.email,
          type: 'deposit',
          channel: 'virtual_account',
          bank: 'Sterling Bank',
          virtualAccountNumber: accountNumber,
          amount: 0,
          grossAmount: incomingGross,
          availableAmount: (rawSettledAmount && !isNaN(parseFloat(rawSettledAmount)) && parseFloat(rawSettledAmount) > 0)
            ? parseFloat(rawSettledAmount)
            : incomingGross,
          chargedAmount: incomingGross,
          fee: 25.00,
          providerFee: parseFloat(rawFeeAmount || 0),
          vatAmount: parseFloat(rawVatAmount || 0),
          currency: currency,
          providerReference: sessionId,
          sessionId: sessionId,
          initiationTranRef: initiationTranRef,
          settlementId: settlementId,
          sourceAccountNumber: data.sourceAccountNumber || payload.sourceAccountNumber || null,
          sourceAccountName: data.sourceAccountName || payload.sourceAccountName || null,
          sourceBankName: data.sourceBankName || payload.sourceBankName || null,
          channelId: data.channelId || payload.channelId || null,
          status: 'Failed',
          credited: false,
          description: `Sterling Bank Virtual Account Transfer (Unconfirmed: ${verifyRes.message || 'Transaction not received at provider'})`,
          raw: payload,
          createdAt: data.tranDateTime || payload.tranDateTime || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (!tx) {
          await db.createTransaction(unconfirmedTx);
        } else {
          await db.updateTransaction(tx.id, {
            status: 'Failed',
            description: unconfirmedTx.description,
            updatedAt: new Date().toISOString()
          });
        }

        return {
          success: false,
          status: 'Failed',
          unconfirmed: true,
          message: `Strowallet session verification failed: ${verifyRes.message}`
        };
      }
    }

    const STRICTWALLET_TRANSFER_FEE = 25.00;

    const availableAmount = (rawSettledAmount && !isNaN(parseFloat(rawSettledAmount)) && parseFloat(rawSettledAmount) > 0)
      ? parseFloat(rawSettledAmount)
      : incomingGross;

    // Safe transaction policy: If gross amount is <= fixed ₦25 fee, do not create negative/zero wallet credit
    if (incomingGross <= STRICTWALLET_TRANSFER_FEE) {
      console.warn(`[PaymentReconciliation] Incoming transfer ₦${incomingGross} is <= fixed charge ₦${STRICTWALLET_TRANSFER_FEE}. Creating audit record without wallet credit.`);

      const failedTx = {
        id: sessionId,
        userId: user.id,
        userFullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'STRICTWALLET User',
        userEmail: user.email,
        type: 'deposit',
        channel: 'virtual_account',
        bank: 'Sterling Bank',
        virtualAccountNumber: accountNumber,
        amount: 0,
        grossAmount: incomingGross,
        availableAmount: availableAmount,
        chargedAmount: incomingGross,
        fee: STRICTWALLET_TRANSFER_FEE,
        providerFee: parseFloat(rawFeeAmount || 0),
        vatAmount: parseFloat(rawVatAmount || 0),
        currency: currency,
        providerReference: sessionId,
        sessionId: sessionId,
        initiationTranRef: initiationTranRef,
        settlementId: settlementId,
        status: 'Failed',
        credited: false,
        description: `Sterling Bank Virtual Account Transfer (Gross: ₦${incomingGross.toFixed(2)} is <= ₦25.00 fixed charge. Wallet not credited.)`,
        createdAt: data.tranDateTime || payload.tranDateTime || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.createTransaction(failedTx);

      return {
        success: false,
        status: 'Failed',
        message: `Incoming transfer amount of ₦${incomingGross.toFixed(2)} is less than or equal to the ₦25.00 processing charge.`
      };
    }

    // Net credit after exactly ₦25 STRICTWALLET charge
    const netCredit = Math.round((incomingGross - STRICTWALLET_TRANSFER_FEE) * 100) / 100;

    // Re-check inside lock right before crediting wallet
    tx = await db.getTransactionByReference(sessionId);
    if (tx && (tx.status === 'Successful' || tx.credited === true)) {
      return {
        success: true,
        alreadyCredited: true,
        status: 'Successful',
        transaction: tx,
        message: 'Transfer has already been credited.'
      };
    }

    // 6. Authoritative Atomic Balance Increment with Firebase Realtime Database
    let creditedUser = user;
    let balanceBefore = parseFloat(user.walletBalance || 0);
    let balanceAfter = balanceBefore + netCredit;

    if (typeof db.atomicCreditUserWallet === 'function') {
      const creditRes = await db.atomicCreditUserWallet(user.id, netCredit);
      creditedUser = creditRes.user;
      balanceBefore = creditRes.balanceBefore;
      balanceAfter = creditRes.balanceAfter;
    } else {
      const freshUser = await db.getUserById(user.id) || user;
      balanceBefore = parseFloat(freshUser.walletBalance || 0);
      const currentTotalDeposited = parseFloat(freshUser.totalDeposited || 0);
      freshUser.walletBalance = Math.round((balanceBefore + netCredit) * 100) / 100;
      freshUser.totalDeposited = Math.round((currentTotalDeposited + netCredit) * 100) / 100;
      creditedUser = await db.saveUser(freshUser);
      balanceAfter = creditedUser.walletBalance;
    }

    const timestamp = data.tranDateTime || payload.tranDateTime || new Date().toISOString();

    // 7. Create Ledger Transaction Record
    tx = {
      id: sessionId,
      userId: creditedUser.id,
      userFullName: creditedUser.fullName || `${creditedUser.firstName || ''} ${creditedUser.lastName || ''}`.trim() || 'STRICTWALLET User',
      userEmail: creditedUser.email,
      type: 'deposit',
      channel: 'virtual_account',
      bank: 'Sterling Bank',
      virtualAccountNumber: accountNumber,
      amount: netCredit,
      grossAmount: incomingGross,
      availableAmount: availableAmount,
      chargedAmount: incomingGross,
      fee: STRICTWALLET_TRANSFER_FEE,
      providerFee: parseFloat(rawFeeAmount || 0),
      vatAmount: parseFloat(rawVatAmount || 0),
      currency: currency,
      providerReference: sessionId,
      sessionId: sessionId,
      initiationTranRef: initiationTranRef,
      settlementId: settlementId,
      sourceAccountNumber: data.sourceAccountNumber || payload.sourceAccountNumber || null,
      sourceAccountName: data.sourceAccountName || payload.sourceAccountName || null,
      sourceBankName: data.sourceBankName || payload.sourceBankName || null,
      channelId: data.channelId || payload.channelId || null,
      status: 'Successful',
      credited: true,
      creditedAt: new Date().toISOString(),
      reconciledBy: 'strowallet_webhook',
      description: `Sterling Bank Virtual Account Transfer (Gross: ₦${incomingGross.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, Fee: ₦25.00, Credited: ₦${netCredit.toLocaleString('en-NG', { minimumFractionDigits: 2 })})`,
      balanceBefore: balanceBefore,
      balanceAfter: balanceAfter,
      raw: payload,
      createdAt: timestamp,
      updatedAt: new Date().toISOString()
    };
    await db.createTransaction(tx);

    // 8. Record Deposit Entry
    await db.saveDeposit({
      id: `DEP-VA-${sessionId}`,
      reference: sessionId,
      providerReference: sessionId,
      userId: creditedUser.id,
      userEmail: creditedUser.email,
      amount: netCredit,
      grossAmount: incomingGross,
      fee: STRICTWALLET_TRANSFER_FEE,
      channel: 'virtual_account',
      bank: 'Sterling Bank',
      status: 'Successful',
      credited: true,
      createdAt: timestamp,
      updatedAt: new Date().toISOString()
    });

    console.info(`[PaymentReconciliation] Successfully credited ₦${netCredit} (Gross: ₦${incomingGross}, Fee: ₦25) to user ${creditedUser.id} (${creditedUser.email}) via Sterling Bank VA ${accountNumber}`);

    // Trigger Transactional SMS Credit Alert asynchronously
    try {
      const { sendTransactionalAlert } = require('./smsAlertService');
      sendTransactionalAlert({
        userId: creditedUser.id,
        alertType: 'credit',
        amount: netCredit,
        userBalance: balanceAfter,
        balanceType: 'main',
        desc: `Credited ₦${netCredit}`,
        reference: sessionId,
        transactionType: 'deposit'
      }).catch(err => console.error('[Sterling VA SMS Alert Error]:', err.message));
    } catch (smsErr) {
      console.warn('[PaymentReconciliation] SMS alert error:', smsErr.message);
    }

    return {
      success: true,
      status: 'Successful',
      credited: true,
      newBalance: balanceAfter,
      transaction: tx
    };
  });
}

module.exports = {
  reconcileDepositTransaction,
  reconcileStrowalletTransfer,
  runAutomaticReconciliation,
  startPaymentReconciliationWorker,
  stopPaymentReconciliationWorker
};
