#!/usr/bin/env bash
# Cai dat 2ros tren Ubuntu 20.04 da co ROS 2 Foxy.
#
#   git clone https://github.com/vienkmt/2ros.git ~/2ros
#   ~/2ros/scripts/install.sh              # build + cai service tu khoi dong
#   ~/2ros/scripts/install.sh --no-service # chi build, chay tay bang scripts/start_turtle_web.sh
#
# Script lam gi:
#   1. kiem tra ROS 2 Foxy, cai goi phu thuoc apt (turtlesim, flask, xvfb)
#   2. tao workspace ~/ros2_ws/src/turtle_web -> symlink toi repo nay
#   3. colcon build --symlink-install
#   4. sinh file service tu systemd/turtle-web.service.in, enable + start
set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="${ROS2_WS:-$HOME/ros2_ws}"
WITH_SERVICE=1
[ "${1:-}" = "--no-service" ] && WITH_SERVICE=0

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mLOI: %s\033[0m\n' "$*" >&2; exit 1; }

step "Kiem tra moi truong"
[ -f /etc/os-release ] && . /etc/os-release
echo "OS: ${PRETTY_NAME:-?}"
if [ ! -f /opt/ros/foxy/setup.bash ]; then
  die "Chua co ROS 2 Foxy. Xem docs/01-cai-dat-ros2-foxy.md roi chay lai."
fi
command -v sudo >/dev/null || die "Can sudo de cai goi apt."

step "Cai goi phu thuoc apt"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  ros-foxy-turtlesim ros-foxy-launch-ros ros-foxy-sensor-msgs ros-foxy-std-srvs \
  python3-colcon-common-extensions python3-flask xvfb >/dev/null
echo "OK"

step "Tao workspace $WS"
mkdir -p "$WS/src"
if [ -e "$WS/src/turtle_web" ] && [ ! -L "$WS/src/turtle_web" ]; then
  die "$WS/src/turtle_web da ton tai va khong phai symlink. Xoa/di chuyen no roi chay lai."
fi
ln -sfn "$REPO/src/turtle_web" "$WS/src/turtle_web"
install -m 755 "$REPO/scripts/start_turtle_web.sh" "$WS/start_turtle_web.sh"
echo "src/turtle_web -> $REPO/src/turtle_web"

step "Build (colcon --symlink-install)"
# shellcheck disable=SC1091
source /opt/ros/foxy/setup.bash
( cd "$WS" && colcon build --symlink-install )

if ! grep -q "source /opt/ros/foxy/setup.bash" "$HOME/.bashrc"; then
  echo "source /opt/ros/foxy/setup.bash" >> "$HOME/.bashrc"
fi
if ! grep -q "source $WS/install/setup.bash" "$HOME/.bashrc"; then
  echo "source $WS/install/setup.bash" >> "$HOME/.bashrc"
  echo "Da them source workspace vao ~/.bashrc"
fi

if [ "$WITH_SERVICE" = 1 ]; then
  step "Cai service systemd turtle-web"
  sed -e "s#__HOME__#$HOME#g" -e "s#__USER__#$USER#g" \
      "$REPO/systemd/turtle-web.service.in" | sudo tee /etc/systemd/system/turtle-web.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now turtle-web.service
  sleep 8
  if systemctl is-active --quiet turtle-web; then
    echo "Service dang chay."
  else
    echo "Service chua len, xem: journalctl -u turtle-web -n 50"
  fi
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
step "Xong"
cat <<EOF
Mo trinh duyet:  http://${IP:-localhost}:5000

Lenh hay dung:
  sudo systemctl status|restart|stop turtle-web
  journalctl -u turtle-web -f
  $WS/start_turtle_web.sh [port]        # chay tay (stop service truoc)
  ros2 topic list / ros2 topic echo /turtle1/battery

Tai lieu: $REPO/docs/
EOF
