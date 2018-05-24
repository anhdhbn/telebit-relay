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
curl -fsS https://get.telebit.cloud/ | bash
```

This will install Telebit Relay to `/opt/telebitd` and
put a symlink to `/opt/telebitd/bin/telebitd` in `/usr/local/bin/telebitd`
for convenience.

You can customize the installation:

```bash
export NODEJS_VER=v8.11.2
export TELEBITD_PATH=/opt/telebitd
curl -fsS https://get.telebit.cloud/ | bash
```

This will change which version of node.js is bundled with Telebit Relay
and the path to which Telebit Relay installs.

Windows & Node.js
-----------------

1. Install [node.js](https://nodejs.org)
2. Open _Node.js_
2. Run the command `npm install -g telebitd`

**Note**: Use node.js v8.x or v10.x

There is [a bug](https://github.com/nodejs/node/issues/20241) in node v9.x that causes telebitd to crash.

Service Install
===

TODO automate this:

`./dist/etc/systemd/system/telebitd.service` should be copied to `/etc/systemd/system/telebitd.service`.

The user and group `telebit` should be created.

**Privileged Ports without sudo**:

```bash
# Linux
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

Usage
====

```bash
telebitd --config /etc/telebit/telebitd.yml
```

Options

`/etc/telebit/telebitd.yml:`
```
servernames:
  - telebit.example.com
  - telebit.example.net
email: 'jon@example.com'
agree_tos: true
community_member: true
secret: 'xxxyyyzzzaaabbbccc'
```

Security
========

The bottom line: As with everything in life, there is no such thing as anonymity
or absolute security. Only use Telebit Relays that you trust or self-host. :D

Even though the traffic is encrypted end-to-end, you can't just trust any Telebit Relay
willy-nilly.

A man-in-the-middle attack is possible using Let's Encrypt since an evil Telebit Relay
would be able to complete the http-01 and tls-sni-01 challenges without a problem
(since that's where your DNS is pointed when you use the service).

Also, the traffic could still be copied and stored for decryption is some era when quantum
computers exist (probably never).

Why?
====

We created this for anyone to use on their own server or VPS,
but those generally cost $5 - $20 / month and so it's probably
cheaper to purchase data transfer (which we supply, obviously),
which is only $1/month for most people.

TODO show how to do on 

	* Node WS Tunnel (zero setup)
	* Heroku (zero cost)
	* Chunk Host (best deal per TB/month)


