agree_tos: true
community_member: true
telemetry: true
vhost: /srv/www/:hostname
greenlock:
  version: 'draft-11'
  server: 'https://acme-v02.api.letsencrypt.org/directory'
  store:
    strategy: le-store-certbot
  config_dir: /opt/telebitd/acme
