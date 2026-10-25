# 01 · Cài đặt ROS 2 Foxy trên Ubuntu 20.04

## Vì sao Foxy

Ubuntu 20.04 (Focal) chỉ có gói apt chính thức cho **ROS 2 Foxy Fitzroy**. Foxy hết hỗ trợ
tháng 05/2023 nhưng vẫn cài được và đủ để học toàn bộ khái niệm cốt lõi. Muốn dùng
Humble / Jazzy thì nâng lên Ubuntu 22.04 / 24.04 hoặc chạy Docker.

Những chỗ Foxy khác bản mới mà tài liệu này có đụng tới:

- `ros2 topic echo` **không có** cờ `--once` → dùng `timeout 3 ros2 topic echo /topic | head`.
- `SetEnvironmentVariable` trong `GroupAction` của launch không truyền env cho `Node` → dùng `additional_env`.
- `launch_ros.parameter_descriptions.ParameterValue` có sẵn (dùng để ép kiểu tham số từ launch arg).

## Cài đặt

```bash
# 1. locale + repo
sudo apt update && sudo apt install -y locales curl gnupg lsb-release
sudo locale-gen en_US en_US.UTF-8
sudo update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
     -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" \
  | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null
sudo apt update

# 2. ROS 2 Foxy + công cụ
sudo apt install -y ros-foxy-desktop ros-dev-tools \
     python3-colcon-common-extensions python3-rosdep python3-argcomplete

# 3. rosdep
sudo rosdep init   # bỏ qua nếu báo đã có
rosdep update

# 4. tự source mỗi terminal
echo "source /opt/ros/foxy/setup.bash" >> ~/.bashrc
source ~/.bashrc
```

## Kiểm tra

Terminal 1 và 2:

```bash
ros2 run demo_nodes_cpp talker
ros2 run demo_nodes_py listener
```

Thấy `Publishing: 'Hello World: N'` và `I heard: ...` là xong.

```bash
ros2 pkg prefix turtlesim      # /opt/ros/foxy  → có turtlesim
```

## Phụ thuộc riêng của dự án này

`scripts/install.sh` cài tự động, liệt kê để biết:

| Gói | Dùng cho |
|---|---|
| `ros-foxy-turtlesim` | robot giả lập |
| `ros-foxy-sensor-msgs` | `BatteryState` của node pin |
| `python3-flask` (1.1.1, apt) | web server; cài bằng apt để khớp Python 3.8 hệ thống |
| `xvfb` | X server ảo để turtlesim chạy không cần màn hình |
| `glslang-tools` (tùy chọn) | `glslangValidator` kiểm tra shader WebGL khi sửa `gl.js` |

## Máy ảo / máy lab không có màn hình

Hai cách xem cửa sổ turtlesim nếu cần:

1. **Không cần xem**: dự án này chạy turtlesim trong Xvfb, mọi thứ hiển thị trên web. Đây là cách mặc định.
2. **X forwarding**: trên máy khách cài X server (macOS: XQuartz), `ssh -X user@ip`, kiểm tra
   `echo $DISPLAY` ra `localhost:10.0`. Cảnh báo `libGL error: failed to load driver: swrast` khi mở
   turtlesim là bình thường. Chạy `ros2 launch turtle_web turtle_web.launch.py headless:=false`.

## Nhiều hệ ROS trong cùng mạng LAN

ROS 2 dùng DDS multicast, các máy cùng mạng sẽ "thấy" node của nhau. Phòng lab nhiều máy thì
mỗi máy đặt `export ROS_DOMAIN_ID=<số 0-101>` khác nhau (thêm vào `~/.bashrc` và vào service,
xem `systemd/turtle-web.service.in`).
