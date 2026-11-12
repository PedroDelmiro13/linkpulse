#!/bin/bash
export HOME=/root
dnf install -y nodejs20 git
cd /opt
git clone https://github.com/PedroDelmiro13/linkpulse.git
cd linkpulse/app
npm ci --omit=dev

cat > /etc/systemd/system/linkpulse.service <<'EOF'
[Unit]
Description=LinkPulse
After=network.target
[Service]
WorkingDirectory=/opt/linkpulse/app
Environment=AWS_REGION=us-east-1
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now linkpulse