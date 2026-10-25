# 05 · Bài tập

Mỗi bài ghi mức độ, file cần sửa và gợi ý. Làm xong bài nào thì `sudo systemctl restart turtle-web` (sửa .py) hoặc tải lại trang (sửa html/js/css).

## Mức 1 · CLI và quan sát (không sửa code)

1. Dùng `ros2 topic echo /turtle1/battery` xem pin lúc rùa đứng và lúc chạy hình số 8. Ghi lại điện áp sụt bao nhiêu volt khi dòng tăng. Giải thích bằng công thức V = OCV − I·R.
2. `ros2 param set /battery_sim time_scale 600` rồi quan sát một chu trình hết pin → sạc → đầy trên web. Vẽ lại đồ thị V(t) và I(t) bằng tay từ sparkline.
3. Spawn 3 rùa bằng CLI, cho mỗi con chạy một hình khác nhau từ web. Dùng `ros2 topic hz` và `ros2 topic bw` so sánh băng thông topic pose với battery.
4. Ghi `ros2 bag record -a` 30 s trong khi lái, phát lại và xem web UI có vẽ lại không. Giải thích vì sao rùa trên web nhảy về vị trí cũ.

## Mức 2 · Sửa tham số, đọc code

5. Đổi bước xoay 5° thành 15° (`TURN_STEP_DEG` trong `app.js`). Đổi nhịp mờ vết thành 30 s (`FADE_SEC` và `GL.setFade`).
6. Trong `web_node.py`, tăng `K_HEAD` lên 6.0 và giảm xuống 1.0, chạy hình elip, quan sát rùa dao động hay lượn. Viết nhận xét về hệ số P.
7. Thêm trường `power_w` vào sự kiện battery (server tính V·I) và hiện trong panel thay vì client tự nhân.
8. Thêm hình **xoắn ốc** vào `set_shape`: r tăng dần theo góc, 3 vòng, chế độ smooth.

## Mức 3 · Thêm tính năng

9. **Waypoint queue**: Shift+click nhiều điểm thì nối thành đường, rùa đi lần lượt. Server: `_start_path` đã nhận danh sách điểm; client cần gom điểm rồi gửi `/api/path` mới.
10. **Tránh biên**: khi pose cách biên < 0.5 và đang tiến về biên, giảm v và quay vào trong. Làm trong `_goto_step` hoặc như một "bộ lọc" trên `cmd_vel` tay.
11. **Node mới `logger_node`**: subscribe pose + battery của mọi rùa, ghi CSV 1 Hz vào `~/turtle_logs/`. Thêm vào launch. Đây là bài node độc lập hoàn toàn, không đụng web.
12. **Service tùy biến**: định nghĩa `srv/SetTimeScale.srv` trong package (cần chuyển sang `ament_cmake` hoặc tạo package interface riêng), battery_sim cung cấp service đó thay cho `ros2 param set`.

## Mức 4 · Điều khiển và hệ thống

13. Thay bộ P trong `heading`/`sharp` bằng PID có anti-windup. So sánh thời gian xoay 90° và độ vọt lố.
14. Pure pursuit đúng nghĩa cho chế độ smooth: lookahead động L = k·v, điểm bám là giao của đường đi với vòng tròn bán kính L. So sánh quỹ đạo elip với cách hiện tại.
15. Chuyển SSE sang WebSocket (`flask-sock`), gửi cmd_vel hai chiều qua cùng kết nối, đo độ trễ vòng (client gửi timestamp, server echo).
16. Dockerize: Dockerfile từ `ros:foxy`, cài gói, copy `src/`, `colcon build`, `CMD` chạy launch. Chạy `docker run -p 5000:5000`. So sánh với systemd.
17. Thay turtlesim bằng robot thật hoặc Gazebo: giữ nguyên `web_node`, chỉ cần robot publish `Pose`-tương đương và nhận `Twist`. Viết node "adapter" chuyển `nav_msgs/Odometry` → `turtlesim/Pose`.

## Gợi ý chấm điểm (cho giảng viên)

| Tiêu chí | Điểm |
|---|---|
| Chạy được, không lỗi trong `journalctl -u turtle-web` | 30 |
| Đúng kiến trúc ROS: dùng topic/service/param chuẩn, không hack qua file hay biến toàn cục | 30 |
| Giải thích được vì sao (lock, thread, watchdog, P controller) | 25 |
| Code sạch, có docstring, commit message rõ | 15 |
