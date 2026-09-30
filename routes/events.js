const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const strowallet = require('../services/strowallet');
const cloudinary = require('../services/cloudinary');

// Helper to generate a clean, safe URL slug
function generateSlug(text) {
  return (text || 'event')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============================================================
// 1. IMAGE UPLOAD (Cloudinary with 'Datapay' preset)
// ============================================================
router.post('/upload', authenticateToken, async (req, res) => {
  try {
    const { image, folder } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image data is required.' });
    }

    const uploadRes = await cloudinary.uploadImage(image, folder || 'strictwallet_events');
    if (!uploadRes.success) {
      return res.status(500).json({ success: false, message: uploadRes.message || 'Image upload failed.' });
    }

    return res.json({
      success: true,
      url: uploadRes.url,
      publicId: uploadRes.publicId
    });
  } catch (error) {
    console.error('[Event Upload Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to upload image.' });
  }
});

// ============================================================
// 2. PUBLIC EVENTS MARKETPLACE & EVENT DETAILS
// ============================================================

// Get all published events for marketplace
router.get('/', async (req, res) => {
  try {
    const events = await db.getAllEvents();
    const published = events.filter(e => e.status === 'published');

    // Add remaining tickets summary to each event
    const safeEvents = published.map(ev => {
      let totalQty = 0;
      let totalSold = 0;
      let minPrice = Infinity;

      (ev.ticketTypes || []).forEach(tt => {
        const qty = parseInt(tt.quantityAvailable, 10) || 0;
        const sold = parseInt(tt.quantitySold, 10) || 0;
        const price = parseFloat(tt.price) || 0;
        totalQty += qty;
        totalSold += sold;
        if (price < minPrice) minPrice = price;
      });

      return {
        id: ev.id,
        slug: ev.slug,
        title: ev.title,
        description: ev.description,
        venue: ev.venue,
        date: ev.date,
        time: ev.time,
        salesStartDate: ev.salesStartDate,
        salesEndDate: ev.salesEndDate,
        bannerUrl: ev.bannerUrl,
        ticketDesignUrl: ev.ticketDesignUrl,
        ticketTypes: ev.ticketTypes,
        creatorName: ev.creatorName,
        totalQuantity: totalQty,
        totalSold,
        remainingTickets: Math.max(0, totalQty - totalSold),
        startingPrice: minPrice === Infinity ? 0 : minPrice,
        status: ev.status,
        createdAt: ev.createdAt
      };
    });

    return res.json({ success: true, events: safeEvents });
  } catch (error) {
    console.error('[Get Events Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load events.' });
  }
});

// Get event by Slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const event = await db.getEventBySlug(req.params.slug);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    return res.json({ success: true, event });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving event.' });
  }
});

// Get event by ID
router.get('/:id', async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    return res.json({ success: true, event });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving event.' });
  }
});

// ============================================================
// 3. EVENT CREATOR MANAGEMENT (Authenticated)
// ============================================================

