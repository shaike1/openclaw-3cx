#!/usr/bin/env python3
"""
OpenClaw HTTP Bridge for Home Assistant
Acts as an HTTP-to-CLI bridge for OpenClaw agent
"""
from flask import Flask, request, jsonify
import subprocess
import json
import os
import re

app = Flask(__name__)

OPENCLAW_BIN = "/usr/bin/openclaw"
OPENCLAW_TOKEN = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "7a9b03fb34c28205fe90a34f05098e72eecba41d8a81b6b7")

def extract_response_text(output):
    """Extract the actual response text from OpenClaw JSON output"""
    try:
        data = json.loads(output)

        # Try to find the text in various possible locations
        if isinstance(data, dict):
            # Check for payloads array
            if "payloads" in data and isinstance(data["payloads"], list) and len(data["payloads"]) > 0:
                payload = data["payloads"][0]
                if isinstance(payload, dict) and "text" in payload:
                    return payload["text"]

            # Check for direct response/text fields
            for key in ["response", "text", "message", "content", "speech"]:
                if key in data:
                    return str(data[key])

            # Check nested response structure
            if "response" in data and isinstance(data["response"], dict):
                resp = data["response"]
                if "speech" in resp:
                    if isinstance(resp["speech"], dict) and "plain" in resp["speech"]:
                        return resp["speech"]["plain"].get("speech", str(resp["speech"]))
                    return str(resp["speech"])

        # If it's a string, return as-is
        if isinstance(data, str):
            return data

        # Fallback: try to find text-like content
        output_str = str(data)
        # Look for text patterns (common in OpenClaw responses)
        text_match = re.search(r"'text':\s*'([^']+)'", output_str)
        if text_match:
            return text_match.group(1)

        return output_str

    except json.JSONDecodeError:
        # Not JSON, try to extract text from raw output
        # Look for text patterns
        text_match = re.search(r"'text':\s*'([^']+)'", output)
        if text_match:
            return text_match.group(1)
        return output

@app.route("/conversation/process", methods=["POST"])
def process_conversation():
    """
    Home Assistant conversation agent endpoint
    Expected JSON:
    {
        "text": "user message here"
    }
    """
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' field"}), 400

        user_message = data["text"]

        # Run OpenClaw agent with the message
        result = subprocess.run(
            [
                OPENCLAW_BIN,
                "agent",
                "--agent", "main",
                "--message", user_message,
                "--local",
                "--json"
            ],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "OPENCLAW_GATEWAY_TOKEN": OPENCLAW_TOKEN}
        )

        if result.returncode == 0:
            response_text = extract_response_text(result.stdout.strip())

            # Clean up response (remove markdown asterisks if any)
            response_text = response_text.replace("**", "").replace("\\n", "\n")

            # Return in format expected by Home Assistant
            return jsonify({
                "response": {
                    "speech": {
                        "plain": {
                            "speech": response_text,
                            "extra_data": None
                        }
                    },
                    "response_type": "action_done"
                }
            })
        else:
            return jsonify({
                "error": "OpenClaw failed",
                "details": result.stderr
            }), 500

    except subprocess.TimeoutExpired:
        return jsonify({"error": "OpenClaw agent timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "openclaw-http-bridge"})

@app.route("/", methods=["GET"])
def index():
    """Root endpoint with info"""
    return jsonify({
        "service": "OpenClaw HTTP Bridge",
        "version": "1.0.0",
        "endpoints": {
            "conversation/process": "POST - Process conversation",
            "health": "GET - Health check"
        }
    })

if __name__ == "__main__":
    # Listen on all interfaces, including Tailscale
    app.run(host="0.0.0.0", port=18790, ssl_context=None)
