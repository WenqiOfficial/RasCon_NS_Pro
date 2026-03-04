import inspect
import logging
import asyncio
import random
import signal
import shlex
import sys
import json

from aioconsole import ainput
from joycontrol.controller_state import button_push, button_press, button_release, ControllerState
from joycontrol.nfc_tag import NFCTag

logger = logging.getLogger(__name__)

#ainput超时
class InputTimeoutError(Exception):
    pass

# 平台兼容性: SIGALRM 只在 Unix 系统上可用
if sys.platform != 'win32':
    def interrupted(signum, frame):
        raise InputTimeoutError
    signal.signal(signal.SIGALRM, interrupted)
##

class CCLI():
    def __init__(self, controller_state: ControllerState):
        self.controller_state = controller_state
        self.available_buttons = self.controller_state.button_state.get_available_buttons()
        self.available_sticks = {'ls','rs'}
        self.script = False
        self.current_amiibo = None
        # 初始化状态文件
        self.update_status(connected=False, message='初始化中...')

    def update_status(self, connected=None, message=None, amiibo=None):
        """更新状态文件供 web.py 读取"""
        status_file = 'file/status.json'
        try:
            # 读取现有状态
            try:
                with open(status_file, 'r', encoding='utf-8') as f:
                    status = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                status = {
                    'connected': False,
                    'controller_type': 'PRO_CONTROLLER',
                    'current_amiibo': None,
                    'message': ''
                }
            
            # 更新指定字段
            if connected is not None:
                status['connected'] = connected
            if message is not None:
                status['message'] = message
            if amiibo is not None:
                status['current_amiibo'] = amiibo
                self.current_amiibo = amiibo
            
            # 写入状态文件
            with open(status_file, 'w', encoding='utf-8') as f:
                json.dump(status, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f'状态更新失败: {e}')

    async def write(self,msg):
        with open('file/message.txt','a') as f:
            f.write(msg+'\n')

    async def get(self,file):
        with open('file/'+file,'r') as f:
            result = list()
            for line in f.readlines():                          #依次读取每行
                line = line.strip()                             #去掉每行头尾空白
                if not len(line) or line.startswith('#'):       #判断是否是空行或注释行
                    continue                                    #是的话，跳过不处理
                result.append(line.lower())                     #保存小写文字
            return result
    async def clean(self,file):
        with open('file/'+file,'w+') as f:
            return f.truncate() 


    async def runCommand(self):

        #读取command.txt指令
        user_input = await self.get('command.txt')
        if not user_input:
            return
        await self.clean('command.txt')

        for command in user_input:
            cmd, *args = command.split()

            if cmd == 'run': #脚本执行
                self.script = True
            elif cmd == 'stop': #脚本停止
                self.script = False
            elif cmd == 'off' or cmd =='on': #控制蓝牙连接开关
                print('开/关 未完成')
            else: #
                await self.pressButton(command)


    async def pressButton(self,*commands):
         for command in commands:
             print(command)
             cmd,*args=command.split()

             if cmd in self.available_sticks: #摇杆
                 dir,sec,*sth=args[0].split(',')
                 await self.cmd_stick(cmd,dir,sec)
             elif cmd in self.available_buttons: #按钮
                 await button_push(self.controller_state,cmd)
             elif cmd.isdecimal():
                 await asyncio.sleep(float(cmd) / 1000)
             elif cmd == 'wait': #等待（ms）
                 await asyncio.sleep(float(args[0]) / 1000)
             elif cmd == 'waitrandom':
                 if args[0].isdecimal and args[1].isdecimal:
                    random_wait = random.randint(int(args[0]), (int(args[1])+1))
                    print(f'rand wait {random_wait}')
                    await asyncio.sleep(float(random_wait) / 1000)
                 else:
                     print(f'command waitrandom args need to be int {args[0]} {args[1]}' )
             elif cmd == 'print':
                 print(args[0]) #输出
             elif cmd == 'amiibo':
                 if args[0] == 'remove':
                     self.controller_state.set_nfc(None)
                     self.update_status(amiibo=None, message='Amiibo 已移除')
                     print('amiibo已移除')
                 elif args[0] != 'clean':
                     await self.set_amiibo(args[0]) #设置amiibo
             elif cmd == 'press':  # 按下按键（长按开始）
                 if args:
                     btn = args[0]
                     if btn in self.available_buttons:
                         await button_press(self.controller_state, btn)
                         print(f'press {btn}')
                     elif btn in self.available_sticks:
                         # 摇杆长按
                         if len(args) > 1:
                             direction = args[1]
                             self.cmd_stick_hold(btn, direction)
             elif cmd == 'release':  # 释放按键（长按结束）
                 if args:
                     btn = args[0]
                     if btn in self.available_buttons:
                         await button_release(self.controller_state, btn)
                         print(f'release {btn}')
                     elif btn in self.available_sticks:
                         # 释放摇杆
                         self.release_stick(btn)
             else: #错误代码
                 print('command',cmd,'not found')


    async def set_amiibo(self, fileName):
        """
        Sets nfc content of the controller state to contents of the given file.
        :param fileName: amiibo文件名(文件固定放在项目文件夹的file/amiibo里)
        """
        try:
            path = 'file/amiibo/' + fileName
            tag = NFCTag.load_amiibo(path)
            self.controller_state.set_nfc(tag)
            self.update_status(amiibo=fileName, message=f'已加载 Amiibo: {fileName}')
            print('amiibo设置成功')
        except Exception as e:
            self.update_status(message=f'Amiibo 加载失败: {e}')
            print(f'amiibo设置失败: {e}')

    def set_stick(self,stick, direction, value=None):

        if direction == 'reset':
            stick.set_center()
        elif direction == 'up':
            stick.set_up()
        elif direction == 'down':
            stick.set_down()
        elif direction == 'left':
            stick.set_left()
        elif direction == 'right':
            stick.set_right()
        #
        #elif direction in ('h', 'horizontal'):
        #    if value is None:
        #        raise ValueError(f'Missing value')
        #    try:
        #        val = int(value)
        #    except ValueError:
        #        raise ValueError(f'Unexpected stick value "{value}"')
        #    stick.set_h(val)
        #elif direction in ('v', 'vertical'):
        #    if value is None:
        #        raise ValueError(f'Missing value')
        #    try:
        #        val = int(value)
        #    except ValueError:
        #        raise ValueError(f'Unexpected stick value "{value}"')
        #    stick.set_v(val)
        #
        else:
            raise ValueError(f'Unexpected argument "{direction}"')
        return f'{stick.__class__.__name__} was set to ({stick.get_h()}, {stick.get_v()}).'

    async def cmd_stick(self,side,direction,release_sec=0.0):
        """
        stick - Command to set stick positions.
        :param side: 'l', 'left' for left control stick; 'r', 'right' for right control stick
        :param direction: 'center', 'up', 'down', 'left', 'right';
               'h', 'horizontal' or 'v', 'vertical' to set the value directly to the "value" argument
        :param value: horizontal or vertical value
        """
        
        try:
            val = float(release_sec)
        except ValueError:
            raise ValueError(f'Unexpected stick release_sec "{release_sec}"')
        if side == 'ls' :
            stick = self.controller_state.l_stick_state
            self.set_stick(stick, direction)
            await self.stickSend(stick,val/1000)
        elif side == 'rs':
            stick = self.controller_state.r_stick_state
            self.set_stick(stick, direction)
            await self.stickSend(stick,val/1000)
        else:
            raise ValueError('Value of side must be "ls" or "rs"')

    async def stickOn(self,stick,release_sec):
        #开始摇杆
        await self.controller_state.send()
        await asyncio.sleep(release_sec)

    async def stickOff(self,stick):
        #释放摇杆
        stick.set_center()
        await self.controller_state.send()
        #await asyncio.sleep(0.05)

    async def stickSend(self,stick,release_sec):
        await self.stickOn(stick,release_sec)
        if release_sec == 0.0:
            test = 0
        else:
            await self.stickOff(stick)

    def cmd_stick_hold(self, side, direction):
        """
        摇杆长按开始 - 设置摇杆位置但不自动释放
        :param side: 'ls' 左摇杆, 'rs' 右摇杆
        :param direction: 'up', 'down', 'left', 'right'
        """
        try:
            if side == 'ls':
                stick = self.controller_state.l_stick_state
            elif side == 'rs':
                stick = self.controller_state.r_stick_state
            else:
                return
            
            self.set_stick(stick, direction)
            # 发送状态但不等待
            asyncio.create_task(self.controller_state.send())
            print(f'stick hold: {side} {direction}')
        except Exception as e:
            print(f'摇杆长按失败: {e}')

    def release_stick(self, side):
        """
        释放摇杆 - 将摇杆回到中心位置
        :param side: 'ls' 左摇杆, 'rs' 右摇杆
        """
        try:
            if side == 'ls':
                stick = self.controller_state.l_stick_state
            elif side == 'rs':
                stick = self.controller_state.r_stick_state
            else:
                return
            
            stick.set_center()
            asyncio.create_task(self.controller_state.send())
            print(f'stick release: {side}')
        except Exception as e:
            print(f'摇杆释放失败: {e}')

    async def readCommand(self,file):
        user_input = await self.get(file)
        if not user_input:
            return
        await self.clean(file)
    def isCommand(self,cmd):
        return (cmd in
                self.available_sticks or
                cmd in self.available_buttons or
                cmd.isdecimal() or
                cmd == 'print' or
                cmd == 'wait' or
                cmd == 'waitrandom' or
                cmd == 'amiibo')

    def forCheck(self,n,user_input):
        commands = []
        until = -1
        for i in range(len(user_input)):
            if i <= n or i<= until:
                continue

            cmd,*args = user_input[i].split()

            if cmd == 'for':
                for _ in range(int(args[0])):
                    until,forcmd = self.forCheck(i,user_input)
                    for get in forcmd:
                        commands.append(get)
            elif cmd == 'next':
                return i,commands
            elif self.isCommand(cmd):
                commands.append(user_input[i])
            else:
                print('command',cmd,'not found')

    async def runScript(self):
        user_input = await self.get('script.txt')
        if not user_input:
            return
        await self.clean('script.txt')

        commands=[]
        until=-1
        for i in range(len(user_input)):
            #检测按键
            await self.runCommand()
            #确认脚本是否要停止
            if self.script == False:
                return

            if i <= until:
                continue

            cmd, *args =user_input[i].split()
            if cmd == 'for':
                for _ in range(int(args[0])):
                    until,forcmd = self.forCheck(i,user_input)
                    for get in forcmd:
                        commands.append(get)
            elif self.isCommand(cmd):
                commands.append(user_input[i])
            elif cmd=='test':
                abc = []
                abc.append('l')
                abc.append('r')
                await button_push(self.controller_state,*abc)
            else:
                print('commands',cmd,'not found')

        for command in commands:
            await self.runCommand()
            if self.script == False:
                return

            await self.pressButton(command)

        self.script = False

    async def get_txt(self):
        await self.runCommand()
        if self.script == True:
            await self.runScript()

    #获取命令行输入(ainput那行删掉nfc功能就无法正常使用，原因不明)
    async def get_cmd(self):
        # 平台兼容性: signal.alarm 只在 Unix 系统上可用
        if sys.platform != 'win32':
            signal.alarm(1)
            try:
                ainput(prompt='cmd >>')
            except InputTimeoutError:
                print('timeout')
            signal.alarm(0)
        else:
            # Windows 上使用 asyncio.wait_for 实现超时
            try:
                await asyncio.wait_for(ainput(prompt='cmd >>'), timeout=1.0)
            except asyncio.TimeoutError:
                pass



    async def run(self):

        while True:
            #等待输入
            await asyncio.gather(self.get_txt(),self.get_cmd())



