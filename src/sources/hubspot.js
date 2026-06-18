const { Client } = require('@hubspot/api-client');

const PROPERTIES = [
  'firstname', 'lastname', 'email',
  'createdate', 'lastmodifieddate', 'dealstage', 'phone',
];

function getClient() {
  return new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
}

/**
 * Full fetch: paginate through all contacts.
 * Returns nextCursor = current ISO timestamp (used as cursor for next incremental).
 */
async function fetchFull() {
  const client = getClient();
  const records = [];
  let after;

  do {
    const res = await client.crm.contacts.basicApi.getPage(100, after, PROPERTIES);
    records.push(...res.results);
    after = res.paging?.next?.after;
  } while (after);

  return { records, nextCursor: new Date().toISOString() };
}

/**
 * Incremental fetch: contacts modified after the cursor timestamp.
 * cursor is an ISO string.
 */
async function fetchIncremental(cursor) {
  const client = getClient();
  const records = [];
  let after;

  const filterGroup = {
    filters: [{
      propertyName: 'lastmodifieddate',
      operator: 'GT',
      value: new Date(cursor).getTime().toString(),
    }],
  };

  do {
    const res = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [filterGroup],
      properties: PROPERTIES,
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
      limit: 100,
      after,
    });
    records.push(...res.results);
    after = res.paging?.next?.after;
  } while (after);

  return { records, nextCursor: new Date().toISOString() };
}

module.exports = { fetchFull, fetchIncremental };
