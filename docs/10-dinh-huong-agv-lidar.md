# 10 · Định hướng dự án kế tiếp: theo dõi vị trí nhiều AGV bằng lidar

Ghi lại kết quả thảo luận ngày 25/10/2026. Đây là tài liệu **thiết kế sơ bộ**, chưa có code.
Mục đích: khi bắt tay làm không phải bàn lại lựa chọn, và sinh viên hiểu vì sao chọn như vậy.

## 1. Yêu cầu

- Có sẵn đội AGV đang vận hành. **Không đụng vào AGV**: không đọc bus, không can thiệp điều khiển. Chỉ gắn thêm một "hộp" và lấy điện từ ắc quy.
- Chỉ cần **theo dõi** vị trí (không điều hướng), độ chính xác vài chục cm là đủ, "tương đối" theo nghĩa không cần đo lường.
- **Nhiều AGV trên một bản đồ chung**, hiển thị trên web như turtle_web.
- Thêm trên hộp: cảm biến pin ắc quy xe, camera chụp ảnh hiện trường định kỳ hoặc theo sự kiện.

## 2. So sánh ba phương án định vị trong nhà

| | Lidar 2D + AMCL | AprilTag trên trần + camera | UWB anchor + tag |
|---|---|---|---|
| Hạ tầng xưởng | **không cần** | dán 200–300 tag / 5 000 m², khảo sát vị trí | 4–8 anchor có nguồn trên tường |
| Chi phí mỗi xe | 2–10 triệu (lidar + Pi) | 1–2 triệu (camera + Pi) | tag vài trăm nghìn |
| Độ chính xác | 2–5 cm nơi hình học rõ, trôi ở hành lang trống | 2–5 cm khi thấy tag, mù giữa các tag | 10–30 cm, không cho hướng xe |
| Nhạy với thay đổi bố cục | phải quét lại bản đồ | không | không |
| Điểm yếu | khu kệ giống nhau → định vị sai mà tự tin; nhiều xe che nhau | ánh sáng, trần cao, che bởi cầu trục | kim loại lớn che sóng |
| Bảo trì dài hạn | thủ tục cập nhật bản đồ | tag bong, bẩn | anchor mất nguồn |

**Quyết định: lidar 2D.** Lý do chính: không phải đụng hạ tầng xưởng, gắn hộp lên xe là chạy, phù hợp
tinh thần "không đụng gì". AprilTag giữ làm phương án **neo** bổ sung tại vài điểm (trạm sạc, đầu hành lang)
nếu sau này AMCL trôi, và làm bài thực hành tf2 trong lab.

## 3. Kiến trúc

```
 ┌───────────── hộp trên mỗi AGV (Ubuntu 22.04, ROS 2 Humble) ─────────────┐
 │ lidar driver ─/scan─▶ odom lidar (rf2o) ─▶ EKF (+IMU) ─▶ AMCL (map chung)│
 │ battery node (INA228 / kẹp Hall) ─▶ BatteryState                         │
 │ camera node ─▶ JPEG theo sự kiện                                         │
 │ exporter ─▶ MQTT (pose, cov, battery, map_version)  + HTTP POST (ảnh)    │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │ WiFi xưởng, KHÔNG chạy DDS qua WiFi
 ┌───────────────────────────────▼──────────────────────────────────────────┐
 │ server (máy lab): Mosquitto ─▶ node gom ─▶ web (turtle_web mở rộng)      │
 │ nền = map.pgm, mỗi xe = một "rùa", ellipse covariance, ảnh theo vị trí   │
 │ kho bản đồ có phiên bản + hash, phát xuống hộp                           │
 └──────────────────────────────────────────────────────────────────────────┘
```

Cây tf trên hộp: `map → odom → base_link → laser`. Không có odometry bánh nên `odom → base_link`
sinh từ lidar (`rf2o_laser_odometry` hoặc `laser_scan_matcher`), ghép IMU qua `robot_localization`.
Bản đồ quét **một lần** bằng `slam_toolbox`, mọi hộp chạy `nav2_amcl` trên cùng file → cùng frame `map`.

Vì sao không DDS qua WiFi: discovery multicast rụng trên WiFi xưởng, khó debug, nhiều xe càng tệ.
Hộp đóng vai client đẩy JSON (pose 5–10 Hz, vài trăm byte) qua MQTT; mất mạng thì đệm, gửi bù.
Cần rviz từ xa thì dùng `zenoh-bridge-ros2dds` sau.

## 4. Phần cứng hộp

