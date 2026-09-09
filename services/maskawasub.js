const axios = require('axios');

const MASKAWASUB_API_KEY = process.env.MASKAWASUB_API_KEY || '67023380ece9a9561cac9b5f208907e0ab85063b';
const MASKAWASUB_BASE_URL = process.env.MASKAWASUB_BASE_URL || 'https://www.maskawasub.com/api';

const getHeaders = () => ({
  'Authorization': `Token ${MASKAWASUB_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
});

function formatErrorMessage(errData, defaultMsg = "We couldn't complete your transaction at this time. Please try again shortly.") {
  if (!errData) return defaultMsg;
  if (Array.isArray(errData)) return errData.join(' ');
  if (typeof errData === 'string') return errData;
  if (typeof errData === 'object') {
    const values = Object.values(errData);
    if (values.length > 0) {
      const first = values[0];
      if (Array.isArray(first)) return first.join(' ');
      if (typeof first === 'string') return first;
    }
  }
  return defaultMsg;
}

/**
 * Purchase Airtime via MaskawaSub
 * @param {number} networkId - MTN=1, GLO=2, 9MOBILE=3, AIRTEL=4
 * @param {string} phone - Recipient phone number
 * @param {number} amount - Amount in Naira
 */
async function purchaseAirtime(networkId, phone, amount) {
  const payload = {
    network: parseInt(networkId, 10),
    amount: parseFloat(amount),
    mobile_number: phone.toString().trim(),
    Ported_number: true,
    airtime_type: 'VTU'
  };

  console.log('[MaskawaSub API] Sending airtime topup:', payload);

  try {
    const response = await axios.post(`${MASKAWASUB_BASE_URL}/topup/`, payload, {
      headers: getHeaders(),
      timeout: 15000
    });

    console.log('[MaskawaSub API] Topup response:', response.data);
    const data = response.data;

    let msg = data.msg || data.message || 'Airtime recharge processed';
    if (Array.isArray(msg)) msg = msg.join(' ');

    const isSuccess = data.Status === 'successful' || data.status === 'successful' || data.status === 'success' || data.Status === 'success';
    return {
      success: isSuccess,
      data: data,
      reference: data.id || data.ident || data.reference || `MSK-AIR-${Date.now()}`,
      status: isSuccess ? 'Successful' : (data.Status || data.status || 'Pending'),
      message: msg
    };
  } catch (error) {
    console.error('[MaskawaSub API Error - Topup]:', error.response ? error.response.data : error.message);
    const errData = error.response ? error.response.data : null;
    return {
      success: false,
      error: errData || error.message,
      message: formatErrorMessage(errData)
    };
  }
}

/**
 * Purchase Data via MaskawaSub
 * @param {number} networkId - MTN=1, GLO=2, 9MOBILE=3, AIRTEL=4
 * @param {string} phone - Recipient phone number
 * @param {string|number} planId - MaskawaSub plan ID
 */
async function purchaseData(networkId, phone, planId) {
  const payload = {
    network: parseInt(networkId, 10),
    mobile_number: phone.toString().trim(),
    plan: parseInt(planId, 10),
    Ported_number: true
  };

  console.log('[MaskawaSub API] Sending data purchase:', payload);

  try {
    const response = await axios.post(`${MASKAWASUB_BASE_URL}/data/`, payload, {
      headers: getHeaders(),
      timeout: 15000
    });

    console.log('[MaskawaSub API] Data response:', response.data);
    const data = response.data;

    let msg = data.msg || data.message || 'Data bundle activated successfully';
    if (Array.isArray(msg)) msg = msg.join(' ');

    const isSuccess = data.Status === 'successful' || data.status === 'successful' || data.status === 'success' || data.Status === 'success';
    return {
      success: isSuccess,
      data: data,
      reference: data.id || data.ident || data.reference || `MSK-DAT-${Date.now()}`,
      status: isSuccess ? 'Successful' : (data.Status || data.status || 'Pending'),
      message: msg
    };
  } catch (error) {
    console.error('[MaskawaSub API Error - Data]:', error.response ? error.response.data : error.message);
    const errData = error.response ? error.response.data : null;
    return {
      success: false,
      error: errData || error.message,
      message: formatErrorMessage(errData)
    };
  }
}

async function queryTransaction(transactionId) {
  try {
    const response = await axios.get(`${MASKAWASUB_BASE_URL}/data/${transactionId}`, {
      headers: getHeaders(),
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

module.exports = {
  purchaseAirtime,
  purchaseData,
  queryTransaction
};
