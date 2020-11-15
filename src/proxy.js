const net=require("net");
const tls = require("tls");
const { Transform } = require('stream')

class Http2TLSTunnel {
    constructor(listenPort, tlsHost, listenHost = "0.0.0.0", tlsPort=443, protocol="rtsp") {
        this._listenHost = listenHost;
        this._listenPort = listenPort;
        this._targetHost = tlsHost;
        this.tlsPort = tlsPort;
        this._protocol = protocol;
    }

    get listenPort() { return this._listenPort; }
    get targetHost() { return this._targetHost; }
    get listenHost() { return this._listenHost; }
    get server() { return this._server; }
    async start() {

        if (this.server && this.server.listening) return this.server;
        if (this.tlsSocket && this.tlsSocket) {
            try {
                this.tlsSocket.end();
            }
            catch {}
        }
        const host = this._targetHost;
        const protocol = this._protocol;
        const prepender = new Transform({
            transform(chunk, encoding, done) {
                this._rest = this._rest && this._rest.length ? Buffer.concat([this._rest, chunk]) : chunk

                let index

                // As long as we keep finding newlines, keep making slices of the buffer and push them to the
                // readable side of the transform stream
                while ((index = this._rest.indexOf('\n')) !== -1) {
                    // The `end` parameter is non-inclusive, so increase it to include the newline we found
                    const line = this._rest.slice(0, ++index).toString().replace(/[a-zA-Z]{3,6}:\/\/localhost:\d+/, `${protocol}://${host}:443`);
                    // `start` is inclusive, but we are already one char ahead of the newline -> all good
                    this._rest = this._rest.slice(index)
                    // We have a single line here! Prepend the string we want
                    this.push(Buffer.from(line));
                    console.log(line.trimEnd());
                }

                return void done()
            },

            // Called before the end of the input so we can handle any remaining
            // data that we have saved
            flush(done) {
                // If we have any remaining data in the cache, send it out
                if (this._rest && this._rest.length) {
                    return void done(null, this._rest);
                }
            },
        })
        const connectionListener = (tcpSocket) => {
            this.tcpSocket = tcpSocket;
            console.debug("client connected from %s:%d", tcpSocket.remoteAddress, tcpSocket.remotePort);
            console.log(`connecting to: ${this.targetHost}`);

            const tlsOptions = {host: this.targetHost, rejectUnauthorized: false, port:443, timeout: 1000, checkServerIdentity: () => {}}
            //servername: this.targetHost,

            const tlsSocket = tls.connect(tlsOptions);
            tlsSocket.on('secureConnect', function() {
                console.debug("connect to %s:%d success", tlsSocket.remoteAddress, tlsSocket.remotePort);
                if (this._protocol) {
                    tcpSocket.pipe(prepender).pipe(tlsSocket);
                }
                else {
                    tcpSocket.pipe(tlsSocket);
                }

                tlsSocket.pipe(tcpSocket);
            })

            tlsSocket.on("error",  (error) => {
                console.error(error);
                tcpSocket.write("HTTP/1.1 503 service unavailable\r\n\r\n");
                tcpSocket.end();
            });

            tcpSocket.on("error",  (error) => {
                console.debug(error);
                tlsSocket.end();
            });
            tlsSocket.on("close",  (hadError) => {
                tcpSocket.end();
            });
            this.tlsSocket = tlsSocket;
        }

        this._server = net.createServer(connectionListener);

        this._server.listen(this.listenPort, this.listenHost, () => {
            const addr = this._server.address();
            console.debug("listening on %s:%d", addr.address, addr.port);
        });
    }

    async stop() {
        if (this.tcpSocket) {
            try {
                this.tcpSocket.end();
            }
            catch {}
        }
        if (this.tlsSocket) {
            try {
                this.tlsSocket.end();
            }
            catch {}
        }

        if (this._server && this._server.listening) {
            try {
                this._server.close();
            } catch {
            }
        }
    }
}

module.exports = {Http2TLSTunnel}