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
  activeChatTicketId: null,
  eventsList: [],
  selectedEvent: null,
  selectedTicketType: null,
  activeAttendeesData: null,
  strowalletBanks: [],
  html5QrScanner: null,
  organizerWalletBalance: 0,
  organizerWithdrawals: [],
  currentCreatorReceiptWithdrawal: null
};

// API Base URL (Relative /api for local development & same-origin production)
const API_BASE = (window.location.protocol.startsWith('http') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.origin.includes('datapay.onrender.com')))
  ? '/api'
  : 'https://datapay.onrender.com/api';


// HTML Escape Utility
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

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
  document.getElementById('sidebarBackdrop')?.classList.remove('active');

  // Update Topbar Title
  const titles = {
    viewDashboard: 'Dashboard',
    viewAirtime: 'Buy Airtime',
    viewData: 'Buy Data Bundles',
    viewTransactions: 'Transaction Ledger',
    viewEvents: 'Events Marketplace & Tickets',
    viewSupport: 'Customer Care Help Desk',
    viewSettings: 'Account Settings'
  };
  document.getElementById('pageHeadline').innerText = titles[viewId] || 'STRICTWALLET';

  // Load specific data on navigation
  if (viewId === 'viewTransactions') loadAllTransactions();
  if (viewId === 'viewSupport') loadUserTickets();
  if (viewId === 'viewEvents') loadMarketplaceEvents();
  if (viewId === 'viewSettings') loadOrganizerWallet();
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

// -------------------------------------------------------------
// SHARED LINK PARSER & PENDING TARGET PERSISTENCE
// -------------------------------------------------------------
function getSharedTargetFromUrl() {
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);
  let target = null;

  if (path.startsWith('/events/')) {
    const slug = path.replace('/events/', '').split('/')[0].split('?')[0];
    if (slug) target = { type: 'event', id: slug };
  } else if (path.startsWith('/event/')) {
    const slug = path.replace('/event/', '').split('/')[0].split('?')[0];
    if (slug) target = { type: 'event', id: slug };
  } else if (path.startsWith('/tickets/')) {
    const ticketId = path.replace('/tickets/', '').split('/')[0].split('?')[0];
    if (ticketId) target = { type: 'ticket', id: ticketId };
  } else if (path.startsWith('/ticket/')) {
    const ticketId = path.replace('/ticket/', '').split('/')[0].split('?')[0];
    if (ticketId) target = { type: 'ticket', id: ticketId };
  }

  if (!target) {
    if (searchParams.get('event')) {
      target = { type: 'event', id: searchParams.get('event') };
    } else if (searchParams.get('ticket')) {
      target = { type: 'ticket', id: searchParams.get('ticket') };
    }
  }

  if (target) {
    if (searchParams.get('ticketType')) {
      target.ticketTypeId = searchParams.get('ticketType');
    }
    if (searchParams.get('holder')) {
      target.ticketHolder = searchParams.get('holder');
    }
  }

  return target;
}

function savePendingReturnTarget(target) {
  if (!target) return;
  try {
    sessionStorage.setItem('strictwallet_pending_target', JSON.stringify(target));
  } catch (e) {}
}

function getPendingReturnTarget() {
  try {
    const raw = sessionStorage.getItem('strictwallet_pending_target');
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  const legacySlug = sessionStorage.getItem('strictwallet_return_event');
  if (legacySlug) {
    return {
      type: 'event',
      id: legacySlug,
      ticketTypeId: sessionStorage.getItem('strictwallet_return_ticket_type') || null,
      ticketHolder: sessionStorage.getItem('strictwallet_return_ticket_holder') || null
    };
  }
  return null;
}

function clearPendingReturnTarget() {
  try {
    sessionStorage.removeItem('strictwallet_pending_target');
    sessionStorage.removeItem('strictwallet_return_event');
    sessionStorage.removeItem('strictwallet_return_ticket_type');
    sessionStorage.removeItem('strictwallet_return_ticket_holder');
  } catch (e) {}
}

async function renderSharedInvitationBanner(target) {
  if (!target) return;
  const loginBanner = document.getElementById('authSharedBanner');
  const regBanner = document.getElementById('regSharedBanner');
  if (!loginBanner && !regBanner) return;

  try {
    let title = 'STRICTWALLET Event';
    let subtitle = 'Sign in or create an account to view and purchase tickets.';
    let actionBtnHtml = '';

    if (target.type === 'event') {
      const endpoint = target.id.startsWith('EVT-') ? `/events/${target.id}` : `/events/slug/${target.id}`;
      const { ok, data } = await authFetch(endpoint);
      if (ok && data.success && data.event) {
        const ev = data.event;
        title = ev.title;
        const venuePart = ev.venue ? ` • ${ev.venue}` : '';
        subtitle = `You've been invited to <strong>${ev.title}</strong>${venuePart}. Sign in or register to get your ticket.`;
        actionBtnHtml = `<button type="button" class="banner-btn" onclick="openEventDetails('${ev.slug || ev.id}')"><i class="fa-solid fa-eye"></i> View Event</button>`;
      }
    } else if (target.type === 'ticket') {
      const { ok, data } = await authFetch(`/events/ticket-info/${target.id}`);
      if (ok && data.success && data.event) {
        title = data.event.title;
        subtitle = `You've received a ticket link for <strong>${data.event.title}</strong>. Sign in or register to access this ticket.`;
        actionBtnHtml = `<button type="button" class="banner-btn" onclick="openEventDetails('${data.event.slug || data.event.id}')"><i class="fa-solid fa-eye"></i> View Event</button>`;
      }
    }

    const bannerHtml = `
      <div class="banner-icon"><i class="fa-solid fa-ticket"></i></div>
      <div class="banner-content">
        <div class="banner-title"><i class="fa-solid fa-envelope-open-text"></i> Shared Invitation: ${title}</div>
        <div class="banner-subtitle">${subtitle}</div>
      </div>
      ${actionBtnHtml}
    `;

    if (loginBanner) {
      loginBanner.innerHTML = bannerHtml;
      loginBanner.style.display = 'flex';
    }
    if (regBanner) {
      regBanner.innerHTML = bannerHtml;
      regBanner.style.display = 'flex';
    }
  } catch (err) {
    console.error('Error rendering shared invitation banner:', err);
  }
}

async function handleSharedTicket(ticketId) {
  if (!ticketId) return;
  try {
    const { ok, data } = await authFetch(`/events/ticket-info/${ticketId}`);
    if (!ok || !data.success) {
      showToast(data.message || 'Ticket not found or inaccessible.', 'warning');
      return;
    }

    if (data.isOwner && data.ticket) {
      viewPersonalizedTicket(data.ticket);
    } else if (data.event) {
      showToast(`Viewing event for ticket: ${data.event.title}`, 'info');
      await openEventDetails(data.event.slug || data.event.id, data.targetTicketTypeId);
    }
  } catch (err) {
    console.error('Error opening shared ticket:', err);
    showToast('Failed to load shared ticket.', 'error');
  }
}

// -------------------------------------------------------------
// APP INITIALIZATION & AUTH CHECKS
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupEventsModuleListeners();

  // Check URL pathname or query for shared event or ticket link
  const sharedTarget = getSharedTargetFromUrl() || getPendingReturnTarget();
  if (sharedTarget) {
    savePendingReturnTarget(sharedTarget);
  }

  if (State.token) {
    await initUserSession();
  } else {
    showAuthScreen('loginCard');
    if (sharedTarget) {
      renderSharedInvitationBanner(sharedTarget);
    }
  }
});

function showAuthScreen(cardId) {
  document.getElementById('authWrapper').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
  
  ['loginCard', 'registerCard', 'recoveryCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === cardId ? 'block' : 'none';
  });

  // Ensure shared banner is updated on card switch if target exists
  const target = getPendingReturnTarget();
  if (target) {
    renderSharedInvitationBanner(target);
  }
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

  // Load social media community links into dashboard
  fetchAndRenderSocialLinks();

  showAppScreen();

  // Automatically return to pending event or ticket if redirected during auth or funding flow
  const pendingTarget = getPendingReturnTarget();
  if (pendingTarget) {
    clearPendingReturnTarget();
    if (pendingTarget.type === 'ticket') {
      navigateToView('viewEvents');
      switchEventTab('my-tickets');
      setTimeout(() => {
        handleSharedTicket(pendingTarget.id);
      }, 250);
    } else {
      navigateToView('viewEvents');
      switchEventTab('discover');
      setTimeout(async () => {
        await openEventDetails(pendingTarget.id, pendingTarget.ticketTypeId);
        if (pendingTarget.ticketHolder) {
          const holderInput = document.getElementById('ticketHolderFullName');
          if (holderInput) holderInput.value = pendingTarget.ticketHolder;
        }
        if (pendingTarget.returnToPurchase) {
          initiateTicketPurchase();
        }
      }, 250);
    }
  }
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

// Fetch admin-configured social media links and render them into the user-facing grid
async function fetchAndRenderSocialLinks() {
  const container = document.getElementById('userSocialLinksContainer');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/settings/social-links`);
    const json = await res.json();

    if (!json.success || !Array.isArray(json.links) || json.links.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); padding: 16px; text-align: center;">No social channels configured yet.</p>';
      return;
    }

    // Platform-specific brand colours for the icon boxes
    const brandColors = {
      'whatsapp': '#25D366',
      'telegram': '#2AABEE',
      'x/twitter': '#000000',
      'twitter': '#1DA1F2',
      'instagram': '#E4405F',
      'facebook': '#1877F2',
      'youtube': '#FF0000',
      'tiktok': '#010101',
      'linkedin': '#0A66C2',
      'discord': '#5865F2',
      'snapchat': '#FFFC00',
      'threads': '#000000'
    };

    container.innerHTML = json.links.map(link => {
      const platformKey = (link.platform || '').toLowerCase();
      const bgColor = brandColors[platformKey] || 'var(--accent-emerald)';
      const iconClass = link.icon || 'fa-solid fa-link';
      const actionText = link.actionText || 'Open';

      return `
        <a href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" class="social-link-card">
          <div class="social-link-icon-box" style="background: ${bgColor}; color: #fff;">
            <i class="${escapeHTML(iconClass)}"></i>
          </div>
          <div class="social-link-info">
            <div class="social-link-title">${escapeHTML(link.name || link.platform)}</div>
            <div class="social-link-action">${escapeHTML(actionText)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.65rem;"></i></div>
          </div>
        </a>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load social links:', err);
    container.innerHTML = '<p style="color: var(--text-secondary); padding: 16px; text-align: center;">Could not load social channels.</p>';
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

  // Mobile Drawer Toggle & Backdrop Handlers
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const toggleSidebar = () => {
    const isOpen = sidebar?.classList.toggle('mobile-open');
    sidebarBackdrop?.classList.toggle('active', !!isOpen);
  };
  const closeSidebar = () => {
    sidebar?.classList.remove('mobile-open');
    sidebarBackdrop?.classList.remove('active');
  };

  document.getElementById('mobileToggleBtn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarCloseBtn')?.addEventListener('click', closeSidebar);
  sidebarBackdrop?.addEventListener('click', closeSidebar);

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

// ==========================================================================
// STRICTWALLET EVENT TICKETING & EVENT CREATOR MODULE
// ==========================================================================

function setupEventsModuleListeners() {
  // Live search in marketplace
  document.getElementById('searchEventsInput')?.addEventListener('input', function(e) {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#eventsGridContainer .event-card').forEach(card => {
      const text = card.innerText.toLowerCase();
      card.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  // Cloudinary Banner Upload
  document.getElementById('ceBannerFile')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('ceBannerStatus');
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-emerald);"></i> Uploading banner to Cloudinary...`;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result;
        const { ok, data } = await authFetch('/events/upload', {
          method: 'POST',
          body: JSON.stringify({ image: base64Data, folder: 'strictwallet_banners' })
        });
        if (ok && data.success) {
          document.getElementById('ceBannerUrl').value = data.url;
          document.getElementById('ceBannerPreview').src = data.url;
          document.getElementById('ceBannerPreviewWrap').style.display = 'block';
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-emerald);"></i> Banner uploaded to Cloudinary!`;
        } else {
          statusEl.innerHTML = `<span style="color: var(--status-error);"><i class="fa-solid fa-circle-xmark"></i> ${data.message || 'Upload failed'}</span>`;
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      statusEl.innerHTML = `<span style="color: var(--status-error);">Upload error</span>`;
    }
  });

  // Cloudinary Ticket Design Upload
  document.getElementById('ceDesignFile')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('ceDesignStatus');
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue-light);"></i> Uploading ticket artwork to Cloudinary...`;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result;
        const { ok, data } = await authFetch('/events/upload', {
          method: 'POST',
          body: JSON.stringify({ image: base64Data, folder: 'strictwallet_tickets' })
        });
        if (ok && data.success) {
          document.getElementById('ceDesignUrl').value = data.url;
          document.getElementById('ceDesignPreview').src = data.url;
          document.getElementById('ceDesignPreviewWrap').style.display = 'block';
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-emerald);"></i> Ticket artwork uploaded to Cloudinary!`;
        } else {
          statusEl.innerHTML = `<span style="color: var(--status-error);"><i class="fa-solid fa-circle-xmark"></i> ${data.message || 'Upload failed'}</span>`;
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      statusEl.innerHTML = `<span style="color: var(--status-error);">Upload error</span>`;
    }
  });

  // Event Creator Withdrawal Form Submission
  document.getElementById('eventWithdrawForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    await submitEventWithdrawal();
  });
}

