const Stripe = require('stripe');

function getClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
}

async function paginateAll(stripe, resource, params = {}) {
  const records = [];
  let startingAfter;

  do {
    const res = await stripe[resource].list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      ...params,
    });
    records.push(...res.data);
    startingAfter = res.has_more ? res.data[res.data.length - 1].id : undefined;
  } while (startingAfter);

  return records;
}

/**
 * Full fetch: all PaymentIntents and Invoices.
 * Returns nextCursor = current Unix timestamp (seconds).
 */
async function fetchFull() {
  const stripe = getClient();
  const [paymentIntents, invoices] = await Promise.all([
    paginateAll(stripe, 'paymentIntents'),
    paginateAll(stripe, 'invoices'),
  ]);

  return {
    records: [
      ...paymentIntents.map((r) => ({ ...r, _resource: 'payment_intent' })),
      ...invoices.map((r) => ({ ...r, _resource: 'invoice' })),
    ],
    nextCursor: String(Math.floor(Date.now() / 1000)),
  };
}

/**
 * Incremental fetch: only records created after cursor (Unix timestamp string).
 */
async function fetchIncremental(cursor) {
  const stripe = getClient();
  const createdGt = parseInt(cursor, 10);
  const params = { 'created[gt]': createdGt };

  const [paymentIntents, invoices] = await Promise.all([
    paginateAll(stripe, 'paymentIntents', params),
    paginateAll(stripe, 'invoices', params),
  ]);

  return {
    records: [
      ...paymentIntents.map((r) => ({ ...r, _resource: 'payment_intent' })),
      ...invoices.map((r) => ({ ...r, _resource: 'invoice' })),
    ],
    nextCursor: String(Math.floor(Date.now() / 1000)),
  };
}

module.exports = { fetchFull, fetchIncremental };
