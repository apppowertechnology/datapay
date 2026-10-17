const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { reconcileDepositTransaction, reconcileStrowalletTransfer } = require('../services/paymentReconciliation');

/**
 * Handle incoming Paystack Webhooks with cryptographic HMAC SHA512 signature validation.
 */
async function handlePaystackWebhook(req, res) {
  try {
    const signature = req.headers['x-paystack-signature'];
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error('[Paystack Webhook] PAYSTACK_SECRET_KEY is not configured in environment.');
      return res.status(500).send('Webhook configuration missing.');
    }

    if (!signature) {
      console.warn('[Paystack Webhook] Received webhook request without x-paystack-signature header.');
      return res.status(401).send('Missing signature');
    }

    // Verify cryptographic signature against raw request body
    const rawBodyBuffer = req.rawBody || Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac('sha512', secretKey)
      .update(rawBodyBuffer)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('[Paystack Webhook] HMAC signature mismatch. Request rejected.');
      return res.status(401).send('Invalid signature');
    }

    const eventPayload = req.body;
    const event = eventPayload ? eventPayload.event : null;
    const data = eventPayload ? eventPayload.data : null;

    console.log(`[Paystack Webhook] Event received: ${event}, Reference: ${data ? data.reference : 'N/A'}`);

    // Immediately respond 200 to acknowledge delivery as required by Paystack
    res.status(200).json({ status: 'success', message: 'Webhook received' });

    // Process event asynchronously
    if (data && data.reference) {
      if (event === 'charge.success') {
        let depositKobo;
        if (data.metadata && data.metadata.depositAmount) {
          depositKobo = Math.round(parseFloat(data.metadata.depositAmount) * 100);
        } else if (data.requested_amount && data.requested_amount > 0) {
          depositKobo = data.requested_amount;
        } else {
          depositKobo = data.amount;
        }

        const paystackData = {
          status: data.status,
          amount: depositKobo / 100,
          chargedAmount: data.amount ? data.amount / 100 : (depositKobo / 100),
          fee: data.fees ? data.fees / 100 : 0,
          email: data.customer ? data.customer.email : '',
          channel: data.channel || 'unknown',
          cardType: data.authorization ? (data.authorization.card_type || data.authorization.brand || null) : null,
          bank: data.authorization ? (data.authorization.bank || null) : null,
          paidAt: data.paid_at || data.paidAt || null,
          gatewayResponse: data.gateway_response || 'Successful',
          paystackId: data.id,
          metadata: data.metadata || {},
          raw: data
        };

        await reconcileDepositTransaction({
          reference: data.reference,
          paystackData,
          triggeredBy: 'webhook'
        });
      } else if (event === 'charge.failed') {
        const paystackData = {
          status: 'failed',
          amount: (data.amount || 0) / 100,
          email: data.customer ? data.customer.email : '',
          channel: data.channel || 'unknown',
          gatewayResponse: data.gateway_response || 'Payment failed',
          paystackId: data.id,
          metadata: data.metadata || {},
          raw: data
        };

        await reconcileDepositTransaction({
          reference: data.reference,
          paystackData,
          triggeredBy: 'webhook'
        });
      }
    }
  } catch (error) {
    console.error('[Paystack Webhook Error]:', error);
    if (!res.headersSent) {
      res.status(500).send('Webhook processing error');
    }
  }
}

/**
 * Handle incoming Strowallet Webhooks for Sterling Bank virtual account transfers.
 * Validates payload structure, verifies transaction session, identifies user,
 * applies exactly ₦25 fee, credits wallet atomically, and prevents duplicate processing.
 */
/**
 * Handle incoming Strowallet Webhooks for Sterling Bank virtual account transfers.
 * Validates payload structure, verifies transaction session with Strowallet,
 * identifies user, applies strictly ₦25 fee, credits wallet atomically, and prevents duplicates.
 */
