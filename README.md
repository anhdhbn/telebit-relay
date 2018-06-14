# Telebit Relay

Friends don't let friends localhost&trade;

A server that works in combination with [Telebit Remote](https://git.coolaj86.com/coolaj86/telebit.js)
to allow you to serve http and https from any computer, anywhere through a secure tunnel.

| Sponsored by [ppl](https://ppl.family) | **Telebit Relay** | [Telebit Remote](https://git.coolaj86.com/coolaj86/telebit.js) |

Features
========

* [x] Expose your bits even in the harshest of network environments
  * [x] NAT, Home Routers
  * [x] College Dorms, HOAs
  * [x] Corporate Firewalls, Public libraries, Airports
  * [x] and even Airplanes, yep
* [x] Automated HTTPS (Free SSL)

Install
=======

Mac & Linux
-----------

Open Terminal and run this install script:

```bash
curl -fsSL https://get.telebit.cloud/relay | bash
```

Of course, feel free to inspect the install script before you run it.

This will install Telebit Relay to `/opt/telebit-relay` and
put a symlink to `/opt/telebit-relay/bin/telebit-relay` in `/usr/local/bin/telebit-relay`
for convenience.

You can customize the installation:

```bash
export NODEJS_VER=v10.2
export TELEBIT_RELAY_PATH=/opt/telebit-relay
curl -fsSL https://get.telebit.cloud/relay
```

That will change the bundled version of node.js is bundled with Telebit Relay
and the path to which Telebit Relay installs.

You can get rid of the tos + email and server domain name prompts by providing them right away:

```bash
curl -fsSL https://get.telebit.cloud/relay | bash -- jon@example.com telebit-relay.example.com
```

Windows & Node.js
-----------------

1. Install [node.js](https://nodejs.org)
2. Open _Node.js_
2. Run the command `npm install -g telebit-relay`

**Note**: Use node.js v8.x or v10.x

There is [a bug](https://github.com/nodejs/node/issues/20241) in node v9.x that causes telebit-relay to crash.

Manually Install
-----------

```bash
git clone https://git.coolaj86.com/coolaj86/telebit-relay.js.git telebit-relay

# we're very picky to due to bugs in various versions of v8, v9, and v10
export NODEJS_VER="v10.2.1"

# We can keep everything self-contained
export NPM_CONFIG_PREFIX=/opt/telebit-relay
export NODE_PATH=/opt/telebit-relay/lib/node_modules

curl -fsSL https://bit.ly/node-installer | bash -s -- --no-dev-deps

pushd /opt/telebit-relay
  bin/node bin/npm install
  rsync -a examples/telebit-relay.yml etc/telebit-relay.yml
  rsync -a dist/etc/systemd/system/telebit-relay.service /etc/systemd/system/telebit-relay.service
popd

# IMPORTANT: Season to taste
edit /opt/telebit-relay/etc/telebit-relay.yml

adduser --home /opt/telebit-relay --gecos '' --disabled-password telebit >/dev/null 2>&1

systemctl daemon-reload
systemctl restart telebit-relay

systemctl status telebit-relay
journalctl -xefu telebit-relay
```

Usage
====

```bash
telebit-relay --config /opt/telebit-relay/etc/telebit-relay.yml
```

Options

`/opt/telebit-relay/etc/telebit-relay.yml:`
```
email: 'jon@example.com'       # must be valid (for certificate recovery and security alerts)
agree_tos: true                # agree to the Telebit, Greenlock, and Let's Encrypt TOSes
community_member: true         # receive infrequent relevant but non-critical updates
telemetry: true                # contribute to project telemetric data
secret: ''                     # JWT authorization secret. Generate like so:
                               # node -e "console.log(crypto.randomBytes(16).toString('hex'))"
servernames:                   # hostnames that direct to the Telebit Relay admin console
  - telebit-relay.example.com
  - telebit-relay.example.net
vhost: /srv/www/:hostname      # securely serve local sites from this path (or false)
                               # (uses template string, i.e. /var/www/:hostname/public)
greenlock:
  store: le-store-certbot      # certificate storage plugin
  config_dir: /opt/telebit-relay/etc/acme    # directory for ssl certificates
```

Security
========

The bottom line: As with everything in life, there is no such thing as anonymity
or absolute security. Only use Telebit Relays that you trust or self-host. :D

Even though the traffic is encrypted end-to-end, you can't just trust any Telebit Relay
willy-nilly.

A man-in-the-middle attack is possible using Let's Encrypt since an evil Telebit Relay
would be able to complete the http-01 challenges without a problem
(since that's where your DNS is pointed when you use the service).

Also, the traffic could still be copied and stored for decryption is some era when quantum
computers exist (probably never).

Why?
====

We created this for anyone to use on their own server or VPS,
but those generally cost $5 - $20 / month and so it's probably
cheaper to purchase data transfer, which is only $1/month for
most people.

In keeping with our no lock-in policy, we release a version of
the server for anyone to use independently.

TODO show how to do on

	* Node WS Tunnel (zero setup)
	* Heroku (zero cost)
	* Chunk Host (best deal per TB/month)

Useful Tidbits
===

## As a systemd service

`./dist/etc/systemd/system/telebit-relay.service` should be copied to `/etc/systemd/system/telebit-relay.service`.

The user and group `telebit` should be created.

## Use privileged ports without sudo

```bash
# Linux
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```
