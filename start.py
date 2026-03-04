#!/usr/bin/env python3
"""
RasCon NS Pro 一键启动脚本
同时启动 Web 控制界面和 joycontrol 后端

用法:
    sudo python3 start.py              # 启动所有服务
    sudo python3 start.py --web-only   # 仅启动 Web 界面
    sudo python3 start.py --reconnect-bt-addr=XX:XX:XX:XX:XX:XX  # 重连指定的 Switch
"""

import argparse
import asyncio
import logging
import os
import sys
import signal
import threading
import json
from pathlib import Path

# 设置工作目录为脚本所在目录
os.chdir(Path(__file__).parent)

# 确保文件目录存在
Path('file').mkdir(exist_ok=True)
Path('file/amiibo').mkdir(exist_ok=True)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('RasCon')

# 全局变量
web_thread = None
joycontrol_task = None

def check_root():
    """检查是否以 root 权限运行"""
    if sys.platform != 'win32' and os.geteuid() != 0:
        logger.error('请使用 sudo 运行此脚本！')
        logger.error('用法: sudo python3 start.py')
        sys.exit(1)

def start_web_server():
    """在独立线程中启动 Flask Web 服务器"""
    try:
        from web import app
        logger.info('Web 控制界面启动中...')
        logger.info('访问 http://localhost:8080 或 http://<树莓派IP>:8080')
        app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False)
    except Exception as e:
        logger.error(f'Web 服务器启动失败: {e}')

def update_status(connected=False, message='', controller_type='PRO_CONTROLLER', amiibo=None):
    """更新状态文件"""
    status_file = 'file/status.json'
    try:
        status = {
            'connected': connected,
            'controller_type': controller_type,
            'current_amiibo': amiibo,
            'message': message
        }
        with open(status_file, 'w', encoding='utf-8') as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f'状态更新失败: {e}')

async def start_joycontrol(args):
    """启动 joycontrol 控制器模拟"""
    try:
        from joycontrol import logging_default as log, utils
        from joycontrol.controller import Controller
        from joycontrol.memory import FlashMemory
        from joycontrol.protocol import controller_protocol_factory
        from joycontrol.server import create_hid_server
        import command
        
        log.configure()
        
        update_status(connected=False, message='正在初始化控制器...')
        logger.info('joycontrol 初始化中...')
        
        # 创建 SPI Flash 内存（包含摇杆校准数据）
        spi_flash = FlashMemory()
        
        # 选择控制器类型
        controller = Controller.PRO_CONTROLLER
        
        # 获取日志输出路径
        log_path = getattr(args, 'log', None)
        
        with utils.get_output(path=log_path, default=None) as capture_file:
            factory = controller_protocol_factory(controller, spi_flash=spi_flash)
            
            # 处理重连地址
            reconnect_addr = getattr(args, 'reconnect_bt_addr', None)
            
            update_status(connected=False, message='等待 Switch 连接...')
            logger.info('等待 Switch 连接...')
            logger.info('请在 Switch 上进入: 设置 > 控制器与传感器 > 更改握法/顺序')
            
            transport, protocol = await create_hid_server(
                factory,
                ctl_psm=17,
                itr_psm=19,
                capture_file=capture_file,
                device_id=reconnect_addr
            )
            
            controller_state = protocol.get_controller_state()
            
            # 创建命令行接口
            cli = command.CCLI(controller_state)
            
            try:
                await controller_state.connect()
                cli.update_status(connected=True, message='已连接到 Switch！')
                logger.info('已成功连接到 Switch！')
                await cli.run()
            finally:
                cli.update_status(connected=False, message='连接已断开')
                logger.info('正在停止通信...')
                await transport.close()
                
    except ImportError as e:
        logger.error(f'缺少依赖: {e}')
        logger.error('请安装依赖: pip3 install -r requirements.txt')
        update_status(connected=False, message=f'依赖缺失: {e}')
    except Exception as e:
        logger.error(f'joycontrol 错误: {e}')
        update_status(connected=False, message=f'错误: {e}')

def signal_handler(signum, frame):
    """处理退出信号"""
    logger.info('收到退出信号，正在关闭...')
    update_status(connected=False, message='服务已停止')
    sys.exit(0)

def main():
    parser = argparse.ArgumentParser(
        description='RasCon NS Pro - Nintendo Switch 控制器模拟器',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  sudo python3 start.py                    # 启动所有服务
  sudo python3 start.py --web-only         # 仅启动 Web 界面
  sudo python3 start.py --reconnect-bt-addr=XX:XX:XX:XX:XX:XX  # 重连 Switch
        '''
    )
    parser.add_argument('--web-only', action='store_true', 
                        help='仅启动 Web 界面，不启动 joycontrol')
    parser.add_argument('--reconnect-bt-addr', dest='reconnect_bt_addr',
                        help='Switch 的蓝牙地址（用于快速重连）')
    parser.add_argument('-l', '--log', help='日志输出文件')
    parser.add_argument('--port', type=int, default=8080, help='Web 服务端口（默认 8080）')
    
    args = parser.parse_args()
    
    # 检查 root 权限（仅在需要 joycontrol 时）
    if not args.web_only:
        check_root()
    
    # 设置信号处理
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 初始化状态文件
    update_status(connected=False, message='服务启动中...')
    
    # 启动 Web 服务器（在独立线程中）
    global web_thread
    web_thread = threading.Thread(target=start_web_server, daemon=True)
    web_thread.start()
    logger.info(f'Web 界面已启动: http://localhost:{args.port}')
    
    if args.web_only:
        logger.info('仅 Web 模式，joycontrol 未启动')
        update_status(connected=False, message='仅 Web 模式（joycontrol 未启动）')
        # 保持主线程运行
        try:
            while True:
                threading.Event().wait(1)
        except KeyboardInterrupt:
            pass
    else:
        # 启动 joycontrol
        try:
            asyncio.run(start_joycontrol(args))
        except KeyboardInterrupt:
            logger.info('用户中断')
        finally:
            update_status(connected=False, message='服务已停止')

if __name__ == '__main__':
    main()
