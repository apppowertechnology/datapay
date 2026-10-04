/**
 * STRICTWALLET — MASTER ADMINISTRATOR CONTROL CORE
 * Real-time analytics, user wallet regulation, pricing matrix, customer support, and audit trails
 */

const AdminState = {
  token: localStorage.getItem('strictwallet_admin_token') || null,
  user: null,
  stats: null,
  chartInstance: null,
  selectedUserForAdj: null,
  selectedPlanForEdit: null,
  activeAdminTicketId: null
};

// API Base URL (Relative /api for local development & same-origin production)
const API_BASE = '/api';



// Toast Notification Manager
function showAdminToast(message, type = 'info') {
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

function formatNaira(amount) {
  const num = parseFloat(amount || 0);
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

async function adminFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (AdminState.token) {
    headers['Authorization'] = `Bearer ${AdminState.token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    const data = await res.json();

    if (res.status === 401 || res.status === 403) {
      if (endpoint !== '/auth/login' && data.message && (data.message.includes('required') || data.message.includes('denied') || data.message.includes('Invalid') || data.message.includes('expired'))) {
        logoutAdmin(false);
        showAdminToast('Admin authorization expired. Please log in.', 'warning');
      }
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('Admin API Fetch Error:', err);
    return { ok: false, status: 0, data: { success: false, message: 'Server connection error.' } };
  }
}

// -------------------------------------------------------------
// INITIALIZATION & AUTHENTICATION
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupAdminEventListeners();

  if (AdminState.token) {
    await initAdminConsole();
  } else {
    showAdminAuthScreen();
  }
});

function showAdminAuthScreen() {
  document.getElementById('adminAuthWrapper').style.display = 'flex';
  document.getElementById('adminAppContainer').style.display = 'none';
}

function showAdminAppScreen() {
  document.getElementById('adminAuthWrapper').style.display = 'none';
  document.getElementById('adminAppContainer').style.display = 'flex';
  navigateAdminView('viewAdminOverview');
}

async function initAdminConsole() {
  const { ok, data } = await adminFetch('/auth/me');
  if (ok && data.success && data.user.role === 'admin') {
    AdminState.user = data.user;
    document.getElementById('adminProfileEmail').innerText = data.user.email;
    showAdminAppScreen();
  } else {
    logoutAdmin(false);
  }
}

function navigateAdminView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active-view'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active-view');

  document.querySelectorAll('#adminSidebar .nav-item[data-admin-view]').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-admin-view') === viewId);
  });

  document.getElementById('adminSidebar')?.classList.remove('mobile-open');
  document.getElementById('adminSidebarBackdrop')?.classList.remove('active');

  const titles = {
    viewAdminOverview: 'Overview & Analytics',
    viewAdminUsers: 'User Management',
    viewAdminTransactions: 'Master Transaction Ledger',
    viewAdminDeposits: 'Payments & Paystack Deposits Management',
    viewAdminEvents: 'Events & Creator Payouts Management',
    viewAdminPricing: 'Pricing & Profit Matrix',
    viewAdminSupport: 'Support Desk & Tickets',
    viewAdminLogs: 'Administrative Audit Trail',
    viewAdminSocial: 'Social Media & Community Channels'
  };
  document.getElementById('adminPageHeadline').innerText = titles[viewId] || 'Admin Console';

  if (viewId === 'viewAdminOverview') loadAdminOverview();
  if (viewId === 'viewAdminUsers') loadAdminUsers();
  if (viewId === 'viewAdminTransactions') loadAdminTransactions();
  if (viewId === 'viewAdminDeposits') loadAdminDeposits();
  if (viewId === 'viewAdminEvents') loadAdminEventsAnalytics();
  if (viewId === 'viewAdminPricing') loadAdminPricing();
  if (viewId === 'viewAdminSupport') loadAdminSupportTickets();
  if (viewId === 'viewAdminLogs') loadAdminAuditLogs();
  if (viewId === 'viewAdminSocial') loadAdminSocialLinks();
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------
function setupAdminEventListeners() {
  
  // Toggle Admin Password Visibility
  document.getElementById('toggleAdminPass')?.addEventListener('click', function() {
    const input = document.getElementById('adminPassword');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    this.querySelector('i').className = isPass ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  });

  // Admin Login
  document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;

    const btn = document.getElementById('adminLoginBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;

    const { ok, data } = await adminFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Authenticate & Enter Console`;

    if (ok && data.success && data.user && data.user.role === 'admin') {
      AdminState.token = data.token;
      localStorage.setItem('strictwallet_admin_token', data.token);
      showAdminToast('Welcome Administrator to STRICTWALLET Control Engine', 'success');
      await initAdminConsole();
    } else if (ok && data.success && data.user && data.user.role !== 'admin') {
      showAdminToast('Access denied: Administrator privileges required.', 'error');
    } else {
      showAdminToast(data.message || 'Unauthorized: Administrator credentials required.', 'error');
    }
  });

  // Sidebar Routing
  document.querySelectorAll('#adminSidebar .nav-item[data-admin-view]').forEach(item => {
    item.addEventListener('click', () => {
      navigateAdminView(item.getAttribute('data-admin-view'));
    });
  });

  // Mobile Drawer & Backdrop Handlers
  const adminSidebar = document.getElementById('adminSidebar');
  const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');
  const toggleAdminSidebar = () => {
    const isOpen = adminSidebar?.classList.toggle('mobile-open');
    adminSidebarBackdrop?.classList.toggle('active', !!isOpen);
  };
  const closeAdminSidebar = () => {
    adminSidebar?.classList.remove('mobile-open');
    adminSidebarBackdrop?.classList.remove('active');
  };

  document.getElementById('adminMobileToggle')?.addEventListener('click', toggleAdminSidebar);
  document.getElementById('adminSidebarCloseBtn')?.addEventListener('click', closeAdminSidebar);
  adminSidebarBackdrop?.addEventListener('click', closeAdminSidebar);

  // Refresh
  document.getElementById('btnRefreshAdminData')?.addEventListener('click', () => {
    const activeView = document.querySelector('.view-section.active-view')?.id || 'viewAdminOverview';
    navigateAdminView(activeView);
    showAdminToast('Dashboard refreshed with latest ledger data', 'info');
  });

  // Logout
  document.getElementById('btnAdminLogout')?.addEventListener('click', () => {
    if (confirm('Sign out of STRICTWALLET Administrator Console?')) {
      logoutAdmin(true);
    }
  });

  // Filter & Search bindings
  document.getElementById('adminUserSearch')?.addEventListener('input', debounce(loadAdminUsers, 300));
  document.getElementById('adminUserStatusFilter')?.addEventListener('change', loadAdminUsers);

  document.getElementById('adminTxSearch')?.addEventListener('input', debounce(loadAdminTransactions, 300));
  document.getElementById('adminTxTypeFilter')?.addEventListener('change', loadAdminTransactions);
  document.getElementById('adminTxStatusFilter')?.addEventListener('change', loadAdminTransactions);

  document.getElementById('adminSupportSearch')?.addEventListener('input', debounce(loadAdminSupportTickets, 300));
  document.getElementById('adminSupportStatusFilter')?.addEventListener('change', loadAdminSupportTickets);

  // Payments & Deposits Management Listeners
  document.getElementById('adminDepositTableSearch')?.addEventListener('input', debounce(loadAdminDeposits, 300));
  document.getElementById('adminDepositTableStatus')?.addEventListener('change', loadAdminDeposits);
  document.getElementById('btnRefreshAdminDeposits')?.addEventListener('click', loadAdminDeposits);

  document.getElementById('btnAdminDepositLookup')?.addEventListener('click', () => {
    const q = document.getElementById('adminDepositLookupInput')?.value.trim();
    if (q) lookupAdminDeposit(q);
  });

  document.getElementById('adminDepositLookupInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = e.target.value.trim();
      if (q) lookupAdminDeposit(q);
    }
  });

  document.getElementById('btnAdminDepositLookupClear')?.addEventListener('click', () => {
    const input = document.getElementById('adminDepositLookupInput');
    if (input) input.value = '';
    const resBox = document.getElementById('adminDepositLookupResult');
    if (resBox) {
      resBox.style.display = 'none';
      resBox.innerHTML = '';
    }
  });

  // Plan Management Search & Filter bindings
  document.getElementById('adminPlanSearch')?.addEventListener('input', debounce(loadAdminPricing, 300));
  document.getElementById('adminPlanNetworkFilter')?.addEventListener('change', loadAdminPricing);
  document.getElementById('adminPlanTypeFilter')?.addEventListener('change', loadAdminPricing);
  document.getElementById('adminPlanStatusFilter')?.addEventListener('change', loadAdminPricing);

  // Open Add Plan Modal
  function openAddPlanModal() {
  // Reset form fields
  const form = document.getElementById('adminAddPlanForm');
  if (form) form.reset();
  // Clear profit preview
  const profitEl = document.getElementById('addProfitPreview');
  if (profitEl) profitEl.innerText = '+₦0.00';
  openModal('adminAddPlanModal');
}
window.openAddPlanModal = openAddPlanModal;
document.getElementById('btnOpenAddPlanModal')?.addEventListener('click', openAddPlanModal);

  // Live Profit Calculation for Edit Modal
  const updateEditProfit = () => {
    const cost = parseFloat(document.getElementById('editPlanCostPrice')?.value || 0);
    const selling = parseFloat(document.getElementById('editSellingPrice')?.value || 0);
    const profit = Math.round((selling - cost) * 100) / 100;
    const el = document.getElementById('editProfitPreview');
    if (el) {
      el.innerText = `${profit >= 0 ? '+' : ''}${formatNaira(profit)}`;
      el.style.color = profit >= 0 ? 'var(--accent-emerald)' : 'var(--status-error)';
    }
  };
  document.getElementById('editPlanCostPrice')?.addEventListener('input', updateEditProfit);
  document.getElementById('editSellingPrice')?.addEventListener('input', updateEditProfit);

  // Live Profit Calculation for Add Modal
  const updateAddProfit = () => {
    const cost = parseFloat(document.getElementById('addPlanCostPrice')?.value || 0);
    const selling = parseFloat(document.getElementById('addSellingPrice')?.value || 0);
    const profit = Math.round((selling - cost) * 100) / 100;
    const el = document.getElementById('addProfitPreview');
    if (el) {
      el.innerText = `${profit >= 0 ? '+' : ''}${formatNaira(profit)}`;
      el.style.color = profit >= 0 ? 'var(--accent-emerald)' : 'var(--status-error)';
    }
  };
  document.getElementById('addPlanCostPrice')?.addEventListener('input', updateAddProfit);
  document.getElementById('addSellingPrice')?.addEventListener('input', updateAddProfit);

  // Revert Plan to Default Button
  document.getElementById('btnResetPlanDefault')?.addEventListener('click', async () => {
    if (!AdminState.selectedPlanForEdit) return;
    if (!confirm(`Revert ${AdminState.selectedPlanForEdit.name} to original default settings?`)) return;

    const { ok, data } = await adminFetch(`/admin/pricing/${AdminState.selectedPlanForEdit.id}/reset`, {
      method: 'POST'
    });

    if (ok && data.success) {
      closeModal('adminEditPriceModal');
      showAdminToast(data.message, 'success');
      loadAdminPricing();
    } else {
      showAdminToast(data.message || 'Failed to revert plan', 'error');
    }
  });

  // Delete Plan from Edit Modal Button
  document.getElementById('btnDeletePlanFromModal')?.addEventListener('click', () => {
    if (!AdminState.selectedPlanForEdit) return;
    const plan = AdminState.selectedPlanForEdit;
    closeModal('adminEditPriceModal');
    deletePlan(plan.id, plan.name);
  });

  // Manual Balance Adjustment Form Submission
  document.getElementById('adminBalanceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!AdminState.selectedUserForAdj) return;

    const type = document.getElementById('adjType').value;
    const amount = parseFloat(document.getElementById('adjAmount').value);
    const reason = document.getElementById('adjReason').value.trim();

    const { ok, data } = await adminFetch(`/admin/users/${AdminState.selectedUserForAdj.id}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ type, amount, reason })
    });

    if (ok && data.success) {
      closeModal('adminBalanceModal');
      showAdminToast(data.message, 'success');
      loadAdminUsers();
      document.getElementById('adminBalanceForm').reset();
    } else {
      showAdminToast(data.message || 'Balance adjustment failed', 'error');
    }
  });

  // Edit Pricing & Plan Form Submission
  document.getElementById('adminEditPriceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!AdminState.selectedPlanForEdit) return;

    const network = document.getElementById('editPlanNetwork').value;
    const planType = document.getElementById('editPlanType').value.trim();
    const size = document.getElementById('editPlanSize').value.trim();
    const name = document.getElementById('editPlanNameInput').value.trim();
    const providerPlanId = document.getElementById('editPlanIdInput').value.trim();
    const validity = document.getElementById('editPlanValidity').value.trim();
    const costPrice = parseFloat(document.getElementById('editPlanCostPrice').value);
    const sellingPrice = parseFloat(document.getElementById('editSellingPrice').value);
    const status = document.getElementById('editPlanStatus').value;

    const { ok, data } = await adminFetch(`/admin/pricing/${AdminState.selectedPlanForEdit.id}`, {
      method: 'POST',
      body: JSON.stringify({
        network,
        planType,
        size,
        name,
        providerPlanId,
        validity,
        costPrice,
        sellingPrice,
        status
      })
    });

    if (ok && data.success) {
      closeModal('adminEditPriceModal');
      showAdminToast(data.message, 'success');
      loadAdminPricing();
    } else {
      showAdminToast(data.message || 'Failed to update plan configurations', 'error');
    }
  });

  // Add New Data Plan Form Submission
  document.getElementById('adminAddPlanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const network = document.getElementById('addPlanNetwork').value;
    const planType = document.getElementById('addPlanType').value.trim();
    const size = document.getElementById('addPlanSize').value.trim();
    const name = document.getElementById('addPlanName').value.trim();
    const providerPlanId = document.getElementById('addPlanIdInput').value.trim();
    const validity = document.getElementById('addPlanValidity').value.trim();
    const costPrice = parseFloat(document.getElementById('addPlanCostPrice').value);
    const sellingPrice = parseFloat(document.getElementById('addSellingPrice').value);
    const status = document.getElementById('addPlanStatus').value;

    const { ok, data } = await adminFetch('/admin/pricing', {
      method: 'POST',
      body: JSON.stringify({
        network,
        planType,
        size,
        name,
        providerPlanId,
        validity,
        costPrice,
        sellingPrice,
        status
      })
    });

    if (ok && data.success) {
      closeModal('adminAddPlanModal');
      document.getElementById('adminAddPlanForm').reset();
      showAdminToast(data.message, 'success');
      loadAdminPricing();
    } else {
      showAdminToast(data.message || 'Failed to create plan', 'error');
    }
  });

  // Admin Ticket Reply Submission
  document.getElementById('adminTicketReplyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('adminTicketReplyInput');
    const message = input.value.trim();

    if (!message || !AdminState.activeAdminTicketId) return;

    const { ok, data } = await adminFetch(`/support/ticket/${AdminState.activeAdminTicketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });

    if (ok && data.success) {
      input.value = '';
      await loadAdminTicketChat(AdminState.activeAdminTicketId);
    } else {
      showAdminToast(data.message || 'Error sending reply', 'error');
    }
  });

  // Ticket Status Actions in Admin Modal
  document.getElementById('btnMarkTicketResolved')?.addEventListener('click', async () => {
    if (!AdminState.activeAdminTicketId) return;
    const { ok, data } = await adminFetch(`/admin/support/tickets/${AdminState.activeAdminTicketId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Resolved' })
    });
    if (ok && data.success) {
      showAdminToast(data.message, 'success');
      closeModal('adminTicketModal');
      loadAdminSupportTickets();
    }
  });

  document.getElementById('btnMarkTicketClosed')?.addEventListener('click', async () => {
    if (!AdminState.activeAdminTicketId) return;
    const { ok, data } = await adminFetch(`/admin/support/tickets/${AdminState.activeAdminTicketId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Closed' })
    });
    if (ok && data.success) {
      showAdminToast(data.message, 'success');
      closeModal('adminTicketModal');
      loadAdminSupportTickets();
    }
  });

  // Social Media Management Form Submit & Button
  document.getElementById('btnOpenAddSocialModal')?.addEventListener('click', openAddSocialModal);

  document.getElementById('adminSocialForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('socialEditId').value;
    const platform = document.getElementById('socialPlatform').value;
    const name = document.getElementById('socialName').value.trim();
    const actionText = document.getElementById('socialActionText').value.trim();
    const url = document.getElementById('socialUrl').value.trim();
    const order = parseInt(document.getElementById('socialOrder').value, 10) || 1;
    const enabled = document.getElementById('socialStatus').value === 'true';

    const btn = document.getElementById('btnSaveSocialLink');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    const { ok, data } = await adminFetch('/admin/social-links', {
      method: 'POST',
      body: JSON.stringify({ id: id || undefined, platform, name, actionText, url, order, enabled })
    });

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Channel`;

    if (ok && data.success) {
      closeModal('adminSocialModal');
      showAdminToast(data.message || 'Social media channel saved successfully!', 'success');
      loadAdminSocialLinks();
    } else {
      showAdminToast(data.message || 'Failed to save social channel', 'error');
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// -------------------------------------------------------------
// 1. OVERVIEW & ANALYTICS
// -------------------------------------------------------------
async function loadAdminOverview() {
  const { ok, data } = await adminFetch('/admin/stats');
  if (!ok || !data.success) return;

  const s = data.stats;
  AdminState.stats = s;

  document.getElementById('statAdminTotalUsers').innerText = s.totalUsers.toLocaleString();
  document.getElementById('statAdminTotalDeposits').innerText = formatNaira(s.totalDeposits);
  document.getElementById('statAdminTotalRevenue').innerText = formatNaira(s.totalRevenue);
  document.getElementById('statAdminTotalProfit').innerText = formatNaira(s.totalProfit);

  document.getElementById('statAdminAirtimeSales').innerText = formatNaira(s.totalAirtimeSales);
  document.getElementById('statAdminDataSales').innerText = formatNaira(s.totalDataSales);
  document.getElementById('statAdminTotalTx').innerText = s.totalTransactions.toLocaleString();
  document.getElementById('statAdminOpenTickets').innerText = s.openTickets.toLocaleString();

  // Render Chart
  renderAdminChart(data.chartData || []);
}

function renderAdminChart(chartData) {
  const ctx = document.getElementById('adminSalesChart');
  if (!ctx) return;

  if (AdminState.chartInstance) {
    AdminState.chartInstance.destroy();
  }

  const labels = chartData.map(d => {
    const dt = new Date(d.date);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const sales = chartData.map(d => d.sales);
  const profit = chartData.map(d => d.profit);

  AdminState.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sales Revenue (₦)',
          data: sales,
          borderColor: '#38BDF8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#38BDF8',
          pointRadius: 4
        },
        {
          label: 'Net Platform Profit (₦)',
          data: profit,
          borderColor: '#00D09C',
          backgroundColor: 'rgba(0, 208, 156, 0.15)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#00D09C',
          pointRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94A3B8', font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94A3B8' }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94A3B8',
            callback: value => '₦' + value.toLocaleString()
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// 2. USER MANAGEMENT
// -------------------------------------------------------------
async function loadAdminUsers() {
  const search = document.getElementById('adminUserSearch')?.value.trim() || '';
  const status = document.getElementById('adminUserStatusFilter')?.value || 'all';

  const { ok, data } = await adminFetch(`/admin/users?search=${encodeURIComponent(search)}&status=${status}`);
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;

  if (ok && data.success && data.users.length > 0) {
    tbody.innerHTML = data.users.map(u => {
      const isSuspended = u.status === 'suspended';
      const badgeClass = isSuspended ? 'badge-danger' : 'badge-success';

      return `
        <tr>
          <td>
            <strong style="color: #FFF;">${u.fullName}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${u.email}</div>
          </td>
          <td>${u.phone || '-'}</td>
          <td>
            <strong style="color: var(--accent-blue-light); font-size: 0.82rem;">${u.virtualBankName || 'Nombank MFB'}</strong>
            <div style="font-family: var(--font-mono); color: #FFF;">${u.virtualAccountNumber || 'Not Generated'}</div>
          </td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-emerald);">
            ${formatNaira(u.walletBalance)}
          </td>
          <td><span class="badge ${badgeClass}">${u.status}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-outline btn-sm" onclick='openBalanceModal(${JSON.stringify(u).replace(/'/g, "&apos;")})'>
                <i class="fa-solid fa-wallet"></i> Adjust
              </button>
              <button class="btn ${isSuspended ? 'btn-primary' : 'btn-danger'} btn-sm" onclick="toggleUserStatus('${u.id}', '${isSuspended ? 'active' : 'suspended'}')">
                <i class="fa-solid ${isSuspended ? 'fa-user-check' : 'fa-user-slash'}"></i> ${isSuspended ? 'Activate' : 'Suspend'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 28px; color: var(--text-muted);">No users found.</td></tr>`;
  }
}