// -------------------------------------------------------------
// 1. EVENT NAVIGATION & TABS
// -------------------------------------------------------------
function switchEventTab(tabName) {
  document.getElementById('tabBtnDiscover')?.classList.toggle('active', tabName === 'discover');
  document.getElementById('tabBtnMyEvents')?.classList.toggle('active', tabName === 'my-events');
  document.getElementById('tabBtnMyTickets')?.classList.toggle('active', tabName === 'my-tickets');

  document.getElementById('eventsTabDiscover').style.display = tabName === 'discover' ? 'block' : 'none';
  document.getElementById('eventsTabMyEvents').style.display = tabName === 'my-events' ? 'block' : 'none';
  document.getElementById('eventsTabMyTickets').style.display = tabName === 'my-tickets' ? 'block' : 'none';

  if (tabName === 'discover') loadMarketplaceEvents();
  if (tabName === 'my-events') loadMyOrganizedEvents();
  if (tabName === 'my-tickets') loadMyTickets();
}

// -------------------------------------------------------------
// 2. DISCOVER EVENTS (Marketplace Grid)
// -------------------------------------------------------------
async function loadMarketplaceEvents() {
  const container = document.getElementById('eventsGridContainer');
  const emptyState = document.getElementById('eventsEmptyState');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
      <p style="margin-top: 10px;">Loading live events marketplace...</p>
    </div>
  `;

  try {
    const { ok, data } = await authFetch('/events');
    if (ok && data.success) {
      State.eventsList = data.events || [];
      if (State.eventsList.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        container.innerHTML = State.eventsList.map(renderMarketplaceEventCard).join('');
      }
    } else {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--status-error); padding: 30px;">Failed to load events.</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--status-error); padding: 30px;">Error connecting to event service.</div>`;
  }
}

function renderMarketplaceEventCard(ev) {
  const banner = ev.bannerUrl || 'Image.png';
  const eventDateStr = ev.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBA';
  const priceDisplay = ev.startingPrice > 0 ? formatNaira(ev.startingPrice) : 'Free';
  const remainingDisplay = ev.remainingTickets > 0 ? `${ev.remainingTickets} left` : `<span style="color: var(--status-error);">Sold Out</span>`;

  return `
    <div class="event-card" id="evCard_${ev.id}">
      <div class="event-banner-wrap">
        <img src="${banner}" alt="${ev.title}" class="event-banner-img" onerror="this.src='Image.png'">
        <div class="event-date-badge">
          <i class="fa-solid fa-calendar-day"></i> ${eventDateStr}
        </div>
      </div>
      <div class="event-card-content">
        <h3 class="event-card-title">${ev.title}</h3>
        <div class="event-card-meta">
          <div class="event-card-meta-item">
            <i class="fa-solid fa-location-dot"></i>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ev.venue}</span>
          </div>
          <div class="event-card-meta-item">
            <i class="fa-solid fa-clock"></i>
            <span>${ev.time || 'TBA'}</span>
          </div>
          <div class="event-card-meta-item">
            <i class="fa-solid fa-ticket"></i>
            <span>${remainingDisplay}</span>
          </div>
        </div>
        <div class="event-card-footer">
          <div class="event-price-tag">
            <span class="event-price-label">Tickets from</span>
            <span class="event-price-val">${priceDisplay}</span>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openEventDetails('${ev.slug || ev.id}')">
            <i class="fa-solid fa-ticket"></i> View / Buy
          </button>
        </div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// 3. EVENT DETAILS MODAL & SLUG ROUTING
// -------------------------------------------------------------
async function openEventDetails(slugOrId, preselectTicketTypeId = null) {
  const modal = document.getElementById('eventDetailsModal');
  if (!modal) return;

  // Fetch complete event details
  const endpoint = slugOrId.startsWith('EVT-') ? `/events/${slugOrId}` : `/events/slug/${slugOrId}`;
  const { ok, data } = await authFetch(endpoint);

  if (!ok || !data.success || !data.event) {
    showToast('Event not found or inactive.', 'warning');
    return;
  }

  const ev = data.event;
  State.selectedEvent = ev;
  State.selectedTicketType = null;

  // Populate Details
  document.getElementById('edBannerImg').src = ev.bannerUrl || '/Image.png';
  document.getElementById('edTitle').innerText = ev.title;
  document.getElementById('edVenue').innerText = ev.venue;
  
  const dStr = ev.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'TBA';
  document.getElementById('edDateTime').innerText = `${dStr} at ${ev.time || 'TBA'}`;
  
  if (ev.salesStartDate || ev.salesEndDate) {
    document.getElementById('edSalesPeriodRow').style.display = 'flex';
    document.getElementById('edSalesPeriod').innerText = `Sales: ${ev.salesStartDate ? formatDateTime(ev.salesStartDate) : 'Open'} - ${ev.salesEndDate ? formatDateTime(ev.salesEndDate) : 'Till Event'}`;
  } else {
    document.getElementById('edSalesPeriodRow').style.display = 'none';
  }

  document.getElementById('edCreatorName').innerText = ev.creatorName || 'STRICTWALLET Organizer';
  document.getElementById('edDescription').innerText = ev.description || 'No description provided.';

  // Shareable Link
  const shareUrl = `${window.location.origin}/events/${ev.slug}`;
  document.getElementById('edShareLinkText').innerText = shareUrl;

  // Ticket Holder field defaults to logged in user's name
  const holderInput = document.getElementById('ticketHolderFullName');
  if (holderInput && State.user && !holderInput.value) {
    holderInput.value = State.user.fullName;
  }

  // Render Available Ticket Types
  const ttContainer = document.getElementById('edTicketTypesList');
  ttContainer.innerHTML = '';

  const ticketTypes = ev.ticketTypes || [];
  if (ticketTypes.length === 0) {
    ttContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">No ticket categories configured.</div>`;
  } else {
    ticketTypes.forEach((tt, idx) => {
      const qtyAvailable = parseInt(tt.quantityAvailable, 10) || 0;
      const qtySold = parseInt(tt.quantitySold, 10) || 0;
      const remaining = Math.max(0, qtyAvailable - qtySold);
      const isSoldOut = remaining <= 0;

      const isTargetType = preselectTicketTypeId && (tt.id === preselectTicketTypeId || tt.name.toLowerCase() === preselectTicketTypeId.toLowerCase());
      const isSelected = !isSoldOut && (isTargetType || (!preselectTicketTypeId && idx === 0 && !State.selectedTicketType));

      const ttCard = document.createElement('div');
      ttCard.className = `ticket-option-card ${isSelected ? 'selected' : ''} ${isSoldOut ? 'sold-out' : ''}`;
      ttCard.style.cssText = `
        display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
        background: ${isSelected ? 'rgba(0, 208, 156, 0.12)' : 'rgba(13, 21, 45, 0.8)'};
        border: 1px solid ${isSelected ? 'var(--accent-emerald)' : 'var(--border-color)'};
        border-radius: var(--radius-md); cursor: ${isSoldOut ? 'not-allowed' : 'pointer'};
        opacity: ${isSoldOut ? '0.5' : '1'}; transition: var(--transition);
      `;

      ttCard.innerHTML = `
        <div>
          <div style="font-weight: 700; color: #FFF; font-size: 0.95rem;">${tt.name}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">
            ${isSoldOut ? '<span style="color: var(--status-error); font-weight: 700;">SOLD OUT</span>' : `${remaining} tickets available`}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-emerald); font-family: var(--font-mono);">
            ${formatNaira(tt.price)}
          </div>
        </div>
      `;

      if (!isSoldOut) {
        ttCard.onclick = () => {
          document.querySelectorAll('.ticket-option-card').forEach(c => {
            c.style.background = 'rgba(13, 21, 45, 0.8)';
            c.style.borderColor = 'var(--border-color)';
          });
          ttCard.style.background = 'rgba(0, 208, 156, 0.12)';
          ttCard.style.borderColor = 'var(--accent-emerald)';
          State.selectedTicketType = tt;
          document.getElementById('edSelectedPriceDisplay').innerText = formatNaira(tt.price);
        };
      }

      ttContainer.appendChild(ttCard);

      if (isSelected) {
        State.selectedTicketType = tt;
        document.getElementById('edSelectedPriceDisplay').innerText = formatNaira(tt.price);
      }
    });
  }

  if (State.selectedTicketType) {
    document.getElementById('edSelectedPriceDisplay').innerText = formatNaira(State.selectedTicketType.price);
  } else {
    document.getElementById('edSelectedPriceDisplay').innerText = '₦0.00';
  }

  openModal('eventDetailsModal');
}

function copyEventShareLink() {
  if (!State.selectedEvent) return;
  const shareUrl = `${window.location.origin}/events/${State.selectedEvent.slug}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Event link copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy shareable event URL:', shareUrl);
    });
  } else {
    prompt('Copy shareable event URL:', shareUrl);
  }
}

function copyTicketShareLink(ticketId = null) {
  const id = ticketId || State.currentViewingTicket?.id;
  if (!id) return;
  const shareUrl = `${window.location.origin}/tickets/${id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Ticket link copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy shareable ticket URL:', shareUrl);
    });
  } else {
    prompt('Copy shareable ticket URL:', shareUrl);
  }
}

// -------------------------------------------------------------
// 4. CREATE / EDIT EVENT FORM LOGIC
// -------------------------------------------------------------
// 4. CREATE / EDIT EVENT FORM LOGIC
// -------------------------------------------------------------
function openCreateEventModal(eventId = null) {
  if (!State.token || !State.user) {
    showToast('Please sign in or register to create an event.', 'info');
    showAuthScreen('loginCard');
    return;
  }

  document.getElementById('editEventId').value = eventId || '';
  document.getElementById('ceTitle').value = '';
  document.getElementById('ceDescription').value = '';
  document.getElementById('ceVenue').value = '';
  document.getElementById('ceDate').value = '';
  document.getElementById('ceTime').value = '';
  document.getElementById('ceSalesStart').value = '';
  document.getElementById('ceSalesEnd').value = '';
  document.getElementById('ceBannerUrl').value = '';
  document.getElementById('ceDesignUrl').value = '';
  document.getElementById('ceBannerFile').value = '';
  document.getElementById('ceDesignFile').value = '';
  document.getElementById('ceBannerPreviewWrap').style.display = 'none';
  document.getElementById('ceDesignPreviewWrap').style.display = 'none';
  document.getElementById('ceBannerStatus').innerText = 'Supports JPG, PNG, WEBP';
  document.getElementById('ceDesignStatus').innerText = 'Artwork used as ticket background';

  // Reset modal title & button labels
  const mTitle = document.querySelector('#createEventModal .card-title');
  const mSub = document.querySelector('#createEventModal .card-subtitle');
  const bPub = document.getElementById('btnPublishEvent');
  const bDraft = document.getElementById('btnSaveEventDraft');

  if (mTitle) mTitle.innerHTML = `<i class="fa-solid fa-calendar-plus" style="color: var(--accent-emerald);"></i> Create Event`;
  if (mSub) mSub.innerText = 'Set up your event, upload banner & ticket artwork, and configure ticket types.';
  if (bPub) bPub.innerHTML = `<i class="fa-solid fa-upload"></i> Publish Event`;
  if (bDraft) bDraft.innerHTML = `<i class="fa-regular fa-file"></i> Save Draft`;

  // Initialize ticket type rows
  const container = document.getElementById('ticketTypesContainer');
  container.innerHTML = '';
  addTicketTypeRow('Regular', '2000', '100');
  addTicketTypeRow('VIP', '5000', '50');

  openModal('createEventModal');
}

