const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { reconcileDepositTransaction } = require('../services/paymentReconciliation');

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

// Support both /api/webhook and /api/webhook/paystack
router.post('/paystack', handlePaystackWebhook);
router.post('/', handlePaystackWebhook);

module.exports = router;
