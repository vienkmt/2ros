#!/usr/bin/env python3
"""
turtle_web: dieu khien turtlesim qua trinh duyet.

Kien truc:
  - Mot node rclpy (TurtleBridge) chay spin trong thread rieng:
      * publish  /turtleN/cmd_vel        (geometry_msgs/Twist)
      * subscribe /turtleN/pose          (turtlesim/Pose)  -> luu vao bo nho
      * client service /spawn, /kill, /clear, /turtleN/set_pen,
                       /turtleN/teleport_absolute
      * doc / ghi parameter background_r/g/b cua node /turtlesim
  - Flask server chay o thread chinh, phuc vu HTML/JS/CSS + REST API + SSE.

Trinh duyet  --HTTP-->  Flask  --rclpy-->  /turtlesim
"""

import json
import math
import os
import threading
import time
from queue import Queue, Empty as QueueEmpty

import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from rcl_interfaces.srv import GetParameters, SetParameters
from rcl_interfaces.msg import Parameter as ParamMsg, ParameterValue, ParameterType

from geometry_msgs.msg import Twist
from turtlesim.msg import Pose
from sensor_msgs.msg import BatteryState
from turtlesim.srv import Spawn, Kill, SetPen, TeleportAbsolute
from std_srvs.srv import Empty

from flask import Flask, jsonify, request, Response, send_from_directory


