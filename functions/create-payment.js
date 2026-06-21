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
    const { action, priceId, email, name, paymentMethodId, clientSecret } = body;

    // ── ACTION 1: Create Payment Intent (called on page load) ──
    if (action === 'create-intent') {
      const price = await stripe.prices.retrieve(priceId);

      // Find or create customer
      const customers = await stripe.customers.list({ email: email || 'guest@nextupenterprise.com', limit: 1 });
      let customer;
      if (customers.data.length > 0) {
        customer = customers.data[0];
      } else {
        customer = await stripe.customers.create({ email: email || 'guest@nextupenterprise.com', name: name || 'Client' });
      }

      if (price.type === 'recurring') {
        // For subscriptions, create a SetupIntent first
        const setupIntent = await stripe.setupIntents.create({
          customer: customer.id,
          payment_method_types: ['card'],
          usage: 'off_session',
        });
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            clientSecret: setupIntent.client_secret,
            customerId: customer.id,
            type: 'setup'
          })
        };
      } else {
        // One-time payment intent
        const pi = await stripe.paymentIntents.create({
          amount: price.unit_amount,
          currency: price.currency,
          customer: customer.id,
          payment_method_types: ['card', 'link'],
          metadata: { priceId: priceId }
        });
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            clientSecret: pi.client_secret,
            customerId: customer.id,
            type: 'payment'
          })
        };
      }
    }

    // ── ACTION 2: Confirm subscription after setup ──
    if (action === 'confirm-subscription') {
      const { customerId, priceId: pid, paymentMethodId: pmId } = body;

      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: pmId }
      });

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: pid }],
        default_payment_method: pmId,
        expand: ['latest_invoice.payment_intent'],
      });

      const pi = subscription.latest_invoice.payment_intent;
      if (pi && pi.status === 'succeeded') {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
      } else {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Subscription failed.' }) };
      }
    }

    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
