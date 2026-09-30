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
      public_key: process.env.STROWALLET_PUBLIC_KEY || STROWALLET_PUBLIC_KEY,
      secret_key: process.env.STROWALLET_SECRET_KEY || STROWALLET_SECRET_KEY,
      bank_code: bankCode,
      account_number: accountNumber
    };
    const endpoint = `${STROWALLET_BASE_URL}/account/verify`;
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.STROWALLET_SECRET_KEY || STROWALLET_SECRET_KEY}`,
        'Public-Key': process.env.STROWALLET_PUBLIC_KEY || STROWALLET_PUBLIC_KEY
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

let cachedBanks = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

// Load offline fallback bank list from saved strowalletBanks.json if present
let fallbackBanks = [];
try {
  const fs = require('fs');
  const path = require('path');
  const fallbackPath = path.join(__dirname, 'strowalletBanks.json');
  if (fs.existsSync(fallbackPath)) {
    fallbackBanks = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  }
} catch (e) {
  // Silent fallback initialization
}

/**
 * 1. GET BANK LIST
 * Endpoint: https://strowallet.com/api/banks/lists/
 */
async function getBankLists() {
  const now = Date.now();
  if (cachedBanks && cachedBanks.length > 0 && (now - lastFetchTime < CACHE_TTL_MS)) {
    return { success: true, banks: cachedBanks, cached: true };
  }

  try {
    const publicKey = process.env.STROWALLET_PUBLIC_KEY || 'pub_zVz8CB4eWxvHoDXPYIzYmnbLwVYaL5RpcM78R3jl';
    const endpoint = `https://strowallet.com/api/banks/lists/`;
    const response = await axios.get(endpoint, {
      params: { public_key: publicKey },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });

    const data = response.data;
    let rawBanks = [];
    if (Array.isArray(data)) {
      rawBanks = data;
    } else if (Array.isArray(data?.data?.bank_list)) {
      rawBanks = data.data.bank_list;
    } else if (Array.isArray(data?.data?.banks)) {
      rawBanks = data.data.banks;
    } else if (Array.isArray(data?.data)) {
      rawBanks = data.data;
    } else if (Array.isArray(data?.banks)) {
      rawBanks = data.banks;
    } else if (Array.isArray(data?.bank_list)) {
      rawBanks = data.bank_list;
    }
    
    // Normalize format to { name, code }
    const banks = rawBanks.map(b => ({
      name: b.name || b.bank_name || b.bankName || 'Unknown Bank',
      code: b.code || b.bank_code || b.bankCode || ''
    })).filter(b => b.code && b.name);

    // Sort alphabetically by name
    banks.sort((a, b) => a.name.localeCompare(b.name));

    if (banks.length > 0) {
      cachedBanks = banks;
      lastFetchTime = now;
      return { success: true, banks, raw: data };
    }

    if (fallbackBanks.length > 0) {
      return { success: true, banks: fallbackBanks, fallback: true };
    }

    return { success: true, banks, raw: data };
  } catch (error) {
    console.error('[Strowallet Bank Lists Error]:', error.response ? error.response.data : error.message);
    if (cachedBanks && cachedBanks.length > 0) {
      return { success: true, banks: cachedBanks, cached: true };
    }
    if (fallbackBanks.length > 0) {
      return { success: true, banks: fallbackBanks, fallback: true };
    }
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to fetch bank list from provider',
      banks: []
    };
  }
}

/**
 * 2. GET CUSTOMER ACCOUNT NAME
 * Endpoint: https://strowallet.com/api/banks/get-customer-name/
 * Query parameters: public_key, bank_code, account_number
 */
async function getCustomerName(bankCode, accountNumber) {
  if (!bankCode || !accountNumber) {
    return { success: false, message: 'Bank code and account number are required' };
  }

  try {
    const publicKey = process.env.STROWALLET_PUBLIC_KEY || 'pub_zVz8CB4eWxvHoDXPYIzYmnbLwVYaL5RpcM78R3jl';
    const endpoint = `https://strowallet.com/api/banks/get-customer-name/`;
    
    const response = await axios.get(endpoint, {
      params: {
        public_key: publicKey,
        bank_code: bankCode,
        account_number: accountNumber
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;
    // Expected response format from Strowallet get-customer-name
    // Usually contains account_name/customer_name and name_enquiry_reference/session_id
    const accountName = data.account_name || data.customer_name || data.data?.account_name || data.data?.customer_name || data.name;
    const nameEnquiryRef = data.name_enquiry_reference || data.reference || data.data?.name_enquiry_reference || data.session_id || `NER-${Date.now()}`;

    if (!accountName && !data.success) {
      return {
        success: false,
        message: data.message || 'Could not verify account name with bank.'
      };
    }

    return {
      success: true,
      accountName: accountName || 'Account Verified',
      nameEnquiryReference: nameEnquiryRef,
      raw: data
    };
  } catch (error) {
    console.error('[Strowallet Name Enquiry Error]:', error.response ? error.response.data : error.message);
    return {
      success: false,
      message: error.response?.data?.message || 'Account verification failed. Please check the account number and bank.'
    };
  }
}

/**
 * 3. BANK TRANSFER REQUEST
 * Endpoint: https://strowallet.com/api/banks/request/
 * Required query parameters: public_key, amount, bank_code, account_number, narration, name_enquiry_reference, SenderName
 */
async function requestBankTransfer({ amount, bankCode, accountNumber, narration, nameEnquiryRef, senderName }) {
  const publicKey = process.env.STROWALLET_PUBLIC_KEY || 'pub_zVz8CB4eWxvHoDXPYIzYmnbLwVYaL5RpcM78R3jl';
  const secretKey = process.env.STROWALLET_SECRET_KEY || 'sec_FybKZleNAkSmBPG1qoFJ8dx6l8o5oGZzoC3Ee4xr';
  const endpoint = `https://strowallet.com/api/banks/request/`;

  const queryParams = {
    public_key: publicKey,
    amount: parseFloat(amount),
    bank_code: bankCode,
    account_number: accountNumber,
    narration: narration,
    name_enquiry_reference: nameEnquiryRef,
    SenderName: senderName || 'STRICTWALLET'
  };

  try {
    const response = await axios.post(endpoint, null, {
      params: queryParams,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      timeout: 30000
    });

    const data = response.data;
    console.info('[Strowallet Bank Transfer Response]:', data);

    const isSuccess = data.success === true || data.status === 'success' || data.status === 'Successful';
    return {
      success: isSuccess,
      status: isSuccess ? 'Successful' : (data.status || 'Failed'),
      reference: data.reference || data.transaction_reference || data.data?.reference || `STR-TXN-${Date.now()}`,
      message: data.message || (isSuccess ? 'Transfer processed successfully' : 'Transfer failed at provider'),
      raw: data
    };
  } catch (error) {
    console.error('[Strowallet Transfer Error]:', error.response ? error.response.data : error.message);
    return {
      success: false,
      status: 'Failed',
      message: error.response?.data?.message || error.message || 'Transfer request failed at provider',
      raw: error.response?.data
    };
  }
}

module.exports = {
  verifyAccount,
  getBankLists,
  getCustomerName,
  requestBankTransfer
};

