# Deploying

Transfers runs on `ssh server` like screamr.ai: three containers from `docker-compose.yml`, reached only through the shared cloudflared tunnel.

- **web** (`transfers_web`): Caddy on port 8080. Serves the built frontend and proxies `/api` and `/t` to the API. Its only networks are `transfers-edge` (joined by cloudflared) and `transfers-app`.
- **api**: Node. Keeps the schedule database and 511 key usage in the `transfers-data` volume. It has no route off the machine except the egress proxy.
- **egress**: Squid, allowing HTTPS to `api.511.org`, `api.bart.gov`, and `www.bart.gov` (its elevator and escalator status tables) only.

The internal networks use Docker's `isolated` gateway mode, which needs Docker 28 or later (the server runs 29.7). Docker Desktop 27 on a Mac rejects it, so local runs need an override that drops that option.

## First deploy

1. Clone the repo on the server with its own read-only deploy key, as screamr.ai and the blog have. The key is `~/.ssh/transfers-read-only`, added to the GitHub repo as the deploy key "server (read-only)". The clone keeps the key in `core.sshCommand`, so `git pull` needs nothing extra.

   ```sh
   ssh-keygen -t ed25519 -N "" -C "server read-only transfers" -f ~/.ssh/transfers-read-only
   ```

   Add `~/.ssh/transfers-read-only.pub` to the repo as a read-only deploy key (`gh repo deploy-key add <file> --repo jwhitlow45/transfers --title "server (read-only)"` from a machine signed in to GitHub). Then:

   ```sh
   cd ~/docker_compose && GIT_SSH_COMMAND="ssh -i ~/.ssh/transfers-read-only -o IdentitiesOnly=yes" git clone git@github.com:jwhitlow45/transfers.git transfers && cd transfers && git config core.sshCommand "ssh -i ~/.ssh/transfers-read-only -o IdentitiesOnly=yes"
   ```

2. Create `~/docker_compose/transfers/.env` with the 511 keys, comma separated, on one line: `API_KEYS_511=<key1>,<key2>,<key3>`. Use keys no other tool uses.

3. Start it. The first start downloads the schedules from 511 (5 requests) and builds the database in about 10 seconds.

   ```sh
   cd ~/docker_compose/transfers && docker compose up -d --build && docker compose ps
   ```

   All three services should show `running`, with `api` and `egress` `healthy`.

4. Let the tunnel reach Caddy. In `~/docker_compose/cloudflared/docker-compose.yml`, add `transfers_edge` to the cloudflared service's `networks` list, and add this under the top-level `networks`:

   ```yaml
   # transfers.gerbil-porgy.cc. Internal and gateway-isolated, like the others. Created by
   # /home/server/docker_compose/transfers/docker-compose.yml.
   transfers_edge:
     name: transfers-edge
     external: true
   ```

   Then attach the running tunnel to the network. This takes effect at once without restarting the tunnel, which would briefly drop every other site it carries. The compose change keeps the network on the tunnel's next recreate.

   ```sh
   docker network connect transfers-edge cloudflared
   ```

5. In the Cloudflare dashboard, open Zero Trust, then Networks, Tunnels, this server's tunnel, Public Hostnames. Add `transfers.gerbil-porgy.cc` with service type HTTP and URL `transfers_web:8080`.

6. Optional, matching screamr: block the egress bridge from reaching the host, in case squid itself is ever compromised.

   ```sh
   sudo iptables -I INPUT 1 -i br-trf-egress -j DROP && sudo netfilter-persistent save
   ```

7. Within 30 days of a public launch, 511's data agreement (section 2g) asks for documentation of the site, such as its live URL and screenshots, and for evidence of the "Data provided by 511.org" credit that section 5b requires. Section 6 directs notices to developerresources@511.org.

## Updating

```sh
cd ~/docker_compose/transfers && git pull && docker compose up -d --build
```

The schedule database and key usage survive in the volume. The schedule rebuilds itself daily around 3:30 AM Pacific.

After a change to `docker/squid.conf`, restart the proxy too, since it reads the file only when it starts:

```sh
cd ~/docker_compose/transfers && docker compose restart egress
```

## Checking on it

- `docker compose logs -f api` shows feed failures and schedule rebuilds.
- `docker compose exec api node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(console.log)"` prints when the schedule was built and when trip updates last arrived (unix seconds). `realtime` stays null until someone opens a trip, since the server fetches only while the site is in use.