| Thành phần | Gợi ý | Ghi chú |
|---|---|---|
| Máy tính | Raspberry Pi 4/5 (8 GB) hoặc Jetson Orin Nano | Pi 4 đủ cho lidar 2D + AMCL 200–500 particle |
| Lidar 2D | RPLidar A2M12 / C1 (sai số 20–30 cm chấp nhận); S2/S3, SICK TiM571, Hokuyo UST-10LX cho xưởng lớn | gắn **cao hơn mọi vật trên xe**, **khác độ cao lidar an toàn của AGV**, cùng độ cao cho toàn đội |
| IMU | BNO055 / ICM-20948 | ổn định góc khi xoay nhanh, lấp khoảng trống |
| Nguồn | DC-DC **cách ly** 48 V → 5 V ≥ 3 A, cầu chì riêng | điểm duy nhất chạm xe. Không muốn chạm: pin 20 Ah |
| Đo pin xe | INA228 (chịu 85 V) đo điện áp tại điểm lấy nguồn; dòng toàn xe bằng **kẹp Hall** ±100 A nếu cần | publish `sensor_msgs/BatteryState`, dùng lại panel pin của turtle_web |
| Camera | Pi Camera / webcam USB, JPEG 640×480 ~50 KB | chụp theo sự kiện: dừng > 30 s, covariance lớn, vào/ra vùng, nút trên web; + 1 ảnh/5 phút |
| Mạng | WiFi Pi hoặc USB WiFi công nghiệp, chrony về server | điểm yếu nhất của hệ |
| Cơ khí | đế cứng chống rung, đo vị trí gắn so với tâm xe | mỗi hộp một file hiệu chuẩn `base_link → laser` |

## 5. Bản đồ chung: những điều phải quan tâm

Ba thứ **sửa sau rất đắt**, chốt trước:

1. **Độ cao gắn lidar thống nhất** cho toàn đội. Lidar 2D chỉ thấy một lát cắt; khác độ cao là khác bản đồ.
2. **Bản đồ có phiên bản và hash**, hộp gửi kèm trong mọi gói; web cảnh báo xe chạy bản đồ cũ. Hai xe khác phiên bản là hai frame khác dù cùng tên `map`.
3. **Gốc tọa độ và hướng khớp bản vẽ CAD xưởng** (hoặc một mốc rõ). Đổi sau là mọi dữ liệu lịch sử lệch.

Còn lại:

- Quét lúc xưởng tĩnh, vắng; lộ trình quét có đóng vòng; kiểm tra sai số bằng đo vài khoảng cách cột thật (< 1 %).
- Biên tập .pgm sau quét: xóa vết xe/người/pallet, tô unknown khu hay đổi, đóng khe cửa. Giữ bản gốc.
- Độ phân giải 5 cm/ô; xưởng rất lớn dùng 10 cm cho AMCL, 5 cm cho web.
- Thủ tục cập nhật bản đồ thành văn bản: quét lại → biên tập → tăng phiên bản → phát xuống lúc xe dừng → đặt lại pose.
- Nhiều tầng/khu tách biệt: mỗi khu một `map_id`, điểm chuyển cần đặt lại pose.
- Pose ban đầu: lưu pose cuối trước khi tắt; nút đặt lại trên web; tự tìm toàn cục khi covariance lớn lâu.
- Tham số AMCL theo loại xe (tốc độ, cách xoay), không copy một bộ cho tất cả.
- Các xe thấy nhau qua lidar: theo dõi covariance và tỉ lệ tia khớp, không chỉ vị trí.
- Đồng bộ đồng hồ (chrony); gói mang cả thời gian hộp và thời gian server nhận.
- Web vẽ nền đúng `origin`, `resolution`; cẩn thận lật trục y của ảnh .pgm.
- Kiểm chứng định kỳ tại vài mốc sơn trên sàn; ảnh camera kèm pose là công cụ cho việc này.

Vì chỉ cần theo dõi, nhiều mục trên có thể nới lỏng, nhưng ba mục đầu thì không.

## 6. Lộ trình

1. **Thử một xe, bộ rẻ**: Pi + RPLidar A2/C1 + IMU + DC-DC. Gắn tạm, chỉ `ros2 bag record /scan /imu/data` một ca chạy thật.
2. **Làm trên bàn từ bag**: dựng bản đồ bằng slam_toolbox, chạy AMCL từ bag, xem có bám ở hành lang dài và khu kệ giống nhau không. Đây là lúc biết có cần tag neo hay không.
3. Viết node exporter MQTT + node pin + node camera; launch file + systemd cho hộp (khuôn giống turtle_web).
4. Mở rộng turtle_web thành dashboard nhiều xe (nền map.pgm, nhiều "rùa", covariance, ảnh).
5. Lên xe thật, rồi nhân bản sang đội.

Lưu ý: máy lab là Foxy/20.04, hộp là Humble/22.04; bag Humble xử lý trong Docker `ros:humble` trên máy lab
(RAM 7.6 GB, đóng bớt thứ khác) hoặc trên một Pi thứ hai.

## 7. Lưu trữ và con người

- Ảnh: 1 xe × 1 ảnh/phút × 50 KB ≈ 70 MB/ngày. Giữ 30 ngày; ảnh sự kiện giữ lâu hơn.
- Xưởng có người: hạ độ phân giải hoặc làm mờ, thông báo cho công nhân, thống nhất với quản lý trước khi gắn camera.
- Hộp hết pin / mất mạng = xe "biến mất" trên bản đồ: báo trạng thái hộp rõ ràng trên web, khác với "xe mất định vị".
