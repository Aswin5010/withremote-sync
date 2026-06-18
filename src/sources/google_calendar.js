const { google } = require('googleapis');

function getClient() {
  const auth = new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GCAL_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

const CALENDAR_ID = () => process.env.GCAL_CALENDAR_ID || 'primary';

/**
 * Full fetch: get all events from the calendar.
 * Returns nextCursor = Google's nextSyncToken (used for incremental sync).
 */
async function fetchFull() {
  const calendar = getClient();
  const records = [];
  let pageToken;
  let nextSyncToken;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
    });
    records.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

/**
 * Incremental fetch: use Google's syncToken to get only changed events.
 * Google returns HTTP 410 when the syncToken is expired — caller handles fallback.
 */
async function fetchIncremental(syncToken) {
  const calendar = getClient();
  const records = [];
  let pageToken;
  let nextSyncToken;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID(),
      maxResults: 250,
      // syncToken goes on the first page only; subsequent pages use pageToken
      ...(pageToken ? { pageToken } : { syncToken }),
    });
    records.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

module.exports = { fetchFull, fetchIncremental };