# ---------------------------------------------------------------------------
# Phan ROS 2
# ---------------------------------------------------------------------------
class TurtleBridge(Node):
    """Cau noi giua web va turtlesim. Moi thu lien quan ROS nam o day."""

    def __init__(self):
        super().__init__('turtle_web')

        # Tham so cua chinh node nay (co the doi khi chay: ros2 param set /turtle_web port 8080)
        self.declare_parameter('port', 5000)
        self.declare_parameter('host', '0.0.0.0')

        self._lock = threading.Lock()
        self._pubs = {}        # name -> publisher cmd_vel
        self._subs = {}        # name -> subscription pose
        self._poses = {}       # name -> dict pose moi nhat
        self._batt_subs = {}   # name -> subscription battery
        self._batt = {}        # name -> dict pin moi nhat
        self._listeners = []   # cac Queue cua client SSE dang mo

        # Service client dung chung cho ca sim
        self.cli_spawn = self.create_client(Spawn, '/spawn')
        self.cli_kill = self.create_client(Kill, '/kill')
        self.cli_clear = self.create_client(Empty, '/clear')
        self.cli_get_param = self.create_client(GetParameters, '/turtlesim/get_parameters')
        self.cli_set_param = self.create_client(SetParameters, '/turtlesim/set_parameters')

        # Rua mac dinh luon co san
        self.track_turtle('turtle1')

        # Dinh ky quet xem co rua nao moi (vd spawn tu CLI) de tu dong theo doi
        self.create_timer(2.0, self._discover_turtles)

        # Bo dieu khien go-to-goal (closed-loop theo pose), chay 20 Hz
        self._goals = {}       # name -> {'x','y','speed','phase'}
        self.create_timer(0.05, self._goto_step)

        self.get_logger().info('TurtleBridge san sang')

    # ---- Quan ly danh sach rua -------------------------------------------
    def track_turtle(self, name):
        with self._lock:
            if name in self._pubs:
                return
            self._pubs[name] = self.create_publisher(Twist, f'/{name}/cmd_vel', 10)
            self._subs[name] = self.create_subscription(
                Pose, f'/{name}/pose',
                lambda msg, n=name: self._on_pose(n, msg), 10)
            self._batt_subs[name] = self.create_subscription(
                BatteryState, f'/{name}/battery',
                lambda msg, n=name: self._on_battery(n, msg), 10)
            self._poses[name] = None
        self.get_logger().info(f'Theo doi {name}')

    def untrack_turtle(self, name):
        self._goals.pop(name, None)
        with self._lock:
            pub = self._pubs.pop(name, None)
            sub = self._subs.pop(name, None)
            bsub = self._batt_subs.pop(name, None)
            self._poses.pop(name, None)
            self._batt.pop(name, None)
        if pub:
            self.destroy_publisher(pub)
        if sub:
            self.destroy_subscription(sub)
        if bsub:
            self.destroy_subscription(bsub)
        self._broadcast({'type': 'removed', 'name': name})

    def _discover_turtles(self):
        # Topic nao dang ton tai dang /xxx/pose kieu turtlesim/msg/Pose thi la mot con rua
        names = set()
        for topic, types in self.get_topic_names_and_types():
            if topic.endswith('/pose') and 'turtlesim/msg/Pose' in types:
                names.add(topic.split('/')[1])
        for n in names - set(self._pubs):
            self.track_turtle(n)
        for n in set(self._pubs) - names:
            self.untrack_turtle(n)

    # ---- Pose: nhan tu ROS, day sang web ---------------------------------
    def _on_pose(self, name, msg):
        d = {
            'type': 'pose', 'name': name,
            'x': round(msg.x, 3), 'y': round(msg.y, 3), 'theta': round(msg.theta, 3),
            'v': round(msg.linear_velocity, 3), 'w': round(msg.angular_velocity, 3),
            't': time.time(),
        }
        with self._lock:
            self._poses[name] = d
        self._broadcast(d)

    def _on_battery(self, name, msg):
        health = {0: 'unknown', 1: 'good', 2: 'overheat', 3: 'dead', 4: 'overvoltage',
                  5: 'unspec_failure', 6: 'cold', 7: 'watchdog', 8: 'safety'}.get(msg.power_supply_health, 'unknown')
        cells = list(msg.cell_voltage)
        status = {1: 'charging', 2: 'discharging', 3: 'not_charging', 4: 'full'}.get(msg.power_supply_status, 'unknown')
        d = {
            'type': 'battery', 'name': name, 'status': status,
            'voltage': round(msg.voltage, 2), 'current': round(msg.current, 2),
            'temp': round(msg.temperature, 1), 'soc': round(msg.percentage, 4),
            'charge_ah': round(msg.charge, 2), 'capacity_ah': round(msg.capacity, 1),
            'health': health, 'serial': msg.serial_number,
            'cell_min': round(min(cells), 3) if cells else None,
            'cell_max': round(max(cells), 3) if cells else None,
            't': time.time(),
        }
        with self._lock:
            self._batt[name] = d
        self._broadcast(d)

    def battery_snapshot(self):
        with self._lock:
            return dict(self._batt)

    def _broadcast(self, data):
        payload = json.dumps(data)
        dead = []
        with self._lock:
            for q in self._listeners:
                try:
                    q.put_nowait(payload)
                except Exception:
                    dead.append(q)
            for q in dead:
                self._listeners.remove(q)

    def add_listener(self):
        q = Queue(maxsize=200)
        with self._lock:
            self._listeners.append(q)
        return q

    def remove_listener(self, q):
        with self._lock:
            if q in self._listeners:
                self._listeners.remove(q)

    def snapshot(self):
        with self._lock:
            return {k: v for k, v in self._poses.items() if v}

    # ---- Lenh van toc ----------------------------------------------------
    def cmd_vel(self, name, linear, angular):
        pub = self._pubs.get(name)
        if pub is None:
            raise KeyError(f'khong co rua {name}')
        if name in self._goals:            # nguoi dung cam tay -> bo muc tieu tu dong
            self.cancel_goal(name, reason='manual')
        msg = Twist()
        msg.linear.x = float(linear)
        msg.angular.z = float(angular)
        pub.publish(msg)

    # ---- Go-to-goal / bam waypoint -----------------------------------------
    # Mot "goal" la danh sach diem. mode='sharp': tai moi diem xoay cho dung huong roi
    # tien (goc nhon, dung cho da giac). mode='smooth': luon chay, chi be lai theo sai
    # goc, chuyen diem som (lookahead) -> duong cong lien tuc (so 8, elip).
    GOAL_TOL = 0.08          # sharp: toi dich khi con cach < 8 cm
    SMOOTH_TOL = 0.30        # smooth: chuyen diem ke khi cach < 30 cm
    TURN_TOL = 0.03
    REALIGN = 0.5
    K_TURN = 4.0
    K_HEAD = 3.0
    K_SMOOTH = 4.0
    K_DIST = 1.5
    MIN_TURN = 0.4
    MIN_LIN = 0.3
    MARGIN = 0.4             # cach bien ban do

    @staticmethod
    def _wrap(a):
        return (a + math.pi) % (2 * math.pi) - math.pi

    def _start_path(self, name, pts, speed, mode, loop=False, label='goal'):
        if name not in self._pubs:
            raise KeyError(f'khong co rua {name}')
        pts = [(min(11.0 - self.MARGIN, max(self.MARGIN, float(x))),
                min(11.0 - self.MARGIN, max(self.MARGIN, float(y)))) for x, y in pts]
        self._goals[name] = {'pts': pts, 'i': 0, 'speed': max(0.2, float(speed)),
                             'mode': mode, 'phase': 'turn', 'loop': bool(loop), 'label': label}
        self._broadcast({'type': 'goal', 'name': name, 'x': pts[0][0], 'y': pts[0][1],
                         'path': pts if len(pts) > 1 else None, 'loop': bool(loop), 'label': label})

    def set_goal(self, name, x, y, speed=2.0):
        self._start_path(name, [(x, y)], speed, 'sharp')

    def turn_by(self, name, delta_rad, speed=2.0):
        """Xoay tai cho them delta (rad), closed-loop. Goi lien tiep thi cong don muc tieu."""
        if name not in self._pubs:
            raise KeyError(f'khong co rua {name}')
        pose = self._poses.get(name)
        if pose is None:
            raise RuntimeError(f'chua co pose cua {name}')
        g = self._goals.get(name)
        if g and g.get('mode') == 'heading':
            g['target'] = self._wrap(g['target'] + delta_rad)
            g['speed'] = max(0.3, float(speed))
        else:
            self._goals[name] = {'mode': 'heading', 'target': self._wrap(pose['theta'] + delta_rad),
                                 'speed': max(0.3, float(speed)), 'pts': [], 'i': 0, 'loop': False,
                                 'label': 'turn', 'phase': 'turn'}
        return math.degrees(self._goals[name]['target'])

    def set_shape(self, name, shape, size=2.0, sides=5, speed=2.0, loop=False):
        pose = self._poses.get(name)
        if pose is None:
            raise RuntimeError(f'chua co pose cua {name}')
        px, py = pose['x'], pose['y']
        a = max(0.5, min(5.0, float(size)))
        n = max(3, min(12, int(sides)))
        lo, hi = self.MARGIN, 11.0 - self.MARGIN

        def fit_center(cx, cy, rx, ry):
            return min(hi - rx, max(lo + rx, cx)), min(hi - ry, max(lo + ry, cy))

        if shape == 'figure8':
            # lemniscate Gerono: di qua tam, bat dau tu vi tri rua
            cx, cy = fit_center(px, py, a, a / 2)
            pts = [(cx + a * math.sin(t), cy + a * math.sin(t) * math.cos(t))
                   for t in [k * 2 * math.pi / 48 for k in range(1, 49)]]
            mode = 'smooth'
        elif shape == 'ellipse':
            rx, ry = a, a * 0.6
            cx, cy = fit_center(px + rx, py, rx, ry)        # rua dang o dau trai elip
            pts = [(cx - rx * math.cos(t), cy - ry * math.sin(t))
                   for t in [k * 2 * math.pi / 36 for k in range(1, 37)]]
            mode = 'smooth'
        elif shape == 'circle':
            cx, cy = fit_center(px + a, py, a, a)
            pts = [(cx - a * math.cos(t), cy - a * math.sin(t))
                   for t in [k * 2 * math.pi / 36 for k in range(1, 37)]]
            mode = 'smooth'
        elif shape in ('polygon', 'square'):
            if shape == 'square':
                n = 4
            r = a
            cx, cy = fit_center(px + r, py, r, r)          # rua dang o dinh ben trai
            pts = [(cx + r * math.cos(math.pi + k * 2 * math.pi / n), cy + r * math.sin(math.pi + k * 2 * math.pi / n))
                   for k in range(1, n + 1)]
            mode = 'sharp'
        else:
            raise ValueError(f'khong biet hinh {shape}')
        self._start_path(name, pts, speed, mode, loop, label=shape)
        return len(pts)

    def cancel_goal(self, name, reason='cancel'):
        g = self._goals.pop(name, None)
        if g is None:
            return False
        self._publish_twist(name, 0.0, 0.0)
        if g['mode'] == 'heading':
            return True
        self._broadcast({'type': 'goal_done', 'name': name, 'reached': False, 'reason': reason})
        return True

    def _publish_twist(self, name, v, w):
        pub = self._pubs.get(name)
        if pub is None:
            return
        msg = Twist()
        msg.linear.x = float(v)
        msg.angular.z = float(w)
        pub.publish(msg)

    def _advance(self, name, g):
        """Sang diem ke tiep. Tra ve False neu da het duong."""
        g['i'] += 1
        if g['i'] >= len(g['pts']):
            if g['loop']:
                g['i'] = 0
            else:
                return False
        g['phase'] = 'turn'
        x, y = g['pts'][g['i']]
        self._broadcast({'type': 'goal', 'name': name, 'x': x, 'y': y, 'label': g['label']})
        return True

    def _goto_step(self):
        for name, g in list(self._goals.items()):
            pose = self._poses.get(name)
            if pose is None:
                continue
            if g['mode'] == 'heading':
                err = self._wrap(g['target'] - pose['theta'])
                if abs(err) < 0.008:                       # ~0.5 do
                    self._goals.pop(name, None)
                    self._publish_twist(name, 0.0, 0.0)
                    continue
                w = self.K_TURN * err
                w = math.copysign(max(0.3, min(abs(w), g['speed'])), w)
                self._publish_twist(name, 0.0, w)
                continue
            tx, ty = g['pts'][g['i']]
            dx, dy = tx - pose['x'], ty - pose['y']
            dist = math.hypot(dx, dy)
            err = self._wrap(math.atan2(dy, dx) - pose['theta'])
            spd = g['speed']

            if g['mode'] == 'smooth':
                if dist < self.SMOOTH_TOL and not self._advance(name, g):
                    self._finish(name)
                    continue
                # cham lai khi lech huong nhieu, khong bao gio dung han
                v = spd * max(0.15, math.cos(err))
                w = max(-1.5 * spd, min(1.5 * spd, self.K_SMOOTH * err))
                self._publish_twist(name, v, w)
                continue

            # ---- sharp: 2 pha
            if dist < self.GOAL_TOL:
                if not self._advance(name, g):
                    self._finish(name)
                else:
                    self._publish_twist(name, 0.0, 0.0)
                continue
            if g['phase'] == 'turn':
                if abs(err) < self.TURN_TOL:
                    g['phase'] = 'go'
                    continue
                w = self.K_TURN * err
                w = math.copysign(max(self.MIN_TURN, min(abs(w), spd)), w)
                self._publish_twist(name, 0.0, w)
            else:
                if abs(err) > self.REALIGN:
                    g['phase'] = 'turn'
                    continue
                v = min(spd, max(self.MIN_LIN, self.K_DIST * dist))
                w = max(-spd, min(spd, self.K_HEAD * err))
                self._publish_twist(name, v, w)

    def _finish(self, name):
        self._goals.pop(name, None)
        self._publish_twist(name, 0.0, 0.0)
        self._broadcast({'type': 'goal_done', 'name': name, 'reached': True})

    def goals(self):
        out = {}
        for n, g in self._goals.items():
            if g['mode'] == 'heading':
                continue
            x, y = g['pts'][g['i']]
            out[n] = {'x': x, 'y': y, 'path': g['pts'] if len(g['pts']) > 1 else None,
                      'loop': g['loop'], 'label': g['label']}
        return out

    # ---- Service helper --------------------------------------------------
    def _call(self, client, req, timeout=3.0):
        if not client.wait_for_service(timeout_sec=timeout):
            raise RuntimeError(f'service {client.srv_name} khong san sang (turtlesim_node da chay chua?)')
        fut = client.call_async(req)
        # Khong duoc spin o day vi spin dang chay o thread khac. Chi cho future xong.
        deadline = time.time() + timeout
        while not fut.done():
            if time.time() > deadline:
                raise RuntimeError(f'service {client.srv_name} qua thoi gian')
            time.sleep(0.01)
        if fut.exception():
            raise fut.exception()
        return fut.result()

    def spawn(self, x, y, theta, name):
        req = Spawn.Request()
        req.x, req.y, req.theta, req.name = float(x), float(y), float(theta), name or ''
        res = self._call(self.cli_spawn, req)
        self.track_turtle(res.name)
        return res.name

    def kill(self, name):
        if name not in self._pubs:
            raise KeyError(f'khong co rua {name}')
        req = Kill.Request()
        req.name = name
        self._call(self.cli_kill, req)
        self.untrack_turtle(name)

    def clear(self):
        self._call(self.cli_clear, Empty.Request())

    def set_pen(self, name, r, g, b, width, off):
        cli = self.create_client(SetPen, f'/{name}/set_pen')
        try:
            req = SetPen.Request()
            req.r, req.g, req.b = int(r), int(g), int(b)
            req.width, req.off = int(width), int(off)
            self._call(cli, req)
        finally:
            self.destroy_client(cli)

    def teleport(self, name, x, y, theta):
        cli = self.create_client(TeleportAbsolute, f'/{name}/teleport_absolute')
        try:
            req = TeleportAbsolute.Request()
            req.x, req.y, req.theta = float(x), float(y), float(theta)
            self._call(cli, req)
        finally:
            self.destroy_client(cli)

    def get_background(self):
        req = GetParameters.Request()
        req.names = ['background_r', 'background_g', 'background_b']
        res = self._call(self.cli_get_param, req)
        return [v.integer_value for v in res.values]

    def set_background(self, r, g, b):
        req = SetParameters.Request()
        for n, v in (('background_r', r), ('background_g', g), ('background_b', b)):
            p = ParamMsg()
            p.name = n
            p.value = ParameterValue(type=ParameterType.PARAMETER_INTEGER, integer_value=int(v))
            req.parameters.append(p)
        self._call(self.cli_set_param, req)
        # turtlesim chi doc lai mau nen khi ve lai -> goi clear
        self.clear()