async function openEditEventModal(eventId) {
  if (!State.token || !State.user) {
    showToast('Please sign in to edit your event.', 'info');
    showAuthScreen('loginCard');
    return;
  }

  try {
    const { ok, data } = await authFetch(`/events/${eventId}`);
    if (!ok || !data.success || !data.event) {
      showToast('Failed to load event details for editing.', 'error');
      return;
    }

    const ev = data.event;

    // Security: only the creator can edit their event
    if (ev.creatorId !== State.user.id && State.user.role !== 'admin') {
      showToast('You can only edit events that you personally created.', 'error');
      return;
    }

    document.getElementById('editEventId').value = ev.id;
    document.getElementById('ceTitle').value = ev.title || '';
    document.getElementById('ceDescription').value = ev.description || '';
    document.getElementById('ceVenue').value = ev.venue || '';
    document.getElementById('ceDate').value = ev.date || '';
    document.getElementById('ceTime').value = ev.time || '';
    document.getElementById('ceSalesStart').value = ev.salesStartDate ? ev.salesStartDate.slice(0, 16) : '';
    document.getElementById('ceSalesEnd').value = ev.salesEndDate ? ev.salesEndDate.slice(0, 16) : '';
    document.getElementById('ceBannerUrl').value = ev.bannerUrl || '';
    document.getElementById('ceDesignUrl').value = ev.ticketDesignUrl || '';
    document.getElementById('ceBannerFile').value = '';
    document.getElementById('ceDesignFile').value = '';

    const bPreview = document.getElementById('ceBannerPreview');
    const bWrap = document.getElementById('ceBannerPreviewWrap');
    if (ev.bannerUrl) {
      bPreview.src = ev.bannerUrl;
      bWrap.style.display = 'block';
    } else {
      bWrap.style.display = 'none';
    }

    const dPreview = document.getElementById('ceDesignPreview');
    const dWrap = document.getElementById('ceDesignPreviewWrap');
    if (ev.ticketDesignUrl) {
      dPreview.src = ev.ticketDesignUrl;
      dWrap.style.display = 'block';
    } else {
      dWrap.style.display = 'none';
    }

    // Populate ticket types with category IDs and sold protections
    const container = document.getElementById('ticketTypesContainer');
    container.innerHTML = '';
    if (ev.ticketTypes && Array.isArray(ev.ticketTypes) && ev.ticketTypes.length > 0) {
      ev.ticketTypes.forEach(tt => {
        addTicketTypeRow(tt.name, tt.price, tt.quantityAvailable, tt.id, tt.quantitySold || 0);
      });
    } else {
      addTicketTypeRow('Regular', '2000', '100');
    }

    // Update modal header & button labels for Edit mode
    const mTitle = document.querySelector('#createEventModal .card-title');
    const mSub = document.querySelector('#createEventModal .card-subtitle');
    const bPub = document.getElementById('btnPublishEvent');
    const bDraft = document.getElementById('btnSaveEventDraft');

    if (mTitle) mTitle.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: var(--accent-emerald);"></i> Edit Event`;
    if (mSub) mSub.innerText = `Update event information, schedule, artwork, or ticket categories for "${ev.title}".`;
    if (bPub) bPub.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update & Publish`;
    if (bDraft) bDraft.innerHTML = `<i class="fa-regular fa-file"></i> Save Draft Changes`;

    openModal('createEventModal');
  } catch (err) {
    console.error('Edit Event Error:', err);
    showToast('Failed to open event editor.', 'error');
  }
}

function addTicketTypeRow(name = '', price = '', qty = '', id = '', sold = 0) {
  const container = document.getElementById('ticketTypesContainer');
  if (!container) return;

  const rowId = `tt_row_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const row = document.createElement('div');
  row.className = 'ticket-type-item-card';
  row.id = rowId;
  row.dataset.ttId = id || '';
  row.dataset.ttSold = sold || 0;

  const hasSales = parseInt(sold, 10) > 0;

  row.innerHTML = `
    <div>
      <input type="text" class="tt-name" placeholder="Category Name (e.g. VVIP / Table for 4)" value="${name}" required style="padding: 8px 12px; font-size: 0.85rem;">
      ${hasSales ? `<div style="font-size: 0.72rem; color: var(--accent-emerald); margin-top: 3px;"><i class="fa-solid fa-circle-check"></i> ${sold} ticket(s) sold</div>` : ''}
    </div>
    <div>
      <input type="number" class="tt-price" placeholder="Price (₦)" value="${price}" min="0" required style="padding: 8px 12px; font-size: 0.85rem;">
    </div>
    <div>
      <input type="number" class="tt-qty" placeholder="Quantity" value="${qty}" min="${hasSales ? sold : 1}" required style="padding: 8px 12px; font-size: 0.85rem;" title="${hasSales ? `Minimum ${sold} (already sold)` : ''}">
    </div>
    <div>
      ${hasSales ? `
        <button type="button" class="btn-remove-tt" style="opacity: 0.45; cursor: not-allowed;" title="Cannot remove category with purchased tickets" disabled>
          <i class="fa-solid fa-lock"></i>
        </button>
      ` : `
        <button type="button" class="btn-remove-tt" title="Remove Ticket Category" onclick="document.getElementById('${rowId}').remove()">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `}
    </div>
  `;

  container.appendChild(row);
}

async function saveEvent(publishNow = false) {
  const title = document.getElementById('ceTitle').value.trim();
  const description = document.getElementById('ceDescription').value.trim();
  const venue = document.getElementById('ceVenue').value.trim();
  const date = document.getElementById('ceDate').value;
  const time = document.getElementById('ceTime').value;
  const salesStartDate = document.getElementById('ceSalesStart').value;
  const salesEndDate = document.getElementById('ceSalesEnd').value;
  const bannerUrl = document.getElementById('ceBannerUrl').value;
  const ticketDesignUrl = document.getElementById('ceDesignUrl').value;
  const editId = document.getElementById('editEventId').value;

  if (!title || !venue || !date || !time) {
    showToast('Please fill in Event Name, Venue, Date, and Time.', 'error');
    return;
  }

  // Gather ticket types
  const rows = document.querySelectorAll('#ticketTypesContainer .ticket-type-item-card');
  const ticketTypes = [];
  rows.forEach(r => {
    const n = r.querySelector('.tt-name').value.trim();
    const p = parseFloat(r.querySelector('.tt-price').value);
    const q = parseInt(r.querySelector('.tt-qty').value, 10);
    const id = r.dataset.ttId || '';
    const sold = parseInt(r.dataset.ttSold, 10) || 0;
    if (n && !isNaN(p) && !isNaN(q) && q > 0) {
      const item = {
        name: n,
        price: p,
        quantityAvailable: q,
        quantitySold: sold
      };
      if (id) item.id = id;
      ticketTypes.push(item);
    }
  });

  if (ticketTypes.length === 0) {
    showToast('Please add at least one valid ticket category.', 'error');
    return;
  }

  const payload = {
    title,
    description,
    venue,
    date,
    time,
    salesStartDate: salesStartDate || null,
    salesEndDate: salesEndDate || null,
    bannerUrl,
    ticketDesignUrl,
    ticketTypes,
    status: publishNow ? 'published' : 'draft'
  };

  const endpoint = editId ? `/events/${editId}` : '/events';
  const method = editId ? 'PUT' : 'POST';

  const btn = publishNow ? document.getElementById('btnPublishEvent') : document.getElementById('btnSaveEventDraft');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const { ok, data } = await authFetch(endpoint, {
      method,
      body: JSON.stringify(payload)
    });

    if (ok && data.success) {
      showToast(data.message || (editId ? 'Event updated successfully!' : 'Event saved successfully!'), 'success');
      closeModal('createEventModal');
      switchEventTab('my-events');
      loadMyOrganizedEvents();
      loadMarketplaceEvents();
    } else {
      showToast(data.message || 'Failed to save event.', 'error');
    }
  } catch (err) {
    showToast('Server error while saving event.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      const isEditing = !!editId;
      btn.innerHTML = publishNow
        ? (isEditing ? `<i class="fa-solid fa-floppy-disk"></i> Update & Publish` : `<i class="fa-solid fa-upload"></i> Publish Event`)
        : (isEditing ? `<i class="fa-regular fa-file"></i> Save Draft Changes` : `<i class="fa-regular fa-file"></i> Save Draft`);
    }
  }
}

// -------------------------------------------------------------
// 5. TICKET PURCHASE WITH STRICTWALLET WALLET DEDUCTION
// -------------------------------------------------------------
// 5. TICKET PURCHASE AUTHORIZATION FLOW
// -------------------------------------------------------------
function initiateTicketPurchase() {
  if (!State.selectedEvent) return;

  // Require login before purchase; preserve all selected context
  if (!State.token || !State.user) {
    savePendingReturnTarget({
      type: 'event',
      id: State.selectedEvent.slug || State.selectedEvent.id,
      ticketTypeId: State.selectedTicketType ? State.selectedTicketType.id : null,
      ticketHolder: document.getElementById('ticketHolderFullName')?.value.trim() || '',
      returnToPurchase: true
    });
    closeModal('eventDetailsModal');
    showAuthScreen('loginCard');
    renderSharedInvitationBanner({ type: 'event', id: State.selectedEvent.slug });
    showToast('Please sign in or create an account to complete your ticket purchase.', 'info');
    return;
  }

  if (!State.selectedTicketType) {
    showToast('Please select a ticket category to purchase.', 'warning');
    return;
  }

  // Populate purchase authorization PIN modal
  const holderInputVal = document.getElementById('ticketHolderFullName').value.trim();
  const ticketHolder = holderInputVal || State.user.fullName;

  document.getElementById('purModalEventTitle').innerText = State.selectedEvent.title;
  document.getElementById('purModalTicketType').innerText = State.selectedTicketType.name;
  document.getElementById('purModalTicketHolder').innerText = ticketHolder;
  document.getElementById('purModalAmount').innerText = formatNaira(State.selectedTicketType.price);
  
  const balance = parseFloat(State.wallet?.balance || 0);
  const ticketPrice = parseFloat(State.selectedTicketType.price || 0);
  document.getElementById('purModalWalletBalance').innerText = formatNaira(balance);

  // Insufficient Balance Check & Option to Fund
  const alertBox = document.getElementById('purModalInsufficientAlert');
  const shortageText = document.getElementById('purModalShortageText');
  const pinGroup = document.getElementById('purModalPinGroup');
  const confirmBtn = document.getElementById('btnConfirmEventPurchase');

  if (balance < ticketPrice) {
    const shortage = Math.max(0, ticketPrice - balance);
    if (shortageText) {
      shortageText.innerHTML = `Your wallet balance is <strong>${formatNaira(balance)}</strong>, which is insufficient for this <strong>${formatNaira(ticketPrice)}</strong> ticket (short by <strong>${formatNaira(shortage)}</strong>). Please fund your wallet to continue.`;
    }
    if (alertBox) alertBox.style.display = 'block';
    if (pinGroup) pinGroup.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
  } else {
    if (alertBox) alertBox.style.display = 'none';
    if (pinGroup) pinGroup.style.display = 'block';
    if (confirmBtn) confirmBtn.style.display = 'inline-flex';
    document.getElementById('eventPurchasePin').value = '';
  }

  openModal('eventPurchasePinModal');
}

