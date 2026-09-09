const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// Apply admin protection to all routes in this router
router.use(requireAdmin);

// 1. ADMIN OVERVIEW STATS
router.get('/stats', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const regularUsers = users.filter(u => u.role !== 'admin');
    const transactions = await db.getAllTransactions();
    const tickets = await db.getAllSupportTickets();

    let totalDeposits = 0;
    let totalAirtimeSales = 0;
    let totalDataSales = 0;
    let totalProfit = 0;
    let pendingTxCount = 0;
    let failedTxCount = 0;

    transactions.forEach(tx => {
      const amt = parseFloat(tx.amount || 0);
      const prf = parseFloat(tx.profit || 0);

      if (tx.status === 'Successful') {
        if (tx.type === 'deposit') {
          totalDeposits += amt;
        } else if (tx.type === 'airtime') {
          totalAirtimeSales += amt;
          totalProfit += prf;
        } else if (tx.type === 'data') {
          totalDataSales += amt;
          totalProfit += prf;
        }
      } else if (tx.status === 'Pending') {
        pendingTxCount++;
      } else if (tx.status === 'Failed') {
        failedTxCount++;
      }
    });

    const totalRevenue = totalAirtimeSales + totalDataSales;

    // Daily breakdown for chart (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const dayTxs = transactions.filter(t => t.createdAt && t.createdAt.startsWith(dateStr) && t.status === 'Successful');
      const sales = dayTxs.filter(t => t.type === 'airtime' || t.type === 'data').reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0);
      const profit = dayTxs.reduce((acc, t) => acc + (parseFloat(t.profit) || 0), 0);
      const deposits = dayTxs.filter(t => t.type === 'deposit').reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0);

      last7Days.push({
        date: dateStr,
        sales,
        profit,
        deposits
      });
    }

    return res.json({
      success: true,
      stats: {
        totalUsers: regularUsers.length,
        totalTransactions: transactions.length,
        totalDeposits,
        totalAirtimeSales,
        totalDataSales,
        totalRevenue,
        totalProfit,
        pendingTransactions: pendingTxCount,
        failedTransactions: failedTxCount,
        openTickets: tickets.filter(t => t.status === 'Open' || t.status === 'Pending').length
      },
      chartData: last7Days
    });
  } catch (error) {
    console.error('[Admin Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
});

// 2. USER MANAGEMENT
router.get('/users', async (req, res) => {
  try {
    const { search, status } = req.query;
    let users = await db.getAllUsers();
    users = users.filter(u => u.role !== 'admin');

    if (status && status !== 'all') {
      users = users.filter(u => u.status === status);
    }

    if (search) {
      const q = search.toLowerCase();
      users = users.filter(u =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.includes(q))
      );
    }

    const safeUsers = users.map(u => {
      const { passwordHash, nextOfKinAnswer, transactionPinHash, ...safe } = u;
      return safe;
    });

    return res.json({ success: true, users: safeUsers });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// 3. GET SINGLE USER DETAILS & TRANSACTIONS
router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const userTransactions = await db.getUserTransactions(user.id);
    const { passwordHash, nextOfKinAnswer, transactionPinHash, ...safeUser } = user;

    return res.json({
      success: true,
      user: safeUser,
      transactions: userTransactions
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load user profile' });
  }
});

// 4. SUSPEND / ACTIVATE USER ACCOUNT
router.post('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const oldStatus = user.status;
    user.status = status;
    await db.saveUser(user);

    // Audit log
    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: `USER_STATUS_${status.toUpperCase()}`,
      description: `Changed status of user ${user.fullName} (${user.email}) from ${oldStatus} to ${status}`
    });

    return res.json({
      success: true,
      message: `User account status updated to ${status}.`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
});