# ---------------------------------------------------------------------------
# Phan Flask
# ---------------------------------------------------------------------------
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')


def create_app(bridge: TurtleBridge) -> Flask:
    app = Flask(__name__, static_folder=os.path.join(WEB_DIR, 'static'), static_url_path='/static')

    def ok(**kw):
        kw.setdefault('ok', True)
        return jsonify(kw)

    def fail(e, code=400):
        bridge.get_logger().warn(f'API loi: {e}')
        return jsonify(ok=False, error=str(e)), code

    @app.route('/')
    def index():
        return send_from_directory(WEB_DIR, 'index.html')

    # -- Trang thai -------------------------------------------------------
    @app.route('/api/state')
    def state():
        return ok(turtles=bridge.snapshot(), names=sorted(bridge._pubs), goals=bridge.goals(), battery=bridge.battery_snapshot())

    @app.route('/api/stream')
    def stream():
        """Server-Sent Events: day pose lien tuc xuong trinh duyet."""
        q = bridge.add_listener()

        def gen():
            try:
                # gui snapshot ban dau
                for d in bridge.snapshot().values():
                    yield f'data: {json.dumps(d)}\n\n'
                for d in bridge.battery_snapshot().values():
                    yield f'data: {json.dumps(d)}\n\n'
                for n, g in bridge.goals().items():
                    yield f'data: {json.dumps({"type": "goal", "name": n, **g})}\n\n'
                while True:
                    try:
                        payload = q.get(timeout=15)
                        yield f'data: {payload}\n\n'
                    except QueueEmpty:
                        yield ': keepalive\n\n'
            finally:
                bridge.remove_listener(q)

        return Response(gen(), mimetype='text/event-stream',
                        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    # -- Dieu khien -------------------------------------------------------
    @app.route('/api/cmd_vel', methods=['POST'])
    def cmd_vel():
        d = request.get_json(force=True) or {}
        try:
            bridge.cmd_vel(d.get('name', 'turtle1'), d.get('linear', 0.0), d.get('angular', 0.0))
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/goto', methods=['POST'])
    def goto():
        d = request.get_json(force=True) or {}
        try:
            bridge.set_goal(d.get('name', 'turtle1'), d['x'], d['y'], d.get('speed', 2.0))
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/turn', methods=['POST'])
    def turn():
        d = request.get_json(force=True) or {}
        try:
            tgt = bridge.turn_by(d.get('name', 'turtle1'), math.radians(float(d.get('delta_deg', 5))), d.get('speed', 2.0))
            return ok(target_deg=round(tgt, 1))
        except Exception as e:
            return fail(e)

    @app.route('/api/shape', methods=['POST'])
    def shape():
        d = request.get_json(force=True) or {}
        try:
            n = bridge.set_shape(d.get('name', 'turtle1'), d.get('shape', 'figure8'), d.get('size', 2.0),
                                 d.get('sides', 5), d.get('speed', 2.0), d.get('loop', False))
            return ok(points=n)
        except Exception as e:
            return fail(e)

    @app.route('/api/goto/cancel', methods=['POST'])
    def goto_cancel():
        d = request.get_json(force=True) or {}
        return ok(cancelled=bridge.cancel_goal(d.get('name', 'turtle1')))

    @app.route('/api/spawn', methods=['POST'])
    def spawn():
        d = request.get_json(force=True) or {}
        try:
            name = bridge.spawn(d.get('x', 5.5), d.get('y', 5.5), d.get('theta', 0.0), d.get('name', ''))
            return ok(name=name)
        except Exception as e:
            return fail(e)

    @app.route('/api/kill', methods=['POST'])
    def kill():
        d = request.get_json(force=True) or {}
        try:
            bridge.kill(d['name'])
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/clear', methods=['POST'])
    def clear():
        try:
            bridge.clear()
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/set_pen', methods=['POST'])
    def set_pen():
        d = request.get_json(force=True) or {}
        try:
            bridge.set_pen(d.get('name', 'turtle1'), d.get('r', 179), d.get('g', 184), d.get('b', 255),
                           d.get('width', 3), d.get('off', 0))
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/teleport', methods=['POST'])
    def teleport():
        d = request.get_json(force=True) or {}
        try:
            bridge.teleport(d.get('name', 'turtle1'), d['x'], d['y'], d.get('theta', 0.0))
            return ok()
        except Exception as e:
            return fail(e)

    @app.route('/api/background', methods=['GET', 'POST'])
    def background():
        try:
            if request.method == 'POST':
                d = request.get_json(force=True) or {}
                bridge.set_background(d['r'], d['g'], d['b'])
            r, g, b = bridge.get_background()
            return ok(r=r, g=g, b=b)
        except Exception as e:
            return fail(e)

    return app


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    bridge = TurtleBridge()

    # ROS spin o thread phu, Flask chiem thread chinh
    spin_thread = threading.Thread(target=rclpy.spin, args=(bridge,), daemon=True)
    spin_thread.start()

    host = bridge.get_parameter('host').value
    port = int(bridge.get_parameter('port').value)
    bridge.get_logger().info(f'Web UI: http://{host}:{port}  (tu may khac: http://<ip-may-nay>:{port})')

    app = create_app(bridge)
    try:
        app.run(host=host, port=port, threaded=True, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        pass
    finally:
        bridge.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
