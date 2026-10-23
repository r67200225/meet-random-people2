# MeetRandom – random video chat (WebRTC + Socket.IO)

## Run locally
    npm install
    npm start        # http://localhost:3000  (open in 2 tabs/browsers to test)

## Deploy (must be HTTPS – browsers block the camera on plain http)
Easiest: Render.com / Railway / Fly.io -> New Web Service -> connect repo (or use the Dockerfile).
Build: `npm install`   Start: `npm start`   Env: `ICE_SERVERS` (see below).
Or a VPS: install Node 20, run with pm2, put Nginx + Let's Encrypt (certbot) in front, and
proxy `/` to port 3000 with WebSocket upgrade headers.

## TURN server (REQUIRED for it to work for everyone)
Roughly 15-25% of users sit behind NATs where STUN alone fails -> black video.
Option A (cheap/free tier): Metered.ca, Twilio, Xirsys – paste their ICE list into env var:
    ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:YOUR_HOST:3478","username":"USER","credential":"PASS"}]'
Option B (self-host coturn on a VPS):
    sudo apt install coturn
    # /etc/turnserver.conf:
    #   listening-port=3478
    #   realm=yourdomain.com
    #   fingerprint
    #   lt-cred-mech
    #   user=USER:PASS
    #   min-port=49152
    #   max-port=65535
    # open UDP/TCP 3478 and UDP 49152-65535 in your firewall.
TURN relays video, so bandwidth cost grows with users.

## Monetization
- Put ad-network code into `#ad-top` and `#ad-side` in public/index.html.
- Many networks (AdSense) BAN random-video-chat sites. Adult-friendly/alt networks accept them but pay less.
- Later: premium (gender/country filters, no ads) with Stripe/Razorpay.

## Moderation & legal (do not skip)
Omegle shut down in 2023 over abuse cases involving minors. Before going public you need:
- Terms, Privacy Policy, 18+ gate (included) and a way to contact you.
- Automated nudity detection on video frames (e.g. server-side/Client-side NSFW model or a service
  like Hive / Sightengine / AWS Rekognition) and human review of reports.
- IP/device bans (basic auto-ban included, in-memory: add Redis + a DB for production).
- Process to report child-exploitation material to authorities (NCMEC CyberTipline / local cybercrime portal).
- Check local law (India: IT Act & IT Rules 2021 intermediary duties, grievance officer, data rules).

## Scaling notes
Video is peer-to-peer, so your server only does signaling (cheap). One small server handles thousands
of waiting users. For multiple server instances, add the Socket.IO Redis adapter and a shared queue.
