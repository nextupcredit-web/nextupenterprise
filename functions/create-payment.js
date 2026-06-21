const stripe = require('stripe')('YOUR_NEW_SK_LIVE_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { priceId, email, name, paymentMethodId } = JSON.parse(event.body);

    if (!priceId || !email || !paymentMethodId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Create or find customer
    const customers = await stripe.customers.list({ email: email, limit: 1 });
    let customer;
    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({ email: email, name: name });
    }

    // Attach payment method
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    } catch(e) {}

    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // Get price type
    const price = await stripe.prices.retrieve(priceId);
    let result;

    if (price.type === 'recurring') {
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription'
        },
        expand: ['latest_invoice.payment_intent'],
      });

      const pi = subscription.latest_invoice.payment_intent;
      if (pi.status === 'requires_action') {
        result = { requiresAction: true, clientSecret: pi.client_secret };
      } else if (pi.status === 'succeeded') {
        result = { success: true };
      } else {
        result = { error: 'Payment failed. Please try again.' };
      }

    } else {
      const pi = await stripe.paymentIntents.create({
        amount: price.unit_amount,
        currency: price.currency,
        customer: customer.id,
        payment_method: paymentMethodId,
        confirm: true,
        return_url: 'https://nextupenterprise.com/welcome-confirmed-nue2026.html',
      });

      if (pi.status === 'requires_action') {
        result = { requiresAction: true, clientSecret: pi.client_secret };
      } else if (pi.status === 'succeeded') {
        result = { success: true };
      } else {
        result = { error: 'Payment failed. Please try again.' };
      }
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message || 'Payment failed.' }) };
  }
};
