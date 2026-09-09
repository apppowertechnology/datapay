const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const path = require('path');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, 'serviceAccountKey.json');

let dbRef = null;

try {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`Service account key not found at: ${SERVICE_ACCOUNT_PATH}`);
  }
  initializeApp({
    credential: cert(require(SERVICE_ACCOUNT_PATH)),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  dbRef = getDatabase().ref();
} catch (err) {
  console.warn(`[Firebase Init] Could not initialize Firebase: ${err.message}`);
  console.warn('[Firebase Init] Running in local-only mode (data_backup.json).');
}

const LOCAL_DB_FILE = path.join(__dirname, 'data_backup.json');

// In-memory cache synced with Firebase & local backup file
let localCache = {
  users: {},
  transactions: {},
  deposits: {},
  dataPlans: {},
  deletedPlans: {},
  socialLinks: {},
  supportTickets: {},
  supportMessages: {},
  adminAuditLogs: {},
  settings: {
    airtimeDiscountPercentage: 0, // e.g. 0% (cost 980, selling 1000)
    profitMarginPercentage: 2
  }
};

// Load local backup if exists
if (fs.existsSync(LOCAL_DB_FILE)) {
  try {
    const fileContent = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
    const data = fileContent.trim() ? JSON.parse(fileContent) : {};
    localCache = { ...localCache, ...data };
  } catch (err) {
    console.error('Error loading local DB backup:', err.message);
  }
}

function saveLocalBackup() {
  try {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(localCache, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing local DB backup:', err.message);
  }
}

// Helper to push/update to Firebase RTDB via REST API with fallback
async function syncToFirebase(node, key, data) {
  if (!dbRef) return;
  try {
    const ref = key ? dbRef.child(`${node}/${key}`) : dbRef.child(node);
    const syncOp = data === null ? ref.remove() : ref.set(data);
    await Promise.race([
      syncOp,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase connection timeout')), 1500))
    ]);
  } catch (err) {
    console.warn(`[DB Sync Notice] Firebase Admin update for /${node}/${key || ''}: ${err.message}. Local backup active.`);
  }
}

async function loadFromFirebase(node) {
  if (!dbRef) return null;
  try {
    const snapshot = await Promise.race([
      dbRef.child(node).once('value'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase connection timeout')), 1500))
    ]);
    const data = snapshot.val();
    if (data) {
      localCache[node] = data;
      saveLocalBackup();
      return data;
    }
  } catch (err) {
    // Fallback to local cache
  }
  return localCache[node] || {};
}

// Initial default data plans for MTN, GLO, AIRTEL, 9MOBILE
const defaultDataPlans = require('./dataPlans.json');
  




const db = {
  async init() {
    console.log('Firebase Admin SDK initialized');
    localCache.deletedPlans = localCache.deletedPlans || {};
    // Initialize collections if empty, respecting deleted plans
    if (!localCache.dataPlans || Object.keys(localCache.dataPlans).length === 0) {
      localCache.dataPlans = {};
      for (const [id, plan] of Object.entries(defaultDataPlans)) {
        if (!localCache.deletedPlans[id]) {
          localCache.dataPlans[id] = plan;
        }
      }
    saveLocalBackup();
    }
    // Initialize default social links if empty
    if (!localCache.socialLinks || Object.keys(localCache.socialLinks).length === 0) {
      localCache.socialLinks = {
        'social_whatsapp': {
          id: 'social_whatsapp',
          platform: 'WhatsApp',
          name: 'WhatsApp Customer Service',
          url: 'https://wa.me/2349161041419?text=Hello%20STRICTWALLET%20Customer%20Care,%20I%20need%20assistance.',
          actionText: 'Chat on WhatsApp',
          icon: 'fa-brands fa-whatsapp',
          enabled: true,
          order: 1
        },
        'social_telegram': {
          id: 'social_telegram',
          platform: 'Telegram',
          name: 'Official Telegram Channel',
          url: 'https://t.me/strictwallet',
          actionText: 'Join Channel',
          icon: 'fa-brands fa-telegram',
          enabled: true,
          order: 2
        },
        'social_x': {
          id: 'social_x',
          platform: 'X/Twitter',
          name: 'X (Twitter)',
          url: 'https://x.com/strictwallet',
          actionText: 'Follow Us',
          icon: 'fa-brands fa-x-twitter',
          enabled: true,
          order: 3
        },
        'social_instagram': {
          id: 'social_instagram',
          platform: 'Instagram',
          name: 'Instagram Official',
          url: 'https://instagram.com/strictwallet',
          actionText: 'Follow Us',
          icon: 'fa-brands fa-instagram',
          enabled: true,
          order: 4
        },
        'social_facebook': {
          id: 'social_facebook',
          platform: 'Facebook',
          name: 'Facebook Page',
          url: 'https://facebook.com/strictwallet',
          actionText: 'Follow Page',
          icon: 'fa-brands fa-facebook',
          enabled: true,
          order: 5
        }
      };
      saveLocalBackup();
      for (const [id, link] of Object.entries(localCache.socialLinks)) {
        await syncToFirebase('socialLinks', id, link);
      }
    }
  },

  // USERS
  async getUserById(id) {
    return localCache.users[id] || null;
  },

  async getUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();
    for (const key of Object.keys(localCache.users)) {
      if (localCache.users[key].email && localCache.users[key].email.toLowerCase().trim() === cleanEmail) {
        return localCache.users[key];
      }
    }
    return null;
  },

  async getUserByVirtualAccount(accNum) {
    if (!accNum) return null;
    for (const key of Object.keys(localCache.users)) {
      if (localCache.users[key].virtualAccountNumber === accNum) {
        return localCache.users[key];
      }
    }
    return null;
  },

  async getAllUsers() {
    return Object.values(localCache.users);
  },

  async saveUser(user) {
    user.updatedAt = new Date().toISOString();
    localCache.users[user.id] = user;
    saveLocalBackup();
    await syncToFirebase('users', user.id, user);
    return user;
  },

  // TRANSACTIONS
  async createTransaction(tx) {
    tx.createdAt = tx.createdAt || new Date().toISOString();
    localCache.transactions[tx.id] = tx;
    saveLocalBackup();
    await syncToFirebase('transactions', tx.id, tx);
    return tx;
  },

  async getTransactionById(id) {
    return localCache.transactions[id] || null;
  },

  async getTransactionByReference(ref) {
    for (const key of Object.keys(localCache.transactions)) {
      if (localCache.transactions[key].providerReference === ref || localCache.transactions[key].reference === ref) {
        return localCache.transactions[key];
      }
    }
    return null;
  },

  async getUserTransactions(userId) {
    return Object.values(localCache.transactions)
      .filter(tx => tx.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllTransactions() {
    return Object.values(localCache.transactions)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // DEPOSITS (Webhook logging & verification)
  async saveDeposit(dep) {
    dep.createdAt = dep.createdAt || new Date().toISOString();
    localCache.deposits[dep.id] = dep;
    saveLocalBackup();
    await syncToFirebase('deposits', dep.id, dep);
    return dep;
  },

  async getDepositByReference(ref) {
    for (const key of Object.keys(localCache.deposits)) {
      if (localCache.deposits[key].providerReference === ref) {
        return localCache.deposits[key];
      }
    }
    return null;
  },

  // DATA PLANS
  async getAllDataPlans() {
    return Object.values(localCache.dataPlans);
  },

  async getDataPlanById(id) {
    return localCache.dataPlans[id] || null;
  },

  async saveAllDataPlans(plans) {
    localCache.dataPlans = plans;
    saveLocalBackup();
    await syncToFirebase('dataPlans', null, plans);
    return plans;
  },

  async updateDataPlan(id, updateData) {
    if (localCache.dataPlans[id]) {
      localCache.dataPlans[id] = { ...localCache.dataPlans[id], ...updateData };
      saveLocalBackup();
      await syncToFirebase('dataPlans', id, localCache.dataPlans[id]);
      return localCache.dataPlans[id];
    }
    return null;
  },

  async addDataPlan(plan) {
    if (!plan.id) {
      const net = (plan.network || 'NET').toLowerCase();
      const type = (plan.planType || 'PLAN').toLowerCase().replace(/[^a-z0-9]/g, '_');
      plan.id = `${net}_${type}_${plan.providerPlanId || Date.now()}`;
    }
    plan.createdAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    localCache.dataPlans[plan.id] = plan;
    if (localCache.deletedPlans && localCache.deletedPlans[plan.id]) {
      delete localCache.deletedPlans[plan.id];
      await syncToFirebase('deletedPlans', plan.id, null);
    }
    saveLocalBackup();
    await syncToFirebase('dataPlans', plan.id, plan);
    return plan;
  },

  async deleteDataPlan(id) {
    if (localCache.dataPlans[id]) {
      const deleted = localCache.dataPlans[id];
      delete localCache.dataPlans[id];
      if (!localCache.deletedPlans) localCache.deletedPlans = {};
      localCache.deletedPlans[id] = true;
      saveLocalBackup();
      await syncToFirebase('dataPlans', id, null);
      await syncToFirebase('deletedPlans', id, true);
      return deleted;
    }
    return null;
  },

  async resetDataPlan(id) {
    const defaultPlan = defaultDataPlans[id];
    if (defaultPlan && localCache.dataPlans[id]) {
      localCache.dataPlans[id] = { ...defaultPlan };
      saveLocalBackup();
      await syncToFirebase('dataPlans', id, localCache.dataPlans[id]);
      return localCache.dataPlans[id];
    }
    return localCache.dataPlans[id] || null;
  },

  // SUPPORT TICKETS
  async createSupportTicket(ticket) {
    ticket.createdAt = new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    localCache.supportTickets[ticket.id] = ticket;
    saveLocalBackup();
    await syncToFirebase('supportTickets', ticket.id, ticket);
    return ticket;
  },

  async getSupportTicketById(id) {
    return localCache.supportTickets[id] || null;
  },

  async getUserTickets(userId) {
    return Object.values(localCache.supportTickets)
      .filter(t => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllSupportTickets() {
    return Object.values(localCache.supportTickets)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateSupportTicket(id, updateData) {
    if (localCache.supportTickets[id]) {
      localCache.supportTickets[id] = {
        ...localCache.supportTickets[id],
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      saveLocalBackup();
      await syncToFirebase('supportTickets', id, localCache.supportTickets[id]);
      return localCache.supportTickets[id];
    }
    return null;
  },

  // SUPPORT MESSAGES
  async addSupportMessage(msg) {
    msg.createdAt = new Date().toISOString();
    localCache.supportMessages[msg.id] = msg;
    saveLocalBackup();
    await syncToFirebase('supportMessages', msg.id, msg);
    return msg;
  },

  async getMessagesByTicketId(ticketId) {
    return Object.values(localCache.supportMessages)
      .filter(m => m.ticketId === ticketId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  // AUDIT LOGS
  async addAuditLog(log) {
    log.timestamp = new Date().toISOString();
    localCache.adminAuditLogs[log.id] = log;
    saveLocalBackup();
    await syncToFirebase('adminAuditLogs', log.id, log);
    return log;
  },

  async getAllAuditLogs() {
    return Object.values(localCache.adminAuditLogs)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // SOCIAL LINKS
  async getAllSocialLinks() {
    return Object.values(localCache.socialLinks || {})
      .sort((a, b) => (parseInt(a.order, 10) || 99) - (parseInt(b.order, 10) || 99));
  },

  async getActiveSocialLinks() {
    return Object.values(localCache.socialLinks || {})
      .filter(s => s.enabled === true)
      .sort((a, b) => (parseInt(a.order, 10) || 99) - (parseInt(b.order, 10) || 99));
  },

  async getSocialLinkById(id) {
    return (localCache.socialLinks && localCache.socialLinks[id]) || null;
  },

  async saveSocialLink(link) {
    if (!localCache.socialLinks) localCache.socialLinks = {};
    if (!link.id) {
      const slug = (link.platform || 'social').toLowerCase().replace(/[^a-z0-9]/g, '_');
      link.id = `social_${slug}_${Date.now()}`;
    }
    link.updatedAt = new Date().toISOString();
    localCache.socialLinks[link.id] = link;
    saveLocalBackup();
    await syncToFirebase('socialLinks', link.id, link);
    return link;
  },

  async deleteSocialLink(id) {
    if (localCache.socialLinks && localCache.socialLinks[id]) {
      const deleted = localCache.socialLinks[id];
      delete localCache.socialLinks[id];
      saveLocalBackup();
      await syncToFirebase('socialLinks', id, null);
      return deleted;
    }
    return null;
  }
};

module.exports = db;
