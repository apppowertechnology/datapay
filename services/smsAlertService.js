const db = require('../db');
const { sendAlertSms } = require('./strowallet');

// In-memory mutex lock map for idempotency
const activeSmsLocks = new Map();

async function withSmsLock(key, fn) {
  const lockKey = (key || '').trim();
  if (!lockKey) return fn();

  while (activeSmsLocks.has(lockKey)) {
    try {
      await activeSmsLocks.get(lockKey);
    } catch (_) {}
  }

  let resolveLock;
  const lockPromise = new Promise(resolve => { resolveLock = resolve; });
  activeSmsLocks.set(lockKey, lockPromise);

  try {
    return await fn();
  } finally {
    activeSmsLocks.delete(lockKey);
    resolveLock();
  }
}

/**
 * Format numeric amount dynamically and cleanly without trailing zeroes.
 * E.g., 5000 -> "5000", 250 -> "250", 250.5 -> "250.5", 250.75 -> "250.75"
 */
function formatSmsAmount(amount) {
  if (amount === undefined || amount === null) return '0';
  const clean = typeof amount === 'string' ? amount.replace(/[^0-9.-]/g, '') : amount;
  const num = typeof clean === 'number' ? clean : parseFloat(clean);
  if (isNaN(num)) return '0';
  if (Number.isInteger(num)) {
    return num.toString();
  }
  return parseFloat(num.toFixed(2)).toString();
}

/**
 * Format outgoing description for Strowallet SMS (Max 20 chars)
 * Formats:
 * - Credit: "Credited ₦{amount}"
 * - Debit: "Debited ₦{amount}"
 *
 * Examples:
 * - "Credited ₦5000"
 * - "Debited ₦1500"
 * - "Credited ₦10000"
 * - "Debited ₦250"
 */
function getProviderSmsDescription(alertType, amount) {
  const isCredit = String(alertType).toLowerCase().trim() === 'credit';
  const prefix = isCredit ? 'Credited ₦' : 'Debited ₦';
  const clean = typeof amount === 'string' ? amount.replace(/[^0-9.-]/g, '') : amount;
  const num = typeof clean === 'number' ? clean : parseFloat(clean);
  if (isNaN(num)) return `${prefix}0`;

  // 1. Standard clean formatted amount
  let amtStr = formatSmsAmount(num);
  let desc = `${prefix}${amtStr}`;

  // 2. If exceeding 20 characters, use a shorter numeric format without changing value
  if (desc.length > 20) {
    const exp = num.toExponential().replace('+', '');
    if (Number(exp) === num && `${prefix}${exp}`.length <= 20) {
      desc = `${prefix}${exp}`;
    }
  }

  // 3. Safety guarantee: never truncate the amount and never exceed 20 characters
  if (desc.length > 20) {
    throw new Error(`SMS alert description exceeds 20 characters without truncation: "${desc}"`);
  }

  return desc;
}

/**
 * Trigger transactional SMS alert for an eligible successful transaction.
 *
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {'credit'|'debit'} params.alertType - 'credit' or 'debit'
 * @param {number} params.amount - Transaction amount
 * @param {number} params.userBalance - Applicable balance after transaction
 * @param {'main'|'organizer'} [params.balanceType='main'] - 'main' for Main Wallet, 'organizer' for Event Creator Wallet
 * @param {string} params.desc - Narration / description
 * @param {string} params.reference - Unique transaction reference (for idempotency)
 * @param {string} params.transactionType - Type of transaction (deposit, airtime, data, ticket_purchase, creator_credit, creator_withdrawal, withdrawal)
 */
