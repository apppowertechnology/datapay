const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// 1. CREATE SUPPORT TICKET
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { subject, category, message, transactionId } = req.body;

    if (!subject || !category || !message) {
      return res.status(400).json({ success: false, message: 'Subject, category, and message are required.' });
    }

    const ticketSeq = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `SW-2026-${ticketSeq}`;
    const ticketId = `tkt_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

    const user = await db.getUserById(req.user.id);

    const newTicket = {
      id: ticketId,
      ticketNumber: ticketNumber,
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      subject: subject.trim(),
      category: category.trim(),
      transactionId: transactionId ? transactionId.trim() : null,
      status: 'Open', // Open, Pending, Resolved, Closed
      lastMessage: message.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.createSupportTicket(newTicket);

    // Initial user message in thread
    const msgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const newMsg = {
      id: msgId,
      ticketId: ticketId,
      senderId: user.id,
      senderName: user.fullName,
      senderRole: 'user',
      message: message.trim(),
      createdAt: new Date().toISOString()
    };

    await db.addSupportMessage(newMsg);

    return res.status(201).json({
      success: true,
      message: `Support ticket #${ticketNumber} created successfully! Our team will assist you shortly.`,
      ticket: newTicket
    });
  } catch (error) {
    console.error('[Support Create Error]:', error);
    return res.status(500).json({ success: false, message: 'Failed to create support ticket.' });
  }
});

// 2. GET USER TICKETS
router.get('/my-tickets', authenticateToken, async (req, res) => {
  try {
    const tickets = await db.getUserTickets(req.user.id);
    return res.json({
      success: true,
      tickets
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch tickets.' });
  }
});

// 3. GET TICKET MESSAGES (THREAD)
router.get('/ticket/:id', authenticateToken, async (req, res) => {
  try {
    const ticket = await db.getSupportTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    if (ticket.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to view this ticket.' });
    }

    const messages = await db.getMessagesByTicketId(ticket.id);

    return res.json({
      success: true,
      ticket,
      messages
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load ticket conversation.' });
  }
});

// 4. SEND MESSAGE IN TICKET
router.post('/ticket/:id/reply', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content cannot be empty.' });
    }

    const ticket = await db.getSupportTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    if (ticket.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to reply to this ticket.' });
    }

    const user = await db.getUserById(req.user.id);
    const msgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

    const newMsg = {
      id: msgId,
      ticketId: ticket.id,
      senderId: user.id,
      senderName: user.fullName,
      senderRole: user.role === 'admin' ? 'admin' : 'user',
      message: message.trim(),
      createdAt: new Date().toISOString()
    };

    await db.addSupportMessage(newMsg);

    // Update ticket status
    const updateData = {
      lastMessage: message.trim()
    };
    if (user.role === 'admin') {
      updateData.status = 'Pending'; // Waiting on customer response or processed
    } else if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      updateData.status = 'Open'; // Re-opened by user
    }

    await db.updateSupportTicket(ticket.id, updateData);

    return res.json({
      success: true,
      message: 'Reply sent successfully.',
      newMessage: newMsg
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to send reply.' });
  }
});

module.exports = router;
