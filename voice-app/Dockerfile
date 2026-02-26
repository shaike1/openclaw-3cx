FROM node:20-slim

WORKDIR /app

# Install Python3, gTTS and FLAC (required by SpeechRecognition for Google STT)
RUN apt-get update && apt-get install -y python3 python3-pip flac --no-install-recommends \
    && pip3 install gtts SpeechRecognition gradio_client --break-system-packages \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create audio directory
RUN mkdir -p /app/audio

# HTTP API port
EXPOSE 3000
# WebSocket for audio streaming
EXPOSE 3001

CMD ["node", "index.js"]