function openFundWalletFromTicketPurchase() {
  if (!State.selectedEvent || !State.selectedTicketType) return;
  
  const balance = parseFloat(State.wallet?.balance || 0);
  const ticketPrice = parseFloat(State.selectedTicketType.price || 0);
  const shortage = Math.max(100, Math.ceil(ticketPrice - balance));
  const holderInputVal = document.getElementById('ticketHolderFullName')?.value.trim();

  // Save current purchase state so user is returned right back after funding
  savePendingReturnTarget({
    type: 'event',
    id: State.selectedEvent.slug || State.selectedEvent.id,
    ticketTypeId: State.selectedTicketType.id,
    ticketHolder: holderInputVal || (State.user ? State.user.fullName : ''),
    returnToPurchase: true
  });

  closeModal('eventPurchasePinModal');
  closeModal('eventDetailsModal');

  // Pre-fill deposit amount input
  const depositInput = document.getElementById('depositAmount');
  if (depositInput) {
    depositInput.value = shortage;
  }
  const simInput = document.getElementById('simFundAmount');
  if (simInput) {
    simInput.value = shortage;
  }

  openModal('fundWalletModal');
  showToast(`Please fund ${formatNaira(shortage)} to complete your ticket purchase.`, 'info');
}

async function executeEventTicketPurchase() {
  if (!State.selectedEvent || !State.selectedTicketType) return;

  const pin = document.getElementById('eventPurchasePin').value;
  if (!pin || pin.length !== 4) {
    showToast('Please enter your 4-digit Transaction PIN.', 'error');
    return;
  }

  const holderInputVal = document.getElementById('ticketHolderFullName').value.trim();
  const ticketHolderName = holderInputVal || State.user.fullName;

  const btn = document.getElementById('btnConfirmEventPurchase');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authorizing...`;

  try {
    const { ok, data } = await authFetch(`/events/${State.selectedEvent.id}/purchase`, {
      method: 'POST',
      body: JSON.stringify({
        ticketTypeId: State.selectedTicketType.id,
        ticketHolderName: ticketHolderName,
        pin: pin
      })
    });

    if (ok && data.success) {
      closeModal('eventPurchasePinModal');
      closeModal('eventDetailsModal');
      clearPendingReturnTarget();

      // Refresh wallet & overview
      await initUserSession();

      State.lastPurchasedTicket = data.ticket;
      renderPaymentReceipt(data.receipt, data.ticket);
      openModal('eventReceiptModal');
      showToast('Ticket purchased successfully!', 'success');
    } else {
      if (data.message && data.message.toLowerCase().includes('insufficient wallet balance')) {
        const alertBox = document.getElementById('purModalInsufficientAlert');
        const shortageText = document.getElementById('purModalShortageText');
        const pinGroup = document.getElementById('purModalPinGroup');
        const confirmBtn = document.getElementById('btnConfirmEventPurchase');
        const balance = parseFloat(State.wallet?.balance || 0);
        const ticketPrice = parseFloat(State.selectedTicketType.price || 0);
        const shortage = Math.max(0, ticketPrice - balance);

        if (shortageText) {
          shortageText.innerHTML = `Your wallet balance is <strong>${formatNaira(balance)}</strong>, which is insufficient for this <strong>${formatNaira(ticketPrice)}</strong> ticket (short by <strong>${formatNaira(shortage)}</strong>). Please fund your wallet to continue.`;
        }
        if (alertBox) alertBox.style.display = 'block';
        if (pinGroup) pinGroup.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';
      }
      showToast(data.message || 'Payment authorization failed.', 'error');
    }
  } catch (err) {
    showToast('Error completing ticket purchase.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Authorize & Pay`;
  }
}

// -------------------------------------------------------------
// 6. PAYMENT RECEIPT RENDERING
// -------------------------------------------------------------
function renderPaymentReceipt(receipt, ticket) {
  const container = document.getElementById('eventReceiptBody');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 16px;">
      <div style="font-size: 1.3rem; font-weight: 800; letter-spacing: 0.05em; color: var(--accent-emerald);">STRICTWALLET</div>
      <div style="font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">Payment Receipt</div>
    </div>

    <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.85rem;">Event Name:</span>
        <strong style="color: #FFF; font-size: 0.85rem; text-align: right;">${receipt.eventName}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.85rem;">Ticket Type:</span>
        <strong style="color: var(--accent-blue-light); font-size: 0.85rem;">${receipt.ticketType}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.85rem;">Ticket Holder:</span>
        <strong style="color: #FFF; font-size: 0.85rem;">${receipt.ticketHolder}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.85rem;">Amount:</span>
        <strong style="color: var(--accent-emerald); font-family: var(--font-mono); font-size: 1.15rem;">${formatNaira(receipt.amount)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.82rem;">Transaction ID:</span>
        <strong style="color: #FFF; font-family: var(--font-mono); font-size: 0.8rem;">${receipt.transactionId}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: var(--text-muted); font-size: 0.82rem;">Date:</span>
        <span style="color: #FFF; font-size: 0.82rem;">${formatDateTime(receipt.date)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px;">
        <span style="color: var(--text-muted); font-size: 0.85rem;">Payment Status:</span>
        <span class="badge badge-success">${receipt.status}</span>
      </div>
    </div>
  `;
}

function viewPurchasedTicketFromReceipt() {
  closeModal('eventReceiptModal');
  if (State.lastPurchasedTicket) {
    viewPersonalizedTicket(State.lastPurchasedTicket);
  }
}

// -------------------------------------------------------------
// 7. PERSONALIZED TICKET CANVAS & DOWNLOAD
// -------------------------------------------------------------
async function viewPersonalizedTicket(ticketOrId) {
  let ticket = ticketOrId;
  if (typeof ticketOrId === 'string') {
    const { ok, data } = await authFetch(`/events/ticket-info/${ticketOrId}`);
    if (ok && data.success) {
      if (data.isOwner && data.ticket) {
        ticket = data.ticket;
      } else if (data.event) {
        // Visitor is not the private owner of this ticket, but has access to the event & tickets
        showToast(`Viewing event for ticket: ${data.event.title}`, 'info');
        await openEventDetails(data.event.slug || data.event.id, data.targetTicketTypeId);
        return;
      }
    } else {
      showToast(data?.message || 'Could not load ticket details.', 'error');
      return;
    }
  }

  State.currentViewingTicket = ticket;
  document.getElementById('ptTicketId').innerText = ticket.id;
  document.getElementById('ptHolderName').innerText = ticket.ticketHolderName;
  
  const statusBadge = document.getElementById('ptStatusBadge');
  if (ticket.status === 'used') {
    statusBadge.className = 'badge badge-warning';
    statusBadge.innerText = 'USED';
  } else if (ticket.status === 'cancelled') {
    statusBadge.className = 'badge badge-error';
    statusBadge.innerText = 'CANCELLED';
  } else {
    statusBadge.className = 'badge badge-success';
    statusBadge.innerText = 'VALID';
  }

  renderPersonalizedTicketCanvas(ticket);
  openModal('personalizedTicketModal');
}

async function renderPersonalizedTicketCanvas(ticket) {
  const canvas = document.getElementById('personalizedTicketCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Background artwork
  if (ticket.ticketDesignUrl) {
    try {
      const bgImg = new Image();
      bgImg.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        bgImg.onload = resolve;
        bgImg.onerror = reject;
        bgImg.src = ticket.ticketDesignUrl;
      });
      ctx.drawImage(bgImg, 0, 0, W, H);

      // Dark glass overlay for contrast
      ctx.fillStyle = 'rgba(6, 11, 25, 0.72)';
      ctx.fillRect(0, 0, W, H);
    } catch (e) {
      drawDefaultTicketCanvasBg(ctx, W, H);
    }
  } else {
    drawDefaultTicketCanvasBg(ctx, W, H);
  }

  // Emerald Border Glow
  ctx.strokeStyle = '#00D09C';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, W - 20, H - 20);

  // Top STRICTWALLET Brand Header
  ctx.fillStyle = '#00D09C';
  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('STRICTWALLET OFFICIAL E-TICKET', 36, 46);

  // Event Name
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
  ctx.fillText((ticket.eventName || 'Event Name').substring(0, 32), 36, 92);

  // Category Pill Badge (VVIP, VIP, Regular, etc.)
  ctx.fillStyle = 'rgba(0, 208, 156, 0.2)';
  ctx.fillRect(36, 112, 170, 34);
  ctx.strokeStyle = '#00D09C';
  ctx.lineWidth = 1;
  ctx.strokeRect(36, 112, 170, 34);

  ctx.fillStyle = '#00D09C';
  ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText((ticket.ticketTypeName || 'Standard').toUpperCase(), 48, 135);

  // Ticket Holder
  ctx.fillStyle = '#94A3B8';
  ctx.font = '14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('TICKET HOLDER', 36, 182);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(ticket.ticketHolderName || ticket.buyerName || 'Attendee', 36, 210);

  // Event Venue & Schedule
  ctx.fillStyle = '#94A3B8';
  ctx.font = '13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('DATE & TIME', 36, 252);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${ticket.eventDate || ''} • ${ticket.eventTime || ''}`, 36, 274);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('VENUE', 36, 310);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText((ticket.eventVenue || 'Venue').substring(0, 36), 36, 332);

  // Ticket ID
  ctx.fillStyle = '#64748B';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillText(`ID: ${ticket.id}`, 36, 388);

  // Generate & Draw QR Code on the right side
  try {
    if (window.QRCode && window.QRCode.toDataURL) {
      const qrDataUrl = await window.QRCode.toDataURL(ticket.qrToken || ticket.id, {
        width: 170,
        margin: 1,
        color: { dark: '#060B19', light: '#FFFFFF' }
      });
      const qrImg = new Image();
      await new Promise(r => {
        qrImg.onload = r;
        qrImg.src = qrDataUrl;
      });

      // White background card for QR code
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(W - 220, 80, 180, 180);
      ctx.drawImage(qrImg, W - 215, 85, 170, 170);

      ctx.fillStyle = '#00D09C';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN FOR ENTRY', W - 130, 280);
      ctx.textAlign = 'left';
    }
  } catch (err) {
    console.error('QR Render Error:', err);
  }
}

function drawDefaultTicketCanvasBg(ctx, W, H) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#060B19');
  grad.addColorStop(0.5, '#0D152D');
  grad.addColorStop(1, '#111B36');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function downloadPersonalizedTicketImage() {
  downloadPersonalizedTicketPDF();
}

// Vector QR Code Renderer for jsPDF (guaranteed crisp scannable modules)
function drawTicketQRCodeVector(doc, text, x, y, size) {
  try {
    const qrEngine = (typeof window !== 'undefined' && window.QRCode) ? window.QRCode : (typeof QRCode !== 'undefined' ? QRCode : null);
    if (!qrEngine || !qrEngine.create) {
      console.warn('QRCode.create not available for vector drawing');
      return false;
    }
    const qr = qrEngine.create(text, { errorCorrectionLevel: 'M' });
    if (!qr || !qr.modules) return false;

    const count = qr.modules.size;
    const margin = 1; // 1-module quiet margin inside the vector canvas
    const totalModules = count + (margin * 2);
    const moduleSize = size / totalModules;

    // Crisp pure white quiet background
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, size, size, 'F');

    // Black square modules (crisp, zero blur, zero distortion)
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          doc.rect(
            x + ((c + margin) * moduleSize),
            y + ((r + margin) * moduleSize),
            moduleSize,
            moduleSize,
            'F'
          );
        }
      }
    }
    return true;
  } catch (err) {
    console.warn('Vector QR drawing failed:', err);
    return false;
  }
}

