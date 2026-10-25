#!/usr/bin/env bash
# Go service va symlink workspace. Khong xoa repo, khong xoa ROS.
set -eo pipefail
WS="${ROS2_WS:-$HOME/ros2_ws}"

if systemctl list-unit-files | grep -q '^turtle-web.service'; then
  sudo systemctl disable --now turtle-web.service || true
  sudo rm -f /etc/systemd/system/turtle-web.service
  sudo systemctl daemon-reload
  echo "Da go service turtle-web"
fi
[ -L "$WS/src/turtle_web" ] && rm -f "$WS/src/turtle_web" && echo "Da bo symlink $WS/src/turtle_web"
rm -f "$WS/start_turtle_web.sh"
echo "Neu muon xoa ca build:  rm -rf $WS/build $WS/install $WS/log"