// Create Event
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description,
      venue,
      date,
      time,
      salesStartDate,
      salesEndDate,
      bannerUrl,
      ticketDesignUrl,
      ticketTypes,
      status
    } = req.body;

    if (!title || !venue || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Event Name, Venue, Date, and Time are required fields.'
      });
    }

    if (!ticketTypes || !Array.isArray(ticketTypes) || ticketTypes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please add at least one ticket type with a price and quantity.'
      });
    }

    // Format & validate ticket types
    const formattedTicketTypes = ticketTypes.map((tt, idx) => {
      const price = parseFloat(tt.price);
      const qty = parseInt(tt.quantityAvailable, 10);
      if (!tt.name || isNaN(price) || price < 0 || isNaN(qty) || qty <= 0) {
        throw new Error(`Invalid ticket type at #${idx + 1}. Name, valid price, and quantity > 0 are required.`);
      }
      return {
        id: tt.id || `TT-${Date.now()}-${idx}-${Math.floor(100 + Math.random() * 900)}`,
        name: tt.name.trim(),
        price: Math.round(price * 100) / 100,
        quantityAvailable: qty,
        quantitySold: parseInt(tt.quantitySold, 10) || 0
      };
    });

    // Generate unique slug
    let baseSlug = generateSlug(title);
    let uniqueSlug = baseSlug;
    let existingWithSlug = await db.getEventBySlug(uniqueSlug);
    if (existingWithSlug) {
      uniqueSlug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const eventId = `EVT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newEvent = {
      id: eventId,
      slug: uniqueSlug,
      creatorId: req.user.id,
      creatorName: req.user.fullName,
      creatorEmail: req.user.email,
      title: title.trim(),
      description: (description || '').trim(),
      venue: venue.trim(),
      date,
      time,
      salesStartDate: salesStartDate || null,
      salesEndDate: salesEndDate || null,
      bannerUrl: bannerUrl || '',
      ticketDesignUrl: ticketDesignUrl || '',
      ticketTypes: formattedTicketTypes,
      status: status === 'published' ? 'published' : 'draft',
      createdAt: new Date().toISOString()
    };

    await db.createEvent(newEvent);

    return res.status(201).json({
      success: true,
      message: newEvent.status === 'published' ? 'Event published successfully!' : 'Event saved as draft!',
      event: newEvent
    });
  } catch (error) {
    console.error('[Create Event Error]:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to create event.' });
  }
});

// Update Event
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (event.creatorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only edit events that you created.' });
    }

    const updates = {};
    const allowed = [
      'title', 'description', 'venue', 'date', 'time',
      'salesStartDate', 'salesEndDate', 'bannerUrl', 'ticketDesignUrl',
      'ticketTypes', 'status'
    ];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (updates.title && updates.title !== event.title) {
      let baseSlug = generateSlug(updates.title);
      let uniqueSlug = baseSlug;
      let existingWithSlug = await db.getEventBySlug(uniqueSlug);
      if (existingWithSlug && existingWithSlug.id !== event.id) {
        uniqueSlug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
      }
      updates.slug = uniqueSlug;
    }

    // Preserve quantitySold on existing ticket types & safeguard sold allocations
    if (updates.ticketTypes && Array.isArray(updates.ticketTypes)) {
      // Check for omitted categories that already have sales
      const missingSoldCategory = (event.ticketTypes || []).find(e => 
        (parseInt(e.quantitySold, 10) || 0) > 0 && !updates.ticketTypes.some(u => u.id === e.id)
      );
      if (missingSoldCategory) {
        return res.status(400).json({
          success: false,
          message: `Cannot remove ticket category "${missingSoldCategory.name}" because tickets have already been purchased for it.`
        });
      }

      for (let idx = 0; idx < updates.ticketTypes.length; idx++) {
        const tt = updates.ticketTypes[idx];
        const existing = (event.ticketTypes || []).find(e => e.id === tt.id);
        const qtySold = existing ? (parseInt(existing.quantitySold, 10) || 0) : 0;
        const qtyAvailable = parseInt(tt.quantityAvailable, 10) || 0;
        const price = Math.round(parseFloat(tt.price) * 100) / 100;

        if (!tt.name || !tt.name.trim() || isNaN(price) || price < 0 || isNaN(qtyAvailable) || qtyAvailable <= 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid ticket category at #${idx + 1}. Name, valid price, and quantity > 0 are required.`
          });
        }

        if (qtyAvailable < qtySold) {
          return res.status(400).json({
            success: false,
            message: `Cannot reduce total tickets (${qtyAvailable}) below already sold tickets (${qtySold}) for category "${tt.name}".`
          });
        }
      }

      updates.ticketTypes = updates.ticketTypes.map((tt, idx) => {
        const existing = (event.ticketTypes || []).find(e => e.id === tt.id);
        const qtySold = existing ? (parseInt(existing.quantitySold, 10) || 0) : 0;
        return {
          id: tt.id || `TT-${Date.now()}-${idx}-${Math.floor(100 + Math.random() * 900)}`,
          name: tt.name.trim(),
          price: Math.round(parseFloat(tt.price) * 100) / 100,
          quantityAvailable: parseInt(tt.quantityAvailable, 10) || 0,
          quantitySold: qtySold
        };
      });
    }

    const updated = await db.updateEvent(event.id, updates);
    return res.json({ success: true, message: 'Event updated successfully.', event: updated });
  } catch (error) {
    console.error('[Update Event Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to update event.' });
  }
});

