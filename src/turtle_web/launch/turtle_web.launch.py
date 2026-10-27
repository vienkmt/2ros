"""Chay ca bo: Xvfb (X ao, khong can man hinh) + turtlesim_node + web_node.

    ros2 launch turtle_web turtle_web.launch.py                 # headless, web o cong 5000
    ros2 launch turtle_web turtle_web.launch.py port:=8080
    ros2 launch turtle_web turtle_web.launch.py headless:=false # dung DISPLAY hien tai (XQuartz)
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, TimerAction
from launch.conditions import IfCondition, UnlessCondition
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue

XVFB_DISPLAY = ':99'
TURTLESIM_PARAMS = [{'background_r': 33, 'background_g': 36, 'background_b': 69}]


def generate_launch_description():
    headless = LaunchConfiguration('headless')
    return LaunchDescription([
        DeclareLaunchArgument('port', default_value='5000'),
        DeclareLaunchArgument('headless', default_value='true',
                              description='true: chay turtlesim tren Xvfb, khong can X server that'),

        # --- headless: Xvfb truoc, turtlesim sau 1s voi DISPLAY=:99
        ExecuteProcess(condition=IfCondition(headless),
                       cmd=['Xvfb', XVFB_DISPLAY, '-screen', '0', '800x600x24', '-nolisten', 'tcp'],
                       output='log', respawn=True, respawn_delay=1.0),
        TimerAction(condition=IfCondition(headless), period=1.0, actions=[
            Node(package='turtlesim', executable='turtlesim_node', name='turtlesim', output='screen',
                 parameters=TURTLESIM_PARAMS,
                 # respawn: neu Xvfb/turtlesim bi tat (vd tien trinh khac chiem :99) thi tu chay lai
                 respawn=True, respawn_delay=2.0,
                 additional_env={'DISPLAY': XVFB_DISPLAY, 'QT_QPA_PLATFORM': 'xcb'}),
        ]),

        # --- co man hinh: dung DISPLAY hien tai
        Node(condition=UnlessCondition(headless),
             package='turtlesim', executable='turtlesim_node', name='turtlesim', output='screen',
             parameters=TURTLESIM_PARAMS),

        Node(package='turtle_web', executable='battery_sim', name='battery_sim', output='screen',
             parameters=[{'capacity_ah': 60.0, 'time_scale': 30.0, 'ambient_c': 28.0, 'rate_hz': 2.0}]),
        Node(package='turtle_web', executable='web_node', name='turtle_web', output='screen',
             parameters=[{'port': ParameterValue(LaunchConfiguration('port'), value_type=int)}]),
    ])
