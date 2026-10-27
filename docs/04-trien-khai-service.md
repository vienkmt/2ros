# 04 · Triển khai: headless, script, systemd, mạng

## Headless với Xvfb

turtlesim là ứng dụng Qt, bắt buộc có X server. Trên máy lab/server không màn hình dùng **Xvfb**
(X virtual framebuffer): một X server vẽ vào bộ nhớ, không ai nhìn, nhưng turtlesim chạy bình thường
và publish pose. Launch file tự khởi động `Xvfb :99` rồi đặt `DISPLAY=:99` cho turtlesim.

Hai lỗi đã gặp:
- Xvfb chưa kịp lên thì turtlesim đã chạy → `could not connect to display`. Fix: `TimerAction` 1 s.
- Display `:99` là của turtle_web. `start_turtle_web.sh` lúc khởi động tắt mọi `Xvfb :99` đang chạy (của lần trước bị kill -9 hoặc của script khác), xóa `/tmp/.X99-lock`, rồi launch mới mở Xvfb. Xvfb và turtlesim có `respawn` trong launch, chết là tự chạy lại sau 1–2 s. Script khác cần Xvfb hãy dùng `:98`.

## Script khởi động

`scripts/start_turtle_web.sh` (install.sh copy sang `~/ros2_ws/`):

1. `source /opt/ros/foxy/setup.bash` và `source install/setup.bash`
2. dọn lock Xvfb
3. `exec ros2 launch turtle_web turtle_web.launch.py port:=$PORT`

`exec` để PID của script chính là PID của `ros2 launch`, systemd gửi tín hiệu đúng chỗ.
**Không dùng `set -u`**: `setup.bash` của ROS tham chiếu `AMENT_TRACE_SETUP_FILES` chưa khai báo và sẽ chết.

## Service systemd

Template `systemd/turtle-web.service.in`, `install.sh` thay `__HOME__`, `__USER__`:

```ini
[Service]
Type=simple
User=__USER__
WorkingDirectory=__HOME__/ros2_ws
ExecStart=__HOME__/ros2_ws/start_turtle_web.sh
KillSignal=SIGINT        # ros2 launch nhận Ctrl+C → tắt mọi node con sạch
KillMode=mixed           # SIGINT cho tiến trình chính, SIGKILL phần còn sót sau timeout
TimeoutStopSec=20
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```

Lệnh:

```bash
sudo systemctl status turtle-web
sudo systemctl restart turtle-web          # sau khi sửa .py
journalctl -u turtle-web -f                # log mọi node (output='screen' → journal)
sudo systemctl disable --now turtle-web    # tắt tự khởi động
```

Muốn chạy tay để debug: `systemctl stop turtle-web` trước, không thì trùng cổng 5000.

Nhiều hệ ROS trong LAN: thêm `Environment=ROS_DOMAIN_ID=<n>` vào `[Service]` (và `~/.bashrc` để CLI cùng domain).

## Mạng và bảo mật

- Flask bind `0.0.0.0:5000`. Không có firewall (ufw tắt) thì trong LAN truy cập được ngay `http://<ip>:5000`.
- Ra Internet: NAT port forward TCP 5000 trên router về máy lab. **UI không có đăng nhập**, ai có link là điều khiển được. Chỉ mở lúc demo, hoặc dùng Tailscale / SSH tunnel:
  ```bash
  ssh -L 5000:localhost:5000 user@may-lab    # rồi mở http://localhost:5000 trên máy mình
  ```
- Flask dev server đủ cho lớp học; production thì đặt sau nginx + gunicorn (gevent worker để SSE không chiếm thread).

## Kiểm tra sau triển khai

```bash
systemctl is-active turtle-web                       # active
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/   # 200
ros2 daemon stop; ros2 node list                     # /battery_sim /turtle_web /turtlesim
timeout 3 ros2 topic echo /turtle1/battery | head
```