async function sendTransactionalAlert({
  userId,
  alertType,
  amount,
  userBalance,
  balanceType = 'main',
  desc,
  reference,
  transactionType
}) {
  if (!userId || !alertType || amount === undefined || userBalance === undefined || !reference) {
    console.warn('[SMS Alert Service] Missing required parameters. Skipping alert.');
    return { skipped: true, reason: 'missing_parameters' };
  }

  const lockKey = `sms_${reference}_${alertType}`;

  return withSmsLock(lockKey, async () => {
    // 1. Idempotency Check: Verify if an SMS has already been recorded for this reference and alertType
    const existingAlerts = await db.getAllSmsAlerts();
    const alreadyProcessed = existingAlerts.some(a => 
      a && a.reference === reference && a.alertType === alertType && (a.status === 'sent' || a.status === 'timeout' || a.status === 'uncertain')
    );
    if (alreadyProcessed) {
      console.log(`[SMS Alert Service] Alert already processed for reference: ${reference} (${alertType}). Skipping duplicate.`);
      return { skipped: true, reason: 'already_processed' };
    }

    // 2. Fetch User & Check SMS Preferences
    const user = await db.getUserById(userId);
    if (!user) {
      console.warn(`[SMS Alert Service] User not found: ${userId}. Skipping alert.`);
      return { skipped: true, reason: 'user_not_found' };
    }

    // Check if user has SMS alerts turned ON (default is false until explicitly turned ON)
    if (user.smsAlertsEnabled !== true) {
      console.log(`[SMS Alert Service] SMS alerts disabled by user ${userId}. Skipping.`);
      return { skipped: true, reason: 'alerts_disabled' };
    }

    // Ensure user has a valid phone number
    const phone = user.phone;
    if (!phone || String(phone).trim().length < 10) {
      console.warn(`[SMS Alert Service] User ${userId} has no valid phone number. Skipping alert.`);
      return { skipped: true, reason: 'invalid_phone' };
    }

    // 3. Check existing wallet balance (₦10 required per alert)
    const SMS_CHARGE = 10.00;
    const PROVIDER_COST = 6.00;
    const GROSS_PROFIT = 4.00;

    const currentWalletBalance = parseFloat(user.walletBalance || 0);

    // If the user has insufficient available wallet funds to pay for the SMS,
    // do not allow the SMS charge to make their wallet balance negative.
    // Skip the paid SMS alert until the user has sufficient funds.
    if (currentWalletBalance < SMS_CHARGE) {
      console.log(`[SMS Alert Service] Insufficient wallet funds (₦${currentWalletBalance.toFixed(2)} < ₦${SMS_CHARGE.toFixed(2)}) for user ${userId}. Skipping paid SMS alert.`);
      return { skipped: true, reason: 'insufficient_wallet_balance' };
    }

    // 4. Format description strictly <= 20 characters for provider: "Credited ₦{amount}" or "Debited ₦{amount}"
    let providerDesc;
    try {
      providerDesc = getProviderSmsDescription(alertType, amount);
    } catch (descErr) {
      console.warn(`[SMS Alert Service] Description validation failed for user ${userId}:`, descErr.message);
      return { skipped: true, reason: 'desc_length_exceeded' };
    }
    const alertId = `SMS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 5. Call Strowallet SMS API
    try {
      const smsResult = await sendAlertSms({
        phone: phone,
        alertType: alertType,
        amount: amount,
        userBalance: userBalance,
        desc: providerDesc
      });

      if (smsResult.success) {
        // Confirmed delivery by provider!
        // Deduct ₦10 directly from customer's existing STRICTWALLET wallet balance
        user.walletBalance = Math.round((currentWalletBalance - SMS_CHARGE) * 100) / 100;
        await db.saveUser(user);

        // Record SMS Alert audit log
        const alertRecord = {
          id: alertId,
          userId: user.id,
          userFullName: user.fullName || 'STRICTWALLET User',
          userPhone: phone,
          reference: reference,
          transactionType: transactionType,
          alertType: alertType,
          amount: parseFloat(amount),
          userBalance: parseFloat(userBalance),
          balanceType: balanceType,
          desc: providerDesc,
          customerCharge: SMS_CHARGE,
          providerCost: PROVIDER_COST,
          profit: GROSS_PROFIT,
          status: 'sent',
          providerResponse: smsResult.raw || null,
          createdAt: new Date().toISOString()
        };
        await db.createSmsAlertRecord(alertRecord);

        // Record in existing transactions ledger
        await db.createTransaction({
          id: `TXN-SMS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          userId: user.id,
          userFullName: user.fullName,
          userEmail: user.email,
          type: 'sms_charge',
          amount: SMS_CHARGE,
          costPrice: PROVIDER_COST,
          profit: GROSS_PROFIT,
          status: 'Successful',
          providerReference: alertId,
          relatedReference: reference,
          description: `Transaction SMS Alert (${providerDesc})`,
          balanceBefore: currentWalletBalance,
          balanceAfter: user.walletBalance,
          createdAt: new Date().toISOString()
        });

        console.info(`[SMS Alert Service] Successfully sent SMS and charged ₦10 (Profit: ₦4) from wallet for user ${user.id}, ref: ${reference}`);
        return { success: true, alertId, customerCharge: SMS_CHARGE, profit: GROSS_PROFIT };
      } else if (smsResult.timeout || smsResult.outcome === 'uncertain') {
        // Timed out: outcome cannot be confirmed
        // Do not blindly retry. Do not charge customer. Do not record profit.
        console.warn(`[SMS Alert Service] Provider timed out for user ${user.id}, ref: ${reference}. Outcome uncertain; no charge applied.`);
        await db.createSmsAlertRecord({
          id: alertId,
          userId: user.id,
          userFullName: user.fullName || 'STRICTWALLET User',
          userPhone: phone,
          reference: reference,
          transactionType: transactionType,
          alertType: alertType,
          amount: parseFloat(amount),
          userBalance: parseFloat(userBalance),
          balanceType: balanceType,
          desc: providerDesc,
          customerCharge: 0,
          providerCost: 0,
          profit: 0,
          status: 'timeout',
          outcome: 'uncertain',
          failureReason: smsResult.message || 'SMS request timed out. Outcome unconfirmed.',
          providerResponse: smsResult.raw || null,
          createdAt: new Date().toISOString()
        });
        return { success: false, timeout: true, outcome: 'uncertain', reason: smsResult.message };
      } else {
        // Provider rejected or failed
        // Do not charge customer. Do not record profit.
        console.warn(`[SMS Alert Service] SMS rejected by provider for user ${user.id}: ${smsResult.message}`);
        if (typeof smsResult.message === 'string' && (smsResult.message.toLowerCase().includes('sender id') || smsResult.message.toLowerCase().includes('not active'))) {
          console.warn(`[SMS Alert Service] SMS delivery failed: Sender ID is awaiting manual verification/activation by Strowallet support.`);
        }
        await db.createSmsAlertRecord({
          id: alertId,
          userId: user.id,
          userFullName: user.fullName || 'STRICTWALLET User',
          userPhone: phone,
          reference: reference,
          transactionType: transactionType,
          alertType: alertType,
          amount: parseFloat(amount),
          userBalance: parseFloat(userBalance),
          balanceType: balanceType,
          desc: providerDesc,
          customerCharge: 0,
          providerCost: 0,
          profit: 0,
          status: 'failed',
          failureReason: smsResult.message || 'Provider rejected SMS',
          providerResponse: smsResult.raw || null,
          createdAt: new Date().toISOString()
        });
        return { success: false, reason: smsResult.message };
      }
    } catch (err) {
      console.error('[SMS Alert Service] Unexpected error processing SMS:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  sendTransactionalAlert,
  formatSmsAmount,
  getProviderSmsDescription
};