async function downloadPersonalizedTicketPDF(ticketObj = null) {
  const ticket = ticketObj || State.currentViewingTicket;
  if (!ticket) {
    showToast('No active ticket selected.', 'warning');
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF engine initializing, please retry in a moment.', 'warning');
    return;
  }

  const btn = document.getElementById('btnDownloadTicket');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...`;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 1. Fetch Logo as base64
    let logoDataUrl = null;
    try {
      const logoRes = await fetch('Image.png');
      const blob = await logoRes.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Logo load error for PDF:', e);
    }

    // 2. Generate Sharp, Scannable QR Code DataURL
    let qrDataUrl = null;
    const qrText = ticket.qrToken || ticket.id;
    try {
      const qrEngine = (typeof window !== 'undefined' && window.QRCode) ? window.QRCode : (typeof QRCode !== 'undefined' ? QRCode : null);
      if (qrEngine && qrEngine.toDataURL) {
        qrDataUrl = await qrEngine.toDataURL(qrText, {
          width: 500,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#FFFFFF' }
        });
      }
    } catch (e) {
      console.warn('QR generation error for PDF:', e);
    }

    const siteUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'https://strictwallet.com'
      : (window.location.origin || 'https://strictwallet.com');
    const displaySiteUrl = 'www.strictwallet.com';

    // ==========================================
    // PDF RENDERING ENGINE (Universal A4)
    // ==========================================
    const pageW = 210;
    const pageH = 297;
    const margin = 14;
    const contentW = pageW - (margin * 2); // 182mm

    // Page soft background
    doc.setFillColor(250, 252, 254);
    doc.rect(0, 0, pageW, pageH, 'F');

    // ------------------------------------------
    // A. TOP BRANDING & SITE LINK HEADER
    // ------------------------------------------
    // Top emerald accent bar
    doc.setFillColor(0, 208, 156); // #00D09C
    doc.rect(0, 0, pageW, 4, 'F');

    // Add Logo if available
    let textStartX = margin;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'JPEG', margin, 12, 20, 20);
        textStartX = margin + 24;
      } catch (err) {
        textStartX = margin;
      }
    }

    // Site Name: STRICTWALLET
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(6, 11, 25); // #060B19
    doc.text('STRICTWALLET', textStartX, 19);

    // Site Website Link
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 163, 122); // #00A37A
    doc.text(displaySiteUrl, textStartX, 25);
    doc.link(textStartX, 22, 36, 4, { url: siteUrl });

    // Header Subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139); // #64748B
    doc.text('Official Event Entry Pass & Secure Ticketing Gateway', textStartX, 30);

    // Right Side: Valid Status Pill Badge
    const statusText = (ticket.status || 'valid').toUpperCase();
    const isUsed = statusText === 'USED';
    const isCancelled = statusText === 'CANCELLED';

    const badgeW = 44;
    const badgeH = 10;
    const badgeX = pageW - margin - badgeW;
    const badgeY = 15;

    if (isUsed) {
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(245, 158, 11);
      doc.setTextColor(180, 83, 9);
    } else if (isCancelled) {
      doc.setFillColor(254, 226, 226);
      doc.setDrawColor(239, 68, 68);
      doc.setTextColor(185, 28, 28);
    } else {
      doc.setFillColor(236, 253, 245);
      doc.setDrawColor(0, 208, 156);
      doc.setTextColor(4, 120, 87);
    }

    doc.setLineWidth(0.4);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`STATUS: ${statusText}`, badgeX + (badgeW / 2), badgeY + 6.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('SECURE QR ENCRYPTED', pageW - margin, 30, { align: 'right' });

    // ------------------------------------------
    // B. MAIN TICKET CARD CONTAINER
    // ------------------------------------------
    const cardY = 38;
    const cardH = 168;

    // Card frame & background
    doc.setDrawColor(226, 232, 240); // #E2E8F0
    doc.setLineWidth(0.6);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, cardY, contentW, cardH, 4, 4, 'FD');

    // 1. Card Top Banner (Deep Midnight)
    const bannerH = 38;
    doc.setFillColor(6, 11, 25); // #060B19
    doc.roundedRect(margin, cardY, contentW, bannerH, 4, 4, 'F');
    doc.rect(margin, cardY + bannerH - 4, contentW, 4, 'F');

    // Emerald accent line at very top of card
    doc.setFillColor(0, 208, 156);
    doc.roundedRect(margin, cardY, contentW, 2.5, 2, 2, 'F');

    // Event Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    const safeTitle = (ticket.eventName || 'Event Name').substring(0, 42);
    doc.text(safeTitle, margin + 8, cardY + 16);

    // Event Category Pill Badge inside banner
    const catName = (ticket.ticketTypeName || 'Standard Pass').toUpperCase();
    doc.setFillColor(0, 208, 156); // #00D09C
    doc.roundedRect(margin + 8, cardY + 23, 44, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(6, 11, 25);
    doc.text(catName, margin + 30, cardY + 28.5, { align: 'center' });

    // Date & Time quick summary on right of banner
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(56, 189, 248); // #38BDF8
    doc.text(`${ticket.eventDate || ''}  •  ${ticket.eventTime || ''}`, pageW - margin - 8, cardY + 28.5, { align: 'right' });

    // ------------------------------------------
    // 2. Ticket Body: Two Column Layout
    // ------------------------------------------
    const bodyY = cardY + bannerH; // Y = 76
    const stubX = margin + 118; // 132mm

    // Vertical Perforation Line
    doc.setDrawColor(203, 213, 225); // #CBD5E1
    doc.setLineDashPattern([1.5, 2], 0);
    doc.line(stubX, bodyY + 4, stubX, cardY + cardH - 4);
    doc.setLineDashPattern([], 0); // reset dash

    // Left Column: Attendee & Event Logistics
    const leftX = margin + 8;
    let curY = bodyY + 11;

    // Field 1: Ticket Holder Name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TICKET HOLDER NAME', leftX, curY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(ticket.ticketHolderName || ticket.buyerName || 'Valued Guest', leftX, curY + 6);
    curY += 16;

    // Field 2: Purchaser / Buyer
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('PURCHASER / BUYER ACCOUNT', leftX, curY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    const buyerDisplay = ticket.buyerName ? `${ticket.buyerName} (${ticket.buyerEmail || ''})` : (ticket.buyerEmail || 'STRICTWALLET Customer');
    doc.text(buyerDisplay.substring(0, 48), leftX, curY + 4.5);
    curY += 13;

    // Field 3: Venue & Location
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('EVENT VENUE & LOCATION', leftX, curY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const venueLines = doc.splitTextToSize(ticket.eventVenue || 'Venue Announced by Organizer', 98);
    doc.text(venueLines, leftX, curY + 5);
    curY += (venueLines.length * 4.5) + 8;

    // Field 4: Event Date & Admission Time
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('EVENT DATE & TIME', leftX, curY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`${ticket.eventDate || 'TBA'} at ${ticket.eventTime || 'TBA'}`, leftX, curY + 5);
    curY += 13;

    // Field 5: Admission Price / Fee
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TICKET PRICE / ADMISSION FEE', leftX, curY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 163, 122); // #00A37A
    const priceNum = parseFloat(ticket.ticketPrice || 0);
    const priceStr = priceNum === 0 ? 'FREE ADMISSION' : `NGN ${priceNum.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    doc.text(priceStr, leftX, curY + 5);
    curY += 13;

    // Field 6: Ticket ID & Transaction ID
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('TICKET ID & TRANSACTION REF', leftX, curY);

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(37, 99, 235); // #2563EB
    doc.text(ticket.id, leftX, curY + 4.5);

    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`TXN: ${ticket.transactionId || 'DIRECT-VERIFIED'}`, leftX, curY + 9);

    // Right Column: Scannable QR Code Stub
    const rightStubW = contentW - 118; // 64mm
    const stubCenterX = stubX + (rightStubW / 2);

    // Stub Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(6, 11, 25);
    doc.text('GATE ENTRY PASS', stubCenterX, bodyY + 6.5, { align: 'center' });

    // Ticket ID directly above QR code
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('TICKET ID', stubCenterX, bodyY + 12, { align: 'center' });

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(37, 99, 235); // #2563EB
    doc.text(ticket.id, stubCenterX, bodyY + 16.5, { align: 'center' });

    // Small Label Above QR Code: "SCAN TO VERIFY TICKET"
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 163, 122); // STRICTWALLET Emerald #00A37A
    doc.text('SCAN TO VERIFY TICKET', stubCenterX, bodyY + 21.5, { align: 'center' });

    // QR Code Container Box (White frame, high contrast, quiet zone)
    const qrBoxW = 50;
    const qrBoxH = 50;
    const qrBoxX = stubX + ((rightStubW - qrBoxW) / 2);
    const qrBoxY = bodyY + 23.5;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225); // #CBD5E1
    doc.setLineWidth(0.4);
    doc.roundedRect(qrBoxX, qrBoxY, qrBoxW, qrBoxH, 2, 2, 'FD');

    // Scannable Black-and-White Square QR Code Graphic (Dual Engine: PNG + Vector Fallback)
    const qrInnerX = qrBoxX + 2.5;
    const qrInnerY = qrBoxY + 2.5;
    const qrInnerSize = qrBoxW - 5; // 45mm x 45mm

    let qrRendered = false;
    if (qrDataUrl) {
      try {
        doc.addImage(qrDataUrl, 'PNG', qrInnerX, qrInnerY, qrInnerSize, qrInnerSize);
        qrRendered = true;
      } catch (err) {
        console.warn('doc.addImage failed, falling back to vector QR:', err);
      }
    }

    if (!qrRendered) {
      qrRendered = drawTicketQRCodeVector(doc, qrText, qrInnerX, qrInnerY, qrInnerSize);
    }

    // Label Below QR Code: "SCAN TO VERIFY TICKET"
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 163, 122);
    doc.text('SCAN TO VERIFY TICKET', stubCenterX, qrBoxY + qrBoxH + 6.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Present code to door scanner', stubCenterX, qrBoxY + qrBoxH + 10.5, { align: 'center' });
    doc.text('Valid for 1 admission check-in', stubCenterX, qrBoxY + qrBoxH + 14.5, { align: 'center' });

    // Verification token snippet
    const tokenPreview = (ticket.qrToken || ticket.id).substring(0, 20) + '...';
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Token: ${tokenPreview}`, stubCenterX, qrBoxY + qrBoxH + 19.5, { align: 'center' });

    // ------------------------------------------
    // C. SECURITY STRIP & VERIFICATION GUARANTEE
    // ------------------------------------------
    const secY = cardY + cardH + 6;
    doc.setFillColor(241, 245, 249); // #F1F5F9
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, secY, contentW, 11, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(
      '• STRICTWALLET VERIFIED DIGITAL PASS • ADMISSION CANNOT BE DUPLICATED • ZERO-FRAUD GUARANTEE •',
      pageW / 2,
      secY + 7,
      { align: 'center' }
    );

    // ------------------------------------------
    // D. IMPORTANT ATTENDEE INSTRUCTIONS
    // ------------------------------------------
    const instY = secY + 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('IMPORTANT ADMISSION & SCANNING INSTRUCTIONS', margin, instY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);

    const guidelines = [
      '1. Digital or Printed Presentation: You can present this PDF directly on your smartphone screen or bring a printed copy.',
      '2. Fast Gate Verification: Set your mobile screen brightness to high at the check-in point for swift barcode reader scanning.',
      '3. One-Time Admission: Each ticket grants single entry. Once scanned at the gate, duplicate attempts will be rejected.',
      '4. Anti-Fraud Advisory: Never share your unique QR code or ticket link on public social media to prevent ticket poaching.'
    ];

    let gY = instY + 6;
    guidelines.forEach(line => {
      doc.text(line, margin, gY);
      gY += 5.2;
    });

    // ------------------------------------------
    // E. FOOTER BRANDING & TIMESTAMP
    // ------------------------------------------
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(margin, 282, pageW - margin, 282);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const createdStr = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleDateString();
    doc.text(`Issued by STRICTWALLET Ticketing Engine  •  ${createdStr}`, margin, 288);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 163, 122);
    doc.text(displaySiteUrl, pageW - margin, 288, { align: 'right' });
    doc.link(pageW - margin - 35, 284, 35, 6, { url: siteUrl });

    // Download PDF
    const cleanFilename = `STRICTWALLET_Ticket_${ticket.id || 'Pass'}.pdf`;
    doc.save(cleanFilename);
    showToast('Event ticket PDF downloaded successfully!', 'success');

  } catch (err) {
    console.error('Ticket PDF Generation Error:', err);
    showToast('Failed to generate PDF ticket. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText || `<i class="fa-solid fa-file-pdf"></i> Download Ticket (PDF)`;
    }
  }
}

// -------------------------------------------------------------
// 8. CUSTOMER "MY TICKETS"
// -------------------------------------------------------------
async function loadMyTickets() {
  const container = document.getElementById('myTicketsGridContainer');
  const emptyState = document.getElementById('myTicketsEmptyState');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
      <p style="margin-top: 10px;">Loading your purchased tickets...</p>
    </div>
  `;

  try {
    const { ok, data } = await authFetch('/events/user/my-tickets');
    if (ok && data.success) {
      const tickets = data.tickets || [];
      if (tickets.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        container.innerHTML = tickets.map(t => `
          <div class="event-card">
            <div class="event-banner-wrap" style="height: 130px;">
              <img src="${t.bannerUrl || 'Image.png'}" alt="${t.eventName}" class="event-banner-img" onerror="this.src='Image.png'">
              <div class="event-status-badge badge-${t.status === 'used' ? 'warning' : 'success'}">
                ${t.status.toUpperCase()}
              </div>
            </div>
            <div class="event-card-content">
              <h3 class="event-card-title">${t.eventName}</h3>
              <div class="event-card-meta">
                <div class="event-card-meta-item">
                  <i class="fa-solid fa-ticket"></i>
                  <strong style="color: var(--accent-emerald);">${t.ticketTypeName}</strong>
                </div>
                <div class="event-card-meta-item">
                  <i class="fa-solid fa-user"></i>
                  <span>Holder: <strong>${t.ticketHolderName}</strong></span>
                </div>
                <div class="event-card-meta-item">
                  <i class="fa-solid fa-barcode"></i>
                  <span style="font-family: var(--font-mono); font-size: 0.75rem;">${t.id}</span>
                </div>
              </div>
              <div class="event-card-footer" style="display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                <span style="font-family: var(--font-mono); font-weight: 800; color: #FFF;">${formatNaira(t.ticketPrice)}</span>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-outline btn-sm" onclick="copyTicketShareLink('${t.id}')" title="Copy shareable ticket link">
                    <i class="fa-regular fa-copy"></i> Share
                  </button>
                  <button class="btn btn-primary btn-sm" onclick="viewPersonalizedTicket('${t.id}')">
                    <i class="fa-solid fa-qrcode"></i> View Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--status-error);">Failed to load your tickets.</div>`;
  }
}

// -------------------------------------------------------------
// 9. EVENT CREATOR MANAGEMENT & ATTENDEE EXPORT
// -------------------------------------------------------------
async function loadMyOrganizedEvents() {
  const container = document.getElementById('myEventsGridContainer');
  const emptyState = document.getElementById('myEventsEmptyState');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
      <p style="margin-top: 10px;">Loading your organized events...</p>
    </div>
  `;

  try {
    const { ok, data } = await authFetch('/events/creator/my-events');
    if (ok && data.success) {
      const myEvents = data.events || [];
      if (myEvents.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        container.innerHTML = myEvents.map(ev => {
          let totalSold = 0;
          (ev.ticketTypes || []).forEach(tt => { totalSold += (parseInt(tt.quantitySold, 10) || 0); });
          const isPublished = ev.status === 'published';

          return `
            <div class="event-card">
              <div class="event-banner-wrap" style="height: 140px;">
                <img src="${ev.bannerUrl || 'Image.png'}" alt="${ev.title}" class="event-banner-img" onerror="this.src='Image.png'">
                <div class="event-status-badge badge-${isPublished ? 'success' : 'warning'}">
                  ${isPublished ? 'Published' : 'Draft'}
                </div>
              </div>
              <div class="event-card-content">
                <h3 class="event-card-title">${ev.title}</h3>
                <div class="event-card-meta">
                  <div class="event-card-meta-item">
                    <i class="fa-solid fa-calendar-day"></i>
                    <span>${ev.date} at ${ev.time}</span>
                  </div>
                  <div class="event-card-meta-item">
                    <i class="fa-solid fa-users"></i>
                    <span><strong>${totalSold}</strong> tickets sold</span>
                  </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-color);">
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="openAttendeesModal('${ev.id}')">
                      <i class="fa-solid fa-users"></i> Attendees
                    </button>
                    <button class="btn btn-outline btn-sm" style="flex: 1;" onclick="openQrScanner('${ev.id}', '${ev.title.replace(/'/g, "\\'")}')">
                      <i class="fa-solid fa-qrcode"></i> Scan
                    </button>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="openEditEventModal('${ev.id}')">
                      <i class="fa-solid fa-pen-to-square"></i> Edit Event
                    </button>
                    <button class="btn btn-outline btn-sm" style="color: var(--status-error); border-color: rgba(239, 68, 68, 0.4); padding: 6px 12px;" title="Delete Event" onclick="deleteCreatorEvent('${ev.id}', '${ev.title.replace(/'/g, "\\'")}')">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                  ${!isPublished ? `
                    <button class="btn btn-primary btn-sm btn-block" onclick="publishCreatorEvent('${ev.id}')">
                      <i class="fa-solid fa-upload"></i> Publish Event Now
                    </button>
                  ` : `
                    <button class="btn btn-outline btn-sm btn-block" onclick="openEventDetails('${ev.slug}')">
                      <i class="fa-solid fa-share-nodes"></i> Share / Preview
                    </button>
                  `}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--status-error);">Failed to load events.</div>`;
  }
}