async function handleStrowalletWebhook(req, res) {
  try {
    let payload = req.body;

    // 1. Buffer handling
    if (Buffer.isBuffer(payload)) {
      try {
        payload = JSON.parse(payload.toString('utf8'));
      } catch (_) {}
    }

    // 2. String handling
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (_) {}
    }

    // 3. Fallback to rawBody buffer if body was unparsed
    if ((!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) && req.rawBody) {
      try {
        const rawStr = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody);
        payload = JSON.parse(rawStr);
      } catch (_) {}
    }

    // 4. Handle urlencoded single JSON key artifact: { '{"sessionId":...}': '' }
    if (payload && typeof payload === 'object' && !payload.sessionId && !payload.accountNumber) {
      const keys = Object.keys(payload);
      if (keys.length === 1 && keys[0].trim().startsWith('{') && keys[0].trim().endsWith('}')) {
        try {
          payload = JSON.parse(keys[0]);
        } catch (_) {}
      }
    }

    // 5. Fallback to req.query if body is completely empty
    if ((!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) && req.query && Object.keys(req.query).length > 0) {
      payload = req.query;
    }

    const data = (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object')
      ? payload.data
      : (payload && typeof payload === 'object' && payload.response && typeof payload.response === 'object')
        ? payload.response
        : (payload || {});

    const sessionId = String(
      data.sessionId || data.session_id || data.sessionID || data.reference ||
      payload.sessionId || payload.session_id || payload.sessionID || payload.reference || ''
    ).trim();

    const accountNumber = String(
      data.accountNumber || data.account_number || data.account ||
      payload.accountNumber || payload.account_number || payload.account || ''
    ).trim();

    const amount = data.transactionAmount ?? data.transaction_amount ?? data.amount ??
      payload.transactionAmount ?? payload.transaction_amount ?? payload.amount;

    const settledAmount = data.settledAmount ?? data.settled_amount ??
      payload.settledAmount ?? payload.settled_amount;

    console.log('[Strowallet Webhook] Received transfer notification:', {
      sessionId,
      accountNumber,
      amount,
      settledAmount,
      channelId: data.channelId || payload.channelId || null,
      tranRemarks: data.tranRemarks || payload.tranRemarks || null
    });

    if (!sessionId) {
      return res.status(400).json({ status: 'error', message: 'Invalid webhook payload: missing sessionId' });
    }

    if (!accountNumber) {
      return res.status(400).json({ status: 'error', message: 'Invalid webhook payload: missing accountNumber' });
    }

    // Process reconciliation idempotently with mutex locking & session verification
    const result = await reconcileStrowalletTransfer(payload);

    if (result.success) {
      return res.status(200).json({
        status: 'success',
        message: result.message || 'Transfer processed successfully',
        sessionId: sessionId
      });
    } else if (result.alreadyCredited) {
      return res.status(200).json({
        status: 'success',
        message: 'Transfer has already been processed.',
        sessionId: sessionId
      });
    } else if (result.timeout) {
      return res.status(504).json({
        status: 'error',
        message: 'Provider verification timed out. Delivery will be retried.'
      });
    } else if (result.unconfirmed) {
      console.warn('[Strowallet Webhook] Unconfirmed transaction rejected:', result.message);
      return res.status(200).json({
        status: 'rejected',
        message: result.message || 'Transaction unconfirmed by provider.'
      });
    } else {
      console.warn('[Strowallet Webhook] Reconciliation non-success:', result.message);
      return res.status(200).json({
        status: 'acknowledged',
        message: result.message || 'Notification received and recorded.'
      });
    }
  } catch (error) {
    console.error('[Strowallet Webhook Error]:', error);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: 'Internal server error processing Strowallet webhook' });
    }
  }
}

// Verification / Probe endpoints for provider dashboard URL testing
router.get('/strowallet', (req, res) => {
  res.status(200).json({ status: 'success', message: 'STRICTWALLET Strowallet Webhook endpoint is active and listening.' });
});

router.get('/', (req, res) => {
  res.status(200).json({ status: 'success', message: 'STRICTWALLET Webhook gateway is active and listening.' });
});

// Dedicated routes
router.post('/strowallet', handleStrowalletWebhook);
router.post('/paystack', handlePaystackWebhook);

// Universal root webhook route: intelligently dispatch based on payload signatures
router.post('/', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  const data = (body && typeof body === 'object' && body.data && typeof body.data === 'object') ? body.data : body;

  const isStrowallet = data && (
    data.sessionId || data.session_id || data.sessionID ||
    data.accountNumber || data.account_number ||
    data.initiationTranRef || data.sourceAccountNumber ||
    data.settlementId || data.tranRemarks ||
    (typeof data.channelId === 'string' && data.channelId.includes('STERLING'))
  );

  if (isStrowallet) {
    return handleStrowalletWebhook(req, res);
  }
  return handlePaystackWebhook(req, res);
});

module.exports = router;
