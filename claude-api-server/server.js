const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const OPENCLAW_HOST = process.env.OPENCLAW_HOST || '127.0.0.1';
const OPENCLAW_PORT = parseInt(process.env.OPENCLAW_PORT || '18790', 10);

function askOpenClaw(prompt, sessionKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: prompt,
      ...(sessionKey ? { session: sessionKey } : {})
    });

    const options = {
      hostname: OPENCLAW_HOST,
      port: OPENCLAW_PORT,
      path: '/conversation/process',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 35000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`upstream_http_${res.statusCode}:${String(data).slice(0, 300)}`));
        }
        try {
          const json = JSON.parse(data);
          const text = json.response?.speech?.plain?.speech || JSON.stringify(json);
          resolve(String(text));
        } catch {
          resolve(String(data));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

app.post('/ask', async (req, res) => {
  try {
    const { prompt, callId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const baseSession = callId ? `claude-phone-${callId}` : 'claude-phone-default';
    console.log(`[${callId || 'x'}] ${prompt.substring(0, 50)}...`);

    let response;
    try {
      response = await askOpenClaw(prompt, baseSession);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('session file locked') || msg.includes('upstream_http_500')) {
        const retrySession = `${baseSession}-retry-${Date.now()}`;
        console.warn(`[${callId || 'x'}] retrying with fresh session due to lock/500`);
        response = await askOpenClaw(prompt, retrySession);
      } else {
        throw e;
      }
    }

    console.log(`-> ${response.substring(0, 50)}...`);
    res.json({ success: true, response, callId });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/end-session', (req, res) => res.json({ success: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'openclaw' }));

app.listen(3333, '0.0.0.0', () => console.log('Server on port 3333'));