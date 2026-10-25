#!/usr/bin/env python3
"""
battery_sim: gia lap pin AGV 48 V cho tung con rua.

Moi rua co 1 pack LiFePO4 16S (nominal 51.2 V, 40.0 - 58.4 V), publish
sensor_msgs/BatteryState len /<rua>/battery o 2 Hz.

Mo hinh (don gian nhung dung "dang" cua pin that):
  - Dong tai   I = I_idle + k_v*|v| + k_w*|w| + nhieu, loc thong thap (dong co phan ung cham)
  - Dien ap    V = OCV(soc) - I*R_pack + nhieu        (sut ap theo tai)
  - SoC        soc -= I*dt / (3600*C_Ah) * time_scale (tich phan dong, tang toc de nhin thay)
  - Nhiet do   dT = (I^2*R*k_heat - (T - T_moi)*k_cool) * dt
  - 16 cell co lech nhe, cell_voltage[] = V/16 + offset co dinh moi cell
  - soc < 5 %  -> health = DEAD-ish (OVERHEAT/COLD giu nguyen), status CRITICAL qua truong location

Tham so (ros2 param): capacity_ah=60, time_scale=30, ambient_c=28, rate_hz=2
"""

import math
import random
import threading

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import BatteryState
from turtlesim.msg import Pose

CELLS = 16
R_PACK = 0.060          # ohm
I_IDLE = 1.2            # A, dien tu + PLC + lidar
K_V = 6.0               # A per (m/s)
K_W = 1.5               # A per (rad/s)
I_TAU = 0.6             # s, hang so thoi gian dong co
K_HEAT = 0.012          # degC/s per W
K_COOL = 0.004          # 1/s
SOC_EMPTY = 0.03        # het pin -> tu dong "ve tram" sac
I_CHARGE = 25.0         # A, pha CC
CV_SOC = 0.90           # tu day chuyen sang CV, dong giam dan

# Duong cong OCV LiFePO4 theo SoC (per cell)
_OCV = [(0.00, 2.80), (0.03, 3.00), (0.08, 3.18), (0.15, 3.24), (0.30, 3.28),
        (0.60, 3.31), (0.85, 3.34), (0.93, 3.38), (0.98, 3.45), (1.00, 3.55)]


def ocv_cell(soc):
    soc = min(1.0, max(0.0, soc))
    for (s0, v0), (s1, v1) in zip(_OCV, _OCV[1:]):
        if soc <= s1:
            k = (soc - s0) / (s1 - s0) if s1 > s0 else 0.0
            return v0 + (v1 - v0) * k
    return _OCV[-1][1]


class Pack:
    def __init__(self, name, ambient):
        self.name = name
        self.soc = random.uniform(0.55, 0.95)
        self.temp = ambient + random.uniform(2.0, 5.0)
        self.current = I_IDLE
        self.v = 0.0
        self.w = 0.0
        self.cell_off = [random.gauss(0.0, 0.008) for _ in range(CELLS)]
        self.serial = f'AGV-{random.randint(1000, 9999)}'
        self.cycles = random.randint(120, 900)
        self.charging = False
        self.full_hold = 0.0    # giay giu trang thai FULL sau khi sac xong

    def step(self, dt, ambient, cap_ah, time_scale):
        """Tra ve (i, volt, temp, cells, status). i > 0 = xa, i < 0 = sac (dau quy uoc noi bo)."""
        # dong tai muc tieu + nhieu, loc thong thap
        i_target = I_IDLE + K_V * abs(self.v) + K_W * abs(self.w)
        i_target *= 1.0 + 0.04 * math.sin(random.random() * 6.283)      # dap mach nho
        self.current += (i_target - self.current) * min(1.0, dt / I_TAU)
        i_load = max(0.3, self.current + random.gauss(0.0, 0.15))

        # het pin -> sac (CC den CV_SOC, roi dong giam tuyen tinh ve ~1 A o 100 %)
        if not self.charging and self.soc <= SOC_EMPTY:
            self.charging = True
            self.cycles += 1
        if self.charging:
            if self.soc < CV_SOC:
                i_chg = I_CHARGE
            else:
                i_chg = max(1.0, I_CHARGE * (1.0 - self.soc) / (1.0 - CV_SOC))
            i_chg *= 1.0 + random.gauss(0.0, 0.01)
            i = i_load - i_chg                        # am = dang nap vao
            status = 'charging'
            if self.soc >= 0.999:
                self.charging = False
                self.full_hold = 20.0
        else:
            i = i_load
            status = 'discharging'
        if self.full_hold > 0:
            self.full_hold -= dt
            status = 'full'

        # SoC
        self.soc -= i * dt / (3600.0 * cap_ah) * time_scale
        self.soc = min(1.0, max(0.0, self.soc))
        if not self.charging and self.soc <= SOC_EMPTY:   # vua cham day trong buoc nay -> bao sac ngay
            self.charging = True
            self.cycles += 1
            status = 'charging'
        if status == 'full' and self.soc < 0.97:
            self.full_hold = 0.0
            status = 'discharging'

        # dien ap pack (sac: V = OCV + |I|R, co the len 57-58 V o cuoi CV)
        v_ocv = ocv_cell(self.soc) * CELLS
        volt = v_ocv - i * R_PACK + random.gauss(0.0, 0.04)
        if self.charging:
            volt = min(volt, 58.4)

        # nhiet
        p_loss = i * i * R_PACK
        self.temp += (p_loss * K_HEAT - (self.temp - ambient) * K_COOL) * dt
        temp = self.temp + random.gauss(0.0, 0.05)

        cells = [volt / CELLS + o for o in self.cell_off]
        return i, volt, temp, cells, status


