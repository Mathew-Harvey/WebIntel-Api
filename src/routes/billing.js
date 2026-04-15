const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  findUserByEmail,
  createUser,
  updateUserStripeId,
  createApiKey,
  upgradeUserKeys,
  upsertSubscription,
  findUserById,
} = require('../db');
const { sendWelcomeEmail, sendKeyEmail } = require('../services/email');

const router = express.Router();

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRICE_ID = () => process.env.STRIPE_PRO_PRICE_ID;
const APP_URL = () => process.env.APP_URL || 'https://webintel.dev';

// -------------------------------------------------------
// POST /api/billing/checkout  — create a Stripe Checkout session
// -------------------------------------------------------
router.post('/checkout', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required.' });
    }

    const stripe = getStripe();

    let user = await findUserByEmail(email);
    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
      if (user) {
        await updateUserStripeId(user.id, customerId);
      } else {
        user = await createUser(email, customerId);
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PRICE_ID(), quantity: 1 }],
      success_url: `${APP_URL()}/dashboard.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL()}/#pricing`,
      metadata: { user_email: email },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[billing] Checkout error:', err.message);
    res.status(500).json({ success: false, message: 'Could not create checkout session.' });
  }
});

// -------------------------------------------------------
// POST /api/billing/portal  — Stripe Customer Portal (manage subscription)
// -------------------------------------------------------
router.post('/portal', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

    const user = await findUserByEmail(email);
    if (!user?.stripe_customer_id) {
      return res.status(404).json({ success: false, message: 'No billing account found.' });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${APP_URL()}/dashboard.html`,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[billing] Portal error:', err.message);
    res.status(500).json({ success: false, message: 'Could not open billing portal.' });
  }
});

// -------------------------------------------------------
// POST /api/billing/webhook  — Stripe webhook handler
// Must use raw body (configured in server.js)
// -------------------------------------------------------
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, event.data.object);
        break;

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(stripe, event.data.object);
        break;

      case 'invoice.payment_failed':
        console.warn('[webhook] Payment failed for', event.data.object.customer);
        break;
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${event.type}:`, err.message);
  }

  res.json({ received: true });
});

// -------------------------------------------------------
// Webhook handlers
// -------------------------------------------------------

async function handleCheckoutCompleted(stripe, session) {
  const email = session.customer_details?.email || session.metadata?.user_email;
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!email) {
    console.error('[webhook] No email in checkout session');
    return;
  }

  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser(email, customerId);
  } else if (!user.stripe_customer_id) {
    await updateUserStripeId(user.id, customerId);
  }

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertSubscription(
    user.id,
    subscriptionId,
    sub.items.data[0]?.price?.id,
    sub.status,
    new Date(sub.current_period_end * 1000)
  );

  await upgradeUserKeys(user.id, 'paid');

  const apiKey = 'wi_live_' + uuidv4().replace(/-/g, '');
  await createApiKey(user.id, apiKey, 'paid');

  await sendKeyEmail(email, apiKey, 'paid');
  console.log(`[webhook] Pro key created for ${email}`);
}

async function handleSubscriptionChange(stripe, subscription) {
  const customerId = subscription.customer;

  const customer = await stripe.customers.retrieve(customerId);
  const user = await findUserByEmail(customer.email);
  if (!user) return;

  const status = subscription.status;
  await upsertSubscription(
    user.id,
    subscription.id,
    subscription.items.data[0]?.price?.id,
    status,
    new Date(subscription.current_period_end * 1000)
  );

  if (status === 'canceled' || status === 'unpaid' || status === 'past_due') {
    await upgradeUserKeys(user.id, 'free');
    console.log(`[webhook] Downgraded ${customer.email} to free`);
  } else if (status === 'active') {
    await upgradeUserKeys(user.id, 'paid');
  }
}

module.exports = router;
