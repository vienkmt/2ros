# 06 · Kinh nghiệm phát triển: 20 bài học từ dự án này

Ghi lại theo thứ tự gặp phải trong một ngày làm việc (25/10/2026), từ cài đặt tới triển khai.
Mỗi mục: **hiện tượng → nguyên nhân → cách xử lý → bài học**.

## Môi trường

**1. Chọn distro theo hệ điều hành, không theo mong muốn.**
Ubuntu 20.04 chỉ có Foxy. Cố cài Humble sẽ mất thời gian build từ source. Chấp nhận Foxy để học, ghi rõ khác biệt (`--once`, launch env) vào tài liệu.

**2. X forwarding chỉ để nhìn, không để chạy dài hạn.**
`ssh -X` + XQuartz hoạt động nhưng phụ thuộc phiên SSH: đóng XQuartz là turtlesim chết (`The X11 connection broke`). Khi mọi thao tác đã lên web, chuyển sang **Xvfb** headless. Cảnh báo `libGL ... swrast` khi dùng X forwarding là vô hại.

**3. Cài thư viện Python bằng apt khi hệ thống là Python của distro.**
`python3-flask` từ apt (1.1.1) khớp Python 3.8 mà rclpy Foxy dùng. `pip install flask` bản mới có thể kéo theo Werkzeug không tương thích.

## rclpy

**4. Một tiến trình, một `rclpy.spin`, đặt ở thread phụ nếu có vòng lặp khác.**
Flask và spin đều chặn. Spin ở `threading.Thread(daemon=True)`, Flask ở main. Mọi dữ liệu chia sẻ qua `Lock`.

**5. Không bao giờ spin lồng, và không gọi service từ trong callback.**
`spin_until_future_complete` trong thread Flask sẽ xung đột với spin đang chạy. Dùng `call_async` + chờ `future.done()` có deadline. Gọi service từ trong timer/subscriber callback thì future không bao giờ xong vì thread phải hoàn thành nó đang bận chạy chính callback đó. Vì vậy việc "đặt bút dày 2 cho rùa mới" được đẩy ra client gọi API.

**6. Cẩn thận trùng tên khi import.**
`from queue import Empty` rồi `from std_srvs.srv import Empty` → `except Empty:` ném `TypeError: catching classes that do not inherit from BaseException`. Luồng SSE chết mỗi khi rùa đứng yên 15 s, trình duyệt phải reconnect, và nó xảy ra 18 lần trước khi nhìn vào log. Bài học: đặt alias (`Empty as QueueEmpty`) và **đọc log của chính mình** trước khi tối ưu chỗ khác.

**7. Discovery là bất đồng bộ.**
Topic của rùa vừa spawn chưa chắc echo được ngay. Trong code dùng timer quét `get_topic_names_and_types()` 2 s một lần thay vì giả định.

## Launch (Foxy)

**8. `SetEnvironmentVariable` trong `GroupAction` không tới được `Node`.**
turtlesim vẫn nhận `DISPLAY=localhost:10.0` cũ và chết. Dùng `additional_env={'DISPLAY': ':99'}` trực tiếp trên `Node`.

**9. Thứ tự khởi động không được bảo đảm.**
Xvfb và turtlesim start cùng lúc → không kết nối được display. `TimerAction(period=1.0)` cho turtlesim.

**10. Tham số từ launch argument là chuỗi.**
`port:=8080` vào `declare_parameter('port', 5000)` kiểu int sẽ lỗi kiểu. Bọc `ParameterValue(LaunchConfiguration('port'), value_type=int)`.

## Shell và tiến trình

**11. `ros2 run` là wrapper Python; kill nó không kill node con.**
Node thật là `install/.../lib/turtle_web/web_node`. Kill wrapper rồi khởi động lại → `Address already in use`. Kill đúng PID con, hoặc dùng launch/systemd để quản lý cả cây.

**12. `pkill -f <mẫu>` có thể khớp chính shell đang chạy lệnh đó** (vì dòng lệnh của shell chứa mẫu). Shell tự tắt, lệnh sau không chạy. Dùng `pgrep -x`, hoặc kill theo PID đã lưu, hoặc `ss -ltnp` tìm theo cổng.

**13. `wait` không tham số đợi mọi job nền, kể cả `nohup ... &` dài hạn.** Lệnh đo treo tới timeout. Lưu `J=$!` rồi `wait $J`.

**14. `set -u` giết `setup.bash` của ROS.** Trong script khởi động chỉ dùng `set -eo pipefail`.

**15. Bản ghi discovery cũ sau `kill -9`.** `ros2 node list` thấy hai `/turtlesim`. Không phải hai tiến trình; `ros2 daemon stop` làm mới. Luôn kiểm tra bằng `ps`/`ss` trước khi tin `ros2 node list`.

## Web, đồ họa

**16. Giật không phải lỗi GPU.** Pose 62 Hz rất đều ở server (sd 0.4 ms) nhưng tới trình duyệt không đều. Vẽ ngay khi nhận là sai; nội suy với độ trễ 60 ms + dead reckoning (snapshot interpolation của game online) giải quyết triệt để. Đo trước khi đoán.

**17. Canvas mờ vì bitmap không theo devicePixelRatio.** Đặt `canvas.width = css × dpr` và `setTransform(dpr,…)`. Đường 1 px căn `+0.5`.

**18. WebGL đáng làm khi muốn vector thật (SDF) và lưu dữ liệu trên GPU (vết đi), không phải để "nhanh hơn" với vài con rùa.** Nhưng đã làm thì kiểm tra shader bằng `glslangValidator` vì máy lab không có trình duyệt. Canvas 2D phải còn làm dự phòng (`?no-gl`).

**19. Layout "vừa một màn hình" phải đo thật.** Đoán chiều cao panel bằng `calc(100vh - 230px)` sai ngay khi panel đổi. Đo `getBoundingClientRect()` của phần dưới bản đồ trong JS.

## Điều khiển, mô phỏng

**20. Chuyển "teleport" thành "đi tới" là bước nhảy từ demo sang robotics.** Bộ P hai pha (xoay rồi tiến, giảm tốc theo khoảng cách, tái định hướng khi lệch) đủ cho turtlesim và là khung của mọi move-to-pose. Watchdog 1 s của turtlesim buộc controller phải phát liên tục, đúng như driver động cơ thật. Pin giả lập nên có vật lý tối thiểu (OCV theo SoC, sụt áp I·R, nhiệt I²R, sạc CC/CV) thay vì random thuần, vì sinh viên sẽ nhìn số và hỏi "tại sao".

## Quy trình

- Mỗi thay đổi đều có một lệnh kiểm tra được từ terminal (`curl` API, `ros2 topic echo`, đo Hz). Không "chắc là chạy".
- Test trên rùa riêng (`spawn ttest` rồi `kill`) khi người khác đang dùng hệ thống, tránh nhiễu số liệu.
- `--symlink-install` + systemd: sửa `.py` chỉ cần restart service, sửa web chỉ cần tải lại trang. Chỉ build lại khi đổi `setup.py`/`package.xml`.
- Ghi nhật ký tiến độ (xem `90-nhat-ky-phat-trien.md`) ngay trong ngày, kể cả lỗi vặt. Chính file đó thành tài liệu này.
