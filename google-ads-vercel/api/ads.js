export const config = { runtime: 'edge' };

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_URL   = 'https://googleads.googleapis.com/v17';

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Falha ao obter access token');
  return data.access_token;
}

async function adsQuery(accessToken, devToken, customerId, query) {
  const res = await fetch(`${GOOGLE_ADS_URL}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.results || [];
}

export default async function handler(req) {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const body = await req.json();
    const { clientId, clientSecret, refreshToken, customerId, dateRange } = body;

    // Usa env vars se disponíveis, senão usa o que veio do body
    const _clientId     = process.env.GOOGLE_CLIENT_ID     || clientId;
    const _clientSecret = process.env.GOOGLE_CLIENT_SECRET || clientSecret;
    const _refreshToken = process.env.GOOGLE_REFRESH_TOKEN || refreshToken;
    const _customerId   = (process.env.GOOGLE_CUSTOMER_ID  || customerId || '').replace(/-/g, '');
    const _devToken     = process.env.GOOGLE_DEV_TOKEN      || body.devToken;
    const _dateRange    = dateRange || 'LAST_30_DAYS';

    if (!_clientId || !_clientSecret || !_refreshToken || !_customerId || !_devToken) {
      return new Response(JSON.stringify({ error: 'Credenciais incompletas' }), { status: 400, headers });
    }

    const accessToken = await getAccessToken(_clientId, _clientSecret, _refreshToken);

    const [accountRows, campaignRows, kwRows] = await Promise.all([
      adsQuery(accessToken, _devToken, _customerId,
        `SELECT customer.descriptive_name, customer.id FROM customer LIMIT 1`),
      adsQuery(accessToken, _devToken, _customerId,
        `SELECT campaign.name, campaign.status, campaign.advertising_channel_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
         FROM campaign WHERE segments.date DURING ${_dateRange}
         ORDER BY metrics.cost_micros DESC LIMIT 20`),
      adsQuery(accessToken, _devToken, _customerId,
        `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.quality_info.quality_score
         FROM keyword_view WHERE segments.date DURING ${_dateRange}
           AND ad_group_criterion.status != 'REMOVED'
         ORDER BY metrics.cost_micros DESC LIMIT 30`),
    ]);

    return new Response(JSON.stringify({ accountRows, campaignRows, kwRows }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
