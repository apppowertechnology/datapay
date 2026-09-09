const axios = require('axios');

const STROWALLET_PUBLIC_KEY = process.env.STROWALLET_PUBLIC_KEY;
const STROWALLET_SECRET_KEY = process.env.STROWALLET_SECRET_KEY;
const STROWALLET_BASE_URL = process.env.STROWALLET_BASE_URL || 'https://strowallet.com/api/virtual-bank';
// Optional bank type for virtual account creation (e.g., 'sterling', 'paga', 'amucha', 'fidelitybank')
const STROWALLET_BANK_TYPE = process.env.STROWALLET_BANK_TYPE || 'sterling';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://strictwallet.com/api/webhook/strowallet';


/** Verify a bank account number against the provider. */
async function verifyAccount(bankCode, accountNumber) {
  if (!bankCode || !accountNumber) {
    throw new Error('Bank code and account number are required');
  }
  try {
    const payload = {
      public_key: STROWALLET_PUBLIC_KEY,
      secret_key: STROWALLET_SECRET_KEY,
      bank_code: bankCode,
      account_number: accountNumber
    };
    const endpoint = `${STROWALLET_BASE_URL}/account/verify`;
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STROWALLET_SECRET_KEY}`,
        'Public-Key': STROWALLET_PUBLIC_KEY
      },
      timeout: 10000
    });
    const data = response.data;
    console.info('[Strowallet Verify] Request successful:', {
      bankCode,
      accountNumber: `${accountNumber.substring(0, 4)}****`
    });
    return { success: true, data };
  } catch (error) {
    console.warn('[Strowallet Verify Error]:', error.response ? error.response.data : error.message);
    return { success: false, message: error.response ? error.response.data.message : error.message };
  }
}

module.exports = {
  verifyAccount
};