// 5. MANUAL BALANCE ADJUSTMENT (CREDIT / DEBIT)
router.post('/users/:id/adjust-balance', async (req, res) => {
  try {
    const { type, amount, reason } = req.body;
    const adjustAmt = parseFloat(amount);

    if (!['credit', 'debit'].includes(type) || isNaN(adjustAmt) || adjustAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid adjustment type or amount' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A valid reason is required for administrative balance adjustments' });
    }

    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const currentBal = parseFloat(user.walletBalance || 0);

    if (type === 'debit' && currentBal < adjustAmt) {
      return res.status(400).json({ success: false, message: 'Cannot debit more than the user’s available wallet balance' });
    }

    const newBal = type === 'credit' ? currentBal + adjustAmt : currentBal - adjustAmt;
    user.walletBalance = Math.round(newBal * 100) / 100;
    await db.saveUser(user);

    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      return res.status(400).json({ success: false, message: 'A specific reason is required for balance adjustments.' });
    }

    // Create Transaction Record
    const tx = {
      id: `TXN-ADJ-${Date.now()}`,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      type: type === 'credit' ? 'deposit' : 'debit',
      amount: adjustAmt,
      costPrice: 0,
      sellingPrice: adjustAmt,
      profit: 0,
      providerReference: `ADMIN-ADJ-${Date.now()}`,
      status: 'Successful',
      reason: cleanReason,
      debitReason: type === 'debit' ? cleanReason : undefined,
      description: type === 'debit' ? `Debit — ${cleanReason}` : `Credit — ${cleanReason}`,
      createdAt: new Date().toISOString()
    };
    await db.createTransaction(tx);

    // Audit log
    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: `WALLET_ADJUSTMENT_${type.toUpperCase()}`,
      description: `Admin adjusted balance for ${user.fullName} (${user.email}): ${type === 'credit' ? '+' : '-'}₦${adjustAmt}. Reason: ${reason}`
    });

    return res.json({
      success: true,
      message: `Successfully ${type === 'credit' ? 'credited' : 'debited'} ₦${adjustAmt.toLocaleString()} for ${user.fullName}`,
      newBalance: user.walletBalance
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to adjust balance' });
  }
});

// 6. TRANSACTION MANAGEMENT
router.get('/transactions', async (req, res) => {
  try {
    const { type, status, search } = req.query;
    let list = await db.getAllTransactions();

    if (type && type !== 'all') {
      list = list.filter(t => t.type && t.type.toLowerCase() === type.toLowerCase());
    }

    if (status && status !== 'all') {
      list = list.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.userFullName && t.userFullName.toLowerCase().includes(q)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(q)) ||
        (t.phoneNumber && t.phoneNumber.includes(q)) ||
        (t.providerReference && t.providerReference.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    return res.json({ success: true, transactions: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// 7. PRICING MANAGEMENT - GET ALL DATA PLANS
// 7. PRICING & PLAN MANAGEMENT - GET ALL DATA PLANS (With Filtering & Search)
router.get('/pricing', async (req, res) => {
  try {
    const { network, planType, status, search } = req.query;
    let plans = await db.getAllDataPlans();

    if (network && network !== 'all') {
      plans = plans.filter(p => p.network && p.network.toUpperCase() === network.toUpperCase());
    }

    if (planType && planType !== 'all') {
      plans = plans.filter(p => p.planType && p.planType.toUpperCase() === planType.toUpperCase());
    }

    if (status && status !== 'all') {
      plans = plans.filter(p => p.status && p.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase().trim();
      plans = plans.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.providerPlanId && p.providerPlanId.toString().toLowerCase().includes(q)) ||
        (p.id && p.id.toLowerCase().includes(q)) ||
        (p.network && p.network.toLowerCase().includes(q)) ||
        (p.planType && p.planType.toLowerCase().includes(q)) ||
        (p.size && p.size.toLowerCase().includes(q)) ||
        (p.validity && p.validity.toLowerCase().includes(q))
      );
    }

    // Sort by network, plan type, then costPrice
    plans.sort((a, b) => {
      if (a.network !== b.network) return a.network.localeCompare(b.network);
      if (a.planType !== b.planType) return (a.planType || '').localeCompare(b.planType || '');
      return (parseFloat(a.costPrice) || 0) - (parseFloat(b.costPrice) || 0);
    });

    return res.json({ success: true, plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load pricing plans' });
  }
});

// 8. ADD NEW DATA PLAN
router.post('/pricing', async (req, res) => {
  try {
    const { network, planType, size, name, validity, providerPlanId, costPrice, sellingPrice, status } = req.body;

    if (!network || !providerPlanId || costPrice === undefined || sellingPrice === undefined) {
      return res.status(400).json({ success: false, message: 'Network, Plan ID, Provider Price, and Selling Price are required.' });
    }

    const networkMap = { 'MTN': 1, 'GLO': 2, '9MOBILE': 3, 'AIRTEL': 4 };
    const netUpper = network.toUpperCase().trim();
    const netId = networkMap[netUpper] || 1;
    const typeUpper = (planType || 'SME').toUpperCase().trim();
    const numCost = parseFloat(costPrice) || 0;
    const numSelling = parseFloat(sellingPrice) || 0;
    const profit = Math.round((numSelling - numCost) * 100) / 100;
    const planSize = (size || '1.0 GB').trim();
    const planName = name ? name.trim() : `${planSize} ${typeUpper}`;
    const planValidity = (validity || '30 Days').trim();
    const planStatus = status === 'inactive' ? 'inactive' : 'active';
    const cleanProviderId = providerPlanId.toString().trim();

    const planKey = `${netUpper.toLowerCase()}_${typeUpper.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${cleanProviderId}`.replace(/__+/g, '_');

    // Check if ID already exists
    const existing = await db.getDataPlanById(planKey);
    if (existing) {
      return res.status(400).json({ success: false, message: `A plan with key ${planKey} already exists. Please use a unique Plan ID.` });
    }

    const newPlan = {
      id: planKey,
      providerPlanId: cleanProviderId,
      network: netUpper,
      networkId: netId,
      planType: typeUpper,
      size: planSize,
      name: planName,
      validity: planValidity,
      costPrice: numCost,
      sellingPrice: numSelling,
      profit: profit,
      status: planStatus
    };

    await db.addDataPlan(newPlan);

    // Audit log
    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'PLAN_CREATED',
      description: `Created new plan ${netUpper} ${planName} (ID: ${cleanProviderId}): Provider ₦${numCost}, Selling ₦${numSelling}, Profit ₦${profit}`
    });

    return res.status(201).json({
      success: true,
      message: 'New data plan created successfully!',
      plan: newPlan
    });
  } catch (error) {
    console.error('[Admin Add Plan Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to create data plan' });
  }
});

// 9. UPDATE DATA PLAN (Full Field Edit)
router.post('/pricing/:id', async (req, res) => {
  try {
    const { name, providerPlanId, network, planType, size, validity, costPrice, sellingPrice, status } = req.body;
    const plan = await db.getDataPlanById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (providerPlanId !== undefined) updates.providerPlanId = providerPlanId.toString().trim();
    if (network !== undefined) {
      updates.network = network.toUpperCase().trim();
      const networkMap = { 'MTN': 1, 'GLO': 2, '9MOBILE': 3, 'AIRTEL': 4 };
      updates.networkId = networkMap[updates.network] || plan.networkId;
    }
    if (planType !== undefined) updates.planType = planType.toUpperCase().trim();
    if (size !== undefined) updates.size = size.trim();
    if (validity !== undefined) updates.validity = validity.trim();
    if (status !== undefined) updates.status = status;

    const newCost = costPrice !== undefined ? parseFloat(costPrice) : plan.costPrice;
    const newSelling = sellingPrice !== undefined ? parseFloat(sellingPrice) : plan.sellingPrice;
    updates.costPrice = newCost;
    updates.sellingPrice = newSelling;
    updates.profit = Math.round((newSelling - newCost) * 100) / 100;

    const updated = await db.updateDataPlan(plan.id, updates);

    // Audit log
    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'PLAN_UPDATE',
      description: `Updated plan ${plan.network} ${plan.name} (ID: ${updates.providerPlanId || plan.providerPlanId}): Provider ₦${newCost}, Selling ₦${newSelling}, Profit ₦${updates.profit}, Status: ${updates.status || plan.status}`
    });

    return res.json({
      success: true,
      message: 'Plan updated successfully!',
      plan: updated
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update data plan' });
  }
});

// 10. TOGGLE PLAN ACTIVE / SUSPENDED STATUS
router.post('/pricing/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be "active" or "inactive".' });
    }

    const plan = await db.getDataPlanById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const updated = await db.updateDataPlan(plan.id, { status });

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: status === 'active' ? 'PLAN_ACTIVATED' : 'PLAN_SUSPENDED',
      description: `${status === 'active' ? 'Reactivated' : 'Suspended'} plan ${plan.network} ${plan.name} (Plan ID: ${plan.providerPlanId})`
    });

    return res.json({
      success: true,
      message: `Plan ${status === 'active' ? 'activated' : 'suspended'} successfully!`,
      plan: updated
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle plan status' });
  }
});

