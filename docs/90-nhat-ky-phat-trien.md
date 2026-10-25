> Nhật ký gốc của tác giả trong quá trình làm dự án, giữ nguyên để sinh viên thấy tiến độ thực tế và các ngõ cụt. Tài liệu chính thức xem các file 01 đến 07.

# Tiến độ cài ROS 2 trên máy lab

Cập nhật: 2026-10-25 (đã test turtlesim, đã có package turtle_web)

## Máy
- Ubuntu 20.04.6 (Focal), x86_64, kernel 5.4.0-216
- User `vienkmt` thuộc group sudo, docker
- sshd đã bật X11Forwarding, xauth có sẵn

## Đã làm
- [x] Thêm key + repo apt `packages.ros.org/ros2/ubuntu focal`
- [x] Cài `ros-foxy-desktop`, `ros-dev-tools`, `python3-colcon-common-extensions`, `python3-rosdep`, `python3-argcomplete`
- [x] `rosdep init` + `rosdep update`
- [x] Thêm `source /opt/ros/foxy/setup.bash` vào `~/.bashrc`
- [x] Test demo talker (C++) / listener (Python): chạy OK
- [x] Xác nhận package `turtlesim` đã có
- [x] Cài XQuartz trên macOS, SSH -X cho DISPLAY=localhost:10.0, xdpyinfo kết nối OK
- [x] Chạy turtlesim_node qua X forwarding: node/topic lên, pub cmd_vel rùa di chuyển, service /spawn tạo turtle2 OK

## Lý do chọn Foxy
Foxy là distro ROS 2 duy nhất có gói apt cho Ubuntu 20.04. Đã hết hỗ trợ 05/2023.
Muốn Humble / Jazzy / Lyrical thì nâng Ubuntu hoặc chạy Docker (máy đã có docker).

## Ghi chú khi test turtlesim (2026-10-25)
- `libGL error: No matching fbConfigs / failed to load driver: swrast` khi mở turtlesim qua XQuartz: chỉ là cảnh báo, cửa sổ vẫn chạy. Nếu không thấy cửa sổ, thử `export LIBGL_ALWAYS_INDIRECT=1` hoặc `QT_XCB_GL_INTEGRATION=none`.
- Foxy KHÔNG có `ros2 topic echo --once`. Dùng: `timeout 3 ros2 topic echo /turtle1/pose | head -6`
- Lần đầu echo topic mới spawn có thể chưa ra dữ liệu ngay (discovery chậm), tăng timeout lên 5-10s.

- [x] Test CLI turtlesim gần hết (teleop, pub, service, param)
- [x] Tạo workspace `~/ros2_ws`, package `turtle_web` (ament_python): Flask + rclpy, web UI điều khiển rùa
- [x] Cài `python3-flask` (apt, 1.1.1)

## Package turtle_web (~/ros2_ws/src/turtle_web)
Xem `README.md` trong package. Chạy:

    source ~/ros2_ws/install/setup.bash
    sudo systemctl status turtle-web                     # đang chạy sẵn như service
    ros2 launch turtle_web turtle_web.launch.py          # hoặc chạy tay (stop service trước)
    ros2 launch turtle_web turtle_web.launch.py headless:=false   # nếu muốn thấy cửa sổ qua ssh -X

Mở http://<ip-máy-lab>:5000 trên macOS. Đã test API bằng curl: state, stream (SSE), cmd_vel, spawn, kill, clear, set_pen, teleport, background đều OK.
Build lại sau khi sửa code: `cd ~/ros2_ws && colcon build --symlink-install` (file .py sửa xong chạy luôn nhờ symlink, chỉ cần restart node).

- [x] Web UI chạy tốt trên macOS, render WebGL (SDF), nội suy pose cho mượt
- [x] Chuyển sang headless: Xvfb trong launch file, không cần XQuartz nữa. Cài `xvfb`, `glslang-tools`
- [x] Sửa bug SSE chết sau 15 s (trùng tên `Empty`)
- [x] Bám waypoint: số 8, elip, tròn, vuông, đa giác (API /api/shape)
- [x] `~/ros2_ws/start_turtle_web.sh` + service systemd `turtle-web` (enabled, tự chạy khi boot)
- [x] Node `battery_sim` giả lập pin AGV 48 V (BatteryState), panel pin trên web
- [x] Go-to-goal closed-loop trong node: click bản đồ rùa xoay rồi tiến tới đích; Shift+click = teleport

## Đang làm
- [ ] Bài tập: hình vuông closed-loop dùng pose (xem README)

## Hướng dẫn test turtlesim (khi SSH lại)

Trên macOS: mở XQuartz trước, rồi mở 2-3 terminal, mỗi cái:

    ssh -X user@<ip-máy-lab>
    echo $DISPLAY        # phải ra dạng localhost:10.0, trống thì thử ssh -Y

Terminal 1:

    ros2 run turtlesim turtlesim_node

Terminal 2 (bấm mũi tên để điều khiển):

    ros2 run turtlesim turtle_teleop_key

Terminal 3 (quan sát hệ thống):

    ros2 node list
    ros2 topic list
    ros2 topic echo /turtle1/pose
    ros2 topic pub --once /turtle1/cmd_vel geometry_msgs/msg/Twist "{linear: {x: 2.0}, angular: {z: 1.8}}"
    ros2 service call /spawn turtlesim/srv/Spawn "{x: 2, y: 2, theta: 0.2, name: 'turtle2'}"
    rqt_graph

Không cần `source` thủ công nữa vì đã có trong `~/.bashrc` (terminal mới).

## Phương án dự phòng
Nếu X11 từ macOS không hoạt động: dựng Xvfb + x11vnc + noVNC trên máy lab, xem qua trình duyệt.

## Bước tiếp theo gợi ý
- Viết node Python thuần (không web) subscribe pose, publish cmd_vel để rùa tự đi theo quỹ đạo
- Tìm hiểu QoS, launch file nhiều node, tf2
