/**
 * Maps a raw Google Calendar event to the canonical records schema.
 * Google events can have date-only (all-day) or dateTime fields.
 */
function transform(raw) {
  const startStr = raw.start?.dateTime || raw.start?.date || null;
  const endStr   = raw.end?.dateTime   || raw.end?.date   || null;

  const eventStart = startStr ? new Date(startStr).toISOString() : null;
  const eventEnd   = endStr   ? new Date(endStr).toISOString()   : null;

  return {
    source:       'google_calendar',
    source_id:    `google_calendar:${raw.id}`,
    record_type:  'event',
    name:         raw.summary || null,
    email:        raw.organizer?.email || null,
    amount_cents: null,
    status:       raw.status || null, // 'confirmed' | 'tentative' | 'cancelled'
    event_start:  eventStart,
    event_end:    eventEnd,
    occurred_at:  eventStart || new Date(raw.created || Date.now()).toISOString(),
    raw,
  };
}

module.exports = { transform };
