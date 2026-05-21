/**
 * Vercel Serverless Function — Notion API Proxy
 * Endpoint: GET /api/notion
 *
 * Queries the "All Projects – Task Board" database and returns
 * normalized task data as JSON.
 */

const https = require('https');

const DB_ID = '606ac8b4-d2f8-470e-9726-0fb3bb500ee0';  // All Projects – Task Board
const NOTION_VERSION = '2022-06-28';

/* ── Notion API helper ── */
function notionRequest(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Notion parse error: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ── Property extractors ── */
function getTitle(p)  { return p?.title?.map(t => t.plain_text).join('') ?? ''; }
function getSel(p)    { return p?.select?.name ?? null; }
function getPeople(p) { return (p?.people ?? []).map(u => u.name ?? 'Unknown'); }
function getDate(p)   { return p?.date?.start ?? null; }
function getNum(p)    { return p?.number ?? null; }
function getUrl(p)    { return p?.url ?? null; }

/* ── Main handler ── */
module.exports = async (req, res) => {
  // CORS — allow any origin (public dashboard)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'NOTION_TOKEN environment variable is not set.' });
    return;
  }

  try {
    /* Paginate through all results (Notion returns max 100 per page) */
    const allPages = [];
    let cursor = undefined;

    do {
      const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const data  = await notionRequest(
        `/v1/databases/${DB_ID}/query`,
        'POST',
        body,
        token
      );

      if (data.object === 'error') {
        res.status(400).json({ error: data.message });
        return;
      }

      allPages.push(...(data.results ?? []));
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    /* Normalize each page into a flat task object */
    const tasks = allPages
      .map(page => {
        const p = page.properties ?? {};
        return {
          id:         page.id,
          url:        page.url,
          taskName:   getTitle(p['Task Name']),
          status:     getSel(p['Status']),
          priority:   getSel(p['Priority']),
          project:    getSel(p['Project']),
          phase:      getSel(p['Phase']),
          sprint:     getSel(p['Sprint']),
          type:       getSel(p['Type']),
          assignees:  getPeople(p['Assignee']),
          startDate:  getDate(p['Start Date']),
          endDate:    getDate(p['End Date']),
          duration:   getNum(p['Duration (days)']),
          info:       getUrl(p['Information']),
        };
      })
      .filter(t => t.taskName); // skip empty/deleted rows

    res.status(200).json({
      tasks,
      total: tasks.length,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[notion api]', err);
    res.status(500).json({ error: err.message });
  }
};
