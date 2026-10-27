#!/usr/bin/env bash
# Khoi dong ca bo turtle_web: Xvfb + turtlesim + battery_sim + web_node.
#   ./start_turtle_web.sh            # cong 5000
#   ./start_turtle_web.sh 8080       # cong khac
#   PORT=8080 ./start_turtle_web.sh
# Dung bang Ctrl+C (ros2 launch tat het cac node con).
set -eo pipefail

PORT="${1:-${PORT:-5000}}"
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source /opt/ros/foxy/setup.bash
# shellcheck disable=SC1091
source "$WS/install/setup.bash"

# Display :99 la cua turtle_web. Luc nay chua co Xvfb nao cua ta, nen Xvfb :99 dang chay
# (neu co) la cua tien trinh khac/lan truoc bi kill -9 -> tat di, khong thi Xvfb moi se loi
# "Server is already active" va turtlesim khong len. Sau do don file lock con sot.
if pgrep -u "$(id -u)" -f '^Xvfb :99( |$)' >/dev/null; then
  echo "[start_turtle_web] Xvfb :99 la cua tien trinh khac, tat de dung lai display"
  pkill -u "$(id -u)" -f '^Xvfb :99( |$)' || true
  sleep 1
fi
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# Thu muc runtime cho Qt (tranh canh bao "XDG_RUNTIME_DIR not set")
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -un)}"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"

echo "[start_turtle_web] workspace=$WS port=$PORT  ->  http://$(hostname -I | awk '{print $1}'):$PORT"
# exec de systemd theo doi dung tien trinh ros2 launch, SIGINT/SIGTERM toi thang no
exec ros2 launch turtle_web turtle_web.launch.py "port:=$PORT"
