/**
 * Maps a raw Stripe PaymentIntent or Invoice to the canonical records schema.
 * Both are tagged with _resource by the source fetcher.
 */
function transform(raw) {
  const isInvoice = raw._resource === 'invoice';

  // Stripe stores amounts in smallest currency unit (cents for USD)
  const amount_cents = isInvoice
    ? (raw.amount_paid ?? raw.total ?? 0)
    : (raw.amount ?? 0);

  return {
    source:       'stripe',
    source_id:    `stripe:${raw.id}`,
    record_type:  'payment',
    name:         raw.description || raw.customer_name || null,
    email:        raw.customer_email || raw.receipt_email || null,
    amount_cents,
    status:       raw.status || null,
    event_start:  null,
    event_end:    null,
    occurred_at:  raw.created
                    ? new Date(raw.created * 1000).toISOString()
                    : null,
    raw,
  };
}

module.exports = { transform };
