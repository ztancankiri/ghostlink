const WebSocket = require('ws');
const net = require('net');
const { createControlPacket, createDataPacket, createClosePacket, parsePacket } = require('./lib/protocol');

const https = require('https');
const fs = require('fs');

const { parseArgs } = require('util');

const { values } = parseArgs({
    options: {
        port: { type: 'string', short: 'p', default: '8081' },
        host: { type: 'string', short: 'h', default: '0.0.0.0' },
        key: { type: 'string', short: 'k', default: 'certs/server.key' },
        cert: { type: 'string', short: 'c', default: 'certs/server.crt' },
        ca: { type: 'string', short: 'a', default: 'certs/ca.crt' },
    },
});

const PORT = parseInt(values.port || '8081');
const HOST = values.host || '0.0.0.0';
const KEY_PATH = values.key || 'certs/server.key';
const CERT_PATH = values.cert || 'certs/server.crt';
const CA_PATH = values.ca || 'certs/ca.crt';

let server;

if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH) && fs.existsSync(CA_PATH)) {
    console.log('🔒 Security: Enabling mTLS');
    server = https.createServer({
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH),
        ca: fs.readFileSync(CA_PATH),
        requestCert: true,
        rejectUnauthorized: true, // Force mTLS
    });
} else {
    console.warn('⚠️ Security: Certificates not found. Falling back to insecure HTTP!');
    server = require('http').createServer();
}

const wss = new WebSocket.Server({ server });

server.listen(PORT, HOST, () => {
    console.log(`GhostLink Server running on wss://${HOST}:${PORT}`);
});

wss.on('connection', (ws) => {
    console.log('New Relay connected');

    // Map to store active TCP connections: id -> net.Socket
    const sockets = new Map();

    ws.on('message', (message) => {
        // message is a Buffer/ArrayBuffer
        if (!Buffer.isBuffer(message)) {
            // ws might give us an ArrayBuffer or Buffer depending on config, but usually Buffer in Node.
            message = Buffer.from(message);
        }

        const packet = parsePacket(message);

        if (!packet) {
            console.error('Failed to parse packet');
            return;
        }

        if (packet.type === 'CONTROL') {
            handleControl(ws, sockets, packet.payload);
        } else if (packet.type === 'DATA') {
            const socket = sockets.get(packet.id);
            if (socket) {
                console.log(`[${packet.id}] Writing to target: ${packet.data.length} bytes`);
                if (packet.data.length < 200) {
                    console.log(`[${packet.id}] Data content: ${packet.data.toString()}`);
                }
                socket.write(packet.data);
            } else {
                console.log(`[${packet.id}] Socket not found for writing`);
                // Socket might have closed or didn't open yet.
                // Send a close frame back just in case? Or ignore.
                // It's safer to send a close back to sync state if we don't have it.
                ws.send(createClosePacket(packet.id));
            }
        } else if (packet.type === 'CLOSE') {
            const socket = sockets.get(packet.id);
            if (socket) {
                socket.end(); // graceful shutdown
                sockets.delete(packet.id);
            }
        }
    });

    ws.on('close', () => {
        console.log('Relay disconnected, cleaning up sockets');
        for (const [id, socket] of sockets) {
            socket.destroy();
        }
        sockets.clear();
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function handleControl(ws, sockets, payload) {
    if (payload.type === 'OPEN') {
        const { id, host, port } = payload;
        console.log(`[${id}] Opening connection to ${host}:${port}`);

        const socket = net.createConnection({ host, port }, () => {
            console.log(`[${id}] Connected to target`);
            // We could send an OPEN_SUCCESS here if we wanted to be robust
        });

        sockets.set(id, socket);

        socket.on('data', (data) => {
            // Forward data back to WS
            if (ws.readyState === WebSocket.OPEN) {
                console.log(`[${id}] Received ${data.length} bytes from target, forwarding to WS`);
                ws.send(createDataPacket(id, data));
            }
        });

        socket.on('close', () => {
            console.log(`[${id}] Target connection closed`);
            if (ws.readyState === WebSocket.OPEN && sockets.has(id)) {
                ws.send(createClosePacket(id));
            }
            sockets.delete(id);
        });

        socket.on('error', (err) => {
            console.error(`[${id}] Socket error:`, err.message);
            if (ws.readyState === WebSocket.OPEN && sockets.has(id)) {
                ws.send(createClosePacket(id));
            }
            sockets.delete(id);
        });
    }
}
