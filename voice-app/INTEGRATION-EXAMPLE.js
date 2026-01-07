/**
 * INTEGRATION EXAMPLE
 * How to add outbound calling routes to existing index.js
 *
 * This file shows the minimal changes needed to integrate outbound calling
 * into the existing voice-app on sippycup.
 */

// ============================================================================
// STEP 1: Add imports at the top of index.js
// ============================================================================

// Add after existing require() statements
const { router: outboundRouter, setupRoutes } = require('./lib/outbound-routes');

// ============================================================================
// STEP 2: Register routes after HTTP server and media server are ready
// ============================================================================

// Find the section where HTTP server is created (around line 100-120)
// It should look something like this:

function initializeServers() {
  const fs = require("fs");
  if (!fs.existsSync(config.audio_dir)) {
    fs.mkdirSync(config.audio_dir, { recursive: true });
  }

  // Create HTTP server
  httpServer = createHttpServer(config.http_port, config.audio_dir);

  // *** ADD THIS SECTION HERE ***
  // Register outbound calling routes
  if (srf && mediaServer) {
    setupRoutes({ srf, mediaServer });
    httpServer.app.use('/api', outboundRouter);
    console.log("[" + new Date().toISOString() + "] OUTBOUND Calling routes registered at /api/outbound-call");
  } else {
    console.warn("[" + new Date().toISOString() + "] OUTBOUND Cannot register routes - srf or mediaServer not ready");
  }
  // *** END OF NEW SECTION ***

  // Continue with existing code...
  audioForkServer = new AudioForkServer({ port: config.ws_port, host: '0.0.0.0' });
  audioForkServer.start();
  // ... rest of existing code
}

// ============================================================================
// ALTERNATIVE: If there's no initializeServers() function
// ============================================================================

// Find where both drachtio and FreeSWITCH are connected
// Look for the checkReadyState() function or similar

function checkReadyState() {
  if (drachtioConnected && freeswitchConnected && !isReady) {
    isReady = true;
    console.log("\n" + "=".repeat(64));
    console.log("  ✅ SYSTEM READY - All components connected");
    console.log("=".repeat(64) + "\n");

    // *** ADD THIS SECTION HERE ***
    // Register outbound routes now that everything is ready
    if (srf && mediaServer) {
      setupRoutes({ srf, mediaServer });

      // If HTTP server already exists with Express app
      if (httpServer && httpServer.app) {
        httpServer.app.use('/api', outboundRouter);
        console.log("[" + new Date().toISOString() + "] OUTBOUND Routes registered");
      }
    }
    // *** END OF NEW SECTION ***

    // Continue with existing ready state logic...
  }
}

// ============================================================================
// ALTERNATIVE: If HTTP server is created later in the code
// ============================================================================

// If the HTTP server is created in a different place, find where it's created
// and add the routes immediately after:

httpServer = createHttpServer(config.http_port, config.audio_dir);

// *** ADD THESE LINES ***
setupRoutes({ srf, mediaServer });
httpServer.app.use('/api', outboundRouter);
console.log("[" + new Date().toISOString() + "] OUTBOUND API enabled at /api/outbound-call");
// *** END OF NEW LINES ***

// ============================================================================
// COMPLETE MINIMAL INTEGRATION (if starting fresh)
// ============================================================================

// At the very end of index.js, after everything is set up:

// Register outbound calling API
(function registerOutboundAPI() {
  const { router: outboundRouter, setupRoutes } = require('./lib/outbound-routes');

  // Wait for system to be ready
  const checkInterval = setInterval(() => {
    if (srf && mediaServer && httpServer && httpServer.app) {
      clearInterval(checkInterval);

      setupRoutes({ srf, mediaServer });
      httpServer.app.use('/api', outboundRouter);

      console.log("[" + new Date().toISOString() + "] OUTBOUND Calling API registered");
      console.log("[" + new Date().toISOString() + "] OUTBOUND POST /api/outbound-call is now available");
    }
  }, 100);
})();

// ============================================================================
// TESTING THE INTEGRATION
// ============================================================================

/*
After deploying and restarting:

1. Check logs for confirmation:
   docker-compose logs -f voice-app | grep OUTBOUND

   Expected output:
   [timestamp] OUTBOUND Calling routes registered at /api/outbound-call
   [timestamp] OUTBOUND API enabled at /api/outbound-call

2. Test the endpoint:
   curl http://YOUR_SERVER_LAN_IP:3000/api/calls

   Expected response:
   {"success":true,"count":0,"calls":[]}

3. Make a test call:
   curl -X POST http://YOUR_SERVER_LAN_IP:3000/api/outbound-call \
     -H "Content-Type: application/json" \
     -d '{"to":"+15551234567","message":"Test from your server"}'

   Expected response:
   {"success":true,"callId":"abc-123-uuid","status":"queued","message":"Call initiated"}

4. Check call status:
   curl http://YOUR_SERVER_LAN_IP:3000/api/call/abc-123-uuid

   Expected states: queued → dialing → playing → completed
*/
