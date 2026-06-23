const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { action, priceId, email, name, paymentMethodId } = body;

    // ── ACTION: Create Payment Intent ──
    if (action === 'create-intent') {
      const price = await stripe.prices.retrieve(priceId);

      // Find or create customer
      let customer;
      if (email) {
        const customers = await stripe.customers.list({ email, limit: 1 });
        customer = customers.data.length > 0
          ? customers.data[0]
          : await stripe.customers.create({ email, name: name || '' });
      }

      if (price.type === 'recurring') {
        // Subscription - use SetupIntent
        const setupIntent = await stripe.setupIntents.create({
          customer: customer ? customer.id : undefined,
          automatic_payment_methods: { enabled: true },
          usage: 'off_session',
        });
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            clientSecret: setupIntent.client_secret,
            customerId: customer ? customer.id : null,
            type: 'setup'
          })
        };
      } else {
        // One-time payment - enable ALL payment methods automatically
        const pi = await stripe.paymentIntents.create({
          amount: price.unit_amount,
          currency: price.currency || 'usd',
          customer: customer ? customer.id : undefined,
          automatic_payment_methods: { enabled: true },
          metadata: { priceId, name: name || '' }
        });
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            clientSecret: pi.client_secret,
            customerId: customer ? customer.id : null,
            type: 'payment'
          })
        };
      }
    }

    // ── ACTION: Confirm Subscription ──
    if (action === 'confirm-subscription') {
      const { customerId, priceId: pid, paymentMethodId: pmId } = body;

      if (customerId) {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: pmId }
        });
      }

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: pid }],
        default_payment_method: pmId,
        expand: ['latest_invoice.payment_intent'],
      });

      const pi = subscription.latest_invoice.payment_intent;
      if (pi && (pi.status === 'succeeded' || pi.status === 'requires_action')) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: pi.status === 'succeeded',
            requiresAction: pi.status === 'requires_action',
            clientSecret: pi.client_secret
          })
        };
      }
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Subscription failed.' }) };
    }

    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