// 11. RESET PLAN SETTINGS TO DEFAULT
router.post('/pricing/:id/reset', async (req, res) => {
  try {
    const plan = await db.getDataPlanById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const resetPlan = await db.resetDataPlan(plan.id);
    if (!resetPlan) {
      return res.status(400).json({ success: false, message: 'No default configuration found to reset this plan.' });
    }

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'PLAN_RESET',
      description: `Reset plan ${plan.network} ${plan.name} to original default settings`
    });

    return res.json({
      success: true,
      message: 'Plan reset to default configuration successfully!',
      plan: resetPlan
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to reset plan' });
  }
});

// 12. DELETE DATA PLAN
router.delete('/pricing/:id', async (req, res) => {
  try {
    const plan = await db.getDataPlanById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const deleted = await db.deleteDataPlan(plan.id);

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'PLAN_DELETED',
      description: `Deleted plan ${plan.network} ${plan.name} (Plan ID: ${plan.providerPlanId})`
    });

    return res.json({
      success: true,
      message: `Plan ${plan.name} removed successfully!`,
      deleted
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete data plan' });
  }
});

// 9. CUSTOMER CARE TICKETS MANAGEMENT
router.get('/support/tickets', async (req, res) => {
  try {
    const { status, search } = req.query;
    let tickets = await db.getAllSupportTickets();

    if (status && status !== 'all') {
      tickets = tickets.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      tickets = tickets.filter(t =>
        (t.ticketNumber && t.ticketNumber.toLowerCase().includes(q)) ||
        (t.userName && t.userName.toLowerCase().includes(q)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(q)) ||
        (t.subject && t.subject.toLowerCase().includes(q))
      );
    }

    return res.json({ success: true, tickets });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch support tickets' });
  }
});

