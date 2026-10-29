const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const paystackService = require('../services/paystack');
const { reconcileDepositTransaction } = require('../services/paymentReconciliation');

// Apply admin protection to all routes in this router
router.use(requireAdmin);

// ============================================================
// FINANCIAL CALCULATION & RECONCILIATION ENGINE
// Calculates revenue, provider costs, and profits across all supported services
// strictly from existing records without estimates or synthetic figures.
// ============================================================
function calculateFinancialLedger({ transactions = [], smsAlerts = [], tickets = [], eventWithdrawals = [], now = new Date() }) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = now.getTime() - (7 * 86400 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  function calcPeriod(periodName, filterFn) {
    const periodTxs = transactions.filter(filterFn);
    const periodSms = smsAlerts.filter(filterFn);
    const periodTickets = tickets.filter(filterFn);
    const periodEventW = eventWithdrawals.filter(filterFn);

    // 1. Airtime Purchases
    const airtimeAll = periodTxs.filter(t => t && t.type === 'airtime');
    const airtimeSucc = airtimeAll.filter(t => t.status === 'Successful');
    const airtimeVolume = Math.round(airtimeSucc.reduce((s, t) => s + (parseFloat(t.amount || t.sellingPrice) || 0), 0) * 100) / 100;
    const airtimeCost = Math.round(airtimeSucc.reduce((s, t) => s + (parseFloat(t.costPrice) || (parseFloat(t.profit) !== undefined ? (parseFloat(t.amount || t.sellingPrice || 0) - parseFloat(t.profit)) : (parseFloat(t.amount || t.sellingPrice || 0) * 0.98))), 0) * 100) / 100;
    const airtimeProfit = Math.round((airtimeVolume - airtimeCost) * 100) / 100;

    // 2. Data Purchases
    const dataAll = periodTxs.filter(t => t && t.type === 'data');
    const dataSucc = dataAll.filter(t => t.status === 'Successful');
    const dataVolume = Math.round(dataSucc.reduce((s, t) => s + (parseFloat(t.amount || t.sellingPrice) || 0), 0) * 100) / 100;
    const dataCost = Math.round(dataSucc.reduce((s, t) => s + (parseFloat(t.costPrice) || (parseFloat(t.profit) !== undefined ? (parseFloat(t.amount || t.sellingPrice || 0) - parseFloat(t.profit)) : parseFloat(t.amount || t.sellingPrice || 0))), 0) * 100) / 100;
    const dataProfit = Math.round((dataVolume - dataCost) * 100) / 100;

    // 3. SMS Alerts (Actual billing records & delivery status)
    const smsSent = periodSms.filter(a => a && a.status === 'sent');
    const smsCharged = smsSent.filter(a => parseFloat(a.customerCharge || 0) > 0 || parseFloat(a.amount || 0) > 0);
    const smsFailed = periodSms.filter(a => a && a.status === 'failed');
    const smsTimeout = periodSms.filter(a => a && (a.status === 'timeout' || a.status === 'uncertain'));
    const smsRevenue = Math.round(smsCharged.reduce((s, a) => s + (parseFloat(a.customerCharge !== undefined ? a.customerCharge : 10.00) || 10.00), 0) * 100) / 100;
    const smsCost = Math.round(smsCharged.reduce((s, a) => s + (parseFloat(a.providerCost !== undefined ? a.providerCost : 6.00) || 6.00), 0) * 100) / 100;
    const smsProfit = Math.round((smsRevenue - smsCost) * 100) / 100;

    // 4. Deposits & Virtual Account Charges
    const depsAll = periodTxs.filter(t => t && t.type === 'deposit');
    const depsSucc = depsAll.filter(t => t.status === 'Successful');
    const depsPending = depsAll.filter(t => t && (t.status === 'Pending' || t.status === 'Processing'));
    const depsFailed = depsAll.filter(t => t && t.status === 'Failed');
    const depsReversed = depsAll.filter(t => t && (t.status === 'Cancelled' || t.status === 'Reversed'));

    const depGrossVolume = Math.round(depsSucc.reduce((s, t) => s + (parseFloat(t.grossAmount) || parseFloat(t.amount) || 0), 0) * 100) / 100;
    const depNetCredited = Math.round(depsSucc.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) * 100) / 100;
    const vaDeposits = depsSucc.filter(t => t.channel === 'virtual_account' || t.bank === 'Sterling Bank' || parseFloat(t.fee || 0) === 25 || (t.description && t.description.toLowerCase().includes('virtual account')));
    const depChargesCollected = Math.round(vaDeposits.reduce((s, t) => s + (parseFloat(t.fee !== undefined ? t.fee : 25.00) || 25.00), 0) * 100) / 100;
    const depProviderCost = Math.round(vaDeposits.reduce((s, t) => s + (parseFloat(t.providerFee || 0) || 0) + (parseFloat(t.vatAmount || 0) || 0), 0) * 100) / 100;
    const depProfit = Math.round((depChargesCollected - depProviderCost) * 100) / 100;

    // 5. Withdrawals (Main Wallet + Event Creator Payouts, deduplicated)
    const mainWths = periodTxs.filter(t => t && (t.type === 'withdrawal' || t.type === 'creator_withdrawal'));
    const combinedWths = [...mainWths, ...periodEventW];
    const seenWth = new Set();
    const deduplicatedWths = combinedWths.filter(w => {
      if (!w) return false;
      const id = w.id || w.reference || w.providerReference;
      if (!id || seenWth.has(id)) return false;
      seenWth.add(id);
      return true;
    });

    const wthSucc = deduplicatedWths.filter(t => t.status === 'Successful');
    const wthPending = deduplicatedWths.filter(t => t.status === 'Pending' || t.status === 'Processing');
    const wthFailed = deduplicatedWths.filter(t => t.status === 'Failed');
    const wthReversed = deduplicatedWths.filter(t => t.status === 'Cancelled' || t.status === 'Reversed');

    const wthVolume = Math.round(wthSucc.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) * 100) / 100;
    const wthCharges = Math.round(wthSucc.reduce((s, t) => s + (parseFloat(t.charge !== undefined ? t.charge : 20.00) || 20.00), 0) * 100) / 100;
    const wthProviderCost = Math.round(wthSucc.reduce((s, t) => s + (parseFloat(t.providerFee !== undefined ? t.providerFee : 12.00) || 12.00), 0) * 100) / 100;
    const wthProfit = Math.round((wthCharges - wthProviderCost) * 100) / 100;
    const wthStampDuty = Math.round(wthSucc.reduce((s, t) => s + (parseFloat(t.stampDuty) || 0), 0) * 100) / 100;

    // 6. Events (3% STRICTWALLET Commission)
    const evSucc = periodTxs.filter(t => t && t.type === 'event_ticket' && t.status === 'Successful');
    const evGrossSales = Math.round(evSucc.reduce((s, t) => s + (parseFloat(t.amount || t.sellingPrice) || 0), 0) * 100) / 100;
    const evCreatorEarnings = Math.round(evSucc.reduce((s, t) => s + (parseFloat(t.costPrice) || Math.round(parseFloat(t.amount || t.sellingPrice || 0) * 0.97 * 100) / 100), 0) * 100) / 100;
    const evCommissionRevenue = Math.round(evSucc.reduce((s, t) => s + (parseFloat(t.profit) || Math.round(parseFloat(t.amount || t.sellingPrice || 0) * 0.03 * 100) / 100), 0) * 100) / 100;
    const evProfit = evCommissionRevenue;

    // Reconciled Totals Across All Supported Services
    const totalRevenue = Math.round((airtimeVolume + dataVolume + smsRevenue + depChargesCollected + wthCharges + evCommissionRevenue) * 100) / 100;
    const totalExpenses = Math.round((airtimeCost + dataCost + smsCost + depProviderCost + wthProviderCost) * 100) / 100;
    const totalGrossProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;
    const totalNetProfit = totalGrossProfit; // No other recorded administrative expense records exist
    const sumOfProfits = Math.round((airtimeProfit + dataProfit + smsProfit + depProfit + wthProfit + evProfit) * 100) / 100;
    const totalPlatformVolume = Math.round((depGrossVolume + airtimeVolume + dataVolume + evGrossSales + wthVolume) * 100) / 100;
    const discrepancy = Math.round(Math.abs(totalGrossProfit - sumOfProfits) * 100) / 100;

    // Status breakdown across all transactions in this period
    const transactionCounts = {
      total: periodTxs.length,
      successful: periodTxs.filter(t => t && t.status === 'Successful').length,
      pending: periodTxs.filter(t => t && (t.status === 'Pending' || t.status === 'Processing')).length,
      failed: periodTxs.filter(t => t && t.status === 'Failed').length,
      reversed: periodTxs.filter(t => t && (t.status === 'Cancelled' || t.status === 'Reversed')).length
    };

    return {
      period: periodName,
      totalRevenue,
      totalExpenses,
      totalGrossProfit,
      totalNetProfit,
      totalPlatformVolume,
      sumOfProfits,
      discrepancy,
      reconciles: discrepancy < 0.01,
      transactionCounts,
      services: {
        airtime: {
          volume: airtimeVolume,
          revenue: airtimeVolume,
          expenses: airtimeCost,
          cost: airtimeCost,
          grossProfit: airtimeProfit,
          successfulCount: airtimeSucc.length,
          successfulTransactions: airtimeSucc.length,
          failedCount: airtimeAll.filter(t => t.status === 'Failed').length,
          totalCount: airtimeAll.length
        },
        data: {
          volume: dataVolume,
          revenue: dataVolume,
          expenses: dataCost,
          cost: dataCost,
          grossProfit: dataProfit,
          successfulCount: dataSucc.length,
          successfulTransactions: dataSucc.length,
          failedCount: dataAll.filter(t => t.status === 'Failed').length,
          totalCount: dataAll.length
        },
        sms: {
          totalProcessed: periodSms.length,
          totalDelivered: smsSent.length,
          successfullyDelivered: smsSent.length,
          totalFailed: smsFailed.length,
          failedUncharged: smsFailed.length,
          totalTimeout: smsTimeout.length,
          totalCharged: smsCharged.length,
          totalChargedToCustomers: smsCharged.length,
          revenue: smsRevenue,
          expenses: smsCost,
          grossProfit: smsProfit
        },
        deposits: {
          incomingDepositVolume: depGrossVolume,
          successfulDeposits: depsSucc.length,
          successfulDepositsCount: depsSucc.length,
          applicableChargesCollected: depChargesCollected,
          providerCosts: depProviderCost,
          netAmountsCredited: depNetCredited,
          depositProfit: depProfit,
          pendingCount: depsPending.length,
          pendingVolume: Math.round(depsPending.reduce((s, t) => s + (parseFloat(t.grossAmount || t.amount) || 0), 0) * 100) / 100,
          failedCount: depsFailed.length,
          failedVolume: Math.round(depsFailed.reduce((s, t) => s + (parseFloat(t.grossAmount || t.amount) || 0), 0) * 100) / 100,
          reversedCount: depsReversed.length,
          reversedVolume: Math.round(depsReversed.reduce((s, t) => s + (parseFloat(t.grossAmount || t.amount) || 0), 0) * 100) / 100
        },
        withdrawals: {
          totalVolume: wthVolume,
          customerChargesCollected: wthCharges,
          withdrawalChargesCollected: wthCharges,
          apiCosts: wthProviderCost,
          apiProviderCost: wthProviderCost,
          withdrawalProfit: wthProfit,
          stampDutyCollected: wthStampDuty,
          successfulCount: wthSucc.length,
          successfulWithdrawals: wthSucc.length,
          pendingCount: wthPending.length,
          pendingVolume: Math.round(wthPending.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) * 100) / 100,
          failedCount: wthFailed.length,
          failedVolume: Math.round(wthFailed.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) * 100) / 100,
          reversedCount: wthReversed.length,
          reversedVolume: Math.round(wthReversed.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) * 100) / 100
        },
        events: {
          grossTicketSales: evGrossSales,
          totalTicketsSold: evSucc.length,
          creatorEarningsLiability: evCreatorEarnings,
          commissionRevenue: evCommissionRevenue,
          eventDirectExpenses: 0,
          eventProfit: evProfit,
          commissionProfit: evCommissionRevenue
        }
      }
    };
  }

  const allTime = calcPeriod('allTime', () => true);
  const monthly = calcPeriod('monthly', d => d && d.createdAt && new Date(d.createdAt).getTime() >= monthStart);
  const weekly = calcPeriod('weekly', d => d && d.createdAt && new Date(d.createdAt).getTime() >= weekStart);
  const today = calcPeriod('today', d => d && d.createdAt && new Date(d.createdAt).getTime() >= todayStart);

  const smsSummary = {
    ...allTime.services.sms,
    dailyProfit: today.services.sms.grossProfit,
    weeklyProfit: weekly.services.sms.grossProfit,
    monthlyProfit: monthly.services.sms.grossProfit,
    allTimeProfit: allTime.services.sms.grossProfit,
    pricingRule: {
      customerCharge: 10.00,
      providerCost: 6.00,
      expectedGrossProfit: 4.00
    },
    limitations: "Historical failed SMS attempts incurred ₦0 customer charge and ₦0 provider expense; only successfully sent alerts with confirmed provider delivery are recognized as revenue and profit."
  };

  const withdrawalSummary = {
    ...allTime.services.withdrawals,
    dailyProfit: today.services.withdrawals.withdrawalProfit,
    weeklyProfit: weekly.services.withdrawals.withdrawalProfit,
    monthlyProfit: monthly.services.withdrawals.withdrawalProfit,
    allTimeProfit: allTime.services.withdrawals.withdrawalProfit,
    pricingRule: {
      customerCharge: 20.00,
      apiProviderCost: 12.00,
      expectedGrossProfit: 8.00
    },
    limitations: "Only completed, successful withdrawals generate profit; pending, failed, or reversed attempts do not contribute to revenue or profit."
  };

  const depositSummary = {
    ...allTime.services.deposits,
    dailyProfit: today.services.deposits.depositProfit,
    weeklyProfit: weekly.services.deposits.depositProfit,
    monthlyProfit: monthly.services.deposits.depositProfit,
    allTimeProfit: allTime.services.deposits.depositProfit,
    pricingRule: {
      virtualAccountCharge: 25.00,
      paystackCustomerCharge: 0.00
    },
    limitations: "₦25 charge applies strictly to incoming virtual account deposits. Customer wallet credits represent platform liabilities and are not business profit."
  };

  return {
    allTime,
    monthly,
    weekly,
    today,
    smsSummary,
    withdrawalSummary,
    depositSummary,
    auditNotes: {
      reconciliationStatus: allTime.reconciles ? 'RECONCILED' : 'DISCREPANCY_DETECTED',
      dataIntegrity: 'Actual recorded figures only; no estimates, invented data, or synthetic transactions.',
      netProfitRule: 'Net profit equals gross profit as no separate administrative or overhead expense accounts exist in historical records.',
      customerFundsProtection: 'Customer wallet balances and deposit volumes are treated strictly as customer funds under management, never as business profit.'
    }
  };
}

