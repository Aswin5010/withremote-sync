const https = require('https');

const CALENDAR_ID = () => process.env.GCAL_CALENDAR_ID || 'primary';

/**
 * Refresh the OAuth2 access token using Node's native https with keepAlive:false.
 * Gaxios (used by google-auth-library) and Node's native fetch both fail on
 * Render's free tier with "Premature close". Direct https.request bypasses that.
 */
function refreshToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     process.env.GCAL_CLIENT_ID,
      client_secret: process.env.GCAL_CLIENT_SECRET,
      refresh_token: process.env.GCAL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString();

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path:     '/token',
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        agent: new https.Agent({ keepAlive: false }),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(`OAuth: ${json.error_description}`));
            resolve(json.access_token);
          } catch (e) {
            reject(new Error(`Token parse error: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Make a Google Calendar API GET request using native https with keepAlive:false.
 */
function calendarGet(path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path,
        method:  'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        agent:   new https.Agent({ keepAlive: false }),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              const err = new Error(json.error.message || 'Calendar API error');
              err.status = json.error.code;
              return reject(err);
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Calendar API parse error: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function buildEventsUrl(params) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null)
  ).toString();
  return `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID())}/events?${qs}`;
}

/**
 * Full fetch: events within a 1-week window (past 3 days + next 4 days).
 */
async function fetchFull() {
  const accessToken = await refreshToken();
  const records = [];
  let pageToken;
  let nextSyncToken;

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 3);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 4);

  do {
    const url = buildEventsUrl({
      maxResults:   250,
      singleEvents: true,
      orderBy:      'startTime',
      timeMin:      timeMin.toISOString(),
      timeMax:      timeMax.toISOString(),
      pageToken,
    });
    const res = await calendarGet(url, accessToken);
    records.push(...(res.items || []));
    pageToken     = res.nextPageToken;
    nextSyncToken = res.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

/**
 * Incremental fetch: use Google's syncToken to get only changed events.
 * Google returns HTTP 410 when the syncToken is expired — caller handles fallback.
 */
async function fetchIncremental(syncToken) {
  const accessToken = await refreshToken();
  const records = [];
  let pageToken;
  let nextSyncToken;

  do {
    const url = buildEventsUrl({
      maxResults: 250,
      ...(pageToken ? { pageToken } : { syncToken }),
    });
    const res = await calendarGet(url, accessToken);
    records.push(...(res.items || []));
    pageToken     = res.nextPageToken;
    nextSyncToken = res.nextSyncToken;
  } while (pageToken);

  return { records, nextCursor: nextSyncToken };
}

module.exports = { fetchFull, fetchIncremental };
