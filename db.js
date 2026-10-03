const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const path = require('path');
const fs = require('fs');

const DEFAULT_DATABASE_URL = 'https://strictwallet-b8418-default-rtdb.firebaseio.com/';
const DB_TIMEOUT_MS = parseInt(process.env.FIREBASE_TIMEOUT_MS, 10) || 15000;

let dbRef = null;
let isFirebaseAvailable = false;
let firebaseApp = null;

// Resolve Service Account Credentials securely
function resolveCredential() {
  // 1. Direct JSON string or Base64 string in env (ideal for Render / CI)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
      const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      return cert(parsed);
    } catch (err) {
      throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY environment variable: ${err.message}`);
    }
  }

  // 2. Individual environment variables
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'strictwallet-b8418',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
  }

  // 3. Custom path via FIREBASE_SERVICE_ACCOUNT_PATH
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const resolvedPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(resolvedPath)) {
      return cert(require(resolvedPath));
    }
    throw new Error(`Configured FIREBASE_SERVICE_ACCOUNT_PATH file not found at: ${resolvedPath}`);
  }

  // 4. Default local serviceAccountKey.json file in root
  const defaultLocalPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(defaultLocalPath)) {
    return cert(require(defaultLocalPath));
  }

  // 5. Google Application Default Credentials path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return cert(require(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)));
  }

  return null;
}

// Strip undefined values before sending to Firebase Realtime Database
function sanitizeForFirebase(data) {
  if (data === undefined) return null;
  return JSON.parse(JSON.stringify(data));
}

// Ensure database connection is active; fail safely without silent local fallback
function ensureConnected() {
  if (!dbRef || !isFirebaseAvailable) {
    const error = new Error('Database connection error: Firebase Realtime Database is unavailable.');
    error.status = 503;
    error.isDbError = true;
    throw error;
  }
}

// Resilient execution with configurable timeout and retry logic for cold-starts/wake-ups
async function executeWithRetry(operationFn, maxRetries = 2) {
  ensureConnected();
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await Promise.race([
        operationFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Firebase operation timed out after ${DB_TIMEOUT_MS / 1000}s`)), DB_TIMEOUT_MS)
        )
      ]);
    } catch (err) {
      lastError = err;
      if (attempt <= maxRetries) {
        console.warn(`[Firebase RTDB] Attempt ${attempt} failed: ${err.message}. Retrying...`);
        await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
  }
  console.error(`[Firebase RTDB Error] Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
  throw lastError;
}

// Connection reachability verification against Firebase Realtime Database
function verifyReachability(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Connection to Firebase Realtime Database timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    dbRef.child('.info/serverTimeOffset').once('value')
      .then(snapshot => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(snapshot.val());
        }
      })
      .catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('234') && cleaned.length === 13) {
    cleaned = '0' + cleaned.slice(3);
  }
  return cleaned;
}

// Default fallback data plans loaded in-memory only (never overwriting RTDB on startup)
const defaultDataPlans = require('./dataPlans.json');

// Default social links in-memory reference
const defaultSocialLinks = {
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

const db = {
  async init() {
    const rawUrl = process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL;
    const dbUrl = rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`;
    console.log(`[Firebase Init] Target Database URL: ${dbUrl}`);

    let credential;
    try {
      credential = resolveCredential();
    } catch (credErr) {
      isFirebaseAvailable = false;
      console.error(`[Firebase Init] Credential resolution error: ${credErr.message}`);
      throw credErr;
    }

    if (!credential) {
      isFirebaseAvailable = false;
      const errMsg = '[Firebase Init] Missing Firebase Admin credentials. Provide FIREBASE_SERVICE_ACCOUNT_KEY (env JSON/base64) or place serviceAccountKey.json in the project root.';
      console.error(errMsg);
      console.error('[Firebase Init] Production database is offline. Fallback to local files is disabled.');
      throw new Error(errMsg);
    }

    try {
      firebaseApp = initializeApp({
        credential,
        databaseURL: dbUrl
      });
      dbRef = getDatabase(firebaseApp).ref();
    } catch (err) {
      isFirebaseAvailable = false;
      console.error(`[Firebase Init] initializeApp failed: ${err.message}`);
      throw err;
    }

    // Verify connectivity to the NEW Realtime Database
    console.log('[Firebase Init] Verifying connectivity to Firebase Realtime Database...');
    try {
      await verifyReachability(DB_TIMEOUT_MS);
      isFirebaseAvailable = true;
      console.log(`[Firebase Init] SUCCESS: Connected and verified reachability to Firebase Realtime Database: ${dbUrl}`);
    } catch (reachErr) {
      isFirebaseAvailable = false;
      console.error(`[Firebase Init] FAILED: Could not reach Firebase Realtime Database: ${reachErr.message}`);
      console.error('[Firebase Init] Local fallback to data_backup.json is prohibited in production.');
      throw new Error(`Firebase Realtime Database unreachable: ${reachErr.message}`);
    }
  },

  isReady() {
    return isFirebaseAvailable && dbRef !== null;
  },

  reloadLocalBackup() {
    // Retained for backward interface compatibility; production uses live Firebase RTDB
    return false;
  },

  // ==========================================
  // USERS
  // ==========================================
  async getUserById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`users/${id}`).once('value'));
    return snap.val();
  },

  async getUserByIdentifier(identifier) {
    if (!identifier) return null;
    ensureConnected();
    const cleanIdent = identifier.trim().toLowerCase();
    const cleanPhone = normalizePhoneNumber(identifier);
    const isEmail = cleanIdent.includes('@');

    const snap = await executeWithRetry(() => dbRef.child('users').once('value'));
    const users = snap.val() || {};

    for (const key of Object.keys(users)) {
      const u = users[key];
      if (!u) continue;
      if (isEmail && u.email && u.email.trim().toLowerCase() === cleanIdent) {
        return u;
      }
      if (!isEmail && cleanPhone && u.phone && normalizePhoneNumber(u.phone) === cleanPhone) {
        return u;
      }
      if (u.email && u.email.trim().toLowerCase() === cleanIdent) {
        return u;
      }
    }
    return null;
  },

  async getUserByEmail(email) {
    return this.getUserByIdentifier(email);
  },

  async getUserByPhone(phone) {
    return this.getUserByIdentifier(phone);
  },

  async getUserByVirtualAccount(accNum) {
    if (!accNum) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('users').once('value'));
    const users = snap.val() || {};
    for (const key of Object.keys(users)) {
      if (users[key] && users[key].virtualAccountNumber === accNum) {
        return users[key];
      }
    }
    return null;
  },

  async getAllUsers() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('users').once('value'));
    const users = snap.val() || {};
    return Object.values(users);
  },

  async saveUser(user) {
    ensureConnected();
    user.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(user);
    await executeWithRetry(() => dbRef.child(`users/${user.id}`).set(sanitized));
    return user;
  },

  // ==========================================
  // TRANSACTIONS
  // ==========================================
  async createTransaction(tx) {
    ensureConnected();
    tx.createdAt = tx.createdAt || new Date().toISOString();
    const sanitized = sanitizeForFirebase(tx);
    await executeWithRetry(() => dbRef.child(`transactions/${tx.id}`).set(sanitized));
    return tx;
  },

  async getTransactionById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`transactions/${id}`).once('value'));
    return snap.val();
  },

  async getTransactionByReference(ref) {
    if (!ref) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('transactions').once('value'));
    const all = snap.val() || {};
    for (const key of Object.keys(all)) {
      const tx = all[key];
      if (tx && (tx.providerReference === ref || tx.reference === ref)) {
        return tx;
      }
    }
    return null;
  },

  async getUserTransactions(userId) {
    if (!userId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('transactions').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(tx => tx && tx.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllTransactions() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('transactions').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // ==========================================
  // DEPOSITS
  // ==========================================
  async saveDeposit(dep) {
    ensureConnected();
    dep.createdAt = dep.createdAt || new Date().toISOString();
    const sanitized = sanitizeForFirebase(dep);
    await executeWithRetry(() => dbRef.child(`deposits/${dep.id}`).set(sanitized));
    return dep;
  },

  async getDepositByReference(ref) {
    if (!ref) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('deposits').once('value'));
    const all = snap.val() || {};
    for (const key of Object.keys(all)) {
      if (all[key] && all[key].providerReference === ref) {
        return all[key];
      }
    }
    return null;
  },

  // ==========================================
  // DATA PLANS
  // ==========================================
  async getAllDataPlans() {
    ensureConnected();
    const [plansSnap, deletedSnap] = await Promise.all([
      executeWithRetry(() => dbRef.child('dataPlans').once('value')),
      executeWithRetry(() => dbRef.child('deletedPlans').once('value'))
    ]);
    const fbPlans = plansSnap.val();
    const deletedPlans = deletedSnap.val() || {};

    if (fbPlans && Object.keys(fbPlans).length > 0) {
      return Object.values(fbPlans).filter(p => p && !deletedPlans[p.id]);
    }

    // Default seed plans in memory without overwriting Firebase
    return Object.values(defaultDataPlans).filter(p => p && !deletedPlans[p.id]);
  },

  async getDataPlanById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`dataPlans/${id}`).once('value'));
    const plan = snap.val();
    if (plan) return plan;
    return defaultDataPlans[id] || null;
  },

  async saveAllDataPlans(plans) {
    ensureConnected();
    const sanitized = sanitizeForFirebase(plans);
    await executeWithRetry(() => dbRef.child('dataPlans').set(sanitized));
    return plans;
  },

  async updateDataPlan(id, updateData) {
    ensureConnected();
    const current = await this.getDataPlanById(id);
    if (!current) return null;
    const updated = { ...current, ...updateData };
    const sanitized = sanitizeForFirebase(updated);
    await executeWithRetry(() => dbRef.child(`dataPlans/${id}`).set(sanitized));
    return updated;
  },

  async addDataPlan(plan) {
    ensureConnected();
    if (!plan.id) {
      const net = (plan.network || 'NET').toLowerCase();
      const type = (plan.planType || 'PLAN').toLowerCase().replace(/[^a-z0-9]/g, '_');
      plan.id = `${net}_${type}_${plan.providerPlanId || Date.now()}`;
    }
    plan.createdAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(plan);
    await executeWithRetry(() => dbRef.child(`dataPlans/${plan.id}`).set(sanitized));
    await executeWithRetry(() => dbRef.child(`deletedPlans/${plan.id}`).remove());
    return plan;
  },

  async deleteDataPlan(id) {
    ensureConnected();
    const plan = await this.getDataPlanById(id);
    if (plan) {
      await executeWithRetry(() => dbRef.child(`dataPlans/${id}`).remove());
      await executeWithRetry(() => dbRef.child(`deletedPlans/${id}`).set(true));
      return plan;
    }
    return null;
  },

  async resetDataPlan(id) {
    ensureConnected();
    const defaultPlan = defaultDataPlans[id];
    if (defaultPlan) {
      const sanitized = sanitizeForFirebase(defaultPlan);
      await executeWithRetry(() => dbRef.child(`dataPlans/${id}`).set(sanitized));
      await executeWithRetry(() => dbRef.child(`deletedPlans/${id}`).remove());
      return defaultPlan;
    }
    return null;
  },

  // ==========================================
  // SUPPORT TICKETS
  // ==========================================
  async createSupportTicket(ticket) {
    ensureConnected();
    ticket.createdAt = new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(ticket);
    await executeWithRetry(() => dbRef.child(`supportTickets/${ticket.id}`).set(sanitized));
    return ticket;
  },

  async getSupportTicketById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`supportTickets/${id}`).once('value'));
    return snap.val();
  },

  async getUserTickets(userId) {
    if (!userId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('supportTickets').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(t => t && t.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllSupportTickets() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('supportTickets').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateSupportTicket(id, updateData) {
    ensureConnected();
    const ticket = await this.getSupportTicketById(id);
    if (!ticket) return null;
    const updated = {
      ...ticket,
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeForFirebase(updated);
    await executeWithRetry(() => dbRef.child(`supportTickets/${id}`).set(sanitized));
    return updated;
  },

  // ==========================================
  // SUPPORT MESSAGES
  // ==========================================
  async addSupportMessage(msg) {
    ensureConnected();
    msg.createdAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(msg);
    await executeWithRetry(() => dbRef.child(`supportMessages/${msg.id}`).set(sanitized));
    return msg;
  },

  async getMessagesByTicketId(ticketId) {
    if (!ticketId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('supportMessages').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(m => m && m.ticketId === ticketId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  // ==========================================
  // AUDIT LOGS
  // ==========================================
  async addAuditLog(log) {
    ensureConnected();
    log.timestamp = new Date().toISOString();
    const sanitized = sanitizeForFirebase(log);
    await executeWithRetry(() => dbRef.child(`adminAuditLogs/${log.id}`).set(sanitized));
    return log;
  },

  async getAllAuditLogs() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('adminAuditLogs').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // ==========================================
  // SOCIAL LINKS
  // ==========================================
  async getAllSocialLinks() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('socialLinks').once('value'));
    const fbLinks = snap.val();
    const links = fbLinks && Object.keys(fbLinks).length > 0 ? fbLinks : defaultSocialLinks;
    return Object.values(links)
      .sort((a, b) => (parseInt(a.order, 10) || 99) - (parseInt(b.order, 10) || 99));
  },

  async getActiveSocialLinks() {
    const all = await this.getAllSocialLinks();
    return all.filter(s => s && s.enabled === true);
  },

  async getSocialLinkById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`socialLinks/${id}`).once('value'));
    const val = snap.val();
    if (val) return val;
    return defaultSocialLinks[id] || null;
  },

  async saveSocialLink(link) {
    ensureConnected();
    if (!link.id) {
      const slug = (link.platform || 'social').toLowerCase().replace(/[^a-z0-9]/g, '_');
      link.id = `social_${slug}_${Date.now()}`;
    }
    link.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(link);
    await executeWithRetry(() => dbRef.child(`socialLinks/${link.id}`).set(sanitized));
    return link;
  },

  async deleteSocialLink(id) {
    ensureConnected();
    const existing = await this.getSocialLinkById(id);
    if (existing) {
      await executeWithRetry(() => dbRef.child(`socialLinks/${id}`).remove());
      return existing;
    }
    return null;
  },

  // ==========================================
  // EVENTS
  // ==========================================
  async createEvent(event) {
    ensureConnected();
    event.createdAt = event.createdAt || new Date().toISOString();
    event.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(event);
    await executeWithRetry(() => dbRef.child(`events/${event.id}`).set(sanitized));
    return event;
  },

  async getEventById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`events/${id}`).once('value'));
    return snap.val();
  },

  async getEventBySlug(slug) {
    if (!slug) return null;
    ensureConnected();
    const cleanSlug = slug.toLowerCase().trim();
    const snap = await executeWithRetry(() => dbRef.child('events').once('value'));
    const all = snap.val() || {};
    for (const key of Object.keys(all)) {
      const ev = all[key];
      if (ev && ev.slug && ev.slug.toLowerCase().trim() === cleanSlug) {
        return ev;
      }
    }
    return null;
  },

  async getAllEvents(options = {}) {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('events').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(ev => ev && (options.includeDeleted ? true : !ev.isDeleted))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getEventsByCreator(creatorId, options = {}) {
    if (!creatorId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('events').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(ev => ev && ev.creatorId === creatorId && (options.includeDeleted ? true : !ev.isDeleted))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateEvent(id, updateData) {
    ensureConnected();
    const ev = await this.getEventById(id);
    if (!ev) return null;
    const updated = {
      ...ev,
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeForFirebase(updated);
    await executeWithRetry(() => dbRef.child(`events/${id}`).set(sanitized));
    return updated;
  },

  async deleteEvent(id) {
    ensureConnected();
    const ev = await this.getEventById(id);
    if (ev) {
      await executeWithRetry(() => dbRef.child(`events/${id}`).remove());
      return ev;
    }
    return null;
  },

  // ==========================================
  // TICKETS
  // ==========================================
  async createTicket(ticket) {
    ensureConnected();
    ticket.createdAt = ticket.createdAt || new Date().toISOString();
    ticket.updatedAt = ticket.updatedAt || new Date().toISOString();
    const sanitized = sanitizeForFirebase(ticket);
    await executeWithRetry(() => dbRef.child(`tickets/${ticket.id}`).set(sanitized));
    return ticket;
  },

  async getTicketById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`tickets/${id}`).once('value'));
    return snap.val();
  },

  async getTicketByQrToken(qrToken) {
    if (!qrToken) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('tickets').once('value'));
    const all = snap.val() || {};
    for (const key of Object.keys(all)) {
      const t = all[key];
      if (t && t.qrToken === qrToken) {
        return t;
      }
    }
    return null;
  },

  async getTicketsByEvent(eventId) {
    if (!eventId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('tickets').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(t => t && t.eventId === eventId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getUserTickets(userId) {
    if (!userId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('tickets').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(t => t && t.buyerId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getAllTickets() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('tickets').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateTicket(id, updateData) {
    ensureConnected();
    const ticket = await this.getTicketById(id);
    if (!ticket) return null;
    const updated = {
      ...ticket,
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeForFirebase(updated);
    await executeWithRetry(() => dbRef.child(`tickets/${id}`).set(sanitized));
    return updated;
  },

  // ==========================================
  // EVENT CREATOR / ORGANIZER WALLET
  // ==========================================
  async getOrganizerWallet(userId) {
    if (!userId) return null;
    ensureConnected();
    // Verify against Firebase RTDB first to NEVER overwrite an existing wallet with balance 0
    const snap = await executeWithRetry(() => dbRef.child(`organizerWallets/${userId}`).once('value'));
    const existing = snap.val();
    if (existing) {
      return existing;
    }

    // Only if record does not exist in Firebase, initialize a new organizer wallet
    const newWallet = {
      userId,
      balance: 0.00,
      totalEarned: 0.00,
      totalWithdrawn: 0.00,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeForFirebase(newWallet);
    await executeWithRetry(() => dbRef.child(`organizerWallets/${userId}`).set(sanitized));
    return newWallet;
  },

  async saveOrganizerWallet(wallet) {
    ensureConnected();
    wallet.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(wallet);
    await executeWithRetry(() => dbRef.child(`organizerWallets/${wallet.userId}`).set(sanitized));
    return wallet;
  },

  async creditOrganizerWallet(userId, amount) {
    const wallet = await this.getOrganizerWallet(userId);
    const amt = parseFloat(amount || 0);
    wallet.balance = Math.round(((parseFloat(wallet.balance) || 0) + amt) * 100) / 100;
    wallet.totalEarned = Math.round(((parseFloat(wallet.totalEarned) || 0) + amt) * 100) / 100;
    return await this.saveOrganizerWallet(wallet);
  },

  async debitOrganizerWallet(userId, amount) {
    const wallet = await this.getOrganizerWallet(userId);
    const amt = parseFloat(amount || 0);
    wallet.balance = Math.round(((parseFloat(wallet.balance) || 0) - amt) * 100) / 100;
    wallet.totalWithdrawn = Math.round(((parseFloat(wallet.totalWithdrawn) || 0) + amt) * 100) / 100;
    return await this.saveOrganizerWallet(wallet);
  },

  // ==========================================
  // EVENT CREATOR WITHDRAWALS
  // ==========================================
  async createEventWithdrawal(wth) {
    ensureConnected();
    wth.createdAt = wth.createdAt || new Date().toISOString();
    wth.updatedAt = new Date().toISOString();
    const sanitized = sanitizeForFirebase(wth);
    await executeWithRetry(() => dbRef.child(`eventWithdrawals/${wth.id}`).set(sanitized));
    return wth;
  },

  async getEventWithdrawalById(id) {
    if (!id) return null;
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child(`eventWithdrawals/${id}`).once('value'));
    return snap.val();
  },

  async updateEventWithdrawal(id, updateData) {
    ensureConnected();
    const wth = await this.getEventWithdrawalById(id);
    if (!wth) return null;
    const updated = {
      ...wth,
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    const sanitized = sanitizeForFirebase(updated);
    await executeWithRetry(() => dbRef.child(`eventWithdrawals/${id}`).set(sanitized));
    return updated;
  },

  async getAllEventWithdrawals() {
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('eventWithdrawals').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getUserEventWithdrawals(userId) {
    if (!userId) return [];
    ensureConnected();
    const snap = await executeWithRetry(() => dbRef.child('eventWithdrawals').once('value'));
    const all = snap.val() || {};
    return Object.values(all)
      .filter(w => w && w.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
};

module.exports = db;