class BatterySim(Node):
    def __init__(self):
        super().__init__('battery_sim')
        self.declare_parameter('capacity_ah', 60.0)
        self.declare_parameter('time_scale', 30.0)
        self.declare_parameter('ambient_c', 28.0)
        self.declare_parameter('rate_hz', 2.0)

        self._lock = threading.Lock()
        self._packs = {}     # name -> Pack
        self._subs = {}
        self._pubs = {}
        self._t_amb = 0.0

        rate = float(self.get_parameter('rate_hz').value)
        self.create_timer(1.0 / rate, self._tick)
        self.create_timer(2.0, self._discover)
        self._discover()
        self.get_logger().info('battery_sim san sang')

    # ---- theo doi rua qua topic pose
    def _discover(self):
        names = set()
        for topic, types in self.get_topic_names_and_types():
            if topic.endswith('/pose') and 'turtlesim/msg/Pose' in types:
                names.add(topic.split('/')[1])
        ambient = float(self.get_parameter('ambient_c').value)
        with self._lock:
            for n in names - set(self._packs):
                self._packs[n] = Pack(n, ambient)
                self._subs[n] = self.create_subscription(Pose, f'/{n}/pose', lambda m, n=n: self._on_pose(n, m), 10)
                self._pubs[n] = self.create_publisher(BatteryState, f'/{n}/battery', 10)
                self.get_logger().info(f'Gan pack {self._packs[n].serial} cho {n}, SoC {self._packs[n].soc*100:.0f}%')
            for n in set(self._packs) - names:
                self.destroy_subscription(self._subs.pop(n))
                self.destroy_publisher(self._pubs.pop(n))
                self._packs.pop(n)

    def _on_pose(self, name, msg):
        p = self._packs.get(name)
        if p:
            p.v, p.w = msg.linear_velocity, msg.angular_velocity

    # ---- mo phong + publish
    def _tick(self):
        rate = float(self.get_parameter('rate_hz').value)
        dt = 1.0 / rate
        cap = float(self.get_parameter('capacity_ah').value)
        ts = float(self.get_parameter('time_scale').value)
        # moi truong dao dong cham quanh ambient_c
        self._t_amb += dt
        ambient = float(self.get_parameter('ambient_c').value) + 0.8 * math.sin(self._t_amb / 90.0)

        now = self.get_clock().now().to_msg()
        with self._lock:
            items = list(self._packs.items())
        for name, pack in items:
            i, volt, temp, cells, status = pack.step(dt, ambient, cap, ts)
            msg = BatteryState()
            msg.header.stamp = now
            msg.header.frame_id = f'{name}/battery'
            msg.voltage = float(volt)
            msg.temperature = float(temp)
            msg.current = -float(i)                       # ROS: am = dang xa
            msg.charge = float(pack.soc * cap)
            msg.capacity = float(cap)
            msg.design_capacity = float(cap)
            msg.percentage = float(pack.soc)
            msg.power_supply_status = {
                'charging': BatteryState.POWER_SUPPLY_STATUS_CHARGING,
                'full': BatteryState.POWER_SUPPLY_STATUS_FULL,
            }.get(status, BatteryState.POWER_SUPPLY_STATUS_DISCHARGING)
            if temp > 55.0:
                msg.power_supply_health = BatteryState.POWER_SUPPLY_HEALTH_OVERHEAT
            elif pack.soc < 0.05 and status != 'charging':
                msg.power_supply_health = BatteryState.POWER_SUPPLY_HEALTH_DEAD
            else:
                msg.power_supply_health = BatteryState.POWER_SUPPLY_HEALTH_GOOD
            msg.power_supply_technology = BatteryState.POWER_SUPPLY_TECHNOLOGY_LIFE
            msg.present = True
            msg.cell_voltage = [float(c) for c in cells]
            msg.cell_temperature = [float(temp + random.gauss(0, 0.3)) for _ in range(CELLS)]
            msg.location = f'slot0;cycles={pack.cycles}'
            msg.serial_number = pack.serial
            pub = self._pubs.get(name)
            if pub:
                pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = BatterySim()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
