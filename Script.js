/**
 * STRICTWALLET — CLIENT-SIDE APPLICATION CORE
 * Enterprise-grade security, reactive state management, and real-time VTU operations
 */

// Application State
const State = {
  token: localStorage.getItem('strictwallet_token') || sessionStorage.getItem('strictwallet_token') || null,
  user: null,
  wallet: null,
  dataPlans: [],
  selectedNetworkAirtime: 1, // 1=MTN, 2=GLO, 3=9MOBILE, 4=AIRTEL
  selectedNetworkData: 'MTN',
  selectedNetworkDataId: 1,
  selectedCategory: 'SME',
  selectedPlan: null,
  pendingPurchase: null, // { type: 'airtime'|'data', payload: {} }
  balanceHidden: localStorage.getItem('strictwallet_hide_balance') === 'true',
  activeChatTicketId: null
};

// API Base URL
const API_BASE = window.location.protocol.startsWith('http')
  ? `${window.location.origin}/api`
  : 'http://localhost:5000/api';

// Toast Notification Manager
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';
  if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}" style="font-size: 1.1rem;"></i>
    <div style="flex: 1;">${message}</div>
    <button style="background: transparent; color: var(--text-muted); cursor: pointer;" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Utility: Format Currency
function formatNaira(amount) {
  const num = parseFloat(amount || 0);
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Utility: Format Date Time
function formatDateTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// Password Strength Validator
function checkPasswordStrength(password, prefix = '') {
  const min8 = password.length >= 8;
  const upper = /[A-Z]/.test(password);
  const lower = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const special = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  updateReqUI(prefix + 'reqMin8', min8);
  updateReqUI(prefix + 'reqUpper', upper);
  updateReqUI(prefix + 'reqLower', lower);
  updateReqUI(prefix + 'reqNumber', number);
  updateReqUI(prefix + 'reqSpecial', special);

  return min8 && upper && lower && number && special;
}

function updateReqUI(elementId, isMet) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (isMet) {
    el.className = 'password-req-item met';
    el.querySelector('i').className = 'fa-solid fa-circle-check';
  } else {
    el.className = 'password-req-item';
    el.querySelector('i').className = 'fa-solid fa-circle-xmark';
  }
}

// Generate Ultra-Strong Password
function generateStrongPassword() {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  const specials = '!@#$%&*?';
  const all = uppers + lowers + numbers + specials;

  let pass = '';
  pass += uppers[Math.floor(Math.random() * uppers.length)];
  pass += lowers[Math.floor(Math.random() * lowers.length)];
  pass += numbers[Math.floor(Math.random() * numbers.length)];
  pass += specials[Math.floor(Math.random() * specials.length)];

  for (let i = 4; i < 12; i++) {
    pass += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle
  return pass.split('').sort(() => 0.5 - Math.random()).join('');
}

// Modal Helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

// Navigation View Controller
function navigateToView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active-view'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active-view');

  // Update Sidebar & Bottom Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-view') === viewId);
  });
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
  });

  // Close mobile sidebar if open
  document.getElementById('sidebar')?.classList.remove('mobile-open');

  // Update Topbar Title
  const titles = {
    viewDashboard: 'Dashboard',
    viewAirtime: 'Buy Airtime',
    viewData: 'Buy Data Bundles',
    viewTransactions: 'Transaction Ledger',
    viewSupport: 'Customer Care Help Desk',
    viewSettings: 'Account Settings'
  };
  document.getElementById('pageHeadline').innerText = titles[viewId] || 'STRICTWALLET';

  // Load specific data on navigation
  if (viewId === 'viewTransactions') loadAllTransactions();
  if (viewId === 'viewSupport') loadUserTickets();
  if (viewId === 'viewData') {
    renderPlanCategories();
    renderDataPlans();
    // Re-fetch latest plans from backend to ensure immediate sync with Admin actions
    authFetch('/wallet/data-plans').then(({ ok, data }) => {
      if (ok && data.success) {
        State.dataPlans = data.plans;
        renderPlanCategories();
        renderDataPlans();
      }
    });
  }
}

