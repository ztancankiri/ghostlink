#!/bin/bash
mkdir -p certs
cd certs

# 1. Generate CA Key and Cert
openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt -subj "/CN=GhostLink CA"

# 2. Generate Server Key and CSR
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=localhost"

# 3. Sign Server CSR with CA
openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key -set_serial 01 -out server.crt

# 4. Generate Client Key and CSR
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=GhostLink Relay"

# 5. Sign Client CSR with CA
openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -set_serial 02 -out client.crt

# 6. Set permissions
chmod 600 *.key

echo "Cookies... I mean Certificates generated in certs/"
