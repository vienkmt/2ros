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

# Don Xvfb :99 con sot lai tu lan truoc (vd service bi kill -9), neu khong Xvfb moi se loi
if [ -e /tmp/.X99-lock ] && ! pgrep -x Xvfb >/dev/null; then
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
fi

echo "[start_turtle_web] workspace=$WS port=$PORT  ->  http://$(hostname -I | awk '{print $1}'):$PORT"
# exec de systemd theo doi dung tien trinh ros2 launch, SIGINT/SIGTERM toi thang no
exec ros2 launch turtle_web turtle_web.launch.py "port:=$PORT"
