#!/bin/bash

TARGET=${1:-localhost}
echo "Generating certificates for: $TARGET"

mkdir -p certs
cd certs

# 1. Generate CA Key and Cert
openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt -subj "/CN=GhostLink CA"

# 2. Server Cert Configuration (with SANs)
cat > server.conf <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = $TARGET

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

# Add IP or DNS based on input
if [[ $TARGET =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "IP.2 = $TARGET" >> server.conf
else
    echo "DNS.2 = $TARGET" >> server.conf
fi

# 3. Generate Server Key and CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -config server.conf

# 4. Sign Server CSR with CA and Extensions
openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key -set_serial 01 -out server.crt -extensions v3_req -extfile server.conf

# 5. Generate Client Key and CSR
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=GhostLink Relay"

# 6. Sign Client CSR with CA
openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -set_serial 02 -out client.crt

# 7. Set permissions
chmod 600 *.key

# 8. Cleanup
rm *.csr server.conf

echo "✅ Certificates generated in certs/ for $TARGET"
