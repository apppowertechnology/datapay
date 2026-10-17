const axios = require('axios');

const STROWALLET_PUBLIC_KEY = process.env.STROWALLET_PUBLIC_KEY;
const STROWALLET_SECRET_KEY = process.env.STROWALLET_SECRET_KEY;
const STROWALLET_BASE_URL = process.env.STROWALLET_BASE_URL || 'https://strowallet.com/api/virtual-bank';
// Optional bank type for virtual account creation (e.g., 'sterling', 'paga', 'amucha', 'fidelitybank')
const STROWALLET_BANK_TYPE = process.env.STROWALLET_BANK_TYPE || 'sterling';
const WEBHOOK_URL = process.env.STROWALLET_WEBHOOK_URL || process.env.WEBHOOK_URL || 'https://datapay.onrender.com/api/webhook/strowallet';


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

/**
 * 4. CREATE STERLING BANK VIRTUAL ACCOUNT
 * Endpoint: https://strowallet.com/api/virtual-bank/sterling
 * Strictly uses Sterling Bank virtual account endpoint with production credentials
 */
async function createSterlingVirtualAccount({ firstName, lastName, accountName, email, phone }) {
  const publicKey = process.env.STROWALLET_PUBLIC_KEY;
  const secretKey = process.env.STROWALLET_SECRET_KEY;
  const webhookUrl = process.env.STROWALLET_WEBHOOK_URL || process.env.WEBHOOK_URL || 'https://datapay.onrender.com/api/webhook/strowallet';
  const mode = process.env.STROWALLET_MODE || 'live';

  if (!publicKey) {
    throw new Error('STROWALLET_PUBLIC_KEY is not configured in environment');
  }

  // Resolve First Name and Last Name
  let resolvedFirstName = (firstName || '').trim();
  let resolvedLastName = (lastName || '').trim();

  // If first or last name is missing, attempt to extract from accountName
  if ((!resolvedFirstName || !resolvedLastName) && accountName) {
    const parts = accountName.trim().split(/\s+/);
    if (!resolvedFirstName) resolvedFirstName = parts[0] || '';
    if (!resolvedLastName) resolvedLastName = parts.slice(1).join(' ') || resolvedFirstName;
  }

  const resolvedAccountName = (accountName || `${resolvedFirstName} ${resolvedLastName}`).trim();

  if (!resolvedFirstName || !resolvedLastName) {
    throw new Error('Customer first name and last name are required for virtual account creation');
  }
  if (!email || !phone) {
    throw new Error('Email and phone number are required for virtual account creation');
  }

  const endpoint = 'https://strowallet.com/api/virtual-bank/sterling';

  const payload = {
    public_key: publicKey,
    email: email.trim().toLowerCase(),
    first_name: resolvedFirstName,
    last_name: resolvedLastName,
    account_name: resolvedAccountName,
    phone: phone.trim(),
    webhook_url: webhookUrl,
    mode: mode
  };

  try {
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
        'Public-Key': publicKey
      },
      timeout: 30000
    });

    const data = response.data;
    console.info('[Strowallet Sterling Account Creation Response]:', {
      success: data.success,
      status: data.status,
      message: data.message
    });

    // Extract returned account details from response
    const accData = data.data || data.customer || data.response || data;
    const accountNumber = accData.account_number || accData.accountNumber;
    const resolvedAccountName = accData.account_name || accData.accountName || accountName;
    const bankName = accData.bank_name || accData.bankName || 'Sterling Bank';

    if (accountNumber) {
      return {
        success: true,
        accountNumber: String(accountNumber).trim(),
        accountName: resolvedAccountName,
        bankName: 'Sterling Bank',
        raw: data
      };
    }

    return {
      success: false,
      message: data.message || accData.message || 'Unable to retrieve virtual account number from provider',
      raw: data
    };
  } catch (error) {
    console.error('[Strowallet Sterling Creation Error]:', error.response ? error.response.data : error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to create Sterling Bank virtual account'
    };
  }
}

