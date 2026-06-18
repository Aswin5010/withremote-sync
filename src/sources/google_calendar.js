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
 * Full fetch: get events within a 1-week window (past 3 days + next 4 days).
 * Scoping to a week avoids pulling years of calendar history on first sync.
 * Returns nextCursor = Google's nextSyncToken (used for incremental sync).
 */
async function fetchFull() {
  const calendar = getClient();
  const records = [];
  let pageToken;
  let nextSyncToken;

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 3);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 4);

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
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