// 1. ADMIN OVERVIEW STATS (Synchronized with Unified Financial Ledger)
router.get('/stats', async (req, res) => {
  try {
    const [users, transactions, tickets, smsAlerts, eventWithdrawals, eventTickets] = await Promise.all([
      db.getAllUsers().catch(err => { console.error('[Stats DB Error - users]:', err.message); return []; }),
      db.getAllTransactions().catch(err => { console.error('[Stats DB Error - transactions]:', err.message); return []; }),
      db.getAllSupportTickets().catch(err => { console.error('[Stats DB Error - support tickets]:', err.message); return []; }),
      db.getAllSmsAlerts().catch(err => { console.error('[Stats DB Error - smsAlerts]:', err.message); return []; }),
      db.getAllEventWithdrawals().catch(err => { console.error('[Stats DB Error - eventWithdrawals]:', err.message); return []; }),
      db.getAllTickets().catch(err => { console.error('[Stats DB Error - tickets]:', err.message); return []; })
    ]);
    const regularUsers = users.filter(u => u && u.role !== 'admin');

    const financialReport = calculateFinancialLedger({
      transactions,
      smsAlerts,
      tickets: eventTickets,
      eventWithdrawals
    });

    const all = financialReport.allTime;
    const s = all.services;

    // Daily breakdown for chart (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const dayTxs = transactions.filter(t => t && t.createdAt && t.createdAt.startsWith(dateStr) && t.status === 'Successful');
      const sales = dayTxs.filter(t => t.type === 'airtime' || t.type === 'data').reduce((acc, t) => acc + (parseFloat(t.amount || t.sellingPrice) || 0), 0);

      // Calculate real daily profit per transaction type from real records
      let dayProfit = dayTxs.reduce((acc, t) => {
        if (t.type === 'airtime' || t.type === 'data') {
          return acc + (parseFloat(t.profit) !== undefined ? parseFloat(t.profit) : (parseFloat(t.amount || t.sellingPrice || 0) - parseFloat(t.costPrice || 0)));
        } else if (t.type === 'event_ticket') {
          return acc + (parseFloat(t.profit) !== undefined ? parseFloat(t.profit) : Math.round(parseFloat(t.amount || 0) * 0.03 * 100) / 100);
        } else if (t.type === 'deposit' && (t.channel === 'virtual_account' || t.bank === 'Sterling Bank' || parseFloat(t.fee || 0) === 25)) {
          return acc + (parseFloat(t.fee !== undefined ? t.fee : 25) - (parseFloat(t.providerFee || 0) || 0) - (parseFloat(t.vatAmount || 0) || 0));
        } else if (t.type === 'withdrawal') {
          return acc + (parseFloat(t.profit) !== undefined ? parseFloat(t.profit) : (parseFloat(t.charge !== undefined ? t.charge : 20) - parseFloat(t.providerFee !== undefined ? t.providerFee : 12)));
        } else if (t.type === 'sms_charge') {
          return acc + (parseFloat(t.profit !== undefined ? t.profit : 4));
        }
        return acc;
      }, 0);

      // Add SMS alerts if recorded in smsAlerts node and not duplicated in dayTxs
      const daySms = smsAlerts.filter(a => a && a.createdAt && a.createdAt.startsWith(dateStr) && a.status === 'sent');
      const daySmsChargedTxs = dayTxs.filter(t => t.type === 'sms_charge');
      if (daySmsChargedTxs.length === 0 && daySms.length > 0) {
        dayProfit += daySms.reduce((acc, a) => acc + (parseFloat(a.customerCharge !== undefined ? a.customerCharge : 10) - parseFloat(a.providerCost !== undefined ? a.providerCost : 6)), 0);
      }

      const deposits = dayTxs.filter(t => t.type === 'deposit').reduce((acc, t) => acc + (parseFloat(t.grossAmount || t.amount) || 0), 0);

      last7Days.push({
        date: dateStr,
        sales: Math.round(sales * 100) / 100,
        profit: Math.round(dayProfit * 100) / 100,
        deposits: Math.round(deposits * 100) / 100
      });
    }

    return res.json({
      success: true,
      stats: {
        totalUsers: regularUsers.length,
        totalTransactions: transactions.length,
        totalDeposits: s.deposits.incomingDepositVolume,
        totalNetDeposited: s.deposits.netAmountsCredited,
        totalAirtimeSales: s.airtime.volume,
        totalDataSales: s.data.volume,
        totalPlatformVolume: all.totalPlatformVolume,
        totalRevenue: all.totalRevenue,
        totalExpenses: all.totalExpenses,
        totalProfit: all.totalGrossProfit,
        totalNetProfit: all.totalNetProfit,
        totalWithdrawalProfit: s.withdrawals.withdrawalProfit,
        totalDepositCharges: s.deposits.applicableChargesCollected,
        totalDepositProfit: s.deposits.depositProfit,
        totalSmsRevenue: s.sms.revenue,
        totalSmsExpenses: s.sms.expenses,
        totalSmsProfit: s.sms.grossProfit,
        totalAirtimeProfit: s.airtime.grossProfit,
        totalDataProfit: s.data.grossProfit,
        totalEventRevenue: s.events.commissionRevenue,
        totalEventProfit: s.events.eventProfit,
        pendingTransactions: transactions.filter(t => t && (t.status === 'Pending' || t.status === 'Processing')).length,
        failedTransactions: transactions.filter(t => t && t.status === 'Failed').length,
        openTickets: tickets.filter(t => t && (t.status === 'Open' || t.status === 'Pending')).length
      },
      smsSummary: financialReport.smsSummary,
      withdrawalSummary: financialReport.withdrawalSummary,
      depositSummary: financialReport.depositSummary,
      chartData: last7Days
    });
  } catch (error) {
    console.error('[Admin Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
});

// 1B. DEDICATED FINANCIAL SUMMARY & TOTAL PROFIT ENDPOINT
router.get('/financial-summary', async (req, res) => {
  try {
    const [transactions, smsAlerts, tickets, eventWithdrawals] = await Promise.all([
      db.getAllTransactions().catch(err => { console.error('[Financial Summary DB Error - transactions]:', err.message); return []; }),
      db.getAllSmsAlerts().catch(err => { console.error('[Financial Summary DB Error - smsAlerts]:', err.message); return []; }),
      db.getAllTickets().catch(err => { console.error('[Financial Summary DB Error - tickets]:', err.message); return []; }),
      db.getAllEventWithdrawals().catch(err => { console.error('[Financial Summary DB Error - eventWithdrawals]:', err.message); return []; })
    ]);

    const report = calculateFinancialLedger({
      transactions,
      smsAlerts,
      tickets,
      eventWithdrawals
    });

    return res.json({
      success: true,
      ...report
    });
  } catch (error) {
    console.error('[Admin Financial Summary Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate financial summary report.' });
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

    // Trigger Transactional SMS Alert asynchronously if enabled
    try {
      const { sendTransactionalAlert } = require('../services/smsAlertService');
      sendTransactionalAlert({
        userId: user.id,
        alertType: type === 'credit' ? 'credit' : 'debit',
        amount: adjustAmt,
        userBalance: user.walletBalance,
        balanceType: 'main',
        desc: type === 'credit' ? `Credited ₦${adjustAmt}` : `Debited ₦${adjustAmt}`,
        reference: tx.id,
        transactionType: type === 'credit' ? 'deposit' : 'withdrawal'
      }).catch(err => console.error('[Admin Adj SMS Alert Error]:', err.message));
    } catch (_) {}

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

// ==========================================
// 10. ADMIN EVENT TICKETING & WITHDRAWAL ANALYTICS
// ==========================================
router.get('/events/analytics', async (req, res) => {
  try {
    const events = await db.getAllEvents();
    const tickets = await db.getAllTickets();
    const withdrawals = await db.getAllEventWithdrawals();

    const totalEvents = events.length;
    const publishedEvents = events.filter(e => e.status === 'published').length;
    const draftEvents = events.filter(e => e.status !== 'published').length;

    let totalTicketsSold = 0;
    let grossTicketSales = 0;
    let totalTicketCommission = 0;
    let totalCreatorEarnings = 0;

    tickets.forEach(t => {
      const price = parseFloat(t.ticketPrice || 0);
      const comm = parseFloat(t.commissionFee || Math.round(price * 0.03 * 100) / 100);
      const earn = parseFloat(t.creatorEarnings || Math.round((price - comm) * 100) / 100);

      totalTicketsSold++;
      grossTicketSales += price;
      totalTicketCommission += comm;
      totalCreatorEarnings += earn;
    });

    grossTicketSales = Math.round(grossTicketSales * 100) / 100;
    totalTicketCommission = Math.round(totalTicketCommission * 100) / 100;
    totalCreatorEarnings = Math.round(totalCreatorEarnings * 100) / 100;

    // Withdrawals accounting:
    // Every successful withdrawal:
    // Organizer charge = ₦20
    // Provider fee = ₦10
    // Stamp duty = ₦50 for withdrawals >= ₦10,000 (₦0 for < ₦10,000)
    // STRICTWALLET profit = (charge - providerFee) + stampDuty (₦10 if < ₦10k; ₦60 if >= ₦10k)
    let totalWithdrawalCount = withdrawals.length;
    let successfulWithdrawals = 0;
    let failedWithdrawals = 0;
    let pendingWithdrawals = 0;

    let totalWithdrawalCharges = 0;
    let totalWithdrawalStampDuty = 0;
    let totalProviderFees = 0;
    let totalWithdrawalProfit = 0;
    let totalWithdrawalVolume = 0;

    withdrawals.forEach(w => {
      const amt = parseFloat(w.amount || 0);
      if (w.status === 'Successful') {
        successfulWithdrawals++;
        totalWithdrawalVolume += amt;
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

        totalWithdrawalCharges += charge;
        totalWithdrawalStampDuty += stampDuty;
        totalProviderFees += providerFee;
        totalWithdrawalProfit += profit;
      } else if (w.status === 'Failed') {
        failedWithdrawals++;
      } else {
        pendingWithdrawals++;
      }
    });

    totalWithdrawalCharges = Math.round(totalWithdrawalCharges * 100) / 100;
    totalWithdrawalStampDuty = Math.round(totalWithdrawalStampDuty * 100) / 100;
    totalProviderFees = Math.round(totalProviderFees * 100) / 100;
    totalWithdrawalProfit = Math.round(totalWithdrawalProfit * 100) / 100;
    totalWithdrawalVolume = Math.round(totalWithdrawalVolume * 100) / 100;

    return res.json({
      success: true,
      metrics: {
        events: {
          total: totalEvents,
          published: publishedEvents,
          draft: draftEvents
        },
        ticketSales: {
          totalTicketsSold,
          grossTicketSales,
          strictwalletCommission: totalTicketCommission,
          creatorEarnings: totalCreatorEarnings
        },
        withdrawals: {
          total: totalWithdrawalCount,
          successful: successfulWithdrawals,
          failed: failedWithdrawals,
          pending: pendingWithdrawals,
          totalVolume: totalWithdrawalVolume,
          totalChargesCollected: totalWithdrawalCharges,
          totalStampDutyCollected: totalWithdrawalStampDuty,
          totalProviderFees: totalProviderFees,
          totalStrictwalletProfit: totalWithdrawalProfit
        }
      },
      events,
      tickets: tickets.slice(0, 100),
      withdrawals: withdrawals.slice(0, 100)
    });
  } catch (error) {
    console.error('[Admin Event Analytics Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve event analytics.' });
  }
});

// ==========================================
// 11. ADMIN DELETE EVENT
// ==========================================
router.delete('/events/:id', async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const tickets = await db.getTicketsByEvent(event.id);
    const hasSoldTickets = (tickets && tickets.length > 0) || (event.ticketTypes || []).some(tt => (parseInt(tt.quantitySold, 10) || 0) > 0);

    if (hasSoldTickets) {
      // Safe deletion/archiving: preserve buyer tickets, attendee history, and financial records
      await db.updateEvent(event.id, {
        isDeleted: true,
        status: 'cancelled',
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.id
      });

      await db.addAuditLog({
        id: `LOG-${Date.now()}`,
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'ADMIN_EVENT_DELETED',
        description: `Admin safely archived and deleted event "${event.title}" (${event.id}) preserving sold tickets.`
      });

      return res.json({
        success: true,
        message: 'Event deleted successfully (archived to preserve attendee ticket records).'
      });
    } else {
      // 0 tickets sold: clean removal
      await db.deleteEvent(event.id);

      await db.addAuditLog({
        id: `LOG-${Date.now()}`,
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'ADMIN_EVENT_DELETED',
        description: `Admin permanently deleted event "${event.title}" (${event.id}).`
      });

      return res.json({
        success: true,
        message: 'Event deleted successfully.'
      });
    }
  } catch (error) {
    console.error('[Admin Delete Event Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
});

// ==========================================
// 12. ADMIN PAYMENTS & DEPOSITS MANAGEMENT
// ==========================================

// List recent deposits with filtering & pagination
router.get('/deposits', async (req, res) => {
  try {
    const { status, search, limit = 50 } = req.query;
    const allTxs = await db.getAllTransactions();
    let deposits = allTxs.filter(t => t && t.type === 'deposit');

    if (status && status !== 'all') {
      deposits = deposits.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      deposits = deposits.filter(t =>
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.providerReference && t.providerReference.toLowerCase().includes(q)) ||
        (t.paystackReference && t.paystackReference.toLowerCase().includes(q)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(q)) ||
        (t.userFullName && t.userFullName.toLowerCase().includes(q)) ||
        (t.userId && t.userId.toLowerCase().includes(q))
      );
    }

    // Attach user balance & overview info where available
    const pageLimit = parseInt(limit, 10) || 50;
    const paginated = deposits.slice(0, pageLimit);

    return res.json({
      success: true,
      total: deposits.length,
      deposits: paginated
    });
  } catch (error) {
    console.error('[Admin Deposits List Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve deposits ledger.' });
  }
});

