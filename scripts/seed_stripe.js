require('dotenv').config();
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// Covers multiple status vocabulary values for PS2 demo
const scenarios = [
  { amount: 9900,  description: 'Pro plan monthly',       confirm: true  },
  { amount: 4900,  description: 'Basic plan monthly',      confirm: true  },
  { amount: 19900, description: 'Enterprise plan monthly', confirm: true  },
  { amount: 9900,  description: 'Pro plan renewal',        confirm: true  },
  { amount: 4900,  description: 'Canceled subscription',   confirm: false }, // stays 'requires_payment_method'
];

async function seed() {
  console.log('Seeding Stripe test PaymentIntents...');

  const customer = await stripe.customers.create({
    email: 'demo@withremote.test',
    name:  'WithRemote Demo',
  });
  console.log(`  Created customer: ${customer.id}`);

  for (const s of scenarios) {
    try {
      const pi = await stripe.paymentIntents.create({
        amount:   s.amount,
        currency: 'usd',
        customer: customer.id,
        description: s.description,
        ...(s.confirm
          ? {
              payment_method: 'pm_card_visa',
              confirm: true,
              automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            }
          : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' } }),
      });
      console.log(`  Created PI ${pi.id}: "${s.description}" — status=${pi.status}`);
    } catch (err) {
      console.error(`  Failed "${s.description}":`, err.message);
    }
  }

  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
