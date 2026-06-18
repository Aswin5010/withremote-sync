require('dotenv').config();
const { Client } = require('@hubspot/api-client');

const client = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

const contacts = [
  { firstname: 'Alice',   lastname: 'Johnson',  email: 'alice@acme.com',    dealstage: 'closedwon' },
  { firstname: 'Bob',     lastname: 'Smith',    email: 'bob@beta.io',       dealstage: 'contractsent' },
  { firstname: 'Carol',   lastname: 'Williams', email: 'carol@corp.net',     dealstage: 'closedwon' },
  { firstname: 'David',   lastname: 'Brown',    email: 'david@delta.co',    dealstage: 'closedlost' },
  { firstname: 'Eve',     lastname: 'Davis',    email: 'eve@epsilon.org',   dealstage: 'appointmentscheduled' },
];

async function seed() {
  console.log('Seeding HubSpot contacts...');
  for (const contact of contacts) {
    try {
      const res = await client.crm.contacts.basicApi.create({ properties: contact });
      console.log(`  Created: ${contact.firstname} ${contact.lastname} (id=${res.id})`);
    } catch (err) {
      if (err.code === 409) {
        console.log(`  Already exists: ${contact.email}`);
      } else {
        console.error(`  Failed (${contact.email}):`, err.message);
      }
    }
  }
  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
