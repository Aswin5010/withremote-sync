require('dotenv').config();
const { google } = require('googleapis');

function getClient() {
  const auth = new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GCAL_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

const events = [
  { summary: 'Team standup',            daysFromNow: 1,  durationHours: 0.5 },
  { summary: 'Product review',          daysFromNow: 3,  durationHours: 1 },
  { summary: 'Client onboarding call',  daysFromNow: 5,  durationHours: 1 },
  { summary: 'Sprint planning',         daysFromNow: 7,  durationHours: 2 },
  { summary: 'Quarterly business review', daysFromNow: 14, durationHours: 2 },
];

async function seed() {
  const calendar = getClient();
  const calId = process.env.GCAL_CALENDAR_ID || 'primary';

  console.log('Seeding Google Calendar events...');
  for (const ev of events) {
    const start = new Date();
    start.setDate(start.getDate() + ev.daysFromNow);
    start.setMinutes(0, 0, 0);

    const end = new Date(start);
    end.setTime(end.getTime() + ev.durationHours * 3600 * 1000);

    try {
      const res = await calendar.events.insert({
        calendarId: calId,
        requestBody: {
          summary: ev.summary,
          start: { dateTime: start.toISOString() },
          end:   { dateTime: end.toISOString() },
        },
      });
      console.log(`  Created: "${ev.summary}" (id=${res.data.id})`);
    } catch (err) {
      console.error(`  Failed "${ev.summary}":`, err.message);
    }
  }
  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