/**
 * 5. VERIFY TRANSACTION SESSION ID
 * Endpoint: https://strowallet.com/api/verifysessionid/
 * Parameters: public_key, amount, sessionID
 */
async function verifySessionId(sessionId, amount) {
  const publicKey = process.env.STROWALLET_PUBLIC_KEY || STROWALLET_PUBLIC_KEY;
  const cleanSessionId = String(sessionId || '').trim();

  if (!publicKey) {
    return { success: false, message: 'STROWALLET_PUBLIC_KEY is not configured in environment' };
  }
  if (!cleanSessionId) {
    return { success: false, message: 'sessionId is required for Strowallet session verification' };
  }

  // Format amount cleanly: handle numbers or string representation (e.g. "100" or 100)
  let cleanAmount = '';
  if (amount !== undefined && amount !== null && amount !== '') {
    const parsed = parseFloat(amount);
    if (!isNaN(parsed)) {
      // If integer value, send as integer string (e.g. "100"), else fixed decimals
      cleanAmount = Number.isInteger(parsed) ? parsed.toString() : parsed.toFixed(2);
    } else {
      cleanAmount = String(amount).trim();
    }
  }

  const endpoint = 'https://strowallet.com/api/verifysessionid/';

  try {
    const response = await axios.get(endpoint, {
      params: {
        public_key: publicKey,
        amount: cleanAmount,
        sessionID: cleanSessionId
      },
      headers: {
        'Accept': 'application/json'
      },
      timeout: 20000 // 20s timeout for provider query
    });

    const data = response.data;
    // Expected Strowallet authoritative response:
    // 200 OK: { "message": "Transaction received.", "status": 200 }
    // 400 Bad Request: { "message": "Transaction not received.", "status": 400 }
    const isSuccess = data && (
      data.status === 200 ||
      data.status === '200' ||
      data.status === 'success' ||
      data.success === true ||
      (typeof data.message === 'string' && data.message.toLowerCase().includes('received'))
    );

    return {
      success: isSuccess,
      status: data.status || 200,
      message: data.message || (isSuccess ? 'Transaction verified successfully.' : 'Transaction unconfirmed.'),
      data
    };
  } catch (error) {
    const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'));
    const responseData = error.response ? error.response.data : null;
    const responseStatus = error.response ? error.response.status : null;

    console.warn('[Strowallet Verify Session Error]:', {
      sessionId: cleanSessionId,
      status: responseStatus,
      isTimeout,
      responseMessage: responseData?.message || error.message
    });

    // 400 indicates provider confirmed transaction was NOT received
    const isUnconfirmed = responseStatus === 400 || (responseData && responseData.status === 400);

    return {
      success: false,
      unconfirmed: isUnconfirmed,
      timeout: isTimeout,
      status: responseStatus || (isTimeout ? 504 : 500),
      message: responseData?.message || (isTimeout ? 'Verification timed out at provider' : error.message)
    };
  }
}

/**
 * 6. TRANSACTIONAL SMS ALERT
 * Endpoint: POST https://strowallet.com/api/Alert-sms/
 * Parameters: public_key, phone, alert_type, sender_id, amount, user_balance, desc
 */
