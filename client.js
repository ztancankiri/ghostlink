const WebSocket = require('ws');
const net = require('net');
const { createControlPacket, createDataPacket, createClosePacket, parsePacket } = require('./lib/protocol');

const fs = require('fs');
const { parseArgs } = require('util');

const { values } = parseArgs({
    options: {
        port: { type: 'string', short: 'p', default: '8080' },
        host: { type: 'string', short: 'h', default: '127.0.0.1' }, // Default to localhost for security
        tunnel: { type: 'string', short: 't', default: 'wss://localhost:8081' }, // Default to wss://
        key: { type: 'string', short: 'k', default: 'certs/client.key' },
        cert: { type: 'string', short: 'c', default: 'certs/client.crt' },
        ca: { type: 'string', short: 'a', default: 'certs/ca.crt' },
        // Strict not supported in node 18.5
    },
});

const PROXY_PORT = parseInt(values.port || '8080');
const PROXY_HOST = values.host || '127.0.0.1';
const TUNNEL_URL = (values.tunnel || 'wss://localhost:8081').replace('ws://', 'wss://');
const KEY_PATH = values.key || 'certs/client.key';
const CERT_PATH = values.cert || 'certs/client.crt';
const CA_PATH = values.ca || 'certs/ca.crt';

// Helper to get WS options
function getWsOptions() {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH) && fs.existsSync(CA_PATH)) {
        console.log('🔒 Security: Enabling mTLS for connection');
        return {
            key: fs.readFileSync(KEY_PATH),
            cert: fs.readFileSync(CERT_PATH),
            ca: fs.readFileSync(CA_PATH),
            rejectUnauthorized: true, // Verify server cert
        };
    } else {
        console.warn('⚠️ Security: Certificates not found. Attempting insecure connection, this might fail if server requires mTLS!');
        // return {}; 
        // For self-signed certs without mTLS locally, we might need rejectUnauthorized: false?
        // But if server is robust, it requires mTLS.
        return { rejectUnauthorized: false };
    }
}

let ws;
let packetQueue = [];
const streams = new Map();
let nextId = 1;

function connectToTunnel() {
    console.log(`Connecting to Tunnel Server at ${TUNNEL_URL}...`);
    ws = new WebSocket(TUNNEL_URL, getWsOptions());

    ws.on('open', () => {
        console.log('Connected to Tunnel Server');
        flushQueue();
    });

    ws.on('message', (message) => {
        if (!Buffer.isBuffer(message)) message = Buffer.from(message);
        const packet = parsePacket(message);
        if (!packet) return;

        if (packet.type === 'DATA') {
            const stream = streams.get(packet.id);
            if (stream && stream.socket && !stream.socket.destroyed) {
                stream.socket.write(packet.data);
            }
        } else if (packet.type === 'CLOSE') {
            const stream = streams.get(packet.id);
            if (stream && stream.socket) {
                stream.socket.end();
            }
            streams.delete(packet.id);
        }
    });

    ws.on('close', () => {
        console.log('Tunnel Connection closed. Reconnecting...');
        setTimeout(connectToTunnel, 3000);
    });

    ws.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.error(`❌ Connection Failed: Could not connect to Tunnel Server at ${TUNNEL_URL}`);
            console.error(`   Ensure the server is running and accessible.`);
        } else {
            console.error('⚠️ Tunnel Error:', err.message);
        }
    });
}

function sendPacket(packet) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(packet);
    } else {
        packetQueue.push(packet);
    }
}

function flushQueue() {
    while (packetQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(packetQueue.shift());
    }
}

connectToTunnel();

const server = net.createServer((clientSocket) => {
    // We need to peek at the first data to determine destination
    clientSocket.once('data', (data) => {
        const dataStr = data.toString();
        const lines = dataStr.split('\r\n');
        const requestLine = lines[0];
        const parts = requestLine.split(' ');
        const method = parts[0];
        const url = parts[1]; // for CONNECT this is host:port, for GET it is http://host/path

        if (method === 'CONNECT') {
            // HTTPS Tunneling
            // CONNECT host:port HTTP/1.1
            const targetParts = url.split(':');
            const host = targetParts[0];
            const port = parseInt(targetParts[1]) || 443;

            const id = nextId++;
            console.log(`[${id}] HTTPS CONNECT ${host}:${port}`);
            streams.set(id, { socket: clientSocket });

            sendPacket(createControlPacket('OPEN', { id, host, port }));

            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

            clientSocket.on('data', (chunk) => {
                sendPacket(createDataPacket(id, chunk));
            });

            clientSocket.on('end', () => {
                console.log(`[${id}] Client disconnected (CONNECT)`);
                sendPacket(createClosePacket(id));
                streams.delete(id);
            });

            clientSocket.on('error', (err) => {
                sendPacket(createClosePacket(id));
                streams.delete(id);
            });

        } else {
            // HTTP Proxy
            // GET http://example.com/foo HTTP/1.1
            // We need to extract Host
            let host, port = 80;

            // Try to parse URL from request line
            try {
                const u = new URL(url);
                host = u.hostname;
                port = parseInt(u.port) || 80;
            } catch (e) {
                // Fallback: search Host header
                const hostLine = lines.find(l => l.toLowerCase().startsWith('host:'));
                if (hostLine) {
                    const val = hostLine.split(':')[1].trim();
                    // handle host:port
                    if (val.includes(':')) {
                        host = val.split(':')[0];
                        port = parseInt(val.split(':')[1]) || 80;
                    } else {
                        host = val;
                    }
                }
            }

            if (!host) {
                clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
                return;
            }

            const id = nextId++;
            console.log(`[${id}] HTTP Request ${method} ${host}:${port}`);
            streams.set(id, { socket: clientSocket });

            sendPacket(createControlPacket('OPEN', { id, host, port }));

            // Rewrite Request Line to be relative path if needed
            // Proxy implementations usually convert absolute URI to relative path for the upstream server
            // But if we just look at the raw buffer... `data` contains the full request.
            // We should modify it.

            let modifiedData = dataStr;

            // 1. Convert absolute URI to relative path in Request Line
            // GET http://example.com/foo -> GET /foo
            // Find the first line
            const firstLineEnd = dataStr.indexOf('\r\n');
            if (firstLineEnd > 0) {
                let reqLine = dataStr.substring(0, firstLineEnd);
                const reqParts = reqLine.split(' ');
                if (reqParts[1].startsWith('http://')) {
                    try {
                        const u = new URL(reqParts[1]);
                        const path = u.pathname + u.search;
                        reqLine = `${reqParts[0]} ${path} ${reqParts[2]}`;
                        modifiedData = reqLine + dataStr.substring(firstLineEnd);
                    } catch (e) { }
                }
            }

            // 2. Remove Proxy-Connection?
            // Simple string replace (risky but okay for MVP)
            modifiedData = modifiedData.replace(/Proxy-Connection: .+\r\n/gi, '');

            sendPacket(createDataPacket(id, Buffer.from(modifiedData)));

            clientSocket.on('data', (chunk) => {
                sendPacket(createDataPacket(id, chunk));
            });

            clientSocket.on('end', () => {
                console.log(`[${id}] Client disconnected (HTTP)`);
                sendPacket(createClosePacket(id));
                streams.delete(id);
            });

            clientSocket.on('error', (err) => {
                console.error(`[${id}] Client error (HTTP):`, err.message);
                sendPacket(createClosePacket(id));
                streams.delete(id);
            });
        }
    });
});

server.listen(PROXY_PORT, PROXY_HOST, () => {
    console.log(`GhostLink Relay running on ${PROXY_HOST}:${PROXY_PORT}`);
});
