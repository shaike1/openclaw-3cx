FROM debian:bookworm-slim

# Install 3CX SmartSBC from the official 3CX apt repository
# Only x86_64 (amd64) is supported by 3CX — see ARM64 notes in docs/SETUP.md
RUN apt-get update && \
    apt-get install -y curl gnupg --no-install-recommends && \
    curl -fsSL https://downloads.3cx.com/downloads/misc/3cxsbc.gpg | \
      gpg --dearmor -o /usr/share/keyrings/3cx-sbc.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/3cx-sbc.gpg] https://downloads.3cx.com/repo sbc main" \
      > /etc/apt/sources.list.d/3cxsbc.list && \
    apt-get update && \
    apt-get install -y 3cxsbc --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# The SBC config is volume-mounted from the host at runtime.
# Generate it by running: ./sbc/provision.sh  (see docs/SETUP.md Step 1)
# The file is auto-rewritten by the SBC on each restart — do not edit manually.
VOLUME ["/etc/3cxsbc.conf"]

CMD ["/usr/sbin/3cxsbc", "-m", "/etc/3cxsbc.conf"]