window.openBalanceModal = function(user) {
  AdminState.selectedUserForAdj = user;
  document.getElementById('adjUserName').innerText = `${user.fullName} (${user.email})`;
  document.getElementById('adjUserBalance').innerText = formatNaira(user.walletBalance);
  document.getElementById('adjAmount').value = '';
  document.getElementById('adjReason').value = '';
  openModal('adminBalanceModal');
};

window.toggleUserStatus = async function(userId, newStatus) {
  if (!confirm(`Are you sure you want to set this user status to ${newStatus.toUpperCase()}?`)) return;

  const { ok, data } = await adminFetch(`/admin/users/${userId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: newStatus })
  });

  if (ok && data.success) {
    showAdminToast(data.message, 'success');
    loadAdminUsers();
  } else {
    showAdminToast(data.message || 'Status update failed', 'error');
  }
};

// -------------------------------------------------------------
// 3. MASTER TRANSACTION LEDGER
// -------------------------------------------------------------
async function loadAdminTransactions() {
  const search = document.getElementById('adminTxSearch')?.value.trim() || '';
  const type = document.getElementById('adminTxTypeFilter')?.value || 'all';
  const status = document.getElementById('adminTxStatusFilter')?.value || 'all';

  const { ok, data } = await adminFetch(`/admin/transactions?search=${encodeURIComponent(search)}&type=${type}&status=${status}`);
  const tbody = document.getElementById('adminTransactionsTableBody');
  if (!tbody) return;

  if (ok && data.success && data.transactions.length > 0) {
    tbody.innerHTML = data.transactions.map(tx => {
      let badgeClass = tx.status === 'Successful' ? 'badge-success' : tx.status === 'Pending' ? 'badge-warning' : 'badge-danger';

      return `
        <tr>
          <td><code style="color: var(--accent-emerald); font-size: 0.78rem;">${tx.id}</code></td>
          <td>
            <strong style="color: #FFF;">${tx.userFullName || 'User'}</strong>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${tx.userEmail || ''}</div>
          </td>
          <td>
            <span style="text-transform: capitalize; font-weight: 700;">${tx.type}</span>
            ${tx.network ? `<span style="font-size: 0.75rem; color: var(--accent-blue-light); display: block;">${tx.network}</span>` : ''}
          </td>
          <td>${tx.phoneNumber || tx.virtualAccountNumber || '-'}</td>
          <td style="font-family: var(--font-mono); color: var(--text-muted);">${formatNaira(tx.costPrice)}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: #FFF;">${formatNaira(tx.sellingPrice || tx.amount)}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-emerald);">${formatNaira(tx.profit)}</td>
          <td><span class="badge ${badgeClass}">${tx.status}</span></td>
          <td style="font-size: 0.78rem; color: var(--text-muted);">${formatDateTime(tx.createdAt)}</td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 28px; color: var(--text-muted);">No matching ledger entries found.</td></tr>`;
  }
}

