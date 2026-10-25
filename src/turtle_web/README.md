# turtle_web – điều khiển turtlesim qua trình duyệt

```
Trình duyệt (HTML/JS)  --HTTP/SSE-->  Flask  --rclpy-->  /turtlesim
```

## Chạy

```bash
source ~/ros2_ws/install/setup.bash
# mặc định headless: Xvfb :99 + turtlesim + web. Không cần XQuartz hay màn hình.
ros2 launch turtle_web turtle_web.launch.py port:=5000
# có màn hình thật (ssh -X): dùng DISPLAY hiện tại
ros2 launch turtle_web turtle_web.launch.py headless:=false
# turtlesim đã chạy sẵn, chỉ bật web
ros2 run turtle_web web_node --ros-args -p port:=5000
```
Mở `http://<ip-máy-lab>:5000`. Dừng bằng Ctrl+C ở terminal launch (tắt cả 3 tiến trình).
Cần gói `xvfb` (`sudo apt install xvfb`). Nền mặc định RGB 33 36 69 đặt trong launch file.

## Chạy tự động khi khởi động máy (systemd)

```bash
~/ros2_ws/start_turtle_web.sh [port]     # chạy tay, Ctrl+C để dừng
sudo systemctl status turtle-web         # service: /etc/systemd/system/turtle-web.service
sudo systemctl restart turtle-web        # sau khi sửa code Python (file tĩnh html/js/css không cần)
sudo systemctl disable --now turtle-web  # tắt tự khởi động
journalctl -u turtle-web -f              # xem log
```
Service chạy user `vienkmt`, `KillSignal=SIGINT` để `ros2 launch` tắt node con sạch, `Restart=on-failure`.
Lưu ý: trong script không dùng `set -u` vì `setup.bash` của ROS tham chiếu biến chưa khai báo.

## Cấu trúc

| File | Vai trò |
|---|---|
| `turtle_web/web_node.py` | Node `turtle_web`. Lớp `TurtleBridge` (ROS) + `create_app` (Flask) + `main` |
| `turtle_web/battery_sim.py` | Node `battery_sim`: giả lập pack LiFePO4 16S 48 V cho từng rùa, publish `sensor_msgs/BatteryState` lên `/<rùa>/battery` 2 Hz. Tham số `capacity_ah`, `time_scale`, `ambient_c`, `rate_hz` |
| `turtle_web/web/index.html` | Giao diện |
| `turtle_web/web/static/app.js` | Logic client: SSE nhận pose, nội suy pose (RENDER_DELAY 60 ms + dead reckoning) để vẽ ở fps màn hình, gửi cmd_vel 10 Hz, gọi API, Canvas 2D dự phòng |
| `turtle_web/web/static/gl.js` | Renderer WebGL (vết mờ dần theo tuổi trong vertex shader: mỗi 60 s giảm nửa, sàn 12%): lưới + vết đi là capsule trong VBO, rùa vẽ bằng SDF trong fragment shader. Thêm `?no-gl` vào URL để ép Canvas 2D |
| `turtle_web/web/static/style.css` | Giao diện tối |
| `launch/turtle_web.launch.py` | Xvfb + turtlesim_node + web_node, tham số `port`, `headless` |
| `setup.py` / `package.xml` | Khai báo package ament_python, entry point `web_node` |

## Ý tưởng ROS cần nắm trong code