async function sendAlertSms({ phone, alertType, amount, userBalance, desc }) {
  const publicKey = process.env.STROWALLET_PUBLIC_KEY;
  const secretKey = process.env.STROWALLET_SECRET_KEY;
  const rawSenderId = process.env.STROWALLET_SENDER_ID || 'STWALLET';
  const cleanSenderId = String(rawSenderId).trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 11);

  if (!publicKey) {
    throw new Error('STROWALLET_PUBLIC_KEY is not configured in environment');
  }
  if (!phone || !alertType || amount === undefined || userBalance === undefined) {
    throw new Error('phone, alertType, amount, and userBalance are required for SMS alert');
  }

  // 1. Format and enforce "desc" parameter strictly:
  // - Credit: "Credited ₦{amount}"
  // - Debit: "Debited ₦{amount}"
  // Maximum length: 20 characters. Never truncate amount or send a description exceeding limit.
  const isCredit = String(alertType).toLowerCase().trim() === 'credit';
  const prefix = isCredit ? 'Credited ₦' : 'Debited ₦';
  const clean = typeof amount === 'string' ? amount.replace(/[^0-9.-]/g, '') : amount;
  const num = typeof clean === 'number' ? clean : parseFloat(clean);

  let cleanDesc;
  if (desc && typeof desc === 'string' && (desc.startsWith('Credited ₦') || desc.startsWith('Debited ₦')) && desc.trim().length <= 20) {
    cleanDesc = desc.trim();
  } else {
    const amtStr = isNaN(num) ? '0' : (Number.isInteger(num) ? num.toString() : parseFloat(num.toFixed(2)).toString());
    cleanDesc = `${prefix}${amtStr}`;

    // If exceeding 20 characters, use shorter numeric format without changing value
    if (cleanDesc.length > 20 && !isNaN(num)) {
      const exp = num.toExponential().replace('+', '');
      if (Number(exp) === num && `${prefix}${exp}`.length <= 20) {
        cleanDesc = `${prefix}${exp}`;
      }
    }
  }

  // Safety safeguard: never truncate the amount or send a description exceeding 20 characters
  if (cleanDesc.length > 20) {
    throw new Error(`The desc may not be greater than 20 characters (got ${cleanDesc.length}): "${cleanDesc}"`);
  }

  const endpoint = 'https://strowallet.com/api/Alert-sms/';

  const payload = {
    public_key: publicKey,
    phone: phone.toString().trim(),
    alert_type: alertType.toLowerCase().trim(),
    sender_id: cleanSenderId, // Strictly 11-char alphanumeric without spaces
    amount: parseFloat(amount).toFixed(2),
    user_balance: parseFloat(userBalance).toFixed(2),
    desc: cleanDesc
  };

  try {
    const response = await axios.post(endpoint, payload, {
      params: payload,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      timeout: 30000 // 30s timeout to allow carrier routing
    });

    const data = response.data;
    console.info('[Strowallet SMS Response]:', data);

    const isSuccess = data && (
      data.success === true ||
      data.status === 200 ||
      data.status === 'success' ||
      data.status === 'Successful' ||
      (typeof data.message === 'string' && data.message.toLowerCase().includes('success'))
    );

    if (!isSuccess) {
      const msgStr = typeof data?.message === 'string' ? data.message : '';
      console.warn(`[Strowallet SMS] Delivery unconfirmed for '${cleanSenderId}': ${msgStr}`);
    }

    return {
      success: isSuccess,
      status: isSuccess ? 'Successful' : (data?.status || 'Failed'),
      message: data?.message || (isSuccess ? 'SMS alert sent successfully' : 'SMS rejected by provider'),
      raw: data
    };
  } catch (error) {
    const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'));
    console.error('[Strowallet SMS Error]:', isTimeout ? `Request timed out (${error.message})` : (error.response ? error.response.data : error.message));
    
    return {
      success: false,
      timeout: isTimeout,
      status: isTimeout ? 'Timeout' : 'Failed',
      outcome: isTimeout ? 'uncertain' : 'failed',
      message: isTimeout 
        ? 'SMS provider request timed out. Outcome is unconfirmed.' 
        : (error.response?.data?.message || error.message || 'SMS request failed at provider'),
      raw: error.response?.data || null
    };
  }
}

/**
 * 7. SENDER ID REGISTRATION
 * Automatic API submissions to /api/senderid-sms/ removed as requested.
 * Sender ID activation is handled directly with Strowallet support.
 */
async function submitSenderId(customSenderId) {
  const rawId = customSenderId || process.env.STROWALLET_SENDER_ID || 'STWALLET';
  const cleanId = String(rawId).trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 11);

  return {
    success: false,
    senderId: cleanId,
    message: `Sender ID registration via API endpoint is disabled. Sender IDs must be reviewed and activated directly by Strowallet support.`
  };
}

module.exports = {
  verifyAccount,
  getBankLists,
  getCustomerName,
  requestBankTransfer,
  createSterlingVirtualAccount,
  verifySessionId,
  sendAlertSms,
  submitSenderId
};