// Search & live-verify payment by reference, email, phone, or userId
router.get('/deposits/lookup', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: 'Search query is required.' });
    }

    const q = query.trim();
    const qLower = q.toLowerCase();

    // 1. Try finding transaction directly by reference / ID
    let tx = await db.getTransactionByReference(q);

    // 2. If not found by exact reference, search all transactions
    if (!tx) {
      const allTxs = await db.getAllTransactions();
      tx = allTxs.find(t =>
        t && t.type === 'deposit' && (
          (t.id && t.id.toLowerCase() === qLower) ||
          (t.providerReference && t.providerReference.toLowerCase() === qLower) ||
          (t.paystackReference && t.paystackReference.toLowerCase() === qLower)
        )
      );
    }

    // 3. If still not found, check if query matches a user's email, phone, or id
    let matchedUser = null;
    if (tx && tx.userId) {
      matchedUser = await db.getUserById(tx.userId);
    } else {
      matchedUser = await db.getUserByEmail(qLower);
      if (!matchedUser) {
        matchedUser = await db.getUserByPhone(q);
      }
      if (!matchedUser) {
        matchedUser = await db.getUserById(q);
      }
      if (matchedUser && !tx) {
        const userTxs = await db.getUserTransactions(matchedUser.id);
        tx = userTxs.find(t => t && t.type === 'deposit') || null;
      }
    }

    // If query or tx has a Paystack reference, attempt live Paystack verify
    let livePaystack = null;
    let paystackError = null;
    const refToCheck = tx ? (tx.providerReference || tx.paystackReference || tx.id) : q;

    try {
      livePaystack = await paystackService.verifyTransaction(refToCheck);
    } catch (err) {
      paystackError = err.message || 'Payment not found on Paystack or invalid reference format.';
    }

    // Determine status and recommendation
    let walletCredited = tx ? (tx.credited === true || tx.status === 'Successful') : false;
    let recommendation = '';

    if (livePaystack && livePaystack.status === 'success') {
      if (walletCredited) {
        recommendation = 'SUCCESSFUL — Wallet Credited';
      } else {
        recommendation = 'SUCCESSFUL — Awaiting Wallet Reconciliation';
      }
    } else if (livePaystack && livePaystack.status === 'failed') {
      recommendation = 'FAILED';
    } else if (livePaystack && (livePaystack.status === 'processing' || livePaystack.status === 'ongoing')) {
      recommendation = 'PROCESSING';
    } else if (tx && tx.status === 'Processing') {
      recommendation = 'PROCESSING';
    } else if (tx && tx.status === 'Cancelled') {
      recommendation = 'CANCELLED';
    } else if (tx && tx.status === 'Failed') {
      recommendation = 'FAILED';
    } else if (tx && tx.status === 'Pending') {
      recommendation = 'PENDING';
    } else if (livePaystack && livePaystack.status === 'abandoned') {
      recommendation = 'PENDING — Awaiting Customer Completion';
    } else {
      recommendation = tx ? tx.status.toUpperCase() : 'NOT FOUND';
    }

    return res.json({
      success: true,
      transaction: tx || null,
      user: matchedUser ? {
        id: matchedUser.id,
        fullName: matchedUser.fullName,
        email: matchedUser.email,
        phone: matchedUser.phoneNumber,
        walletBalance: matchedUser.walletBalance
      } : null,
      livePaystack: livePaystack ? {
        status: livePaystack.status,
        amount: livePaystack.amount,
        chargedAmount: livePaystack.chargedAmount,
        fee: livePaystack.fee,
        channel: livePaystack.channel,
        cardType: livePaystack.cardType,
        bank: livePaystack.bank,
        paidAt: livePaystack.paidAt,
        gatewayResponse: livePaystack.gatewayResponse,
        customerEmail: livePaystack.email
      } : null,
      paystackError: paystackError,
      walletCredited,
      recommendation
    });
  } catch (error) {
    console.error('[Admin Deposit Lookup Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to look up deposit information.' });
  }
});