async function deleteCreatorEvent(eventId, eventTitle) {
  if (!confirm(`Are you sure you want to delete "${eventTitle}"? This will remove the event from ticket sales and the public marketplace.`)) {
    return;
  }

  try {
    const { ok, data } = await authFetch(`/events/${eventId}`, {
      method: 'DELETE'
    });

    if (ok && data.success) {
      showToast(data.message || 'Event deleted successfully.', 'success');
      loadMyOrganizedEvents();
      loadMarketplaceEvents();
    } else {
      showToast(data.message || 'Failed to delete event.', 'error');
    }
  } catch (err) {
    showToast('Server error while deleting event.', 'error');
  }
}

async function publishCreatorEvent(eventId) {
  if (!confirm('Are you ready to publish this event publicly? Attendees will be able to purchase tickets.')) return;
  const { ok, data } = await authFetch(`/events/${eventId}/publish`, { method: 'POST' });
  if (ok && data.success) {
    showToast('Event published successfully!', 'success');
    loadMyOrganizedEvents();
    loadMarketplaceEvents();
  } else {
    showToast(data.message || 'Failed to publish event.', 'error');
  }
}

// Attendees Modal & Search
async function openAttendeesModal(eventId) {
  const modal = document.getElementById('attendeesModal');
  if (!modal) return;

  const { ok, data } = await authFetch(`/events/${eventId}/attendees`);
  if (!ok || !data.success) {
    showToast('Failed to load attendee list.', 'error');
    return;
  }

  State.activeAttendeesData = data;
  document.getElementById('attModalTitle').innerText = `Attendees: ${data.event.title}`;
  document.getElementById('attStatTicketsSold').innerText = data.stats.totalTicketsSold;
  document.getElementById('attStatGrossSales').innerText = formatNaira(data.stats.grossRevenue);
  document.getElementById('attStatCommission').innerText = formatNaira(data.stats.commission);
  document.getElementById('attStatNetEarnings').innerText = formatNaira(data.stats.creatorNetEarnings);

  renderAttendeesTable(data.attendees || []);
  openModal('attendeesModal');
}

function renderAttendeesTable(list) {
  const tbody = document.getElementById('attendeesTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No attendees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a => `
    <tr>
      <td style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-blue-light);">${a.id}</td>
      <td><strong>${a.ticketHolderName}</strong></td>
      <td style="color: var(--text-secondary);">${a.buyerName}</td>
      <td><span class="badge badge-info">${a.ticketTypeName}</span></td>
      <td style="font-family: var(--font-mono);">${formatNaira(a.ticketPrice)}</td>
      <td><span class="badge badge-${a.status === 'used' ? 'warning' : 'success'}">${a.status.toUpperCase()}</span></td>
      <td style="color: var(--text-muted); font-size: 0.78rem;">${formatDateTime(a.createdAt)}</td>
    </tr>
  `).join('');
}

function filterAttendeesTable() {
  if (!State.activeAttendeesData) return;
  const q = document.getElementById('attSearchInput').value.toLowerCase().trim();
  const filtered = (State.activeAttendeesData.attendees || []).filter(a =>
    (a.ticketHolderName && a.ticketHolderName.toLowerCase().includes(q)) ||
    (a.buyerName && a.buyerName.toLowerCase().includes(q)) ||
    (a.id && a.id.toLowerCase().includes(q)) ||
    (a.ticketTypeName && a.ticketTypeName.toLowerCase().includes(q))
  );
  renderAttendeesTable(filtered);
}

function exportAttendeesCSV() {
  if (!State.activeAttendeesData || !State.activeAttendeesData.attendees) {
    showToast('No attendees to export', 'warning');
    return;
  }

  const attendees = State.activeAttendeesData.attendees;
  let csv = 'Ticket ID,Ticket Holder,Buyer Name,Category,Price,Status,Purchase Date\n';
  attendees.forEach(a => {
    csv += `"${a.id}","${a.ticketHolderName}","${a.buyerName}","${a.ticketTypeName}","${a.ticketPrice}","${a.status}","${a.createdAt}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Attendees_${State.activeAttendeesData.event.slug || 'Event'}.csv`);
  link.click();
}

