#!/bin/bash

# Kill old processes
pkill -f "node server.js"
pkill -f "node client.js"

sleep 1

# Start Server (Secure mTLS)
node server.js -p 8081 -h 0.0.0.0 > server.log 2>&1 &
SERVER_PID=$!
echo "Started GhostLink Server (PID: $SERVER_PID)"

sleep 2

# Start Client (Secure mTLS)
node client.js -p 8080 -h 127.0.0.1 -t wss://localhost:8081 > client.log 2>&1 &
CLIENT_PID=$!
echo "Started GhostLink Relay (PID: $CLIENT_PID)"

sleep 2

echo "--- Testing HTTPS Proxy over mTLS Tunnel ---"
curl -v -x http://127.0.0.1:8080 https://www.google.com -o /dev/null
STATUS=$?

echo "cleaning up..."
kill $SERVER_PID
kill $CLIENT_PID

if [ $STATUS -eq 0 ]; then
    echo "SUCCESS: mTLS Tunnel Established and Proxy functional."
    exit 0
else
    echo "FAILURE: Proxy test failed."
    exit 1
fi
