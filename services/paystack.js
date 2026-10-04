const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Initialize a Paystack transaction for wallet funding.
 * @param {number} amount Amount in Naira (NGN). Paystack expects kobo, so multiply by 100.
 * @param {string} email Customer email for reference.
 * @param {object} metadata Optional metadata to attach to the transaction.
 * @param {string} callbackUrl Optional return URL for Paystack redirect checkout.
 * @returns {Promise<{reference:string, authorization_url:string}>}
 */
async function initializeTransaction(amount, email, metadata = {}, callbackUrl = null) {
  const reference = `STW-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const payload = {
    email,
    amount: Math.round(amount * 100), // Convert to kobo
    reference,
    metadata: {
      ...metadata,
      depositAmount: amount,
      platform: 'STRICTWALLET',
      custom_fields: [
        { display_name: 'Platform', variable_name: 'platform', value: 'STRICTWALLET' },
        ...(metadata.userId ? [{ display_name: 'User ID', variable_name: 'user_id', value: metadata.userId }] : [])
      ]
    }
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  const response = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, payload, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const data = response.data;
  if (!data || !data.data) {
    throw new Error('Paystack initialization failed');
  }

  return {
    reference: data.data.reference,
    authorization_url: data.data.authorization_url
  };
}

/**
 * Verify a Paystack transaction after customer completes checkout or via webhook / reconciliation.
 * @param {string} reference Transaction reference returned by initialize.
 * @returns {Promise<{
 *   status: string,
 *   amount: number,
 *   chargedAmount: number,
 *   fee: number,
 *   email: string,
 *   channel: string,
 *   cardType: string|null,
 *   bank: string|null,
 *   paidAt: string|null,
 *   gatewayResponse: string,
 *   paystackId: number|string,
 *   metadata: object,
 *   raw: object
 * }>}
 */
async function verifyTransaction(reference) {
  const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });

  const data = response.data;
  if (!data || !data.data) {
    throw new Error('Paystack verification failed');
  }

  // Determine intended wallet deposit amount in kobo:
  // 1. If metadata has depositAmount, that is the exact user-specified funding amount.
  // 2. Otherwise use requested_amount if provided by Paystack.
  // 3. Fallback to total charged amount.
  let depositKobo;
  if (data.data.metadata && data.data.metadata.depositAmount) {
    depositKobo = Math.round(parseFloat(data.data.metadata.depositAmount) * 100);
  } else if (data.data.requested_amount && data.data.requested_amount > 0) {
    depositKobo = data.data.requested_amount;
  } else {
    depositKobo = data.data.amount;
  }

  return {
    status: data.data.status, // 'success', 'failed', 'abandoned', etc.
    amount: depositKobo / 100,
    chargedAmount: data.data.amount ? data.data.amount / 100 : (depositKobo / 100),
    fee: data.data.fees ? data.data.fees / 100 : 0,
    email: data.data.customer ? data.data.customer.email : '',
    channel: data.data.channel || 'unknown',
    cardType: data.data.authorization ? (data.data.authorization.card_type || data.data.authorization.brand || null) : null,
    bank: data.data.authorization ? (data.data.authorization.bank || null) : null,
    paidAt: data.data.paid_at || data.data.paidAt || null,
    gatewayResponse: data.data.gateway_response || '',
    paystackId: data.data.id,
    metadata: data.data.metadata || {},
    raw: data.data
  };
}

module.exports = {
  initializeTransaction,
  verifyTransaction
};
