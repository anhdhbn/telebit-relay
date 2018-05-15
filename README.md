| Sponsored by [ppl](https://ppl.family) | **Telebit Relay** | [Telebit](https://git.coolaj86.com/coolaj86/tunnel-client.js) |
# Telebit&trade;

A server that works in combination with [stunnel.js](https://git.coolaj86.com/coolaj86/tunnel-client.js)
to allow you to serve http and https from any computer, anywhere through a secure tunnel.

CLI
===

Installs as `stunnel.js` with the alias `jstunnel`
(for those that regularly use `stunnel` but still like commandline completion).

### Install

```bash
npm install -g stunneld
```

Then `dist/etc/systemd/system/stunneld.service` should be copied to `/etc/systemd/system/stunneld.service` and
the ARGUMENTS, such as SECRET, MUST BE CHANGED.

*TODO*: make `--config /path/to/config` the only argument (and have the secret auto-generated on first run?)

## Note: Use node.js v8.x

There is a bug in node v9.x that causes stunneld to crash.

https://github.com/nodejs/node/issues/20241

### Advanced Usage

How to use `stunnel.js` with your own instance of `stunneld.js`:

```bash
stunneld.js --servernames tunnel.example.com --protocols wss --secret abc123
```

Options

```
--secret          the same secret used by stunnel client (used for authentication)
--serve           comma separated list of <proto>:<servername>:<port> to which
                  incoming http and https should be forwarded
```

### Privileged Ports without sudo

```bash
# Linux
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

### Alterntive Methods

**NOT YET IMPLEMENTED**

We created this for anyone to use on their own server or VPS,
but those generally cost $5 - $20 / month and so it's probably
cheaper to purchase data transfer (which we supply, obviously),
which is only $1/month for most people.

Just use the client ([stunnel.js](https://git.coolaj86.com/coolaj86/tunnel-client.js))
with this tunneling service (the default) and save yourself the monthly fee
by only paying for the data you need.

	* Node WS Tunnel (zero setup)
	* Heroku (zero cost)
	* Chunk Host (best deal per TB/month)

Security
========

The bottom line: As with everything in life, there is no such thing as anonymity
or absolute security. Only use stunneld services that you trust. :D

Even though the traffic is encrypted end-to-end, you can't just trust any stunneld service
willy-nilly.

A man-in-the-middle attack is possible using Let's Encrypt since an evil stunneld service
would be able to complete the http-01 and tls-sni-01 challenges without a problem
(since that's where your DNS is pointed when you use the service).

Also, the traffic could still be copied and stored for decryption is some era when quantum
computers exist (probably never).