// 10. UPDATE TICKET STATUS (Resolved / Closed)
router.post('/support/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Open', 'Pending', 'Resolved', 'Closed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket status' });
    }

    const ticket = await db.getSupportTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    await db.updateSupportTicket(ticket.id, { status });

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: `TICKET_${status.toUpperCase()}`,
      description: `Support Ticket #${ticket.ticketNumber} marked as ${status}`
    });

    return res.json({
      success: true,
      message: `Ticket #${ticket.ticketNumber} status updated to ${status}.`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update ticket status' });
  }
});

// 11. AUDIT LOGS
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await db.getAllAuditLogs();
    return res.json({ success: true, logs });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load audit logs' });
  }
});
// 12. SOCIAL MEDIA CHANNELS MANAGEMENT
router.get('/social-links', async (req, res) => {
  try {
    const links = await db.getAllSocialLinks();
    return res.json({ success: true, links });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load social links' });
  }
});

router.post('/social-links', async (req, res) => {
  try {
    const { id, platform, name, url, actionText, enabled, order } = req.body;
    if (!platform || !url) {
      return res.status(400).json({ success: false, message: 'Platform name and URL are required.' });
    }

    const cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      return res.status(400).json({ success: false, message: 'Please enter a valid link starting with https:// or http://' });
    }

    const platformIcons = {
      'WhatsApp': 'fa-brands fa-whatsapp',
      'Telegram': 'fa-brands fa-telegram',
      'X/Twitter': 'fa-brands fa-x-twitter',
      'Instagram': 'fa-brands fa-instagram',
      'Facebook': 'fa-brands fa-facebook',
      'YouTube': 'fa-brands fa-youtube',
      'TikTok': 'fa-brands fa-tiktok',
      'LinkedIn': 'fa-brands fa-linkedin',
      'Discord': 'fa-brands fa-discord'
    };

    const linkData = {
      id: id || undefined,
      platform: platform.trim(),
      name: (name || platform).trim(),
      url: cleanUrl,
      actionText: (actionText || 'Follow Us').trim(),
      enabled: enabled === true || enabled === 'true',
      icon: platformIcons[platform.trim()] || 'fa-solid fa-globe',
      order: parseInt(order, 10) || 50
    };

    const saved = await db.saveSocialLink(linkData);

    await db.addAuditLog({
        id: `LOG-${Date.now()}`,
        adminId: req.user?.id || null,
        adminEmail: req.user?.email || null,
        action: id ? 'SOCIAL_LINK_UPDATED' : 'SOCIAL_LINK_CREATED',
        description: `${id ? 'Updated' : 'Added'} social media channel ${saved.platform}: ${saved.name} (${saved.url})`
      });

    return res.json({ success: true, message: 'Social media channel saved successfully!', link: saved });
  } catch (error) {
    console.error('Error saving social link:', error);
    return res.status(500).json({ success: false, message: 'Failed to save social link', error: error.message });
  }
});

router.post('/social-links/:id/toggle', async (req, res) => {
  try {
    const link = await db.getSocialLinkById(req.params.id);
    if (!link) return res.status(404).json({ success: false, message: 'Social link not found' });

    link.enabled = !link.enabled;
    const saved = await db.saveSocialLink(link);

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'SOCIAL_LINK_TOGGLED',
      description: `${saved.enabled ? 'Enabled' : 'Disabled'} social channel ${saved.platform}`
    });

    return res.json({
      success: true,
      message: `${saved.platform} channel ${saved.enabled ? 'enabled' : 'disabled'} successfully!`,
      link: saved
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle social link' });
  }
});

router.delete('/social-links/:id', async (req, res) => {
  try {
    const link = await db.getSocialLinkById(req.params.id);
    if (!link) {
      return res
        .status(404)
        .json({ success: false, message: 'Social link not found' });
    }

    const deleted = await db.deleteSocialLink(req.params.id);

    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'SOCIAL_LINK_DELETED',
      description: `Deleted social media channel ${link.platform} (${link.name})`,
    });

    return res.json({
      success: true,
      message: `${link.platform} channel deleted successfully!`,
      deleted,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: 'Failed to delete social link' });
  }
});


module.exports = router;
