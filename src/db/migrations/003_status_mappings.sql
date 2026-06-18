CREATE TABLE IF NOT EXISTS status_mappings (
  source            TEXT NOT NULL,
  raw_status        TEXT NOT NULL,
  normalized_status TEXT NOT NULL,
  PRIMARY KEY (source, raw_status)
);

-- Stripe status vocabulary
INSERT INTO status_mappings (source, raw_status, normalized_status) VALUES
  ('stripe', 'paid',           'collected'),
  ('stripe', 'succeeded',      'collected'),
  ('stripe', 'pending',        'pending'),
  ('stripe', 'open',           'pending'),
  ('stripe', 'draft',          'pending'),
  ('stripe', 'failed',         'failed'),
  ('stripe', 'uncollectible',  'failed'),
  ('stripe', 'refunded',       'refunded'),
  ('stripe', 'void',           'voided'),
  ('stripe', 'canceled',       'voided')
ON CONFLICT (source, raw_status) DO NOTHING;

-- HubSpot deal stage vocabulary
INSERT INTO status_mappings (source, raw_status, normalized_status) VALUES
  ('hubspot', 'completed',     'collected'),
  ('hubspot', 'paid',          'collected'),
  ('hubspot', 'closedwon',     'collected'),
  ('hubspot', 'pending',       'pending'),
  ('hubspot', 'contractsent',  'pending'),
  ('hubspot', 'appointmentscheduled', 'pending'),
  ('hubspot', 'qualifiedtobuy', 'pending'),
  ('hubspot', 'presentationscheduled', 'pending'),
  ('hubspot', 'decisionmakerboughtin', 'pending'),
  ('hubspot', 'closedlost',    'failed'),
  ('hubspot', 'voided',        'voided'),
  ('hubspot', 'failed',        'failed')
ON CONFLICT (source, raw_status) DO NOTHING;
