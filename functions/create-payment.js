const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { priceId, email, name, paymentMethodId } = JSON.parse(event.body);

    // Validate inputs
    if (!priceId || !email || !paymentMethodId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Create or find customer
    const customers = await stripe.customers.list({ email: email, limit: 1 });
    let customer;
    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: email,
        name: name,
        payment_method: paymentMethodId,
      });
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // Check if one-time or subscription
    const price = await stripe.prices.retrieve(priceId);

    let result;

    if (price.type === 'recurring') {
      // Monthly subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription'
        },
        expand: ['latest_invoice.payment_intent'],
      });

      const paymentIntent = subscription.latest_invoice.payment_intent;

      if (paymentIntent.status === 'requires_action') {
        result = {
          requiresAction: true,
          clientSecret: paymentIntent.client_secret
        };
      } else if (paymentIntent.status === 'succeeded') {
        result = { success: true };
      } else {
        result = { error: 'Payment failed. Please try again.' };
      }

    } else {
      // One-time payment
      const paymentIntent = await stripe.paymentIntents.create({
        amount: price.unit_amount,
        currency: price.currency,
        customer: customer.id,
        payment_method: paymentMethodId,
        confirm: true,
        return_url: 'https://nextupenterprise.com/welcome-confirmed-nue2026.html',
        metadata: { priceId: priceId, name: name }
      });

      if (paymentIntent.status === 'requires_action') {
        result = {
          requiresAction: true,
          clientSecret: paymentIntent.client_secret
        };
      } else if (paymentIntent.status === 'succeeded') {
        result = { success: true };
      } else {
        result = { error: 'Payment failed. Please try again.' };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://nextupenterprise.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result)
    };

  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': 'https://nextupenterprise.com' },
      body: JSON.stringify({ error: err.message || 'Payment failed. Please try again.' })
    };
  }
};