// -------------------------------------------------------------
// 4. PRICING & PROFIT MATRIX
// -------------------------------------------------------------
async function loadAdminPricing() {
  const search = document.getElementById('adminPlanSearch')?.value.trim() || '';
  const network = document.getElementById('adminPlanNetworkFilter')?.value || 'all';
  const planType = document.getElementById('adminPlanTypeFilter')?.value || 'all';
  const status = document.getElementById('adminPlanStatusFilter')?.value || 'all';

  const { ok, data } = await adminFetch(`/admin/pricing?search=${encodeURIComponent(search)}&network=${network}&planType=${encodeURIComponent(planType)}&status=${status}`);
  const tbody = document.getElementById('adminPricingTableBody');
  if (!tbody) return;

  if (ok && data.success && data.plans.length > 0) {
    tbody.innerHTML = data.plans.map(p => {
      const isActive = p.status === 'active';
      const profit = Math.round((parseFloat(p.sellingPrice) - parseFloat(p.costPrice)) * 100) / 100;
      const safePlanStr = JSON.stringify(p).replace(/'/g, "&apos;");

      return `
        <tr>
          <td><strong style="color: var(--accent-blue-light); font-weight: 800;">${p.network}</strong></td>
          <td><span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #FFF; font-weight: 700;">${p.planType || 'SME'}</span></td>
          <td>
            <strong style="color: #FFF;">${p.name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;"><i class="fa-regular fa-clock"></i> ${p.validity}</div>
          </td>
          <td><code style="color: var(--accent-emerald); font-size: 0.8rem;">${p.providerPlanId || '-'}</code></td>
          <td style="font-family: var(--font-mono); color: #38BDF8;">${formatNaira(p.costPrice)}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: #FFF; font-size: 0.95rem;">${formatNaira(p.sellingPrice)}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: ${profit >= 0 ? 'var(--accent-emerald)' : 'var(--status-error)'};">
            ${profit >= 0 ? '+' : ''}${formatNaira(profit)}
          </td>
          <td>
            <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
              <i class="fa-solid ${isActive ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isActive ? 'Active' : 'Suspended'}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-outline btn-sm" onclick='openEditPriceModal(${safePlanStr})' title="Edit Plan">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
              ${isActive ? `
                <button class="btn btn-sm" onclick="togglePlanStatus('${p.id}', 'inactive', '${p.name.replace(/'/g, "\\'")}')" style="background: rgba(245, 158, 11, 0.15); color: #F59E0B; border: 1px solid rgba(245, 158, 11, 0.4);" title="Suspend this plan">
                  <i class="fa-solid fa-ban"></i> Suspend
                </button>
              ` : `
                <button class="btn btn-primary btn-sm" onclick="togglePlanStatus('${p.id}', 'active', '${p.name.replace(/'/g, "\\'")}')" title="Reactivate this plan">
                  <i class="fa-solid fa-check"></i> Activate
                </button>
              `}
              <button class="btn btn-danger btn-sm" onclick="deletePlan('${p.id}', '${p.name.replace(/'/g, "\\'")}')" title="Permanently Delete Plan">
                <i class="fa-solid fa-trash"></i> Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 28px; color: var(--text-muted);">No data plans found matching your search and filter criteria.</td></tr>`;
  }
}

window.openEditPriceModal = function(plan) {
  AdminState.selectedPlanForEdit = plan;
  document.getElementById('editPlanNetwork').value = plan.network || 'MTN';
  document.getElementById('editPlanType').value = plan.planType || 'SME';
  document.getElementById('editPlanSize').value = plan.size || '';
  document.getElementById('editPlanNameInput').value = plan.name || '';
  document.getElementById('editPlanIdInput').value = plan.providerPlanId || '';
  document.getElementById('editPlanValidity').value = plan.validity || '30 Days';
  document.getElementById('editPlanCostPrice').value = plan.costPrice || 0;
  document.getElementById('editSellingPrice').value = plan.sellingPrice || 0;
  document.getElementById('editPlanStatus').value = plan.status || 'active';

  const cost = parseFloat(plan.costPrice || 0);
  const selling = parseFloat(plan.sellingPrice || 0);
  const profit = Math.round((selling - cost) * 100) / 100;
  const el = document.getElementById('editProfitPreview');
  if (el) {
    el.innerText = `${profit >= 0 ? '+' : ''}${formatNaira(profit)}`;
    el.style.color = profit >= 0 ? 'var(--accent-emerald)' : 'var(--status-error)';
  }

  openModal('adminEditPriceModal');
};

window.togglePlanStatus = async function(planId, newStatus, planName) {
  const isActivating = newStatus === 'active';
  const actionText = isActivating ? 'reactivate' : 'suspend';
  const displayName = planName ? ` "${planName}"` : '';

  if (!confirm(`Are you sure you want to ${actionText} this data plan${displayName}?`)) return;

  const { ok, data } = await adminFetch(`/admin/pricing/${planId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: newStatus })
  });

  if (ok && data.success) {
    showAdminToast(data.message || `Plan ${isActivating ? 'activated' : 'suspended'} successfully!`, 'success');
    loadAdminPricing();
  } else {
    showAdminToast(data.message || `Failed to ${actionText} plan`, 'error');
  }
};

window.deletePlan = async function(planId, planName) {
  const displayName = planName ? ` "${planName}"` : '';
  if (!confirm(`Are you sure you want to delete this plan${displayName}?\n\nThis action cannot be undone and will immediately remove the plan from the database, Admin Panel, and User Interface.`)) {
    return;
  }

  const { ok, data } = await adminFetch(`/admin/pricing/${planId}`, { method: 'DELETE' });
  if (ok && data.success) {
    showAdminToast(data.message || 'Plan permanently deleted successfully', 'success');
    loadAdminPricing();
  } else {
    showAdminToast(data.message || 'Failed to delete plan', 'error');
  }
};

// -------------------------------------------------------------
// 5. SUPPORT TICKETS MANAGEMENT
// -------------------------------------------------------------
async function loadAdminSupportTickets() {
  const search = document.getElementById('adminSupportSearch')?.value.trim() || '';
  const status = document.getElementById('adminSupportStatusFilter')?.value || 'all';

  const { ok, data } = await adminFetch(`/admin/support/tickets?search=${encodeURIComponent(search)}&status=${status}`);
  const tbody = document.getElementById('adminSupportTableBody');
  if (!tbody) return;

  if (ok && data.success && data.tickets.length > 0) {
    tbody.innerHTML = data.tickets.map(t => {
      let badgeClass = t.status === 'Open' ? 'badge-info' : t.status === 'Resolved' ? 'badge-success' : 'badge-warning';

      return `
        <tr>
          <td><code style="color: var(--accent-emerald);">${t.ticketNumber}</code></td>
          <td>
            <strong style="color: #FFF;">${t.userName || 'User'}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${t.userEmail || ''}</div>
          </td>
          <td><strong>${t.subject}</strong></td>
          <td>${t.category}</td>
          <td><span class="badge ${badgeClass}">${t.status}</span></td>
          <td style="font-size: 0.78rem; color: var(--text-muted);">${formatDateTime(t.createdAt)}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openAdminTicketChat('${t.id}', '${t.ticketNumber}', '${t.subject.replace(/'/g, "&apos;")}', '${(t.userName || 'User').replace(/'/g, "&apos;")}')">
              <i class="fa-solid fa-comments"></i> Manage & Chat
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 28px; color: var(--text-muted);">No support tickets found.</td></tr>`;
  }
}

window.openAdminTicketChat = async function(ticketId, ticketNumber, subject, customerName) {
  AdminState.activeAdminTicketId = ticketId;
  document.getElementById('admChatTicketNumber').innerText = `Ticket #${ticketNumber}`;
  document.getElementById('admChatTicketSubject').innerText = subject;
  document.getElementById('admChatCustomerName').innerText = customerName;
  openModal('adminTicketModal');
  await loadAdminTicketChat(ticketId);
};

async function loadAdminTicketChat(ticketId) {
  const container = document.getElementById('adminTicketChatContainer');
  const { ok, data } = await adminFetch(`/support/ticket/${ticketId}`);

  if (ok && data.success) {
    if (data.messages.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No messages in this ticket yet.</div>`;
      return;
    }

    container.innerHTML = data.messages.map(m => `
      <div class="chat-bubble ${m.senderRole === 'admin' ? 'admin' : 'user'}" style="${m.senderRole === 'admin' ? 'background: rgba(0, 208, 156, 0.15); border: 1px solid rgba(0, 208, 156, 0.3);' : ''}">
        <strong style="font-size: 0.75rem; opacity: 0.8; display: block; margin-bottom: 3px;">
          ${m.senderRole === 'admin' ? 'Administrator (You)' : (m.senderName || 'Customer')}
        </strong>
        <div>${m.message}</div>
        <span class="chat-time">${formatDateTime(m.createdAt)}</span>
      </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
  }
}

// -------------------------------------------------------------
// 6. AUDIT LOGS
// -------------------------------------------------------------
async function loadAdminAuditLogs() {
  const { ok, data } = await adminFetch('/admin/audit-logs');
  const tbody = document.getElementById('adminAuditLogsTableBody');
  if (!tbody) return;

  if (ok && data.success && data.logs.length > 0) {
    tbody.innerHTML = data.logs.map(l => `
      <tr>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${formatDateTime(l.timestamp)}</td>
        <td><strong style="color: var(--accent-blue-light);">${l.adminEmail || 'admin'}</strong></td>
        <td><code style="color: var(--accent-emerald);">${l.action}</code></td>
        <td style="color: #FFF;">${l.description}</td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 28px; color: var(--text-muted);">No audit logs recorded yet.</td></tr>`;
  }
}

// -------------------------------------------------------------
// 7. SOCIAL MEDIA MANAGEMENT
// -------------------------------------------------------------
async function loadAdminSocialLinks() {
  const { ok, data } = await adminFetch('/admin/social-links');
  const tbody = document.getElementById('adminSocialTableBody');
  if (!tbody) return;

  if (ok && data.success && data.links.length > 0) {
    tbody.innerHTML = data.links.map(s => {
      const isEnabled = s.enabled === true;
      const safeLinkStr = JSON.stringify(s).replace(/'/g, "&apos;");

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <i class="${s.icon || 'fa-solid fa-globe'}" style="font-size: 1.3rem; color: var(--accent-emerald);"></i>
              <strong style="color: #FFF;">${s.platform}</strong>
            </div>
          </td>
          <td>
            <strong style="color: #FFF;">${s.name}</strong>
          </td>
          <td><span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #38BDF8;">${s.actionText || 'Visit Us'}</span></td>
          <td>
            <a href="${s.url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue-light); font-size: 0.82rem; word-break: break-all;">
              ${s.url} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.72rem;"></i>
            </a>
          </td>
          <td>
            <span class="badge ${isEnabled ? 'badge-success' : 'badge-danger'}">
              <i class="fa-solid ${isEnabled ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${isEnabled ? 'Active' : 'Disabled'}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-outline btn-sm" onclick='openEditSocialModal(${safeLinkStr})' title="Edit Channel">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
              <button class="btn btn-sm ${isEnabled ? 'btn-secondary' : 'btn-primary'}" onclick="toggleSocialLinkStatus('${s.id}')" title="${isEnabled ? 'Disable' : 'Enable'}">
                <i class="fa-solid ${isEnabled ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isEnabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteSocialLink('${s.id}', '${s.platform}')" title="Delete Channel">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 28px; color: var(--text-muted);">No social media platforms added yet. Click "Add Platform" to configure one.</td></tr>`;
  }
}

window.openAddSocialModal = function() {
  document.getElementById('adminSocialForm').reset();
  document.getElementById('socialEditId').value = '';
  document.getElementById('adminSocialModalTitle').innerText = 'Add Social Media Channel';
  document.getElementById('socialStatus').value = 'true';
  document.getElementById('socialActionText').value = 'Follow Us';
  openModal('adminSocialModal');
};

window.openEditSocialModal = function(link) {
  document.getElementById('socialEditId').value = link.id;
  document.getElementById('adminSocialModalTitle').innerText = `Edit ${link.platform} Channel`;
  document.getElementById('socialPlatform').value = link.platform || 'WhatsApp';
  document.getElementById('socialName').value = link.name || '';
  document.getElementById('socialActionText').value = link.actionText || 'Follow Us';
  document.getElementById('socialUrl').value = link.url || '';
  document.getElementById('socialOrder').value = link.order || 1;
  document.getElementById('socialStatus').value = link.enabled ? 'true' : 'false';
  openModal('adminSocialModal');
};

window.toggleSocialLinkStatus = async function(linkId) {
  const { ok, data } = await adminFetch(`/admin/social-links/${linkId}/toggle`, { method: 'POST' });
  if (ok && data.success) {
    showAdminToast(data.message || 'Social link status updated', 'success');
    loadAdminSocialLinks();
  } else {
    showAdminToast(data.message || 'Failed to update social link', 'error');
  }
};

window.deleteSocialLink = async function(linkId, platform) {
  if (!confirm(`Are you sure you want to remove the ${platform} social media channel?`)) return;
  const { ok, data } = await adminFetch(`/admin/social-links/${linkId}`, { method: 'DELETE' });
  if (ok && data.success) {
    showAdminToast(data.message || 'Social channel removed successfully', 'success');
    loadAdminSocialLinks();
  } else {
    showAdminToast(data.message || 'Failed to remove social channel', 'error');
  }
};

function logoutAdmin(showNotification = true) {
  AdminState.token = null;
  AdminState.user = null;
  localStorage.removeItem('strictwallet_admin_token');
  showAdminAuthScreen();
  if (showNotification) showAdminToast('Admin signed out safely.', 'info');
}

// ==========================================================================
// ADMIN EVENT TICKETING & WITHDRAWAL ANALYTICS
// ==========================================================================

async function loadAdminEventsAnalytics() {
  const tbodyEvents = document.getElementById('admEventsTableBody');
  const tbodyWth = document.getElementById('admWithdrawalsTableBody');

  if (tbodyEvents) {
    tbodyEvents.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading event analytics...</td></tr>`;
  }
  if (tbodyWth) {
    tbodyWth.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading withdrawal ledger...</td></tr>`;
  }

  try {
    const { ok, data } = await adminFetch('/admin/events/analytics');
    if (!ok || !data.success) {
      showAdminToast(data.message || 'Failed to retrieve event analytics', 'error');
      return;
    }

    AdminState.adminEventsData = data;
    const m = data.metrics;

    // 1. Update KPI Card Values
    document.getElementById('admStatGrossTicketSales').innerText = formatNaira(m.ticketSales.grossTicketSales);
    document.getElementById('admStatTicketsSold').innerText = m.ticketSales.totalTicketsSold;
    document.getElementById('admStatTicketCommission').innerText = formatNaira(m.ticketSales.strictwalletCommission);
    document.getElementById('admStatCreatorEarnings').innerText = formatNaira(m.ticketSales.creatorEarnings);

    document.getElementById('admStatTotalEvents').innerText = m.events.total;
    document.getElementById('admStatPublishedEvents').innerText = m.events.published;
    document.getElementById('admStatDraftEvents').innerText = m.events.draft;

    // 2. Update Withdrawal Economics & Platform Profit
    document.getElementById('admStatSuccessfulWithdrawals').innerText = m.withdrawals.successful;
    document.getElementById('admStatWithdrawalVolume').innerText = formatNaira(m.withdrawals.totalVolume);
    document.getElementById('admStatChargesCollected').innerText = formatNaira(m.withdrawals.totalChargesCollected);
    document.getElementById('admStatProviderFees').innerText = formatNaira(m.withdrawals.totalProviderFees);
    document.getElementById('admStatNetWithdrawalProfit').innerText = formatNaira(m.withdrawals.totalStrictwalletProfit);

    // 3. Render Tables
    renderAdminEventsTable(data.events || []);
    renderAdminWithdrawalsTable(data.withdrawals || []);

  } catch (err) {
    console.error('Admin Event Analytics Load Error:', err);
    showAdminToast('Error connecting to event analytics service', 'error');
  }
}

function renderAdminEventsTable(events) {
  const tbody = document.getElementById('admEventsTableBody');
  if (!tbody) return;

  if (events.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No events created yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map(ev => {
    const isPub = ev.status === 'published';
    const cats = (ev.ticketTypes || []).map(t => `${t.name} (${formatNaira(t.price)})`).join(', ');

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #FFF;">${ev.id}</div>
          <div style="font-size: 0.76rem; color: var(--accent-blue-light); font-family: var(--font-mono);">${ev.slug}</div>
        </td>
        <td><strong>${ev.title}</strong></td>
        <td>
          <div>${ev.creatorName || '-'}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">${ev.creatorEmail || ''}</div>
        </td>
        <td>${ev.date} ${ev.time || ''}</td>
        <td><span style="font-size: 0.85rem; color: var(--text-secondary);">${ev.venue}</span></td>
        <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem;">
          ${cats || 'None'}
        </td>
        <td>
          <span class="badge badge-${isPub ? 'success' : 'warning'}">${isPub ? 'PUBLISHED' : 'DRAFT'}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" style="color: var(--status-error); border-color: rgba(239, 68, 68, 0.4); padding: 4px 10px; font-size: 0.78rem;" onclick="adminDeleteEvent('${ev.id}', '${ev.title.replace(/'/g, "\\'")}')">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function adminDeleteEvent(eventId, eventTitle) {
  if (!confirm(`Are you sure you want to delete event "${eventTitle}" (${eventId}) as administrator?\n\nThis will remove the event from public display and disable ticket sales.`)) {
    return;
  }

  try {
    const { ok, data } = await adminFetch(`/admin/events/${eventId}`, {
      method: 'DELETE'
    });

    if (ok && data.success) {
      showAdminToast(data.message || 'Event deleted successfully.', 'success');
      loadAdminEventsAnalytics();
    } else {
      showAdminToast(data.message || 'Failed to delete event.', 'error');
    }
  } catch (err) {
    console.error('Admin delete event error:', err);
    showAdminToast('Server error while deleting event.', 'error');
  }
}

function filterAdminEventsTable() {
  if (!AdminState.adminEventsData) return;
  const q = document.getElementById('admEventsSearch').value.toLowerCase().trim();
  const filtered = (AdminState.adminEventsData.events || []).filter(e =>
    (e.title && e.title.toLowerCase().includes(q)) ||
    (e.creatorName && e.creatorName.toLowerCase().includes(q)) ||
    (e.id && e.id.toLowerCase().includes(q)) ||
    (e.slug && e.slug.toLowerCase().includes(q))
  );
  renderAdminEventsTable(filtered);
}

function renderAdminWithdrawalsTable(withdrawals) {
  const tbody = document.getElementById('admWithdrawalsTableBody');
  if (!tbody) return;

  if (withdrawals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">No withdrawal requests recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = withdrawals.map(w => {
    let statusBadge = 'badge-info';
    if (w.status === 'Successful') statusBadge = 'badge-success';
    if (w.status === 'Failed') statusBadge = 'badge-error';

    const amt = parseFloat(w.amount || 0);
    const charge = parseFloat(w.charge || 20.00);
    const providerFee = parseFloat(w.providerFee || 10.00);
    const stampDuty = parseFloat(w.stampDuty !== undefined ? w.stampDuty : (amt >= 10000 ? 50.00 : 0.00));
    
    let profit = (charge - providerFee) + stampDuty;
    if (w.profit !== undefined && w.profit !== null) {
      const storedProfit = parseFloat(w.profit);
      if (storedProfit >= profit) {
        profit = storedProfit;
      }
    }
    const profitDisplay = w.status === 'Successful' ? formatNaira(profit) : '₦0.00';

    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-blue-light);">${w.id}</td>
        <td><strong>${w.userFullName || '-'}</strong></td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: #FFF;">${formatNaira(w.amount)}</td>
        <td style="color: var(--accent-emerald);">₦20.00</td>
        <td style="color: ${stampDuty > 0 ? 'var(--status-warning)' : 'var(--text-muted)'}; font-weight: 600;">${formatNaira(stampDuty)}</td>
        <td style="color: var(--status-warning);">₦10.00</td>
        <td style="color: var(--accent-emerald); font-weight: 700;">${profitDisplay}</td>
        <td>${w.bankName || w.bankCode}</td>
        <td style="font-family: var(--font-mono);">${w.accountNumber}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${w.narration || '-'}</td>
        <td><span class="badge ${statusBadge}">${w.status.toUpperCase()}</span></td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${formatDateTime(w.createdAt)}</td>
      </tr>
    `;
  }).join('');
}

function filterAdminWithdrawalsTable() {
  if (!AdminState.adminEventsData) return;
  const q = document.getElementById('admWithdrawalsSearch').value.toLowerCase().trim();
  const filtered = (AdminState.adminEventsData.withdrawals || []).filter(w =>
    (w.userFullName && w.userFullName.toLowerCase().includes(q)) ||
    (w.id && w.id.toLowerCase().includes(q)) ||
    (w.accountNumber && w.accountNumber.includes(q)) ||
    (w.bankName && w.bankName.toLowerCase().includes(q))
  );
  renderAdminWithdrawalsTable(filtered);
}

// ==========================================
// ADMIN PAYMENTS & DEPOSITS MANAGEMENT
// ==========================================

async function loadAdminDeposits() {
  const status = document.getElementById('adminDepositTableStatus')?.value || 'all';
  const search = document.getElementById('adminDepositTableSearch')?.value.trim() || '';
  const tbody = document.getElementById('adminDepositsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading deposits ledger...</td></tr>`;

  try {
    const { ok, data } = await adminFetch(`/admin/deposits?status=${status}&search=${encodeURIComponent(search)}&limit=100`);
    if (!ok || !data.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--status-error); padding: 24px;">Failed to load deposits.</td></tr>`;
      return;
    }

    const deposits = data.deposits || [];
    if (deposits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No matching deposit records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = deposits.map(dep => {
      let badgeClass = 'badge-success';
      if (dep.status === 'Processing') badgeClass = 'badge-processing';
      else if (dep.status === 'Pending') badgeClass = 'badge-warning';
      else if (dep.status === 'Failed') badgeClass = 'badge-danger';
      else if (dep.status === 'Cancelled') badgeClass = 'badge-cancelled';

      const ref = dep.providerReference || dep.paystackReference || dep.reference || dep.id;
      const credited = dep.credited === true || (dep.status === 'Successful' && dep.credited !== false);

      return `
        <tr>
          <td><code style="color: var(--accent-blue-light); font-size: 0.8rem;">${ref}</code></td>
          <td>
            <div style="font-weight: 600; color: #FFF;">${dep.userFullName || 'User'}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${dep.userEmail || '-'}</div>
          </td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-emerald);">
            ${formatNaira(dep.amount)}
          </td>
          <td style="text-transform: capitalize; font-size: 0.82rem; color: var(--text-muted);">
            ${dep.channel || 'Paystack'}
          </td>
          <td><span class="badge ${badgeClass}">${dep.status}</span></td>
          <td>
            ${credited
              ? '<span class="badge badge-success" style="font-size: 0.72rem;"><i class="fa-solid fa-check"></i> YES</span>'
              : '<span class="badge badge-warning" style="font-size: 0.72rem;">NO</span>'
            }
          </td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTime(dep.createdAt)}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" onclick="quickLookupAdminDeposit('${ref}')" title="Lookup & Live Verify">
                <i class="fa-solid fa-magnifying-glass"></i>
              </button>
              ${!credited && dep.status !== 'Cancelled' ? `
              <button class="btn btn-primary btn-sm" onclick="reconcileAdminDeposit('${ref}')" title="Reconcile & Credit Wallet">
                <i class="fa-solid fa-check-double"></i>
              </button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('loadAdminDeposits Error:', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--status-error); padding: 24px;">Error connecting to deposits server.</td></tr>`;
  }
}

window.quickLookupAdminDeposit = function(ref) {
  const input = document.getElementById('adminDepositLookupInput');
  if (input) input.value = ref;
  lookupAdminDeposit(ref);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function lookupAdminDeposit(query) {
  const resBox = document.getElementById('adminDepositLookupResult');
  if (!resBox) return;

  resBox.style.display = 'block';
  resBox.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Checking local records and live Paystack status...</div>`;

  try {
    const { ok, data } = await adminFetch(`/admin/deposits/lookup?query=${encodeURIComponent(query)}`);
    if (!ok || !data.success) {
      resBox.innerHTML = `<div style="color: var(--status-error); padding: 14px;"><i class="fa-solid fa-circle-exclamation"></i> ${data.message || 'Lookup failed'}</div>`;
      return;
    }

    const { transaction, user, livePaystack, paystackError, walletCredited, recommendation } = data;
    const refToReconcile = transaction ? (transaction.providerReference || transaction.paystackReference || transaction.id) : (livePaystack ? query : null);

    let bannerColor = 'rgba(59, 130, 246, 0.15)';
    let bannerBorder = 'rgba(59, 130, 246, 0.4)';
    let bannerText = '#60a5fa';

    if (livePaystack && livePaystack.status === 'success') {
      if (walletCredited) {
        bannerColor = 'rgba(16, 185, 129, 0.15)';
        bannerBorder = 'rgba(16, 185, 129, 0.4)';
        bannerText = 'var(--accent-emerald)';
      } else {
        bannerColor = 'rgba(245, 158, 11, 0.15)';
        bannerBorder = 'rgba(245, 158, 11, 0.4)';
        bannerText = 'var(--status-warning)';
      }
    } else if (livePaystack && livePaystack.status === 'failed') {
      bannerColor = 'rgba(239, 68, 68, 0.15)';
      bannerBorder = 'rgba(239, 68, 68, 0.4)';
      bannerText = 'var(--status-error)';
    }

    resBox.innerHTML = `
      <!-- Status Recommendation Banner -->
      <div style="background: ${bannerColor}; border: 1px solid ${bannerBorder}; color: ${bannerText}; border-radius: var(--radius-sm); padding: 14px; margin-bottom: 18px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div>
          <i class="fa-solid fa-shield-halved"></i> <span>${recommendation}</span>
        </div>
        ${(livePaystack && livePaystack.status === 'success' && !walletCredited && refToReconcile) ? `
        <button class="btn btn-primary btn-sm" onclick="reconcileAdminDeposit('${refToReconcile}')">
          <i class="fa-solid fa-check-double"></i> Reconcile & Credit Wallet (₦${livePaystack.amount})
        </button>` : ''}
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px;">
        <!-- User Information -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 14px;">
          <h4 style="font-size: 0.85rem; color: var(--accent-blue-light); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">
            <i class="fa-solid fa-user"></i> Customer Account
          </h4>
          ${user ? `
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem;">
              <div><span style="color: var(--text-muted);">Name:</span> <strong>${user.fullName || '-'}</strong></div>
              <div><span style="color: var(--text-muted);">Email:</span> <code>${user.email}</code></div>
              <div><span style="color: var(--text-muted);">Phone:</span> ${user.phone || '-'}</div>
              <div><span style="color: var(--text-muted);">Current Balance:</span> <strong style="color: var(--accent-emerald); font-family: var(--font-mono);">${formatNaira(user.walletBalance)}</strong></div>
            </div>
          ` : `<p style="color: var(--text-muted); font-size: 0.86rem;">No matching registered user linked to this search.</p>`}
        </div>

        <!-- Local STRICTWALLET Record -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 14px;">
          <h4 style="font-size: 0.85rem; color: var(--accent-emerald); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">
            <i class="fa-solid fa-database"></i> STRICTWALLET Database Record
          </h4>
          ${transaction ? `
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem;">
              <div><span style="color: var(--text-muted);">Tx ID:</span> <code>${transaction.id}</code></div>
              <div><span style="color: var(--text-muted);">Reference:</span> <code style="color: #FFF;">${transaction.providerReference || transaction.reference}</code></div>
              <div><span style="color: var(--text-muted);">Amount:</span> <strong style="color: var(--accent-emerald); font-family: var(--font-mono);">${formatNaira(transaction.amount)}</strong></div>
              <div><span style="color: var(--text-muted);">Status:</span> <span class="badge ${transaction.status === 'Successful' ? 'badge-success' : transaction.status === 'Pending' ? 'badge-warning' : 'badge-danger'}">${transaction.status}</span></div>
              <div><span style="color: var(--text-muted);">Wallet Credited:</span> <strong>${walletCredited ? '<span style="color: var(--accent-emerald);">YES</span>' : '<span style="color: var(--status-warning);">NO</span>'}</strong></div>
              <div><span style="color: var(--text-muted);">Created:</span> ${formatDateTime(transaction.createdAt)}</div>
            </div>
          ` : `<p style="color: var(--text-muted); font-size: 0.86rem;">No transaction record found in local database for this reference.</p>`}
        </div>

        <!-- Live Paystack Verification -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 14px;">
          <h4 style="font-size: 0.85rem; color: var(--status-warning); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">
            <i class="fa-solid fa-satellite-dish"></i> Live Paystack API Status
          </h4>
          ${livePaystack ? `
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem;">
              <div><span style="color: var(--text-muted);">Gateway Status:</span> <strong style="text-transform: uppercase; color: ${livePaystack.status === 'success' ? 'var(--accent-emerald)' : 'var(--status-error)'};">${livePaystack.status}</strong></div>
              <div><span style="color: var(--text-muted);">Net Amount:</span> <strong style="color: var(--accent-emerald); font-family: var(--font-mono);">${formatNaira(livePaystack.amount)}</strong></div>
              <div><span style="color: var(--text-muted);">Charged Total:</span> ${formatNaira(livePaystack.chargedAmount)} (Fee: ${formatNaira(livePaystack.fee)})</div>
              <div><span style="color: var(--text-muted);">Channel:</span> <span style="text-transform: capitalize;">${livePaystack.channel}</span> ${livePaystack.cardType ? `(${livePaystack.cardType})` : ''} ${livePaystack.bank ? `- ${livePaystack.bank}` : ''}</div>
              <div><span style="color: var(--text-muted);">Gateway Response:</span> <em>${livePaystack.gatewayResponse || 'N/A'}</em></div>
              <div><span style="color: var(--text-muted);">Paid At:</span> ${livePaystack.paidAt ? formatDateTime(livePaystack.paidAt) : 'N/A'}</div>
            </div>
          ` : `<p style="color: var(--text-muted); font-size: 0.86rem;">${paystackError || 'No live record on Paystack.'}</p>`}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('lookupAdminDeposit Error:', err);
    resBox.innerHTML = `<div style="color: var(--status-error); padding: 14px;">Error communicating with lookup service.</div>`;
  }
}

window.reconcileAdminDeposit = async function(reference) {
  if (!reference) return;
  if (!confirm(`Reconcile and credit wallet for transaction reference "${reference}"? This action is idempotent and safe.`)) {
    return;
  }

  showAdminToast('Initiating safe payment reconciliation...', 'info');

  try {
    const { ok, data } = await adminFetch('/admin/deposits/reconcile', {
      method: 'POST',
      body: JSON.stringify({ reference })
    });

    if (ok && data.success) {
      if (data.alreadyCredited) {
        showAdminToast(`Reference ${reference} has already been credited. No duplicate credit applied.`, 'warning');
      } else if (data.credited) {
        showAdminToast(`Payment successfully reconciled! Wallet credited with new balance: ${formatNaira(data.newBalance)}`, 'success');
      } else {
        showAdminToast(data.message || 'Payment reconciled.', 'info');
      }
      lookupAdminDeposit(reference);
      loadAdminDeposits();
    } else {
      showAdminToast(data?.message || 'Reconciliation failed.', 'error');
    }
  } catch (err) {
    console.error('reconcileAdminDeposit Error:', err);
    showAdminToast('Error during reconciliation: ' + err.message, 'error');
  }
};


