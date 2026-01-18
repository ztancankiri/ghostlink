#!/bin/bash

# Start Tunnel Server
node server.js > server.log 2>&1 &
SERVER_PID=$!
echo "Started Tunnel Server (PID: $SERVER_PID)"

# Start Proxy Relay
node client.js > client.log 2>&1 &
CLIENT_PID=$!
echo "Started Proxy Relay (PID: $CLIENT_PID)"

sleep 2

echo "--- Testing HTTP Proxy (Example.com) ---"
curl -v -x http://127.0.0.1:8080 http://example.com/ -o /dev/null
HTTP_STATUS=$?

echo "--- Testing HTTPS Proxy (Example.com) ---"
curl -v -x http://127.0.0.1:8080 https://example.com/ -o /dev/null
HTTPS_STATUS=$?

echo "cleaning up..."
kill $SERVER_PID
kill $CLIENT_PID

if [ $HTTP_STATUS -eq 0 ] && [ $HTTPS_STATUS -eq 0 ]; then
    echo "SUCCESS: Both HTTP and HTTPS proxy tests passed."
    exit 0
else
    echo "FAILURE: Tests failed."
    exit 1
fi