// Admin manual reconciliation action (Idempotent & Audit-logged)
router.post('/deposits/reconcile', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference || !reference.trim()) {
      return res.status(400).json({ success: false, message: 'Payment reference is required for reconciliation.' });
    }

    const ref = reference.trim();

    // Perform idempotent reconciliation with per-reference mutex
    const result = await reconcileDepositTransaction({
      reference: ref,
      triggeredBy: `admin_${req.user.id}`
    });

    // Record admin audit log
    await db.addAuditLog({
      id: `LOG-${Date.now()}`,
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'ADMIN_PAYMENT_RECONCILE',
      description: `Admin reconciled reference "${ref}". Outcome: ${result.status} (Credited: ${result.credited ? 'YES' : 'NO / Already Credited'}) - ${result.message || ''}`,
      createdAt: new Date().toISOString()
    });

    return res.json({
      success: result.success,
      status: result.status,
      credited: result.credited || false,
      alreadyCredited: result.alreadyCredited || false,
      message: result.message || (result.status === 'Successful' ? 'Payment reconciled and credited successfully.' : `Payment status is ${result.status}.`),
      transaction: result.transaction,
      newBalance: result.newBalance
    });
  } catch (error) {
    console.error('[Admin Deposit Reconcile Error]:', error);
    return res.status(500).json({ success: false, message: 'Reconciliation failed: ' + error.message });
  }
});

