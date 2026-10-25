# 2ros – Học ROS 2 qua turtlesim và một AGV giả lập điều khiển bằng web

Dự án giáo dục: từ cài ROS 2 Foxy trên Ubuntu 20.04, làm quen CLI với turtlesim,
đến tự viết package Python có **web UI điều khiển (Flask + WebGL)**, **bộ điều khiển
closed-loop**, **node giả lập pin 48 V** và **triển khai thành service systemd**
chạy không cần màn hình.

```
Trình duyệt (HTML / JS / WebGL)
      │  HTTP + Server-Sent Events
      ▼
 web_node (Flask + rclpy)  ──cmd_vel──▶  turtlesim_node (Xvfb, headless)
      ▲        │  goto / shape / turn           │ pose
      │        └──────── pose ◀─────────────────┘
      │  BatteryState
 battery_sim ◀── pose (vận tốc làm tải)
```

## Cài nhanh (Ubuntu 20.04 + ROS 2 Foxy)

```bash
git clone https://github.com/vienkmt/2ros.git ~/2ros
~/2ros/scripts/install.sh          # cài phụ thuộc, build, cài service tự khởi động
```

Mở `http://<ip-máy>:5000`. Chưa có ROS 2: xem [docs/01-cai-dat-ros2-foxy.md](docs/01-cai-dat-ros2-foxy.md).

## Lộ trình học

| # | Tài liệu | Nội dung |
|---|---|---|
| 01 | [Cài đặt ROS 2 Foxy](docs/01-cai-dat-ros2-foxy.md) | Repo apt, gói cần cài, rosdep, kiểm tra talker/listener |
| 02 | [Turtlesim bằng CLI](docs/02-turtlesim-cli.md) | Node, topic, message, service, parameter, bag qua 10 bước thực hành |
| 03 | [Kiến trúc turtle_web](docs/03-kien-truc-turtle-web.md) | Node Python + Flask, SSE, WebGL, controller, battery_sim, launch |
| 04 | [Triển khai](docs/04-trien-khai-service.md) | Xvfb headless, script khởi động, systemd, mở cổng, bảo mật |
| 05 | [Bài tập](docs/05-bai-tap.md) | Từ dễ đến khó, có gợi ý |
| 06 | [Kinh nghiệm và lỗi đã gặp](docs/06-kinh-nghiem-phat-trien.md) | 20 bài học rút ra khi làm dự án này |
| 07 | [Xử lý sự cố](docs/07-xu-ly-su-co.md) | Triệu chứng, nguyên nhân, cách sửa |
| 10 | [Định hướng AGV lidar](docs/10-dinh-huong-agv-lidar.md) | Dự án kế tiếp: hộp định vị gắn thêm, nhiều AGV chung bản đồ, so sánh lidar / AprilTag / UWB |
| 90 | [Nhật ký phát triển](docs/90-nhat-ky-phat-trien.md) | Tiến độ thực tế theo ngày |

Chi tiết API và tham số của package: [src/turtle_web/README.md](src/turtle_web/README.md).

## Cấu trúc repo

```
2ros/
├── src/turtle_web/            # package ROS 2 (ament_python)
│   ├── turtle_web/
│   │   ├── web_node.py        # node turtle_web: TurtleBridge (ROS) + Flask API + controller
│   │   ├── battery_sim.py     # node battery_sim: pack LiFePO4 16S 48 V, BatteryState
│   │   └── web/               # index.html, static/app.js, static/gl.js, static/style.css
│   ├── launch/turtle_web.launch.py   # Xvfb + turtlesim + battery_sim + web_node
│   ├── package.xml, setup.py, setup.cfg, resource/
│   └── README.md              # API, tham số, ý tưởng ROS trong code
├── scripts/
│   ├── install.sh             # cài một lệnh
│   ├── uninstall.sh
│   └── start_turtle_web.sh    # chạy tay / ExecStart của service
├── systemd/turtle-web.service.in     # template, install.sh điền __HOME__/__USER__
├── docs/                      # giáo trình
├── LICENSE (MIT), .gitignore
```

Thiết kế: repo **không** chứa workspace colcon. `install.sh` tạo `~/ros2_ws/src/turtle_web`
là symlink về repo, nên sửa code trong repo và `colcon build --symlink-install` một lần là đủ,
file Python/HTML/JS sửa xong chỉ cần `sudo systemctl restart turtle-web`.

## Tính năng web UI

- Bản đồ WebGL: rùa vẽ bằng SDF trong fragment shader, vết đi lưu trên GPU và mờ dần theo tuổi, nét ở mọi DPI.
- Pose nội suy 60 ms + dead reckoning, vẽ ở tần số màn hình dù pose chỉ đến 62 Hz.
- Điều khiển: D-pad, joystick ảo, bàn phím; xoay từng bước 5° closed-loop.
- Click bản đồ: go-to-goal (xoay về hướng đích, tiến thẳng, giảm tốc). Shift+click teleport.
- Hình: số 8, elip, tròn, vuông, đa giác ngẫu nhiên, lặp; bám waypoint hai chế độ mượt / góc nhọn.
- Pin rùa 48 V: điện áp sụt theo tải, nhiệt độ theo I²R, SoC tích phân, hết pin tự sạc CC/CV.
- Giao diện đáp ứng cho di động.

## Yêu cầu

Ubuntu 20.04, ROS 2 Foxy (distro duy nhất có apt cho 20.04, đã EOL 05/2023 nhưng đủ để học),
Python 3.8, `python3-flask`, `xvfb`. Trình duyệt hỗ trợ WebGL (mọi trình duyệt hiện đại).

## Giấy phép

MIT. Dùng tự do cho giảng dạy.