1. **Spin ở thread phụ**: `rclpy.spin(node)` chặn vĩnh viễn, Flask cũng chặn. Nên spin trong `threading.Thread`, Flask ở main thread.
2. **Publisher**: `create_publisher(Twist, '/turtle1/cmd_vel', 10)`, số 10 là queue depth (QoS).
3. **Subscriber + callback**: `create_subscription(Pose, topic, callback, 10)`. Callback chạy trong thread spin, nên dùng `Lock` khi ghi vào dict dùng chung với Flask.
4. **Service client async**: `call_async()` trả `Future`. Không được gọi `spin_until_future_complete` vì spin đã chạy ở thread khác; chỉ cần chờ `future.done()`.
5. **Parameter của node khác**: không có API trực tiếp, phải gọi service `/turtlesim/get_parameters` và `/turtlesim/set_parameters` (kiểu `rcl_interfaces/srv`).
6. **Parameter của chính node**: `declare_parameter('port', 5000)` rồi `get_parameter('port').value`. Đổi khi chạy bằng `--ros-args -p port:=8080`.
7. **Discovery**: `get_topic_names_and_types()` quét graph để tự phát hiện rùa spawn từ nơi khác (vd CLI).
8. **Pose 62 Hz nhưng màn hình 60-120 Hz**: vẽ ngay khi nhận sẽ giật vì mạng đến không đều. Client giữ bộ đệm mẫu, vẽ lùi 60 ms và nội suy giữa 2 mẫu; thiếu mẫu thì ngoại suy bằng v, ω (chuyển động cung tròn). Đây là kỹ thuật snapshot interpolation của game online.
9. **Go-to-goal closed-loop** (`_goto_step`, timer 20 Hz): đọc pose phản hồi, tính sai số góc `err = atan2(dy,dx) - theta` (wrap về [-π, π]) và khoảng cách. Pha `turn`: ω = K·err đến khi |err| < 0.03 rad. Pha `go`: v = min(speed, K·dist) giảm tốc khi gần, ω = K·err hiệu chỉnh hướng, lệch quá 0.5 rad thì quay lại pha turn. Tới đích (< 8 cm) thì dừng. Đây là bộ điều khiển P hai tầng, nền của mọi bài "move to pose" trong robotics.
10. **Nhiều node, một package** (`battery_sim`): node độc lập chỉ nói chuyện với phần còn lại qua topic. Subscribe `/<rùa>/pose` để lấy vận tốc làm tải, publish `BatteryState` chuẩn ROS (`sensor_msgs`), nên bất kỳ tool nào (rqt, rosbag, dashboard khác) đọc được mà không biết gì về web. Mô hình: I = I_idle + k·|v| + k·|ω| qua lọc thông thấp; V = OCV(soc) − I·R; SoC tích phân dòng nhân `time_scale` để nhìn thấy thay đổi; T theo I²R và tản nhiệt. Chỉnh tốc độ hao pin: `ros2 param set /battery_sim time_scale 5`.
11. **Tại sao gửi cmd_vel 10 Hz**: turtlesim tự dừng rùa nếu ~1 s không nhận lệnh mới. Robot thật cũng thiết kế vậy (watchdog) để mất kết nối là dừng.

## API

| Method | Path | Body |
|---|---|---|
| GET | `/api/state` | – |
| GET | `/api/stream` | SSE: event `pose`, `battery`, `goal`, `goal_done`, `removed` |
| POST | `/api/cmd_vel` | `{name, linear, angular}` |
| POST | `/api/spawn` | `{x, y, theta, name}` |
| POST | `/api/kill` | `{name}` |
| POST | `/api/clear` | `{}` |
| POST | `/api/set_pen` | `{name, r, g, b, width, off}` |
| POST | `/api/teleport` | `{name, x, y, theta}` |
| POST | `/api/goto` | `{name, x, y, speed}` – go-to-goal closed-loop, SSE phát `goal` / `goal_done` |
| POST | `/api/shape` | `{name, shape: figure8|ellipse|circle|square|polygon, size, sides, speed, loop}` – bám waypoint |
| POST | `/api/goto/cancel` | `{name}` – huỷ goto và shape |
| GET/POST | `/api/background` | `{r, g, b}` |

## Bài tập mở rộng
- Thêm endpoint `/api/relative` gọi `teleport_relative`.
- Thay SSE bằng WebSocket (flask-sock) để gửi cmd_vel hai chiều.
- Viết thêm hình mới trong `set_shape` (xoắn ốc, chữ cái...). Smooth mode = pure-pursuit đơn giản, thử thêm lookahead động theo tốc độ.
- Thêm điều khiển PID (thay P) cho go-to-goal, so sánh quỹ đạo.
- Cho phép click nhiều điểm thành waypoint queue.
- Tách `TurtleBridge` ra file riêng, viết unit test với `pytest`.

## Lỗi đã gặp
- `from queue import Empty` bị `from std_srvs.srv import Empty` ghi đè, nhánh keepalive SSE ném TypeError và stream chết sau 15 s rảnh. Đã đổi thành `QueueEmpty`.
- `SetEnvironmentVariable` trong `GroupAction` không truyền DISPLAY cho Node trên Foxy. Dùng `additional_env` của `Node` thay thế, kèm `TimerAction` 1 s để Xvfb kịp lên.