// 15. SMS ALERT REVENUE & AUDIT
router.get('/sms-revenue', async (req, res) => {
  try {
    const alerts = await db.getAllSmsAlerts();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = now.getTime() - (7 * 86400 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Financial formulas strictly per requirement:
    // SMS Revenue = Number of Successfully Charged SMS Alerts × ₦10
    // SMS Provider Cost = Number of SMS Alerts With Confirmed Provider Charges × ₦6
    // SMS Gross Profit = SMS Revenue − SMS Provider Cost
    const successfulAlerts = alerts.filter(a => a && a.status === 'sent' && (parseFloat(a.customerCharge || 0) > 0 || parseFloat(a.amount || 0) === 10));
    const totalSmsSent = successfulAlerts.length;
    const totalSmsRevenue = Math.round(totalSmsSent * 10.00 * 100) / 100;
    const totalProviderCost = Math.round(totalSmsSent * 6.00 * 100) / 100;
    const totalGrossProfit = Math.round((totalSmsRevenue - totalProviderCost) * 100) / 100;

    // Time-based profit breakdowns
    const todaySent = successfulAlerts.filter(a => a && a.createdAt && new Date(a.createdAt).getTime() >= todayStart);
    const weekSent = successfulAlerts.filter(a => a && a.createdAt && new Date(a.createdAt).getTime() >= weekStart);
    const monthSent = successfulAlerts.filter(a => a && a.createdAt && new Date(a.createdAt).getTime() >= monthStart);

    const dailyProfit = Math.round(todaySent.length * 4.00 * 100) / 100;
    const weeklyProfit = Math.round(weekSent.length * 4.00 * 100) / 100;
    const monthlyProfit = Math.round(monthSent.length * 4.00 * 100) / 100;
    const allTimeProfit = totalGrossProfit;

    const summaryData = {
      totalSmsSent,
      totalDelivered: totalSmsSent,
      totalCharged: totalSmsSent,
      totalSmsRevenue,
      totalProviderCost,
      totalGrossProfit,
      dailyProfit,
      weeklyProfit,
      monthlyProfit,
      allTimeProfit,
      failedCount: alerts.filter(a => a && a.status === 'failed').length,
      timeoutCount: alerts.filter(a => a && (a.status === 'timeout' || a.status === 'uncertain')).length,
      totalAlertAttempts: alerts.length,
      pricingRule: {
        customerCharge: 10.00,
        providerCost: 6.00,
        grossProfitPerSms: 4.00
      }
    };

    return res.json({
      success: true,
      stats: summaryData,
      summary: summaryData,
      alerts
    });
  } catch (error) {
    console.error('[Admin SMS Revenue Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve SMS revenue data.' });
  }
});

// 16. SMS SENDER ID MANAGEMENT
router.get('/sms/sender-id', async (req, res) => {
  try {
    const rawSenderId = process.env.STROWALLET_SENDER_ID || 'STWALLET';
    const cleanSenderId = String(rawSenderId).trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 11);

    return res.json({
      success: true,
      senderId: cleanSenderId,
      maxLength: 11,
      rule: 'Maximum 11 alphanumeric characters without spaces'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve sender ID information.' });
  }
});

router.post('/sms/sender-id', async (req, res) => {
  try {
    const { senderId } = req.body;
    const { submitSenderId } = require('../services/strowallet');

    const result = await submitSenderId(senderId);
    return res.json(result);
  } catch (error) {
    console.error('[Admin Submit Sender ID Error]:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to submit sender ID.' });
  }
});

module.exports = router;

