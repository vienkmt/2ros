# 02 · Turtlesim bằng CLI: 10 bước nắm 5 khái niệm

Turtlesim là robot giả đơn giản nhất của ROS 2 nhưng có đủ kiến trúc của robot thật.
Học xong bài này bạn nắm **Node, Topic, Message, Service, Parameter**.

- **Node**: một chương trình. `turtlesim_node` là robot, `turtle_teleop_key` là tay cầm. Hai node không biết nhau, chỉ nói chuyện qua topic.
- **Topic**: kênh một chiều kiểu phát thanh. Publish để phát, subscribe để nghe. `/turtle1/cmd_vel` là lệnh vận tốc, `/turtle1/pose` là vị trí phát ra liên tục.
- **Message**: định dạng dữ liệu trên topic. `cmd_vel` kiểu `geometry_msgs/msg/Twist`: linear x y z, angular x y z. Rùa chạy mặt phẳng nên chỉ dùng `linear.x` (tiến/lùi) và `angular.z` (xoay).
- **Service**: gọi một lần, có request và response. `/spawn`, `/clear`, `/turtle1/set_pen`.
- **Parameter**: cấu hình của node, đổi được khi đang chạy. `background_r/g/b`.

Chuẩn bị: 3 terminal (nếu máy có màn hình) hoặc dùng service `turtle-web` đang chạy sẵn và chỉ cần 1 terminal cho các lệnh quan sát.

## Bước 1. Khởi động robot

```bash
ros2 run turtlesim turtlesim_node        # ros2 run <package> <executable>
```

Node tên `/turtlesim`, rùa `turtle1` spawn tại (5.54, 5.54). Bản đồ 11×11, gốc tọa độ góc dưới trái.

## Bước 2. Liệt kê những gì đang tồn tại

```bash
ros2 node list
ros2 topic list
ros2 service list
ros2 param list
```

`/rosout` và `/parameter_events` là của hệ thống, node nào cũng có.

## Bước 3. Soi một topic

```bash
ros2 topic info /turtle1/cmd_vel          # kiểu message, số publisher / subscriber
ros2 topic info /turtle1/pose
ros2 interface show geometry_msgs/msg/Twist
ros2 interface show turtlesim/msg/Pose
```

`cmd_vel`: 1 subscriber (rùa nghe), 0 publisher (chưa ai ra lệnh). `pose` ngược lại.

## Bước 4. Nghe vị trí rùa

```bash
ros2 topic echo /turtle1/pose             # ~62 Hz dù rùa đứng yên; Ctrl+C dừng
ros2 topic hz /turtle1/pose
```

## Bước 5. Điều khiển bằng bàn phím

```bash
ros2 run turtlesim turtle_teleop_key
```

Chạy lại `ros2 topic info /turtle1/cmd_vel`: publisher thành 1. Teleop chỉ là một node publish Twist mỗi khi bấm phím.

## Bước 6. Tự publish lệnh

```bash
ros2 topic pub --once /turtle1/cmd_vel geometry_msgs/msg/Twist \
  "{linear: {x: 2.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 1.8}}"
```

Rùa chạy một cung rồi dừng vì chỉ có một message. Bỏ `--once`, thêm `--rate 1` để chạy liên tục.
Lưu ý quan trọng: **turtlesim tự dừng rùa nếu ~1 s không nhận lệnh mới** (watchdog). Robot thật cũng thế, mất kết nối là dừng. Đây là lý do web UI gửi `cmd_vel` 10 Hz khi giữ phím.

## Bước 7. Gọi service

```bash
ros2 service type /spawn
ros2 interface show turtlesim/srv/Spawn          # phần trên --- là request, dưới là response
ros2 service call /spawn turtlesim/srv/Spawn "{x: 2, y: 2, theta: 0.2, name: 'turtle2'}"
ros2 service call /clear std_srvs/srv/Empty
ros2 service call /turtle1/set_pen turtlesim/srv/SetPen "{r: 255, g: 0, b: 0, width: 5, 'off': 0}"
```

## Bước 8. Parameter khi đang chạy

```bash
ros2 param get /turtlesim background_r
ros2 param set /turtlesim background_r 150
ros2 service call /clear std_srvs/srv/Empty       # turtlesim chỉ đọc lại màu nền khi vẽ lại
```

## Bước 9. Nhìn toàn cảnh

```bash
rqt_graph        # cần màn hình / X forwarding
```

Oval là node, chữ nhật là topic, mũi tên là chiều dữ liệu. Mở khi teleop đang chạy.

## Bước 10. Ghi và phát lại

```bash
ros2 bag record /turtle1/cmd_vel -o lan1      # lái rùa 10 s rồi Ctrl+C
ros2 bag info lan1
ros2 bag play lan1                            # rùa tự chạy lại đúng đường
```

Bag là công cụ debug quan trọng nhất khi làm robot thật: ghi cảm biến ngoài hiện trường, về phát lại để thử thuật toán.

## Ghi chú Foxy

- Không có `ros2 topic echo --once`. Thay bằng `timeout 3 ros2 topic echo /turtle1/pose | head -6`.
- Topic của rùa vừa spawn có thể chưa ra dữ liệu ngay vì discovery, tăng timeout.
- `ros2 node list` thấy tên trùng (`/turtlesim` hai lần) sau khi kill -9: bản ghi discovery cũ, chạy `ros2 daemon stop` để làm mới.

## Sau bài này

Bạn đã dùng đủ bộ CLI. Bước tiếp theo là đọc [03](03-kien-truc-turtle-web.md) để xem các khái niệm trên hiện ra trong code Python như thế nào.
