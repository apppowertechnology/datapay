const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- STARTING STRICTWALLET AUTOMATED TEST SUITE ---');

  try {
    // 1. REGISTRATION
    console.log('\n[1] Testing User Registration...');
    const testEmail = `user_${Date.now()}@example.com`;
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      fullName: 'Tunde Bakare',
      email: testEmail,
      phone: '08034567890',
      nextOfKin: 'Grace Bakare',
      password: 'SecurePassword2026!#',
      confirmPassword: 'SecurePassword2026!#'
    });

    console.log('Registration Status:', regRes.data.success);
    console.log('Dedicated Virtual Account:', regRes.data.user.virtualAccountNumber, 'Bank:', regRes.data.user.virtualBankName);
    const userToken = regRes.data.token;

    // 2. USER LOGIN
    console.log('\n[2] Testing User Login...');
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: testEmail,
      password: 'SecurePassword2026!#'
    });
    console.log('Login Status:', loginRes.data.success, 'Message:', loginRes.data.message);

    // 3. PASSWORD RECOVERY VERIFICATION
    console.log('\n[3] Testing Password Recovery with Next of Kin...');
    const recVerRes = await axios.post(`${BASE_URL}/auth/recover-verify`, {
      email: testEmail,
      nextOfKinAnswer: 'grace bakare'
    });
    console.log('Recovery Verification:', recVerRes.data.success);
    const resetToken = recVerRes.data.resetToken;

    const recResetRes = await axios.post(`${BASE_URL}/auth/recover-reset`, {
      resetToken,
      newPassword: 'BrandNewPassword2026!#',
      confirmPassword: 'BrandNewPassword2026!#'
    });
    console.log('Password Reset Status:', recResetRes.data.success);

    // Login with new password
    const newLogin = await axios.post(`${BASE_URL}/auth/login`, {
      email: testEmail,
      password: 'BrandNewPassword2026!#'
    });
    const authToken = newLogin.data.token;
    const authHeaders = { headers: { Authorization: `Bearer ${authToken}` } };

    // 4. SET TRANSACTION PIN
    console.log('\n[4] Setting 4-Digit Transaction PIN...');
    const pinRes = await axios.post(`${BASE_URL}/wallet/set-pin`, { pin: '1234' }, authHeaders);
    console.log('PIN Set Status:', pinRes.data.success);

    // 6. BUY AIRTIME
    console.log('\n[6] Testing Airtime Purchase (₦1,000 MTN)...');
    const airtimeRes = await axios.post(`${BASE_URL}/wallet/buy-airtime`, {
      network: 1, // MTN
      phone: '08034567890',
      amount: 1000,
      pin: '1234'
    }, authHeaders);
    console.log('Airtime Purchase Result:', airtimeRes.data.success, 'Message:', airtimeRes.data.message, 'Remaining Balance:', airtimeRes.data.newBalance);

    // 7. BUY DATA
    console.log('\n[7] Testing Data Bundle Purchase (MTN 1GB)...');
    const dataRes = await axios.post(`${BASE_URL}/wallet/buy-data`, {
      planId: 'mtn_1gb',
      phone: '08034567890',
      pin: '1234'
    }, authHeaders);
    console.log('Data Purchase Result:', dataRes.data.success, 'Message:', dataRes.data.message, 'Remaining Balance:', dataRes.data.newBalance);

    // 8. TRANSACTION HISTORY
    console.log('\n[8] Testing Transaction History Ledger...');
    const txRes = await axios.get(`${BASE_URL}/wallet/transactions`, authHeaders);
    console.log('User Transaction Count:', txRes.data.transactions.length);

    // 9. CUSTOMER CARE / SUPPORT TICKETS
    console.log('\n[9] Testing Support Ticket Creation & Live Chat...');
    const ticketRes = await axios.post(`${BASE_URL}/support/create`, {
      subject: 'Question on Virtual Account Transfer Speed',
      category: 'Deposit problem',
      message: 'Hello, how long do bank transfers take to credit?'
    }, authHeaders);
    console.log('Ticket Created:', ticketRes.data.ticket.ticketNumber);
    const ticketId = ticketRes.data.ticket.id;

    // 10. ADMIN AUTHENTICATION
    console.log('\n[10] Testing Admin Login & Console...');
    const adminLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@strictwallet.com',
      password: 'StrictAdmin2026!#'
    });
    console.log('Admin Auth Status:', adminLoginRes.data.success, 'Role:', adminLoginRes.data.user.role);
    const adminToken = adminLoginRes.data.token;
    const adminHeaders = { headers: { Authorization: `Bearer ${adminToken}` } };

    // 11. ADMIN STATS
    console.log('\n[11] Testing Admin Analytics Overview...');
    const statsRes = await axios.get(`${BASE_URL}/admin/stats`, adminHeaders);
    console.log('Platform Stats:', statsRes.data.stats);

    // 12. ADMIN PRICING MANAGEMENT
    console.log('\n[12] Testing Admin Price & Profit Margin Management...');
    const priceRes = await axios.post(`${BASE_URL}/admin/pricing/mtn_1gb`, {
      sellingPrice: 360,
      status: 'active'
    }, adminHeaders);
    console.log('Updated MTN 1GB Selling Price:', priceRes.data.plan.sellingPrice, 'Calculated Profit:', priceRes.data.plan.profit);

    // 13. ADMIN REPLY TO SUPPORT TICKET
    console.log('\n[13] Testing Admin Ticket Reply & Resolution...');
    const replyRes = await axios.post(`${BASE_URL}/support/ticket/${ticketId}/reply`, {
      message: 'Hello! Virtual account deposits are credited instantly within 2-5 seconds.'
    }, adminHeaders);
    console.log('Admin Reply Status:', replyRes.data.success);

    const resolveRes = await axios.post(`${BASE_URL}/admin/support/tickets/${ticketId}/status`, {
      status: 'Resolved'
    }, adminHeaders);
    console.log('Ticket Status Marked:', resolveRes.data.message);

    console.log('\n>>> ALL STRICTWALLET TESTS COMPLETED SUCCESSFULLY! <<<');
  } catch (error) {
    console.error('Test Suite Error:', error.response ? error.response.data : error.message);
  }
}

runTests();