// Authenticated Fetch Wrapper
async function authFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (State.token) {
    headers['Authorization'] = `Bearer ${State.token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    const data = await res.json();

    if (res.status === 401 || res.status === 403) {
      if (data.message && (data.message.includes('expired') || data.message.includes('required') || data.message.includes('Invalid'))) {
        logoutUser(false);
        showToast('Your session has expired. Please sign in.', 'warning');
      }
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('API Fetch Error:', err);
    return { ok: false, status: 0, data: { success: false, message: 'Network connection issue. Please check your internet.' } };
  }
}

// -------------------------------------------------------------

// Verify Bank Account Function
async function verifyBankAccount() {
  const bankCode = document.getElementById('bankCodeInput').value.trim();
  const accountNumber = document.getElementById('accountNumberInput').value.trim();

  if (!bankCode || !accountNumber) {
    showToast('Please provide both bank code and account number.', 'warning');
    return;
  }

  // Show loading state on button (optional)
  const verifyBtn = document.querySelector('#bankVerifyModal button.btn-primary');
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
  }

  const { ok, data } = await authFetch('/bank/verify', {
    method: 'POST',
    body: JSON.stringify({ bankCode, accountNumber })
  });

  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = 'Verify';
  }

  const resultDiv = document.getElementById('bankVerifyResult');
  if (ok && data.success) {
    document.getElementById('resultBankName').innerText = data.bankName || data.bank_name || bankCode;
    document.getElementById('resultAccountName').innerText = data.accountName || data.account_name || '';
    document.getElementById('resultAccountNumber').innerText = data.accountNumber || data.account_number || accountNumber;
    document.getElementById('resultStatus').innerText = data.status || 'verified';
    resultDiv.style.display = 'block';
    showToast('Bank account verified successfully.', 'success');
  } else {
    resultDiv.style.display = 'none';
    const msg = data.message || 'Verification failed. Please check details.';
    showToast(msg, 'error');
  }
}

// APP INITIALIZATION & AUTH CHECKS
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  if (State.token) {
    await initUserSession();
  } else {
    showAuthScreen('loginCard');
  }
});

function showAuthScreen(cardId) {
  document.getElementById('authWrapper').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  
  ['loginCard', 'registerCard', 'recoveryCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === cardId ? 'block' : 'none';
  });
}

function showAppScreen() {
  document.getElementById('authWrapper').style.display = 'none';
  document.getElementById('appContainer').style.display = 'flex';
  navigateToView('viewDashboard');
}

async function initUserSession() {
  const [profileRes, walletRes, plansRes] = await Promise.all([
    authFetch('/auth/me'),
    authFetch('/wallet/overview'),
    authFetch('/wallet/data-plans')
  ]);

  if (profileRes.ok && profileRes.data.success) {
    State.user = profileRes.data.user;
    updateUserInterface();
  } else {
    logoutUser(false);
    return;
  }

  if (walletRes.ok && walletRes.data.success) {
    State.wallet = walletRes.data.wallet;
    renderWalletOverview(walletRes.data);
  }

  if (plansRes.ok && plansRes.data.success) {
    State.dataPlans = plansRes.data.plans;
    renderPlanCategories();
    renderDataPlans();
  }

  showAppScreen();
}

function updateUserInterface() {
  if (!State.user) return;
  
  document.getElementById('sidebarUserName').innerText = State.user.fullName;
  document.getElementById('sidebarUserEmail').innerText = State.user.email;
  document.getElementById('sidebarUserAvatar').innerText = State.user.fullName.charAt(0).toUpperCase();

  // Settings view inputs
  document.getElementById('setFullName').value = State.user.fullName;
  document.getElementById('setEmail').value = State.user.email;
  document.getElementById('setPhone').value = State.user.phone;
  document.getElementById('setNextOfKin').value = State.user.nextOfKin || 'N/A';

  // Toggle PIN current password requirement
  const currentPinGroup = document.getElementById('currentPinGroup');
  if (currentPinGroup) {
    currentPinGroup.style.display = State.user.hasPin ? 'block' : 'none';
  }
}

function renderWalletOverview(overviewData) {
  const w = overviewData.wallet;
  State.wallet = w;

  // Format Balances
  updateBalanceDisplay();

  // Virtual account removed.

  // Statistics
  document.getElementById('statTotalDeposits').innerText = formatNaira(w.totalDeposited);
  document.getElementById('statAirtimeSpent').innerText = formatNaira(w.totalAirtimeSpent);
  document.getElementById('statDataSpent').innerText = formatNaira(w.totalDataSpent);

  // Recent Transactions
  renderRecentTransactions(overviewData.recentTransactions || []);
}

function updateBalanceDisplay() {
  const balance = State.wallet ? State.wallet.balance : 0;
  const topbarEl = document.getElementById('topbarBalance');
  const dashBalEl = document.getElementById('dashboardBalanceAmount');
  const eyeIcon = document.getElementById('eyeIcon');

  if (State.balanceHidden) {
    topbarEl.innerText = '₦••••••';
    dashBalEl.innerText = '₦••••••';
    if (eyeIcon) eyeIcon.className = 'fa-regular fa-eye-slash';
  } else {
    topbarEl.innerText = formatNaira(balance);
    dashBalEl.innerText = formatNaira(balance);
    if (eyeIcon) eyeIcon.className = 'fa-regular fa-eye';
  }
}

function renderRecentTransactions(transactions) {
  const tbody = document.getElementById('recentTransactionsTableBody');
  if (!tbody) return;

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">No transaction activity yet. Fund your wallet or make your first purchase!</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(tx => {
    let badgeClass = 'badge-success';
    if (tx.status === 'Pending') badgeClass = 'badge-warning';
    if (tx.status === 'Failed') badgeClass = 'badge-danger';

    let typeIcon = tx.type === 'deposit' ? '<i class="fa-solid fa-arrow-down" style="color: var(--accent-emerald);"></i> Deposit' : 
                   tx.type === 'airtime' ? '<i class="fa-solid fa-mobile-screen-button" style="color: #38BDF8;"></i> Airtime' : 
                   '<i class="fa-solid fa-wifi" style="color: #8B5CF6;"></i> Data';

    return `
      <tr>
        <td><strong>${typeIcon}</strong></td>
        <td>${tx.description || tx.id}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: ${tx.type === 'deposit' ? 'var(--accent-emerald)' : '#FFF'};">
          ${tx.type === 'deposit' ? '+' : '-'}${formatNaira(tx.amount)}
        </td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTime(tx.createdAt)}</td>
        <td><span class="badge ${badgeClass}">${tx.status}</span></td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// EVENT LISTENERS & FORM BINDINGS
