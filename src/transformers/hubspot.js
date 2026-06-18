/**
 * Maps a raw HubSpot contact object to the canonical records schema.
 */
function transform(raw) {
  const p = raw.properties || {};
  const nameParts = [p.firstname, p.lastname].filter(Boolean);

  return {
    source:       'hubspot',
    source_id:    `hubspot:${raw.id}`,
    record_type:  'contact',
    name:         nameParts.length ? nameParts.join(' ') : null,
    email:        p.email || null,
    amount_cents: null,
    status:       p.dealstage || null,
    event_start:  null,
    event_end:    null,
    occurred_at:  p.lastmodifieddate
                    ? new Date(p.lastmodifieddate).toISOString()
                    : p.createdate
                      ? new Date(p.createdate).toISOString()
                      : null,
    raw,
  };
}

module.exports = { transform };