function exportAttendeesPDF() {
  if (!State.activeAttendeesData || !State.activeAttendeesData.attendees) {
    showToast('No attendees to export', 'warning');
    return;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const event = State.activeAttendeesData.event;
    const attendees = State.activeAttendeesData.attendees;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('STRICTWALLET — ATTENDEE MANIFEST', 14, 20);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Event: ${event.title}`, 14, 28);
    doc.text(`Total Attendees: ${attendees.length} | Export Date: ${new Date().toLocaleDateString()}`, 14, 34);

    // Group Attendees by Ticket Type (as required by Requirement 19)
    const grouped = {};
    attendees.forEach(a => {
      const type = (a.ticketTypeName || 'Standard').toUpperCase();
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(a);
    });

    let y = 46;
    for (const [type, list] of Object.entries(grouped)) {
      if (y > 260) { doc.addPage(); y = 20; }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`CATEGORY: ${type} (${list.length} attendees)`, 14, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);

      list.forEach((att, idx) => {
        if (y > 275) { doc.addPage(); y = 20; }
        const line = `${idx + 1}. ${att.ticketHolderName} — ID: ${att.id} — Status: ${att.status.toUpperCase()}`;
        doc.text(line, 18, y);
        y += 6;
      });
      y += 8;
    }

    doc.save(`Attendees_${event.slug || 'Event'}.pdf`);
    showToast('Attendee manifest PDF downloaded successfully!', 'success');
  } catch (err) {
    console.error('PDF Export Error:', err);
    showToast('Failed to generate PDF. Exporting as CSV instead.', 'error');
    exportAttendeesCSV();
  }
}

// -------------------------------------------------------------
// 10. QR SCANNER & TICKET VERIFICATION
// -------------------------------------------------------------
function openQrScanner(eventId, eventTitle) {
  State.qrActiveEventId = eventId;
  document.getElementById('qrScannerEventTitle').innerText = `Event: ${eventTitle}`;
  document.getElementById('qrScanResultBox').style.display = 'none';
  document.getElementById('manualVerifyInput').value = '';

  openModal('qrScannerModal');

  // Initialize camera scanner if library available
  setTimeout(() => {
    try {
      if (window.Html5Qrcode) {
        if (State.html5QrScanner) {
          State.html5QrScanner.stop().catch(() => {});
        }
        State.html5QrScanner = new Html5Qrcode('qrReader');
        State.html5QrScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            onQrCodeDetected(decodedText);
          },
          () => {}
        ).catch(err => {
          console.warn('Camera access error:', err);
        });
      }
    } catch (e) {
      console.warn('QR scanner initialization skipped:', e);
    }
  }, 300);
}

function closeQrScanner() {
  if (State.html5QrScanner) {
    State.html5QrScanner.stop().then(() => {
      State.html5QrScanner.clear();
      State.html5QrScanner = null;
    }).catch(() => {
      State.html5QrScanner = null;
    });
  }
  closeModal('qrScannerModal');
}

let lastScanTime = 0;
async function onQrCodeDetected(token) {
  const now = Date.now();
  if (now - lastScanTime < 3000) return; // debounce scans
  lastScanTime = now;
  await verifyTicketByToken(token);
}

async function verifyManualTicket() {
  const token = document.getElementById('manualVerifyInput').value.trim();
  if (!token) {
    showToast('Please enter a ticket code or token.', 'warning');
    return;
  }
  await verifyTicketByToken(token);
}

async function verifyTicketByToken(token) {
  const resultBox = document.getElementById('qrScanResultBox');
  resultBox.style.display = 'block';
  resultBox.className = 'verification-result-box';
  resultBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying ticket with backend...`;

  try {
    const isToken = token.startsWith('SEC-QR-');
    const payload = isToken ? { qrToken: token } : { ticketId: token };

    const { ok, data } = await authFetch(`/events/${State.qrActiveEventId}/verify-ticket`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (ok && data.success && data.code === 'VALID') {
      resultBox.className = 'verification-result-box valid';
      resultBox.innerHTML = `
        <i class="fa-solid fa-circle-check fa-2x" style="color: var(--status-success);"></i>
        <div>
          <div style="font-size: 1.1rem; font-weight: 800; color: var(--status-success);">VALID TICKET</div>
          <div><strong>Event:</strong> ${data.ticket.eventName}</div>
          <div><strong>Ticket:</strong> ${data.ticket.ticketTypeName}</div>
          <div><strong>Holder:</strong> ${data.ticket.ticketHolderName}</div>
          <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">Ticket ID: ${data.ticket.id}</div>
        </div>
      `;
      showToast('VALID TICKET: Checked in successfully!', 'success');
    } else if (data.code === 'ALREADY_USED') {
      resultBox.className = 'verification-result-box already-used';
      resultBox.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation fa-2x" style="color: var(--status-warning);"></i>
        <div>
          <div style="font-size: 1.1rem; font-weight: 800; color: var(--status-warning);">TICKET ALREADY USED</div>
          <div><strong>Used on:</strong> ${formatDateTime(data.ticket?.usedAt)}</div>
          <div><strong>Holder:</strong> ${data.ticket?.ticketHolderName || '-'}</div>
        </div>
      `;
      showToast('WARNING: Ticket already checked in previously!', 'warning');
    } else {
      resultBox.className = 'verification-result-box invalid';
      resultBox.innerHTML = `
        <i class="fa-solid fa-circle-xmark fa-2x" style="color: var(--status-error);"></i>
        <div>
          <div style="font-size: 1.1rem; font-weight: 800; color: var(--status-error);">INVALID TICKET</div>
          <div style="font-size: 0.85rem;">${data.message || 'No ticket found matching scanned QR code.'}</div>
        </div>
      `;
      showToast('INVALID TICKET', 'error');
    }
  } catch (err) {
    resultBox.className = 'verification-result-box invalid';
    resultBox.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Connection error during verification.`;
  }
}

// -------------------------------------------------------------
// 11. EVENT CREATOR WALLET & STROWALLET WITHDRAWAL
// -------------------------------------------------------------
async function loadOrganizerWallet(forceTableRender = true) {
  const balEl = document.getElementById('organizerWalletBalance');
  const tableEl = document.getElementById('creatorWithdrawalsTableBody');
  if (!balEl && !tableEl) return;

  try {
    const { ok, data } = await authFetch('/events/creator/wallet');
    if (ok && data.success) {
      State.organizerWalletBalance = data.wallet.balance;
      if (balEl) balEl.innerText = formatNaira(data.wallet.balance);
      State.organizerWithdrawals = Array.isArray(data.withdrawals) ? data.withdrawals : [];
      if (forceTableRender) {
        renderCreatorWithdrawalsTable(State.organizerWithdrawals);
      }
    }
  } catch (e) {
    console.warn('Failed to load organizer wallet', e);
  }
}

async function openWithdrawalModal() {
  if (!State.token || !State.user) {
    showToast('Please sign in to access your wallet.', 'info');
    return;
  }

  document.getElementById('wthAvailableBalanceDisplay').innerText = formatNaira(State.organizerWalletBalance || 0);
  document.getElementById('wthAmount').value = '';
  document.getElementById('wthAccountNumber').value = '';
  document.getElementById('wthNarration').value = 'Ticket sales payout';
  document.getElementById('wthPin').value = '';
  document.getElementById('wthNameEnquiryRef').value = '';
  document.getElementById('wthAccountNameDisplay').innerText = 'Enter 10-digit account number to verify owner name...';
  document.getElementById('wthAccountNameDisplay').style.color = 'var(--text-muted)';

  openModal('eventWithdrawModal');
  loadStrowalletBanks();
}

async function loadStrowalletBanks(force = false) {
  const select = document.getElementById('wthBankSelect');
  if (!select) return;

  // Already populated with options
  if (!force && State.strowalletBanks && State.strowalletBanks.length > 0 && select.options.length > 2) {
    return;
  }

  // If in state already, populate immediately
  if (State.strowalletBanks && State.strowalletBanks.length > 0) {
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select destination bank --</option>' + 
      State.strowalletBanks.map(b => `<option value="${b.code}" data-name="${b.name}">${b.name}</option>`).join('');
    if (currentVal) select.value = currentVal;
    return;
  }

  select.innerHTML = '<option value="">-- Loading Nigerian banks... --</option>';

  try {
    const { ok, data } = await authFetch('/events/withdrawals/banks');
    if (ok && data.success && Array.isArray(data.banks) && data.banks.length > 0) {
      State.strowalletBanks = data.banks;
      const currentVal = select.value;
      select.innerHTML = '<option value="">-- Select destination bank --</option>' + 
        data.banks.map(b => `<option value="${b.code}" data-name="${b.name}">${b.name}</option>`).join('');
      if (currentVal) select.value = currentVal;
    } else {
      select.innerHTML = '<option value="">-- Failed to load banks, click here to retry --</option>';
    }
  } catch (err) {
    console.error('Error loading banks:', err);
    select.innerHTML = '<option value="">-- Failed to load banks, click here to retry --</option>';
  }
}

function calculateWithdrawalTotal() {
  // Amount + 20 fee
}

function onBankSelectionChange() {
  const accNum = document.getElementById('wthAccountNumber').value.trim();
  if (accNum.length === 10) {
    verifyStrowalletAccount();
  }
}

let verifyAccTimeout = null;
function onAccountNumberInput(el) {
  el.value = el.value.replace(/\D/g, '');
  if (el.value.length === 10) {
    clearTimeout(verifyAccTimeout);
    verifyAccTimeout = setTimeout(verifyStrowalletAccount, 400);
  } else {
    document.getElementById('wthAccountNameDisplay').innerText = 'Enter 10-digit account number to verify owner name...';
    document.getElementById('wthAccountNameDisplay').style.color = 'var(--text-muted)';
    document.getElementById('wthNameEnquiryRef').value = '';
  }
}

async function verifyStrowalletAccount() {
  const bankSelect = document.getElementById('wthBankSelect');
  const bankCode = bankSelect.value;
  const accountNumber = document.getElementById('wthAccountNumber').value.trim();
  const display = document.getElementById('wthAccountNameDisplay');

  if (!bankCode) {
    display.innerText = 'Please select a bank first.';
    display.style.color = 'var(--status-warning)';
    return;
  }

  if (accountNumber.length !== 10) {
    display.innerText = 'Account number must be 10 digits.';
    display.style.color = 'var(--status-warning)';
    return;
  }

  display.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-emerald);"></i> Verifying account with bank...`;
  display.style.color = 'var(--accent-emerald)';

  try {
    const { ok, data } = await authFetch('/events/withdrawals/verify-account', {
      method: 'POST',
      body: JSON.stringify({ bankCode, accountNumber })
    });

    if (ok && data.success && data.accountName) {
      display.innerText = `✓ ${data.accountName}`;
      display.style.color = 'var(--accent-emerald)';
      document.getElementById('wthNameEnquiryRef').value = data.nameEnquiryReference || '';
    } else {
      display.innerText = `✗ ${data.message || 'Could not verify account name'}`;
      display.style.color = 'var(--status-error)';
      document.getElementById('wthNameEnquiryRef').value = '';
    }
  } catch (err) {
    display.innerText = 'Verification network error';
    display.style.color = 'var(--status-error)';
  }
}

async function submitEventWithdrawal() {
  const amount = parseFloat(document.getElementById('wthAmount').value);
  const bankSelect = document.getElementById('wthBankSelect');
  const bankCode = bankSelect.value;
  const bankName = bankSelect.options[bankSelect.selectedIndex]?.getAttribute('data-name') || '';
  const accountNumber = document.getElementById('wthAccountNumber').value.trim();
  const accountName = document.getElementById('wthAccountNameDisplay').innerText.replace(/^✓\s*/, '').trim();
  const narration = document.getElementById('wthNarration').value.trim();
  const pin = document.getElementById('wthPin').value;
  const nameEnquiryRef = document.getElementById('wthNameEnquiryRef').value;

  if (isNaN(amount) || amount < 100) {
    showToast('Minimum withdrawal amount is ₦100.', 'error');
    return;
  }

  if (!bankCode || accountNumber.length !== 10) {
    showToast('Please select a bank and enter a valid 10-digit account number.', 'error');
    return;
  }

  if (!accountName || accountName.includes('verify') || accountName.includes('Could not') || accountName.includes('error')) {
    showToast('Please verify the account owner name before proceeding.', 'error');
    return;
  }

  if (!narration) {
    showToast('Narration is required.', 'error');
    return;
  }

  if (!pin || pin.length !== 4) {
    showToast('Please enter your 4-digit STRICTWALLET Transaction PIN.', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitWithdrawal');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing Transfer...`;

  try {
    const { ok, data } = await authFetch('/events/withdrawals/request', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        bankCode,
        bankName,
        accountNumber,
        accountName,
        narration,
        nameEnquiryRef,
        pin
      })
    });

    if (ok && data.success) {
      showToast(data.message || 'Withdrawal processed successfully!', 'success');
      closeModal('eventWithdrawModal');
      await loadOrganizerWallet(true);
      if (data.withdrawal) {
        showEventWithdrawalReceipt(data.withdrawal);
      }
    } else {
      showToast(data.message || 'Withdrawal request failed.', 'error');
      closeModal('eventWithdrawModal');
      await loadOrganizerWallet(true);
      if (data && data.withdrawal) {
        showEventWithdrawalReceipt(data.withdrawal);
      }
    }
  } catch (err) {
    showToast('Error communicating with withdrawal service.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-arrow-up-from-bracket"></i> Confirm Withdrawal`;
  }
}

// -------------------------------------------------------------
// 12. EVENT CREATOR WALLET TRANSACTIONS & WITHDRAWAL RECEIPTS
// -------------------------------------------------------------

function formatMaskedAccount(acc) {
  if (!acc) return '-';
  const clean = acc.toString().trim();
  if (clean.length <= 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
}

function renderCreatorWithdrawalsTable(withdrawals) {
  const tbody = document.getElementById('creatorWithdrawalsTableBody');
  if (!tbody) return;

  if (!Array.isArray(withdrawals) || withdrawals.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.35;"></i>
          No Event Creator Wallet withdrawals yet.
          <div style="font-size: 0.78rem; margin-top: 4px; color: var(--text-secondary);">When you withdraw your ticket sales earnings, your verified transactions and receipts will appear here.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = withdrawals.map(wth => {
    let badgeClass = 'badge-success';
    let icon = '<i class="fa-solid fa-circle-check"></i>';
    if (wth.status === 'Pending' || wth.status === 'Processing') {
      badgeClass = 'badge-warning';
      icon = '<i class="fa-solid fa-clock"></i>';
    } else if (wth.status === 'Failed') {
      badgeClass = 'badge-danger';
      icon = '<i class="fa-solid fa-circle-xmark"></i>';
    }

    const sent = parseFloat(wth.amount || 0);

    return `
      <tr>
        <td><code style="color: var(--accent-emerald); font-size: 0.8rem; font-weight: 700;">${wth.id}</code></td>
        <td><strong style="color: #FFF; font-size: 0.82rem;">Withdrawal</strong></td>
        <td>
          <div style="font-weight: 600; color: #FFF;">${escapeHTML(wth.bankName || 'Bank')}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(wth.accountName || '')}</div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 0.82rem;">${formatMaskedAccount(wth.accountNumber)}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: #FFF;">
          ${formatNaira(sent)}
        </td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTime(wth.createdAt)}</td>
        <td><span class="badge ${badgeClass}">${icon} ${wth.status}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="showEventWithdrawalReceiptById('${wth.id}')" title="View Withdrawal Receipt">
            <i class="fa-solid fa-receipt"></i> Receipt
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function showEventWithdrawalReceipt(wth) {
  if (!wth) return;
  State.currentCreatorReceiptWithdrawal = wth;
  const body = document.getElementById('creatorWithdrawalReceiptBody');
  if (!body) return;

  const isSuccess = wth.status === 'Successful';
  const isFailed = wth.status === 'Failed';
  const isPending = wth.status === 'Pending' || wth.status === 'Processing';

  let badgeClass = isSuccess ? 'badge-success' : isFailed ? 'badge-danger' : 'badge-warning';
  let badgeIcon = isSuccess ? '<i class="fa-solid fa-circle-check"></i>' : isFailed ? '<i class="fa-solid fa-circle-xmark"></i>' : '<i class="fa-solid fa-clock"></i>';

  const gross = parseFloat(wth.totalDeducted || (wth.amount + (wth.charge || 20)));
  const fee = parseFloat(wth.charge || 20.00);
  const sent = parseFloat(wth.amount || 0);

  const txDate = wth.createdAt ? new Date(wth.createdAt) : new Date();
  const dateStr = txDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = txDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  body.innerHTML = `
    <!-- STRICTWALLET Receipt Header -->
    <div style="text-align: center; margin-bottom: 16px;">
      <img src="Image.png" alt="STRICTWALLET" style="height: 38px; margin-bottom: 6px;" onerror="this.style.display='none'">
      <div style="font-size: 1.15rem; font-weight: 800; color: #FFF; letter-spacing: -0.02em;">STRICTWALLET</div>
      <div style="font-size: 0.85rem; color: var(--accent-emerald); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px;">
        Event Creator Wallet Withdrawal Receipt
      </div>
      <div style="margin-top: 8px;">
        <span class="badge ${badgeClass}" style="font-size: 0.85rem; padding: 5px 14px;">
          ${badgeIcon} ${wth.status}
        </span>
      </div>
    </div>

    <!-- Amount Sent Highlight -->
    <div style="text-align: center; background: rgba(0, 0, 0, 0.4); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; margin-bottom: 14px;">
      <div style="font-size: 0.76rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.08em; margin-bottom: 2px;">
        Net Amount Sent to Bank
      </div>
      <div style="font-size: 1.85rem; font-weight: 800; font-family: var(--font-mono); color: #FFF;">
        ${formatNaira(sent)}
      </div>
      <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
        Destination: <strong>${escapeHTML(wth.bankName || 'Bank')}</strong>
      </div>
    </div>

    <!-- Breakdown Details -->
    <div style="background: rgba(13, 21, 45, 0.65); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 9px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Transaction Type:</span>
        <strong style="color: #FFF;">Event Creator Wallet Withdrawal</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Amount Withdrawn:</span>
        <strong style="color: #FFF; font-family: var(--font-mono);">${formatNaira(gross)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Withdrawal Charge:</span>
        <strong style="color: var(--text-secondary); font-family: var(--font-mono);">${formatNaira(fee)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 6px;">
        <span style="color: var(--text-muted);">Amount Sent:</span>
        <strong style="color: var(--accent-emerald); font-family: var(--font-mono); font-size: 0.95rem;">${formatNaira(sent)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 6px;">
        <span style="color: var(--text-muted);">Bank:</span>
        <strong style="color: #FFF;">${escapeHTML(wth.bankName || 'Bank')}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Account Name:</span>
        <strong style="color: #FFF;">${escapeHTML(wth.accountName || '-')}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Account Number:</span>
        <span style="color: #FFF; font-family: var(--font-mono);">${formatMaskedAccount(wth.accountNumber)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Description / Narration:</span>
        <span style="color: #FFF;">${escapeHTML(wth.narration || 'Ticket sales payout')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 6px;">
        <span style="color: var(--text-muted);">Transaction Reference:</span>
        <code style="color: var(--accent-emerald); font-size: 0.8rem;">${wth.id}</code>
      </div>
      ${wth.providerReference ? `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Provider Reference:</span>
        <span style="color: #FFF; font-family: var(--font-mono); font-size: 0.8rem;">${escapeHTML(wth.providerReference)}</span>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Date:</span>
        <span style="color: #FFF;">${dateStr}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Time:</span>
        <span style="color: #FFF;">${timeStr}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--text-muted);">Status:</span>
        <span class="badge ${badgeClass}" style="font-size: 0.72rem;">${wth.status}</span>
      </div>
    </div>

    ${isFailed && wth.failureReason ? `
    <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-sm); padding: 10px 14px; margin-top: 12px; color: #FCA5A5; font-size: 0.82rem; line-height: 1.45;">
      <i class="fa-solid fa-triangle-exclamation"></i> <strong>Failure Reason:</strong> ${escapeHTML(wth.failureReason)}
      <div style="font-size: 0.75rem; color: #F87171; margin-top: 4px;">Your Event Creator Wallet balance has been automatically restored.</div>
    </div>` : ''}

    <div style="text-align: center; margin-top: 14px; font-size: 0.74rem; color: var(--text-muted);">
      <i class="fa-solid fa-shield-halved" style="color: var(--accent-emerald);"></i> Verified STRICTWALLET Event Creator Financial Ledger Record
    </div>
  `;

  openModal('creatorWithdrawalReceiptModal');
}

async function showEventWithdrawalReceiptById(id) {
  let wth = (State.organizerWithdrawals || []).find(w => w.id === id);
  if (wth) {
    showEventWithdrawalReceipt(wth);
    return;
  }
  try {
    const { ok, data } = await authFetch(`/events/creator/withdrawals/${id}`);
    if (ok && data.success && data.withdrawal) {
      showEventWithdrawalReceipt(data.withdrawal);
    } else {
      showToast('Could not load withdrawal receipt.', 'error');
    }
  } catch (err) {
    showToast('Failed to load withdrawal receipt.', 'error');
  }
}

function downloadCurrentCreatorReceiptPdf() {
  if (!State.currentCreatorReceiptWithdrawal) {
    showToast('No receipt selected for download.', 'warning');
    return;
  }
  downloadEventWithdrawalReceiptPdf(State.currentCreatorReceiptWithdrawal);
}

function downloadEventWithdrawalReceiptPdf(wth) {
  if (!wth) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    showToast('PDF generation engine not available.', 'error');
    return;
  }

  const btn = document.getElementById('btnDownloadCreatorReceiptPdf');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...`;
  }

  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 16;
    const contentW = pageW - margin * 2;

    // Header Navy Bar
    doc.setFillColor(13, 21, 45); // #0D152D
    doc.rect(0, 0, pageW, 36, 'F');

    // Emerald Top Stripe
    doc.setFillColor(0, 208, 156); // #00D09C
    doc.rect(0, 0, pageW, 4, 'F');

    // STRICTWALLET Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('STRICTWALLET', margin, 20);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 208, 156);
    doc.text('FINTECH WALLET & EVENT CREATOR TICKETING PLATFORM', margin, 27);

    // Document Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('EVENT CREATOR WALLET WITHDRAWAL RECEIPT', margin, 46);

    // Status Banner
    const isSuccess = wth.status === 'Successful';
    const isFailed = wth.status === 'Failed';
    const bannerColor = isSuccess ? [236, 253, 245] : isFailed ? [254, 242, 242] : [255, 251, 235];
    const bannerBorder = isSuccess ? [167, 243, 208] : isFailed ? [254, 202, 202] : [253, 230, 138];
    const textColor = isSuccess ? [5, 150, 105] : isFailed ? [220, 38, 38] : [217, 119, 6];

    doc.setFillColor(bannerColor[0], bannerColor[1], bannerColor[2]);
    doc.setDrawColor(bannerBorder[0], bannerBorder[1], bannerBorder[2]);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, 52, contentW, 13, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    const statusLabel = isSuccess ? 'STATUS: SUCCESSFUL (FUNDS TRANSFERRED)' : isFailed ? 'STATUS: FAILED (WALLET BALANCE RESTORED)' : `STATUS: ${wth.status.toUpperCase()}`;
    doc.text(statusLabel, pageW / 2, 60.5, { align: 'center' });

    // Amount Sent Highlight Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, 70, contentW, 25, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('NET AMOUNT SENT TO DESTINATION BANK', pageW / 2, 78, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(15, 23, 42);
    const netAmountStr = `NGN ${parseFloat(wth.amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    doc.text(netAmountStr, pageW / 2, 88, { align: 'center' });

    // Details Rows
    const startY = 104;
    const gross = parseFloat(wth.totalDeducted || (wth.amount + (wth.charge || 20)));
    const fee = parseFloat(wth.charge || 20.00);
    const sent = parseFloat(wth.amount || 0);

    const maskedAcc = wth.accountNumber ? `•••• •••• ${wth.accountNumber.toString().slice(-4)}` : 'N/A';
    const txDate = wth.createdAt ? new Date(wth.createdAt) : new Date();
    const dateStr = txDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = txDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const rows = [
      ['Transaction Reference', wth.id || 'N/A'],
      ['Provider Reference', wth.providerReference || 'Pending / N/A'],
      ['Transaction Type', 'Event Creator Wallet Withdrawal'],
      ['Gross Amount Withdrawn', `NGN ${gross.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`],
      ['Organizer Withdrawal Charge', `NGN ${fee.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`],
      ['Net Amount Sent', `NGN ${sent.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`],
      ['Destination Bank', wth.bankName || 'N/A'],
      ['Account Name', wth.accountName || 'N/A'],
      ['Account Number', maskedAcc],
      ['Description / Narration', wth.narration || 'Ticket sales payout'],
      ['Date & Time', `${dateStr}, ${timeStr}`],
      ['Transfer Status', wth.status || 'Pending']
    ];

    if (isFailed && wth.failureReason) {
      rows.push(['Failure Reason', wth.failureReason]);
    }

    let curY = startY;
    rows.forEach(([label, val], idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(margin, curY - 4.5, contentW, 7.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, margin + 3, curY);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      const splitVal = doc.splitTextToSize(val.toString(), 95);
      doc.text(splitVal[0], pageW - margin - 3, curY, { align: 'right' });

      curY += 8;
    });

    // Footer
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(margin, 266, pageW - margin, 266);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Official STRICTWALLET Event Creator Receipt • Generated on ${new Date().toLocaleString()}`, margin, 273);
    doc.text('This is an authentic transaction receipt from the STRICTWALLET financial ledger.', margin, 278);

    doc.save(`STRICTWALLET_Withdrawal_${wth.id || 'Receipt'}.pdf`);
    showToast('Withdrawal receipt PDF downloaded successfully!', 'success');
  } catch (pdfErr) {
    console.error('Receipt PDF Generation Error:', pdfErr);
    showToast('Failed to generate PDF receipt.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText || `<i class="fa-solid fa-file-pdf"></i> Download Receipt (PDF)`;
    }
  }
}

function scrollToCreatorTransactions() {
  if (State.currentView !== 'viewSettings') {
    navigateToView('viewSettings');
  }
  setTimeout(() => {
    const el = document.getElementById('creatorWalletTxSection');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 150);
}