// Delete Event (Event Creator or Admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (event.creatorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only delete events that you created.' });
    }

    // Check if tickets have been sold
    const tickets = await db.getTicketsByEvent(event.id);
    const hasSoldTickets = (tickets && tickets.length > 0) || (event.ticketTypes || []).some(tt => (parseInt(tt.quantitySold, 10) || 0) > 0);

    if (hasSoldTickets) {
      // Safe deletion/archiving: mark as deleted/cancelled so financial records,
      // ticket records, buyer receipts, and transactions remain intact
      await db.updateEvent(event.id, {
        isDeleted: true,
        status: 'cancelled',
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.id
      });
      return res.json({
        success: true,
        message: 'Event deleted successfully (archived to preserve attendee ticket records).'
      });
    } else {
      // No tickets sold: clean removal
      await db.deleteEvent(event.id);
      return res.json({
        success: true,
        message: 'Event deleted successfully.'
      });
    }
  } catch (error) {
    console.error('[Delete Event Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
});

// Publish Event
router.post('/:id/publish', authenticateToken, async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (event.creatorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. You can only publish your own events.' });
    }

    const updated = await db.updateEvent(event.id, { status: 'published' });
    return res.json({
      success: true,
      message: 'Event is now publicly published!',
      event: updated
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to publish event.' });
  }
});

// Get My Created Events
router.get('/creator/my-events', authenticateToken, async (req, res) => {
  try {
    const events = await db.getEventsByCreator(req.user.id);
    return res.json({ success: true, events });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load your events.' });
  }
});

// Get Event Attendees & Sales History (Event Creator only)
router.get('/:id/attendees', authenticateToken, async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (event.creatorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to view attendee records for this event.' });
    }

    const tickets = await db.getTicketsByEvent(event.id);
    const { search } = req.query;

    let filtered = tickets;
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = tickets.filter(t => 
        (t.buyerName && t.buyerName.toLowerCase().includes(q)) ||
        (t.ticketHolderName && t.ticketHolderName.toLowerCase().includes(q)) ||
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.transactionId && t.transactionId.toLowerCase().includes(q))
      );
    }

    // Summary calculations
    let grossRevenue = 0;
    tickets.forEach(t => {
      grossRevenue += parseFloat(t.ticketPrice || 0);
    });

    const commission = Math.round(grossRevenue * 0.03 * 100) / 100;
    const creatorNetEarnings = Math.round((grossRevenue - commission) * 100) / 100;

    return res.json({
      success: true,
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        ticketTypes: event.ticketTypes
      },
      stats: {
        totalTicketsSold: tickets.length,
        grossRevenue,
        commission,
        creatorNetEarnings
      },
      attendees: filtered
    });
  } catch (error) {
    console.error('[Get Attendees Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to load attendees.' });
  }
});

