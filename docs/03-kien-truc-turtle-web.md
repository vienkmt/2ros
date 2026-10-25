# 03 · Kiến trúc package turtle_web

```
                 ┌──────────────── trình duyệt ────────────────┐
                 │ app.js: SSE nhận pose/battery/goal          │
                 │         gửi cmd_vel 10 Hz, gọi API          │
                 │ gl.js : WebGL (lưới, vết, rùa SDF)          │
                 └──────────────▲───────────────┬──────────────┘
                     text/event-stream      POST /api/...
                 ┌──────────────┴───────────────▼──────────────┐
                 │ web_node.py  (node /turtle_web)             │
                 │  Flask (thread chính)  ⇄  TurtleBridge      │
                 │  rclpy.spin (thread phụ)                    │
                 │  timer 20 Hz: controller goto/shape/turn    │
                 └───┬──────────▲───────────────▲──────────────┘
          cmd_vel    │          │ pose          │ BatteryState
                     ▼          │               │
              turtlesim_node ───┘        battery_sim.py ◀── pose
              (DISPLAY=:99 Xvfb)
```

Ba node, một package, nói chuyện hoàn toàn qua topic/service chuẩn. Bất kỳ node nào cũng thay được bằng robot thật nếu giữ interface.

## 1. web_node.py

### 1.1 Spin ở thread phụ

`rclpy.spin(node)` chặn vĩnh viễn, `app.run()` của Flask cũng vậy. Giải pháp:

```python
threading.Thread(target=rclpy.spin, args=(bridge,), daemon=True).start()
app.run(host, port, threaded=True)
```

Hệ quả: callback ROS (pose, battery, timer) chạy ở thread spin; handler Flask chạy ở thread khác. Mọi dict dùng chung (`_poses`, `_batt`, `_listeners`) được bảo vệ bằng `threading.Lock`.

### 1.2 Gọi service từ thread Flask

Không được `rclpy.spin_until_future_complete` vì spin đang chạy ở thread khác (deadlock). Chỉ `call_async` rồi chờ `future.done()`:

```python
fut = client.call_async(req)
while not fut.done(): time.sleep(0.01)   # có deadline
```

Hệ quả thứ hai: **không gọi service từ trong callback ROS** (timer, subscriber), vì thread hoàn thành future chính là thread đang chạy callback → treo. Vì vậy đặt bút mặc định (dày 2) cho rùa mới được client gọi qua API, không gọi trong `track_turtle`.

### 1.3 Discovery

`get_topic_names_and_types()` 2 s một lần: topic `/<x>/pose` kiểu `turtlesim/msg/Pose` ⇒ có rùa `x`. Rùa spawn từ CLI hay bị kill ở đâu cũng được web theo dõi đúng.

### 1.4 Server-Sent Events

Mỗi client giữ một `Queue`. Callback pose/battery `json.dumps` một lần rồi `put_nowait` vào mọi queue; generator Flask `yield f'data: {payload}\n\n'`. 15 s không có gì thì gửi `: keepalive`. Chọn SSE thay WebSocket vì một chiều là đủ, không cần thư viện, tự reconnect.

Sự kiện: `pose`, `battery`, `goal` (có `path` khi là hình), `goal_done`, `removed`.

### 1.5 Controller (timer 20 Hz, `_goto_step`)

Một "goal" là danh sách điểm + chế độ:

| mode | dùng cho | luật |
|---|---|---|
| `sharp` | click đích, vuông, đa giác | 2 pha: **turn** ω = K·err tới khi \|err\| < 0.03 rad; **go** v = min(speed, 1.5·dist), ω = K·err; lệch > 0.5 rad quay lại turn; tới < 8 cm thì sang điểm kế |
| `smooth` | số 8, elip, tròn | không dừng: v = speed·max(0.15, cos err), ω = K·err; cách < 30 cm thì sang điểm kế (lookahead) |
| `heading` | xoay 5° từng bước | ω = K·err tới hướng đích, gọi liên tiếp thì cộng dồn đích |

err = wrap(atan2(dy,dx) − θ) về [−π, π]. Đây là bộ điều khiển P hai tầng, nền của mọi bài "move to pose". Bất kỳ `cmd_vel` tay nào tới là goal bị hủy (người ưu tiên máy).

Hình được sinh trong `set_shape` từ pose hiện tại: số 8 là lemniscate Gerono đi qua chính vị trí rùa, elip/tròn/đa giác bắt đầu từ điểm trái nhất; tâm được dịch để toàn hình nằm trong lề 0.4.

### 1.6 Parameter của node khác