// -------------------------------------------------------------
function setupEventListeners() {
  
  // Navigation Links between Auth Cards
  document.getElementById('toRegisterLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('registerCard');
  });

  document.getElementById('toLoginLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('loginCard');
  });

  document.getElementById('toForgotPasswordLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('recoveryCard');
  });

  document.getElementById('toLoginFromRecLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('loginCard');
  });

  // Password Visibility Toggles
  document.getElementById('toggleLoginPass')?.addEventListener('click', function() {
    const input = document.getElementById('loginPassword');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    this.querySelector('i').className = isPass ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  });

  document.getElementById('toggleRegPass')?.addEventListener('click', function() {
    const input = document.getElementById('regPassword');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    this.querySelector('i').className = isPass ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  });

  // Dynamic Password Strength Checking on Registration
  document.getElementById('regPassword')?.addEventListener('input', (e) => {
    checkPasswordStrength(e.target.value, '');
  });

  // Dynamic Password Strength on Password Change
  document.getElementById('changeNewPass')?.addEventListener('input', (e) => {
    checkPasswordStrength(e.target.value, 'cp');
  });

  // Dynamic Password Strength on Recovery Reset
  document.getElementById('recNewPassword')?.addEventListener('input', (e) => {
    checkPasswordStrength(e.target.value, 'rec');
  });

  // Generate Strong Password Generator Button
  document.getElementById('btnGenStrongPass')?.addEventListener('click', () => {
    const generated = generateStrongPassword();
    const passInput = document.getElementById('regPassword');
    const confInput = document.getElementById('regConfirmPassword');
    
    passInput.value = generated;
    confInput.value = generated;
    passInput.type = 'text';
    confInput.type = 'text';
    
    checkPasswordStrength(generated, '');
    showToast('Ultra-secure password generated and applied! Please note it down safely.', 'success');
  });

  // 1. REGISTRATION SUBMISSION
  document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const nextOfKin = document.getElementById('regNextOfKin').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    if (!checkPasswordStrength(password, '')) {
      showToast('Please ensure your password satisfies all 5 security requirements.', 'warning');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Passwords do not match!', 'error');
      return;
    }

    const btn = document.getElementById('regSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering...`;

    const { ok, data } = await authFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, email, phone, nextOfKin, password, confirmPassword })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Register`;

    if (ok && data.success) {
      State.token = data.token;
      localStorage.setItem('strictwallet_token', data.token);
      showToast(data.message, 'success');
      await initUserSession();
    } else {
      showToast(data.message || 'Registration failed. Please check your inputs.', 'error');
    }
  });

  // 2. LOGIN SUBMISSION
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    const btn = document.getElementById('loginSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;

    const { ok, data } = await authFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In to STRICTWALLET`;

    if (ok && data.success) {
      State.token = data.token;
      if (rememberMe) {
        localStorage.setItem('strictwallet_token', data.token);
      } else {
        sessionStorage.setItem('strictwallet_token', data.token);
      }
      showToast(data.message, 'success');
      await initUserSession();
    } else {
      showToast(data.message || 'Invalid credentials.', 'error');
    }
  });

  // 3. PASSWORD RECOVERY STEP 1: VERIFY NEXT OF KIN
  let recoveryResetToken = null;
  document.getElementById('recoveryVerifyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recEmail').value.trim();
    const nextOfKinAnswer = document.getElementById('recNextOfKin').value.trim();

    const btn = document.getElementById('recVerifyBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;

    const { ok, data } = await authFetch('/auth/recover-verify', {
      method: 'POST',
      body: JSON.stringify({ email, nextOfKinAnswer })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Verify Security Answer`;

    if (ok && data.success) {
      recoveryResetToken = data.resetToken;
      document.getElementById('recoveryVerifyForm').style.display = 'none';
      document.getElementById('recoveryResetForm').style.display = 'block';
      showToast(data.message, 'success');
    } else {
      showToast(data.message || 'Security verification failed.', 'error');
    }
  });

  // 4. PASSWORD RECOVERY STEP 2: SET NEW PASSWORD
  document.getElementById('recoveryResetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('recNewPassword').value;
    const confirmPassword = document.getElementById('recConfirmPassword').value;

    if (!checkPasswordStrength(newPassword, 'rec')) {
      showToast('New password does not meet security requirements.', 'warning');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    const btn = document.getElementById('recResetBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating Password...`;

    const { ok, data } = await authFetch('/auth/recover-reset', {
      method: 'POST',
      body: JSON.stringify({ resetToken: recoveryResetToken, newPassword, confirmPassword })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-key"></i> Update Password & Sign In`;

    if (ok && data.success) {
      showToast(data.message, 'success');
      document.getElementById('recoveryResetForm').reset();
      document.getElementById('recoveryVerifyForm').reset();
      document.getElementById('recoveryResetForm').style.display = 'none';
      document.getElementById('recoveryVerifyForm').style.display = 'block';
      showAuthScreen('loginCard');
    } else {
      showToast(data.message || 'Password update failed.', 'error');
    }
  });

  // 5. SIDEBAR & BOTTOM NAV ROUTING
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      navigateToView(item.getAttribute('data-view'));
    });
  });

  document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToView(btn.getAttribute('data-view'));
    });
  });

  // Mobile Drawer Toggle
  document.getElementById('mobileToggleBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('mobile-open');
  });

  // Hide / Show Balance Toggle
  document.getElementById('toggleBalanceVisibility')?.addEventListener('click', () => {
    State.balanceHidden = !State.balanceHidden;
    localStorage.setItem('strictwallet_hide_balance', State.balanceHidden);
    updateBalanceDisplay();
  });

  // Copy Account Number Handlers (Removed)

  // Quick Fund Modals
  document.getElementById('btnQuickFund')?.addEventListener('click', () => openModal('fundWalletModal'));
  document.getElementById('btnDashboardFund')?.addEventListener('click', () => openModal('fundWalletModal'));

  // Sandbox Test Fund Simulation
  document.getElementById('btnSimulateFund')?.addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('simFundAmount').value);
    if (!amount || amount <= 0) {
      showToast('Please specify a valid deposit amount', 'warning');
      return;
    }

    const btn = document.getElementById('btnSimulateFund');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Crediting...`;

    const { ok, data } = await authFetch('/webhook/simulate-funding', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });

    btn.disabled = false;
    btn.innerHTML = `Simulate Deposit`;

    if (ok && data.success) {
      showToast(data.message, 'success');
      closeModal('fundWalletModal');
      await initUserSession();
    } else {
      showToast(data.message || 'Simulated deposit error', 'error');
    }
  });

  // 6. AIRTIME PURCHASE FLOW
  document.querySelectorAll('#airtimeNetworkSelector .network-badge').forEach(badge => {
    badge.addEventListener('click', () => {
      document.querySelectorAll('#airtimeNetworkSelector .network-badge').forEach(b => b.classList.remove('selected'));
      badge.classList.add('selected');
      State.selectedNetworkAirtime = parseInt(badge.getAttribute('data-network'), 10);
    });
  });

  document.querySelectorAll('.amount-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.amount-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      document.getElementById('airtimeAmount').value = pill.getAttribute('data-amount');
    });
  });

  document.getElementById('airtimeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = document.getElementById('airtimePhone').value.trim();
    const amount = parseFloat(document.getElementById('airtimeAmount').value);

    if (!phone || phone.length < 10) {
      showToast('Please enter a valid recipient phone number.', 'warning');
      return;
    }

    if (isNaN(amount) || amount < 50 || amount > 50000) {
      showToast('Airtime amount must be between ₦50 and ₦50,000.', 'warning');
      return;
    }

    const netNames = { 1: 'MTN', 2: 'GLO', 3: '9MOBILE', 4: 'AIRTEL' };
    const netName = netNames[State.selectedNetworkAirtime];

    // Prepare Confirmation Modal
    State.pendingPurchase = {
      type: 'airtime',
      network: State.selectedNetworkAirtime,
      networkName: netName,
      phone,
      amount
    };

    document.getElementById('confirmModalTitle').innerText = 'Confirm Airtime Recharge';
    document.getElementById('confirmServiceType').innerText = 'Airtime Top-up';
    document.getElementById('confirmNetwork').innerText = netName;
    document.getElementById('confirmPlanRow').style.display = 'none';
    document.getElementById('confirmPhone').innerText = phone;
    document.getElementById('confirmAmount').innerText = formatNaira(amount);
    document.getElementById('confirmWalletBalance').innerText = formatNaira(State.wallet?.balance || 0);
    document.getElementById('confirmTxPin').value = '';

    openModal('purchaseConfirmModal');
  });

  // 7. DATA PURCHASE FLOW
  document.querySelectorAll('#dataNetworkSelector .network-badge').forEach(badge => {
    badge.addEventListener('click', () => {
      document.querySelectorAll('#dataNetworkSelector .network-badge').forEach(b => b.classList.remove('selected'));
      badge.classList.add('selected');
      State.selectedNetworkData = badge.getAttribute('data-network');
      State.selectedNetworkDataId = parseInt(badge.getAttribute('data-network-id'), 10);
      State.selectedPlan = null;
      updateSelectedPlanPreview();
      renderPlanCategories();
      renderDataPlans();
    });
  });

  document.getElementById('dataForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = document.getElementById('dataPhone').value.trim();

    if (!phone || phone.length < 10) {
      showToast('Please enter a valid recipient phone number.', 'warning');
      return;
    }

    if (!State.selectedPlan) {
      showToast('Please select a data plan bundle to proceed.', 'warning');
      return;
    }

    State.pendingPurchase = {
      type: 'data',
      planId: State.selectedPlan.id,
      planName: `${State.selectedPlan.name} (${State.selectedPlan.validity})`,
      network: State.selectedPlan.network,
      phone,
      amount: State.selectedPlan.sellingPrice
    };

    document.getElementById('confirmModalTitle').innerText = 'Confirm Data Purchase';
    document.getElementById('confirmServiceType').innerText = 'Data Bundle';
    document.getElementById('confirmNetwork').innerText = State.selectedPlan.network;
    document.getElementById('confirmPlanRow').style.display = 'flex';
    document.getElementById('confirmPlanName').innerText = `${State.selectedPlan.name} (${State.selectedPlan.validity})`;
    document.getElementById('confirmPhone').innerText = phone;
    document.getElementById('confirmAmount').innerText = formatNaira(State.selectedPlan.sellingPrice);
    document.getElementById('confirmWalletBalance').innerText = formatNaira(State.wallet?.balance || 0);
    document.getElementById('confirmTxPin').value = '';

    openModal('purchaseConfirmModal');
  });

  // 8. EXECUTE PURCHASE WITH TRANSACTION PIN
  document.getElementById('btnExecutePurchase')?.addEventListener('click', async () => {
    const pin = document.getElementById('confirmTxPin').value.trim();

    if (!pin || pin.length !== 4) {
      showToast('Please enter your 4-digit Transaction PIN.', 'warning');
      return;
    }

    if (!State.pendingPurchase) return;

    const btn = document.getElementById('btnExecutePurchase');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing Transaction...`;

    let endpoint = State.pendingPurchase.type === 'airtime' ? '/wallet/buy-airtime' : '/wallet/buy-data';
    let bodyPayload = State.pendingPurchase.type === 'airtime' ? {
      network: State.pendingPurchase.network,
      phone: State.pendingPurchase.phone,
      amount: State.pendingPurchase.amount,
      pin
    } : {
      planId: State.pendingPurchase.planId,
      phone: State.pendingPurchase.phone,
      pin
    };

    const { ok, data } = await authFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(bodyPayload)
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm & Authorize`;

    if (ok && data.success) {
      closeModal('purchaseConfirmModal');
      showToast(data.message, 'success');
      
      // Update Balance
      if (data.newBalance !== undefined) {
        State.wallet.balance = data.newBalance;
        updateBalanceDisplay();
      }

      // Show Receipt
      if (data.transaction) {
        showReceiptModal(data.transaction);
      }

      await initUserSession();
    } else {
      showToast(data.message || 'Transaction failed. Please try again.', 'error');
    }
  });

  // 9. TRANSACTION PIN SETUP / CHANGE
  document.getElementById('pinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPin = document.getElementById('newPin').value.trim();
    const currentPin = document.getElementById('currentPin')?.value.trim();

    if (!/^\d{4}$/.test(newPin)) {
      showToast('PIN must be exactly 4 digits.', 'warning');
      return;
    }

    const { ok, data } = await authFetch('/wallet/set-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: newPin, currentPin })
    });

    if (ok && data.success) {
      showToast(data.message, 'success');
      document.getElementById('pinForm').reset();
      State.user.hasPin = true;
      updateUserInterface();
    } else {
      showToast(data.message || 'Failed to update PIN', 'error');
    }
  });

  // 10. CHANGE PASSWORD
  document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('changeCurrPass').value;
    const newPassword = document.getElementById('changeNewPass').value;
    const confirmPassword = document.getElementById('changeConfPass').value;

    if (!checkPasswordStrength(newPassword, 'cp')) {
      showToast('New password does not meet security requirements.', 'warning');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    const { ok, data } = await authFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });

    if (ok && data.success) {
      showToast(data.message, 'success');
      document.getElementById('changePasswordForm').reset();
    } else {
      showToast(data.message || 'Password update failed.', 'error');
    }
  });

  // 11. CUSTOMER CARE / SUPPORT TICKETS
  document.getElementById('btnOpenNewTicketModal')?.addEventListener('click', () => {
    document.getElementById('newTicketForm').reset();
    openModal('createTicketModal');
  });

  document.getElementById('newTicketForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('ticketSubject').value.trim();
    const category = document.getElementById('ticketCategory').value;
    const transactionId = document.getElementById('ticketTxId').value.trim();
    const message = document.getElementById('ticketMessage').value.trim();

    const { ok, data } = await authFetch('/support/create', {
      method: 'POST',
      body: JSON.stringify({ subject, category, transactionId, message })
    });

    if (ok && data.success) {
      closeModal('createTicketModal');
      showToast(data.message, 'success');
      loadUserTickets();
    } else {
      showToast(data.message || 'Failed to submit ticket.', 'error');
    }
  });

  // Support Reply in Live Chat Modal
  document.getElementById('ticketReplyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ticketReplyInput');
    const message = input.value.trim();

    if (!message || !State.activeChatTicketId) return;

    const { ok, data } = await authFetch(`/support/ticket/${State.activeChatTicketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });

    if (ok && data.success) {
      input.value = '';
      await loadTicketChat(State.activeChatTicketId);
    } else {
      showToast(data.message || 'Error sending reply', 'error');
    }
  });

  // 12. LOGOUT
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out of STRICTWALLET?')) {
      logoutUser(true);
    }
  });

  // Transaction Ledger Filters
  document.getElementById('txFilterType')?.addEventListener('change', loadAllTransactions);
  document.getElementById('txFilterStatus')?.addEventListener('change', loadAllTransactions);
  document.getElementById('txSearchInput')?.addEventListener('input', debounce(loadAllTransactions, 300));
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// -------------------------------------------------------------
// DYNAMIC DATA PLAN CATEGORIES & BUNDLE RENDERING
// -------------------------------------------------------------
function getAvailableCategoriesForNetwork(networkName) {
  const netUpper = (networkName || State.selectedNetworkData).toUpperCase();
  const activePlansForNet = (State.dataPlans || []).filter(
    p => p.network.toUpperCase() === netUpper && p.status === 'active'
  );

  const categories = new Set();
  activePlansForNet.forEach(p => {
    const cat = (p.planType || 'SME').trim().toUpperCase();
    if (cat) categories.add(cat);
  });

  // Common priority order: SME, SME2, GIFTING, CORPORATE GIFTING, CORPORATE GIFTING 2, DATA AWOOF, DATA COUPONS, DATA SHARE
  const priority = ['SME', 'SME2', 'GIFTING', 'CORPORATE GIFTING', 'CORPORATE GIFTING 2', 'CORPORATE', 'DATA AWOOF', 'DATA COUPONS', 'DATA SHARE'];
  const sorted = Array.from(categories).sort((a, b) => {
    const idxA = priority.indexOf(a);
    const idxB = priority.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  return sorted;
}

function renderPlanCategories() {
  const categoryContainer = document.getElementById('dataCategorySelector');
  if (!categoryContainer) return;

  const currentNetwork = State.selectedNetworkData;
  const categories = getAvailableCategoriesForNetwork(currentNetwork);

  if (categories.length === 0) {
    categoryContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No active plan categories available for ${currentNetwork}.</span>`;
    State.selectedCategory = '';
    return;
  }

  // If current selected category is not available in the new network, default to first available
  if (!State.selectedCategory || !categories.includes(State.selectedCategory.toUpperCase())) {
    State.selectedCategory = categories[0];
  }

  categoryContainer.innerHTML = categories.map(cat => {
    const count = (State.dataPlans || []).filter(
      p => p.network.toUpperCase() === currentNetwork.toUpperCase() &&
           p.status === 'active' &&
           (p.planType || '').toUpperCase() === cat
    ).length;

    const isSelected = State.selectedCategory.toUpperCase() === cat;
    return `
      <div class="category-pill ${isSelected ? 'selected' : ''}" onclick="selectPlanCategory('${cat}')">
        <span>${cat}</span>
        <span class="pill-count">${count}</span>
      </div>
    `;
  }).join('');

  const catBadge = document.getElementById('currentCategoryBadge');
  if (catBadge) catBadge.innerText = State.selectedCategory;
}

window.selectPlanCategory = function(categoryName) {
  State.selectedCategory = categoryName;
  State.selectedPlan = null;
  updateSelectedPlanPreview();
  renderPlanCategories();
  renderDataPlans();
};

function renderDataPlans() {
  const container = document.getElementById('dataPlansGrid');
  if (!container) return;

  const currentNetwork = State.selectedNetworkData;
  const currentCategory = (State.selectedCategory || '').toUpperCase();

  // Filter STRICTLY by current selected network, status active, and current category. Do not mix categories!
  const filtered = (State.dataPlans || []).filter(p =>
    p.network.toUpperCase() === currentNetwork.toUpperCase() &&
    p.status === 'active' &&
    (!currentCategory || (p.planType || '').toUpperCase() === currentCategory)
  );

  const planCountBadge = document.getElementById('planCountBadge');
  if (planCountBadge) {
    planCountBadge.innerText = `${filtered.length} plan${filtered.length === 1 ? '' : 's'} available`;
  }

  const catBadge = document.getElementById('currentCategoryBadge');
  if (catBadge) {
    catBadge.innerText = currentCategory || 'Active';
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; padding: 32px 20px; text-align: center; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
        <i class="fa-solid fa-folder-open" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 10px; display: block;"></i>
        <div style="color: #FFF; font-weight: 600; margin-bottom: 4px;">No Available ${currentCategory} Plans Found</div>
        <div style="color: var(--text-muted); font-size: 0.85rem;">There are currently no active ${currentCategory} bundles for ${currentNetwork}. Please select another category above.</div>
      </div>
    `;
    updateSelectedPlanPreview();
    return;
  }

  // Sort by selling price ascending
  filtered.sort((a, b) => (parseFloat(a.sellingPrice) || 0) - (parseFloat(b.sellingPrice) || 0));

  container.innerHTML = filtered.map(plan => {
    const isSelected = State.selectedPlan?.id === plan.id;
    const netClass = plan.network.toLowerCase() === '9mobile' ? 'network-9mobile' : plan.network.toLowerCase();

    return `
      <div class="plan-card ${isSelected ? 'selected' : ''}" onclick="selectDataPlan('${plan.id}')">
        <div class="plan-card-header">
          <div class="plan-badges">
            <span class="plan-badge-network ${netClass}">${plan.network}</span>
            <span class="plan-badge-category">${plan.planType || 'DATA'}</span>
          </div>
          <div class="plan-validity">
            <i class="fa-regular fa-clock"></i> ${plan.validity}
          </div>
        </div>

        <div>
          <div class="plan-data-val">${plan.size || plan.name}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">${plan.name}</div>
        </div>

        <div class="plan-card-footer">
          <span class="plan-price-label">Selling Price</span>
          <span class="plan-price-tag">${formatNaira(plan.sellingPrice)}</span>
        </div>
      </div>
    `;
  }).join('');

  updateSelectedPlanPreview();
}

window.selectDataPlan = function(planId) {
  State.selectedPlan = (State.dataPlans || []).find(p => p.id === planId) || null;
  renderDataPlans();
  updateSelectedPlanPreview();
};

function updateSelectedPlanPreview() {
  const previewBox = document.getElementById('selectedPlanPreviewBox');
  const btn = document.getElementById('btnDataProceed');

  if (!State.selectedPlan) {
    if (previewBox) previewBox.style.display = 'none';
    if (btn) btn.disabled = true;
    return;
  }

  const plan = State.selectedPlan;
  if (previewBox) {
    previewBox.style.display = 'flex';
    document.getElementById('selectedPlanMetaBadge').innerText = `${plan.network} • ${plan.planType || 'DATA'}`;
    document.getElementById('selectedPlanValidityText').innerHTML = `<i class="fa-regular fa-clock"></i> ${plan.validity}`;
    document.getElementById('selectedPlanTitleText').innerText = plan.name || `${plan.size} ${plan.planType}`;
    document.getElementById('selectedPlanPriceText').innerText = formatNaira(plan.sellingPrice);
  }

  if (btn) btn.disabled = false;
}

async function loadAllTransactions() {
  const type = document.getElementById('txFilterType')?.value || 'all';
  const status = document.getElementById('txFilterStatus')?.value || 'all';
  const search = document.getElementById('txSearchInput')?.value.trim() || '';

  const { ok, data } = await authFetch(`/wallet/transactions?type=${type}&status=${status}&search=${encodeURIComponent(search)}`);
  const tbody = document.getElementById('allTransactionsTableBody');
  if (!tbody) return;

  if (ok && data.success && data.transactions.length > 0) {
    tbody.innerHTML = data.transactions.map(tx => {
      let badgeClass = 'badge-success';
      if (tx.status === 'Pending') badgeClass = 'badge-warning';
      if (tx.status === 'Failed') badgeClass = 'badge-danger';

      return `
        <tr>
          <td><code style="color: var(--accent-emerald); font-size: 0.8rem;">${tx.id}</code></td>
          <td><strong style="text-transform: capitalize;">${tx.type}</strong></td>
          <td>${tx.phoneNumber || '-'}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: ${tx.type === 'deposit' ? 'var(--accent-emerald)' : '#FFF'};">
            ${tx.type === 'deposit' ? '+' : '-'}${formatNaira(tx.amount)}
          </td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTime(tx.createdAt)}</td>
          <td><span class="badge ${badgeClass}">${tx.status}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick='showReceiptModal(${JSON.stringify(tx).replace(/'/g, "&apos;")})'>
              <i class="fa-solid fa-receipt"></i> Receipt
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 28px; color: var(--text-muted);">No matching transactions found.</td></tr>`;
  }
}

function showReceiptModal(tx) {
  const body = document.getElementById('txReceiptBody');
  if (!body) return;

  let badgeClass = tx.status === 'Successful' ? 'badge-success' : tx.status === 'Pending' ? 'badge-warning' : 'badge-danger';

  body.innerHTML = `
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="Image.png" alt="STRICTWALLET" style="height: 44px; margin-bottom: 8px;">
      <h3 style="font-size: 1.1rem; color: #FFF;">STRICTWALLET TRANSACTION RECEIPT</h3>
      <span class="badge ${badgeClass}" style="margin-top: 6px;">${tx.status}</span>
    </div>

    <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px; display: flex; flex-direction: column; gap: 10px; font-size: 0.88rem;">
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Transaction ID:</span>
        <code style="color: var(--accent-emerald);">${tx.id}</code>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Provider Reference:</span>
        <span style="color: #FFF; font-family: var(--font-mono);">${tx.providerReference || '-'}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Transaction Type:</span>
        <strong style="color: #FFF; text-transform: uppercase;">${tx.type}</strong>
      </div>
      ${tx.network ? `
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Network:</span>
        <span style="color: #FFF;">${tx.network}</span>
      </div>` : ''}
      ${tx.phoneNumber ? `
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Recipient:</span>
        <span style="color: #FFF; font-family: var(--font-mono);">${tx.phoneNumber}</span>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Date & Time:</span>
        <span style="color: #FFF;">${formatDateTime(tx.createdAt)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px; font-size: 1.1rem;">
        <span style="color: var(--text-muted);">Amount Paid:</span>
        <strong style="color: var(--accent-emerald); font-family: var(--font-mono);">${formatNaira(tx.amount)}</strong>
      </div>
    </div>
  `;

  openModal('txReceiptModal');
}

// -------------------------------------------------------------
// CUSTOMER CARE TICKETS & MESSAGING
// -------------------------------------------------------------
async function loadUserTickets() {
  const { ok, data } = await authFetch('/support/my-tickets');
  const tbody = document.getElementById('userTicketsTableBody');
  if (!tbody) return;

  if (ok && data.success && data.tickets.length > 0) {
    tbody.innerHTML = data.tickets.map(t => {
      let badgeClass = t.status === 'Open' ? 'badge-info' : t.status === 'Resolved' ? 'badge-success' : 'badge-warning';

      return `
        <tr>
          <td><code style="color: var(--accent-emerald);">${t.ticketNumber}</code></td>
          <td><strong>${t.subject}</strong></td>
          <td>${t.category}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTime(t.createdAt)}</td>
          <td><span class="badge ${badgeClass}">${t.status}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openTicketChat('${t.id}', '${t.ticketNumber}', '${t.subject.replace(/'/g, "&apos;")}')">
              <i class="fa-solid fa-comments"></i> View Chat
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 28px; color: var(--text-muted);">No support tickets opened yet.</td></tr>`;
  }
}

window.openTicketChat = async function(ticketId, ticketNumber, subject) {
  State.activeChatTicketId = ticketId;
  document.getElementById('chatTicketNumber').innerText = `Ticket #${ticketNumber}`;
  document.getElementById('chatTicketSubject').innerText = subject;
  openModal('ticketChatModal');
  await loadTicketChat(ticketId);
};

async function loadTicketChat(ticketId) {
  const container = document.getElementById('ticketChatContainer');
  const { ok, data } = await authFetch(`/support/ticket/${ticketId}`);

  if (ok && data.success) {
    if (data.messages.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No messages in this ticket yet.</div>`;
      return;
    }

    container.innerHTML = data.messages.map(m => `
      <div class="chat-bubble ${m.senderRole === 'user' ? 'user' : 'admin'}">
        <strong style="font-size: 0.75rem; opacity: 0.8; display: block; margin-bottom: 3px;">
          ${m.senderRole === 'user' ? 'You' : 'STRICTWALLET Support Specialist'}
        </strong>
        <div>${m.message}</div>
        <span class="chat-time">${formatDateTime(m.createdAt)}</span>
      </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
  }
}

function logoutUser(showNotification = true) {
  State.token = null;
  State.user = null;
  State.wallet = null;
  localStorage.removeItem('strictwallet_token');
  sessionStorage.removeItem('strictwallet_token');
  showAuthScreen('loginCard');
  if (showNotification) showToast('You have been signed out safely.', 'info');
}

// --- PAYSTACK WALLET FUNDING ---
document.getElementById('fundWalletForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amountInput = document.getElementById('depositAmount').value;
  const amount = parseFloat(amountInput);
  
  if (!amount || amount < 100) {
    showToast('Minimum deposit amount is ₦100', 'warning');
    return;
  }
  
  const btn = document.getElementById('btnProcessPayment');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

  try {
    const { ok, data } = await authFetch('/wallet/deposit/initialize', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });

    if (!ok || !data.success) {
      throw new Error(data.message || 'Failed to initialize payment');
    }

    closeModal('fundWalletModal');
    document.getElementById('fundWalletForm').reset();

    const handler = PaystackPop.setup({
      key: data.publicKey,
      email: State.user.email,
      amount: amount * 100, // kobo
      reference: data.reference,
      currency: 'NGN',
      callback: function(response) {
        showToast('Payment successful, verifying...', 'info');
        // Handle async logic inside the regular function
        (async () => {
          try {
            const verifyRes = await authFetch('/wallet/deposit/verify', {
              method: 'POST',
              body: JSON.stringify({ reference: response.reference })
            });
            
            if (verifyRes.ok && verifyRes.data.success) {
              showToast(`Successfully deposited ₦${amount.toLocaleString()}`, 'success');
              await initUserSession(); // Refresh wallet overview
            } else {
              showToast(verifyRes.data?.message || 'Verification failed. Please contact support.', 'error');
            }
          } catch (err) {
            showToast('An error occurred during verification.', 'error');
          }
        })();
      },
      onClose: function() {
        showToast('Payment window closed', 'info');
      }
    });

    handler.openIframe();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
});