// ============================================================
// 4. TICKET PURCHASE (Atomic Deduct, 3% Commission, QR Token)
// ============================================================
router.post('/:id/purchase', authenticateToken, async (req, res) => {
  try {
    const { ticketTypeId, ticketHolderName, pin } = req.body;

    if (!ticketTypeId) {
      return res.status(400).json({ success: false, message: 'Ticket type selection is required.' });
    }

    // Load Event
    const event = await db.getEventById(req.params.id);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (event.status !== 'published') {
      return res.status(400).json({ success: false, message: 'This event is not published or active for ticket sales.' });
    }

    // Check sales dates if configured
    const now = new Date();
    if (event.salesStartDate && new Date(event.salesStartDate) > now) {
      return res.status(400).json({
        success: false,
        message: `Ticket sales have not started yet. Sales open on ${new Date(event.salesStartDate).toLocaleString()}.`
      });
    }
    if (event.salesEndDate && new Date(event.salesEndDate) < now) {
      return res.status(400).json({
        success: false,
        message: 'Ticket sales for this event have ended.'
      });
    }

    // Locate Ticket Type
    const ticketTypeIndex = (event.ticketTypes || []).findIndex(t => t.id === ticketTypeId);
    if (ticketTypeIndex === -1) {
      return res.status(400).json({ success: false, message: 'Selected ticket type does not exist.' });
    }

    const ticketType = event.ticketTypes[ticketTypeIndex];
    const qtyAvailable = parseInt(ticketType.quantityAvailable, 10) || 0;
    const qtySold = parseInt(ticketType.quantitySold, 10) || 0;

    // Prevent overselling
    if (qtySold >= qtyAvailable) {
      return res.status(400).json({
        success: false,
        message: `Sorry, tickets for "${ticketType.name}" are completely sold out!`
      });
    }

    const ticketPrice = parseFloat(ticketType.price) || 0;

    // Load fresh Buyer
    const buyer = await db.getUserById(req.user.id);
    if (!buyer) {
      return res.status(404).json({ success: false, message: 'Buyer account not found.' });
    }

    // Verify 4-digit PIN if required
    if (ticketPrice > 0) {
      if (!buyer.transactionPinHash) {
        return res.status(400).json({
          success: false,
          message: 'Please set up your 4-digit Transaction PIN in Settings before purchasing tickets.'
        });
      }

      if (!pin) {
        return res.status(400).json({ success: false, message: 'Transaction PIN is required to authorize purchase.' });
      }

      const isPinValid = await bcrypt.compare(pin.toString(), buyer.transactionPinHash);
      if (!isPinValid) {
        return res.status(400).json({ success: false, message: 'Invalid Transaction PIN.' });
      }

      // Check balance
      const buyerBalance = parseFloat(buyer.walletBalance || 0);
      if (buyerBalance < ticketPrice) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You have ₦${buyerBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, required: ₦${ticketPrice.toLocaleString('en-NG', { minimumFractionDigits: 2 })}. Please fund your wallet to continue.`,
          requiredAmount: ticketPrice,
          currentBalance: buyerBalance
        });
      }
    }

    // Commission Accounting: 3% STRICTWALLET fee, 97% Creator Earnings
    const commissionFee = Math.round(ticketPrice * 0.03 * 100) / 100;
    const creatorEarnings = Math.round((ticketPrice - commissionFee) * 100) / 100;

    // 1. Server-side Atomic Deductions
    if (ticketPrice > 0) {
      buyer.walletBalance = Math.round((parseFloat(buyer.walletBalance) - ticketPrice) * 100) / 100;
      await db.saveUser(buyer);
    }

    // 2. Increment ticket quantity sold
    event.ticketTypes[ticketTypeIndex].quantitySold = qtySold + 1;
    await db.updateEvent(event.id, { ticketTypes: event.ticketTypes });

    // 3. Credit Event Creator's Organizer Wallet
    if (creatorEarnings > 0) {
      await db.creditOrganizerWallet(event.creatorId, creatorEarnings);
    }

    // 4. Generate Unique Ticket ID & QR Verification Token
    const safeSlugPart = (event.slug || 'EVT').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    const ticketId = `TKT-${safeSlugPart}-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const qrToken = `SEC-QR-${uuidv4()}`;
    const txId = `TXN-EVT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const resolvedHolderName = (ticketHolderName && ticketHolderName.trim().length > 0)
      ? ticketHolderName.trim()
      : buyer.fullName;

    const newTicket = {
      id: ticketId,
      qrToken,
      eventId: event.id,
      eventName: event.title,
      eventSlug: event.slug,
      eventVenue: event.venue,
      eventDate: event.date,
      eventTime: event.time,
      bannerUrl: event.bannerUrl,
      ticketDesignUrl: event.ticketDesignUrl,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      ticketPrice: ticketPrice,
      commissionFee: commissionFee,
      creatorEarnings: creatorEarnings,
      buyerId: buyer.id,
      buyerName: buyer.fullName,
      buyerEmail: buyer.email,
      ticketHolderName: resolvedHolderName,
      transactionId: txId,
      status: 'valid', // valid | used | cancelled
      usedAt: null,
      verifiedBy: null,
      createdAt: new Date().toISOString()
    };

    await db.createTicket(newTicket);

    // 5. Record Transaction in normal Ledger
    const txRecord = {
      id: txId,
      userId: buyer.id,
      userFullName: buyer.fullName,
      userEmail: buyer.email,
      type: 'event_ticket',
      amount: ticketPrice,
      costPrice: creatorEarnings,
      sellingPrice: ticketPrice,
      profit: commissionFee,
      status: 'Successful',
      description: `Ticket Purchase: "${event.title}" (${ticketType.name}) for ${resolvedHolderName}`,
      ticketId: newTicket.id,
      eventId: event.id,
      createdAt: new Date().toISOString()
    };
    await db.createTransaction(txRecord);

    return res.status(201).json({
      success: true,
      message: 'Ticket purchased successfully!',
      ticket: newTicket,
      receipt: {
        company: 'STRICTWALLET',
        title: 'Payment Receipt',
        eventName: event.title,
        ticketType: ticketType.name,
        ticketHolder: resolvedHolderName,
        amount: ticketPrice,
        transactionId: txId,
        date: newTicket.createdAt,
        status: 'Successful'
      }
    });
  } catch (error) {
    console.error('[Ticket Purchase Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to process ticket purchase.' });
  }
});

// ============================================================
// 5. CUSTOMER "MY TICKETS" & TICKET RETRIEVAL
// ============================================================
router.get('/user/my-tickets', authenticateToken, async (req, res) => {
  try {
    const tickets = await db.getUserTickets(req.user.id);
    return res.json({ success: true, tickets });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve your tickets.' });
  }
});

router.get('/ticket/:id', authenticateToken, async (req, res) => {
  try {
    const ticket = await db.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    // Only buyer, creator, or admin may access
    const event = await db.getEventById(ticket.eventId);
    const isCreator = event && event.creatorId === req.user.id;
    if (ticket.buyerId !== req.user.id && !isCreator && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving ticket.' });
  }
});

// Secure endpoint for shared ticket links
// If requested by the buyer/creator, full ticket is provided.
// If requested by another person/guest, validate ticket existence and return public event details
// so the visitor can view event and purchase their own ticket without leaking private attendee data.
router.get('/ticket-info/:id', async (req, res) => {
  try {
    const ticket = await db.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found or invalid ticket identifier.' });
    }

    const event = await db.getEventById(ticket.eventId);
    if (!event || event.isDeleted) {
      return res.status(404).json({ success: false, message: 'Associated event not found or is no longer available.' });
    }

    let isOwner = false;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'strictwallet_super_secure_jwt_secret_key_2026');
        if (decoded && (decoded.id === ticket.buyerId || decoded.id === event.creatorId || decoded.role === 'admin')) {
          isOwner = true;
        }
      } catch (e) {
        // Ignored, proceed as public/guest
      }
    }

    if (isOwner) {
      return res.json({
        success: true,
        isOwner: true,
        ticket,
        event
      });
    }

    // Non-owner / guest: return safe public event data and the target ticket type
    const safeTicketType = (event.ticketTypes || []).find(tt => tt.id === ticket.ticketTypeId);
    return res.json({
      success: true,
      isOwner: false,
      isPurchasable: event.status === 'published',
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description,
        venue: event.venue,
        date: event.date,
        time: event.time,
        salesStartDate: event.salesStartDate,
        salesEndDate: event.salesEndDate,
        bannerUrl: event.bannerUrl,
        ticketTypes: event.ticketTypes,
        creatorName: event.creatorName,
        status: event.status
      },
      targetTicketTypeId: ticket.ticketTypeId,
      targetTicketTypeName: safeTicketType ? safeTicketType.name : ticket.ticketTypeName
    });
  } catch (error) {
    console.error('[Ticket Info Error]:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving shared ticket details.' });
  }
});

// ============================================================
// 6. QR SCANNER / TICKET VERIFICATION (Event Staff/Creator)
// ============================================================
router.post('/:id/verify-ticket', authenticateToken, async (req, res) => {
  try {
    const { qrToken, ticketId } = req.body;

    if (!qrToken && !ticketId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        message: 'QR code token or Ticket ID is required for verification.'
      });
    }

    const event = await db.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    // Only Event Creator or Admin can verify tickets for this event
    if (event.creatorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: You are not authorized to verify tickets for this event.'
      });
    }

    // Look up ticket by qrToken or ticketId
    let ticket = null;
    if (qrToken) {
      ticket = await db.getTicketByQrToken(qrToken);
    }
    if (!ticket && ticketId) {
      ticket = await db.getTicketById(ticketId);
    }

    if (!ticket) {
      return res.status(404).json({
        success: false,
        code: 'INVALID',
        message: 'INVALID TICKET: No ticket found matching the scanned QR code.'
      });
    }

    // Must belong to this specific event
    if (ticket.eventId !== event.id) {
      return res.status(400).json({
        success: false,
        code: 'WRONG_EVENT',
        message: `INVALID TICKET: This ticket belongs to a different event ("${ticket.eventName}").`
      });
    }

    // Check if already used
    if (ticket.status === 'used') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_USED',
        message: `TICKET ALREADY USED on ${new Date(ticket.usedAt).toLocaleString()}!`,
        ticket: {
          id: ticket.id,
          eventName: ticket.eventName,
          ticketTypeName: ticket.ticketTypeName,
          ticketHolderName: ticket.ticketHolderName,
          usedAt: ticket.usedAt
        }
      });
    }

    if (ticket.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        code: 'CANCELLED',
        message: 'INVALID TICKET: This ticket has been cancelled or refunded.'
      });
    }

    // Mark as USED
    const usedAt = new Date().toISOString();
    ticket.status = 'used';
    ticket.usedAt = usedAt;
    ticket.verifiedBy = req.user.fullName;
    await db.updateTicket(ticket.id, {
      status: 'used',
      usedAt,
      verifiedBy: req.user.fullName
    });

    return res.json({
      success: true,
      code: 'VALID',
      message: 'VALID TICKET: Ticket verified successfully!',
      ticket: {
        id: ticket.id,
        eventName: ticket.eventName,
        ticketTypeName: ticket.ticketTypeName,
        ticketHolderName: ticket.ticketHolderName,
        usedAt: usedAt,
        status: 'used'
      }
    });
  } catch (error) {
    console.error('[Ticket Verification Error]:', error);
    return res.status(500).json({ success: false, message: 'Ticket verification error.' });
  }
});

// ============================================================
// 7. EVENT CREATOR WALLET & STROWALLET WITHDRAWALS
// ============================================================

// Get Organizer Wallet Details & Recent Withdrawals
router.get('/creator/wallet', authenticateToken, async (req, res) => {
  try {
    const wallet = await db.getOrganizerWallet(req.user.id);
    const withdrawals = await db.getUserEventWithdrawals(req.user.id);

    return res.json({
      success: true,
      wallet: {
        balance: parseFloat(wallet.balance || 0),
        totalEarned: parseFloat(wallet.totalEarned || 0),
        totalWithdrawn: parseFloat(wallet.totalWithdrawn || 0)
      },
      withdrawals: withdrawals.slice(0, 50)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load organizer wallet.' });
  }
});

// Get All Event Creator Wallet Withdrawals / Transaction History
router.get('/creator/withdrawals', authenticateToken, async (req, res) => {
  try {
    const withdrawals = await db.getUserEventWithdrawals(req.user.id);
    return res.json({
      success: true,
      withdrawals
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load withdrawal history.' });
  }
});

// Get Single Event Creator Withdrawal by ID
router.get('/creator/withdrawals/:id', authenticateToken, async (req, res) => {
  try {
    const withdrawal = await db.getEventWithdrawalById(req.params.id);
    if (!withdrawal || withdrawal.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Withdrawal transaction not found.' });
    }
    return res.json({
      success: true,
      withdrawal
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load withdrawal transaction.' });
  }
});

// Strowallet Bank Lists
router.get('/withdrawals/banks', async (req, res) => {
  try {
    const result = await strowallet.getBankLists();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load bank list.' });
  }
});

// Strowallet Account Name Lookup
router.post('/withdrawals/verify-account', authenticateToken, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    if (!bankCode || !accountNumber) {
      return res.status(400).json({ success: false, message: 'Bank code and account number are required.' });
    }

    const result = await strowallet.getCustomerName(bankCode, accountNumber.trim());
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to verify account.' });
  }
});

// Process Withdrawal Request
router.post('/withdrawals/request', authenticateToken, async (req, res) => {
  try {
    const {
      amount,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      narration,
      nameEnquiryRef,
      pin
    } = req.body;

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₦100.' });
    }

    if (!bankCode || !accountNumber || !accountName) {
      return res.status(400).json({ success: false, message: 'Bank selection and verified account name are required.' });
    }

    if (!narration || !narration.trim()) {
      return res.status(400).json({ success: false, message: 'Narration is required.' });
    }

    if (!pin) {
      return res.status(400).json({ success: false, message: 'STRICTWALLET Transaction PIN is required.' });
    }

    // Verify User & Transaction PIN
    const user = await db.getUserById(req.user.id);
    if (!user || !user.transactionPinHash) {
      return res.status(400).json({
        success: false,
        message: 'Please set up your 4-digit Transaction PIN in Settings before withdrawing.'
      });
    }

    const isPinValid = await bcrypt.compare(pin.toString(), user.transactionPinHash);
    if (!isPinValid) {
      return res.status(400).json({ success: false, message: 'Invalid Transaction PIN.' });
    }

    // Withdrawal Fee Calculations:
    // Charge to creator = ₦20
    // Provider fee = ₦10
    // STRICTWALLET profit = ₦10
    const charge = 20.00;
    const providerFee = 10.00;
    const profit = 10.00;
    const totalDeduction = Math.round((withdrawAmount + charge) * 100) / 100;

    // Check Organizer Wallet Balance
    const wallet = await db.getOrganizerWallet(user.id);
    const availableBalance = parseFloat(wallet.balance || 0);

    if (availableBalance < totalDeduction) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Event Creator Wallet balance. Available: ₦${availableBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, Required (including ₦20 withdrawal fee): ₦${totalDeduction.toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`
      });
    }

    // 1. Temporarily Debit Organizer Wallet with safe transaction state
    wallet.balance = Math.round((availableBalance - totalDeduction) * 100) / 100;
    await db.saveOrganizerWallet(wallet);

    const withdrawalId = `WTH-EVT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const withdrawalRecord = {
      id: withdrawalId,
      userId: user.id,
      userFullName: user.fullName,
      userEmail: user.email,
      amount: withdrawAmount,
      charge: charge,
      providerFee: providerFee,
      profit: 0, // only credited upon confirmed success
      totalDeducted: totalDeduction,
      bankCode: bankCode,
      bankName: bankName || 'Bank',
      accountNumber: accountNumber.trim(),
      accountName: accountName.trim(),
      narration: narration.trim(),
      nameEnquiryReference: nameEnquiryRef || `NER-${Date.now()}`,
      providerReference: null,
      status: 'Processing',
      createdAt: new Date().toISOString()
    };

    await db.createEventWithdrawal(withdrawalRecord);

    // 2. Execute Transfer via Strowallet API
    const transferResult = await strowallet.requestBankTransfer({
      amount: withdrawAmount,
      bankCode,
      accountNumber: accountNumber.trim(),
      narration: narration.trim(),
      nameEnquiryRef: withdrawalRecord.nameEnquiryReference,
      senderName: 'STRICTWALLET'
    });

    if (transferResult.success) {
      // Transfer Succeeded!
      withdrawalRecord.status = 'Successful';
      withdrawalRecord.providerReference = transferResult.reference;
      withdrawalRecord.profit = profit; // ₦10 confirmed profit
      wallet.totalWithdrawn = Math.round(((parseFloat(wallet.totalWithdrawn) || 0) + withdrawAmount) * 100) / 100;
      await db.saveOrganizerWallet(wallet);
      await db.updateEventWithdrawal(withdrawalRecord.id, withdrawalRecord);

      return res.json({
        success: true,
        message: `Withdrawal of ₦${withdrawAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} transferred successfully!`,
        withdrawal: withdrawalRecord
      });
    } else if (transferResult.status === 'Pending' || transferResult.status === 'Processing') {
      // Transfer Pending / Processing at Provider
      withdrawalRecord.status = transferResult.status;
      withdrawalRecord.providerReference = transferResult.reference;
      await db.updateEventWithdrawal(withdrawalRecord.id, withdrawalRecord);

      return res.json({
        success: true,
        message: `Withdrawal submitted and currently ${transferResult.status.toLowerCase()} with provider.`,
        withdrawal: withdrawalRecord
      });
    } else {
      // Transfer Failed at Provider: Refund Organizer Wallet Immediately
      wallet.balance = Math.round((parseFloat(wallet.balance) + totalDeduction) * 100) / 100;
      await db.saveOrganizerWallet(wallet);

      withdrawalRecord.status = 'Failed';
      withdrawalRecord.profit = 0;
      withdrawalRecord.failureReason = transferResult.message || 'Transfer failed at bank provider';
      await db.updateEventWithdrawal(withdrawalRecord.id, withdrawalRecord);

      return res.status(502).json({
        success: false,
        message: `Transfer failed: ${transferResult.message || 'Bank network error'}. Your wallet balance has been restored.`,
        withdrawal: withdrawalRecord
      });
    }
  } catch (error) {
    console.error('[Withdrawal Request Error]:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while processing withdrawal.' });
  }
});

module.exports = router;