Không có API trực tiếp; gọi service `/turtlesim/get_parameters`, `/turtlesim/set_parameters` (`rcl_interfaces/srv`). Đổi nền xong phải `/clear` vì turtlesim chỉ đọc màu khi vẽ lại.

## 2. battery_sim.py

Mỗi rùa một pack LiFePO4 16S (40.0 đến 58.4 V, nominal 51.2 V). Publish `sensor_msgs/BatteryState` lên `/<rùa>/battery` 2 Hz. Mô hình:

```
I_load = 1.2 + 6·|v| + 1.5·|ω|  (A), lọc thông thấp τ = 0.6 s, nhiễu
V      = OCV(soc)·16 − I·0.06 Ω
soc   -= I·dt / (3600·C_Ah) · time_scale          # time_scale 30 để thấy hao trong vài phút
dT     = (I²R·0.012 − (T − T_amb)·0.004)·dt
soc ≤ 3 % → sạc: CC 25 A đến 90 %, CV giảm tuyến tính về 1 A ở 100 %, rồi FULL, rồi xả
```

Quy ước ROS: `current` âm khi xả. Trường `power_supply_status` CHARGING/FULL/DISCHARGING, `power_supply_health` OVERHEAT > 55 °C, DEAD < 5 %. Tham số đổi lúc chạy: `ros2 param set /battery_sim time_scale 5`.

## 3. Phía trình duyệt

### 3.1 Nội suy pose (app.js)

Pose đến 62 Hz nhưng qua mạng không đều; vẽ ngay khi nhận thì khung nào thiếu mẫu rùa đứng, khung sau nhảy. Giải pháp giống game online: giữ bộ đệm mẫu có timestamp server, ước lượng lệch đồng hồ bằng min(now − t), vẽ ở thời điểm lùi **60 ms** và nội suy giữa 2 mẫu; thiếu mẫu thì ngoại suy theo cung tròn từ v, ω tối đa 150 ms. Góc nội suy theo cung ngắn nhất.

### 3.2 WebGL (gl.js)

- Canvas kích thước bitmap = CSS × devicePixelRatio, nên nét trên Retina.
- Lưới và vết là **capsule**: mỗi đoạn một quad, fragment tính khoảng cách tới đoạn → đầu tròn, khử răng cưa 1 px. Vết nằm trong một VBO 60 000 đoạn, mỗi khung 1 draw call. Mỗi đoạn mang thời điểm tạo; vertex shader giảm alpha một nửa sau mỗi 60 s (sàn 12 %) nên vết cũ mờ dần mà không tốn CPU.
- Rùa là **SDF** trong fragment shader: mai elip + hoa văn 6 nan, đầu, 2 mắt, 4 chân, đuôi, bóng; rùa chọn có vòng nét đứt xoay. Mọi kích thước theo bán kính `r`, đổi một số là cả con đổi.
- Chữ (tên rùa, số trục) vẽ bằng canvas 2D trong suốt phủ lên vì WebGL không có text.
- Không có WebGL (hoặc `?no-gl`) thì tự về Canvas 2D với cùng tính năng.

### 3.3 Điều khiển

Giữ phím tiến/lùi → vòng lặp 100 ms gửi `cmd_vel` (khớp watchdog 1 s của turtlesim). Mũi tên trái/phải → `/api/turn` 5° mỗi lần, auto-repeat của OS hoặc timer 150 ms khi giữ nút. Joystick: trục dọc là v, trục ngang là ω. Click bản đồ → `/api/goto`; Shift+click → teleport.

## 4. Launch

`launch/turtle_web.launch.py`:

- `headless:=true` (mặc định): `ExecuteProcess` Xvfb `:99`, `TimerAction` 1 s rồi `Node turtlesim` với `additional_env={'DISPLAY': ':99'}` và nền 33 36 69.
- `headless:=false`: turtlesim dùng DISPLAY hiện tại.
- `port:=5000` ép kiểu int bằng `ParameterValue(..., value_type=int)`.

## 5. Luồng phát triển

```bash
cd ~/ros2_ws && colcon build --symlink-install     # chỉ khi đổi setup.py / package.xml / thêm file
sudo systemctl restart turtle-web                   # sau khi sửa .py
# sửa html/js/css: chỉ cần tải lại cứng trang (Cmd/Ctrl+Shift+R)
```

Kiểm tra cú pháp không cần trình duyệt: `python3 -m py_compile`, `pip install esprima` rồi `esprima.parseScript`, `glslangValidator` cho shader (prepend `#version 100`).

Đọc tiếp: [src/turtle_web/README.md](../src/turtle_web/README.md) có bảng API đầy đủ.
