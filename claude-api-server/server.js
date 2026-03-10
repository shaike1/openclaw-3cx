const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const GATEWAY_HOST = process.env.OPENCLAW_HOST || '127.0.0.1';
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789', 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// In-memory conversation history per callId
const conversations = new Map();
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 min

function pruneOldConversations() {
  const now = Date.now();
  for (const [key, val] of conversations.entries()) {
    if (now - val.updatedAt > CONVERSATION_TTL_MS) conversations.delete(key);
  }
}
setInterval(pruneOldConversations, 5 * 60 * 1000);

function askGateway(messages) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ model: 'main', messages, stream: false });
    const options = {
      hostname: GATEWAY_HOST,
      port: GATEWAY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      timeout: 60000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`gateway_http_${res.statusCode}:${data.slice(0, 300)}`));
        }
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || JSON.stringify(json);
          resolve(String(text));
        } catch {
          resolve(String(data));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

app.post('/ask', async (req, res) => {
  try {
    const { prompt, callId, devicePrompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const key = callId || 'default';
    if (!conversations.has(key)) {
      const messages = [];
      if (devicePrompt) {
        messages.push({ role: 'system', content: devicePrompt });
      }
      conversations.set(key, { messages, updatedAt: Date.now() });
    }
    const conv = conversations.get(key);

    if (devicePrompt && !conv.messages.some((m) => m.role === 'system' && m.content === devicePrompt)) {
      conv.messages.unshift({ role: 'system', content: devicePrompt });
    }

    conv.messages.push({ role: 'user', content: prompt });
    conv.updatedAt = Date.now();

    console.log(`[${key}] ${prompt.substring(0, 60)}...`);
    let response = await askGateway(conv.messages);

    if (/Codex error:/i.test(response) || /"type"\s*:\s*"error"/i.test(response) || /server_error/i.test(response)) {
      console.warn(`[${key}] upstream returned error payload, using fallback reply`);
      response = 'מצטער, הייתה לי תקלה רגעית בתשובה. אפשר לנסות שוב?';
    }

    conv.messages.push({ role: 'assistant', content: response });
    console.log(`-> ${response.substring(0, 60)}...`);
    res.json({ success: true, response, callId });
  } catch (error) {
    console.error('Error:', error.message);
    res.json({ success: true, response: 'מצטער, יש כרגע תקלה זמנית במנוע השיחה. אפשר לנסות שוב בעוד רגע?', callId: req.body?.callId });
  }
});

app.post('/end-session', (req, res) => {
  const { callId } = req.body;
  if (callId) conversations.delete(callId);
  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'openclaw' }));

app.listen(3333, '0.0.0.0', () => console.log('Server on port 3333'));