import os
from glob import glob
from setuptools import setup

package_name = 'turtle_web'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    # Dua file web vao cung thu muc voi web_node.py khi install
    package_data={package_name: ['web/*.html', 'web/static/*']},
    include_package_data=True,
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.py')),
    ],
    install_requires=['setuptools', 'flask'],
    zip_safe=False,
    maintainer='vienkmt',
    maintainer_email='vienlvx@hotmail.com',
    description='Dieu khien turtlesim qua giao dien web (Flask + rclpy)',
    license='MIT',
    entry_points={
        'console_scripts': [
            'web_node = turtle_web.web_node:main',
            'battery_sim = turtle_web.battery_sim:main',
        ],
    },
)
