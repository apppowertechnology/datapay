const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Initialize a Paystack transaction for wallet funding.
 * @param {number} amount Amount in Naira (NGN). Paystack expects kobo, so multiply by 100.
 * @param {string} email Customer email for reference.
 * @returns {Promise<{reference:string, authorization_url:string}>}
 */
async function initializeTransaction(amount, email) {
  const payload = {
    email,
    amount: Math.round(amount * 100), // Convert to kobo
    reference: `STW-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
  };
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
 * Verify a Paystack transaction after customer completes checkout.
 * @param {string} reference Transaction reference returned by initialize.
 * @returns {Promise<{status:string, amount:number, email:string}>}
 */
async function verifyTransaction(reference) {
  const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const data = response.data;
  if (!data || !data.data) {
    throw new Error('Paystack verification failed');
  }
  return {
    status: data.data.status,
    amount: data.data.amount / 100,
    email: data.data.customer.email
  };
}

module.exports = {
  initializeTransaction,
  verifyTransaction
};
