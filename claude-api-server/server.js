const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

function askOpenClaw(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ text: prompt });
    const options = {
      hostname: 'YOUR_OPENCLAW_IP',
      port: 18790,
      path: '/conversation/process',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 25000
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.response?.speech?.plain?.speech || JSON.stringify(json);
          resolve(String(text));
        } catch (e) {
          resolve(String(data));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

app.post('/ask', async (req, res) => {
  try {
    const { prompt, callId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    
    console.log(`[${callId || 'x'}] ${prompt.substring(0, 30)}...`);
    const response = await askOpenClaw(prompt);
    console.log(`-> ${response.substring(0, 30)}...`);
    
    res.json({ success: true, response, callId });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/end-session', (req, res) => res.json({ success: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'openclaw' }));

app.listen(3333, '0.0.0.0', () => console.log('Server on port 3333'));
