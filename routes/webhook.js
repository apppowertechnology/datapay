const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Virtual account webhooks and simulations removed. Paystack handles deposits via inline checkout.

module.exports = router;
