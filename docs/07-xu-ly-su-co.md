# 07 · Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `install.sh` báo "Chưa có ROS 2 Foxy" | chưa cài ROS | làm theo [01](01-cai-dat-ros2-foxy.md) |
| `systemctl status turtle-web` = `activating`/restart liên tục, journal: `AMENT_TRACE_SETUP_FILES: unbound variable` | script có `set -u` | bỏ `-u` (bản trong repo đã bỏ) |
| journal: `could not connect to display :99` | Xvfb chưa lên hoặc lock cũ `/tmp/.X99-lock` | `rm -f /tmp/.X99-lock /tmp/.X11-unix/X99`, restart; launch đã có TimerAction 1 s |
| `Address already in use` cổng 5000 | còn web_node cũ chạy tay, hoặc service đang chạy | `ss -ltnp \| grep 5000` → kill PID đó, hoặc `systemctl stop turtle-web` trước khi chạy tay |
| `ros2 node list` không thấy node của service / `ros2 param set` báo `Node not found` | daemon discovery cache cũ, hoặc khác `ROS_DOMAIN_ID` | `ros2 daemon stop` rồi thử lại; kiểm tra domain id của shell và của service |
| `ros2 node list` thấy tên trùng | bản ghi discovery sau kill -9 | vô hại, `ros2 daemon stop`; xác nhận bằng `ps` |
| Web mở được nhưng bản đồ trống, "không có dữ liệu pin" | turtlesim/battery_sim chết | `journalctl -u turtle-web -n 100`, tìm `process has died` |
| Rùa không nhúc nhích khi giữ phím trên web | tab mất focus, hoặc SSE đứt | click vào trang; xem chấm trạng thái góc phải; log có "Mất kết nối" |
| Rùa giật | đang chạy Canvas 2D hoặc mạng kém | log khởi động ghi renderer; thử `?no-gl` để so; `RENDER_DELAY` trong app.js tăng lên 100 |
| Bản đồ mờ | trình duyệt cũ không báo devicePixelRatio | hiếm; kiểm tra console |
| Màn hình đen, console báo lỗi shader | GPU/driver không hỗ trợ WebGL 1 | thêm `?no-gl` vào URL |
| Vết không mờ dần | đang Canvas 2D và tab bị throttle | bình thường khi tab nền; quay lại tab sẽ vẽ lại |
| Click bản đồ rùa quay vòng tại chỗ mãi | REALIGN/TURN_TOL quá chặt với tốc độ góc lớn | giảm slider tốc độ góc, hoặc nới `TURN_TOL` |
| Pin về 0 % nhưng không sạc | `time_scale` quá lớn làm SoC nhảy qua ngưỡng trong 1 bước | đã xử lý bằng kiểm tra sau khi cập nhật SoC; nếu vẫn gặp, giảm `time_scale` |
| `colcon build` lỗi `turtle_web` không tìm thấy khi symlink | symlink `~/ros2_ws/src/turtle_web` trỏ sai | `ls -la ~/ros2_ws/src`; `ln -sfn ~/2ros/src/turtle_web ~/ros2_ws/src/turtle_web` |
| Sửa `.py` nhưng không có tác dụng | chưa restart service | `sudo systemctl restart turtle-web` |
| Sửa js/css nhưng không có tác dụng | cache trình duyệt | tải lại cứng Ctrl/Cmd+Shift+R |
| Truy cập từ máy khác không được | sai IP, hoặc firewall | `hostname -I`; `sudo ufw status`; `curl http://<ip>:5000` ngay trên máy lab |
| Web lên nhưng báo `service /turtle1/set_pen khong san sang`, rùa không nhúc nhích (27/10/2026) | một tiến trình khác tắt/chiếm Xvfb `:99` (ví dụ script test AT-SPI), turtlesim mất X11 và chết; `ros2 launch` vẫn chạy nên `systemctl` báo *active* | `pgrep -af Xvfb` xem ai giữ `:99`, tắt tiến trình lạ rồi `sudo systemctl restart turtle-web`. Từ bản này launch đã bật `respawn` cho Xvfb và turtlesim; tiến trình khác cần Xvfb hãy dùng display khác (`:98`) |

Lệnh chẩn đoán nhanh:

```bash
systemctl is-active turtle-web && curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/
journalctl -u turtle-web -n 50 --no-pager | grep -vE "GET|POST"
ps -eo pid,etime,cmd | grep -E "Xvfb|turtlesim_node|battery_sim|web_node" | grep -v grep
ros2 daemon stop; ros2 node list; ros2 topic list
timeout 3 ros2 topic echo /turtle1/pose | head -6
```
