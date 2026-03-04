from flask import Flask, render_template, request, jsonify
import shutil
import os
import json
import amiibos

app = Flask(__name__)
script = ""

# 状态存储
status = {
    'connected': False,
    'controller_type': 'PRO_CONTROLLER',
    'current_amiibo': None
}

def default():
    msg = read('msg.txt')
    script = read('scriptcopy.txt')
    return msg, script

def get_file_path(filename):
    import os
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, 'file', filename)

def read(file):
    try:
        with open(get_file_path(file), 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def write(file, msg):
    with open(get_file_path(file), 'w', encoding='utf-8') as f:
        f.write(msg)

def clean(file):
    with open(get_file_path(file), 'w+', encoding='utf-8') as f:
        f.truncate()

# ==================== API 端点 ====================

@app.route('/api/btn', methods=['POST'])
def api_btn():
    """AJAX API: 发送按键命令（支持长按）"""
    try:
        data = request.get_json()
        action = data.get('action', 'push')  # push, press, release
        button = data.get('button', '')
        
        if not button:
            return jsonify({'success': False, 'error': '缺少按键参数'})
        
        if action == 'press':
            # 按下按键（长按开始）
            write('command.txt', f'press {button}')
        elif action == 'release':
            # 释放按键（长按结束）
            write('command.txt', f'release {button}')
        else:
            # 普通按键（例如 amiibo remove 等命令也会走到这里）
            write('command.txt', button)
        
        return jsonify({'success': True, 'action': action, 'button': button})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/status', methods=['GET'])
def api_status():
    """AJAX API: 获取当前状态（从 joycontrol 同步）"""
    try:
        # 读取 joycontrol 写入的状态文件
        status_file = 'file/status.json'
        if os.path.exists(status_file):
            with open(status_file, 'r', encoding='utf-8') as f:
                joycontrol_status = json.load(f)
        else:
            joycontrol_status = {
                'connected': False,
                'controller_type': 'PRO_CONTROLLER',
                'current_amiibo': None,
                'message': 'joycontrol 未启动'
            }
        
        # 尝试读取消息日志
        msg = read('msg.txt') if os.path.exists('file/msg.txt') else ''
        
        return jsonify({
            'success': True,
            'connected': joycontrol_status.get('connected', False),
            'controller_type': joycontrol_status.get('controller_type', 'PRO_CONTROLLER'),
            'current_amiibo': joycontrol_status.get('current_amiibo'),
            'joycontrol_message': joycontrol_status.get('message', ''),
            'message': msg
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/list', methods=['GET'])
def api_amiibo_list():
    """AJAX API: 获取已上传的 Amiibo 列表（增强版）"""
    try:
        from amiibo_library import library
        
        # 先同步数据库
        library.scan_and_sync()
        
        # 获取列表
        amiibos_list = library.get_amiibo_list(include_info=True)
        stats = library.get_statistics()
        
        return jsonify({
            'success': True, 
            'amiibos': amiibos_list,
            'statistics': stats
        })
    except ImportError:
        # 回退到简单模式
        amiibo_path = 'file/amiibo/data/'
        if not os.path.exists(amiibo_path):
            amiibo_path = 'file/amiibo/'
            os.makedirs(amiibo_path, exist_ok=True)
        
        amiibos_list = []
        for f in os.listdir(amiibo_path):
            if f.endswith('.bin'):
                amiibos_list.append({
                    'filename': f,
                    'path': amiibo_path + f,
                    'size': os.path.getsize(amiibo_path + f)
                })
        
        return jsonify({'success': True, 'amiibos': amiibos_list})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/add', methods=['POST'])
def api_amiibo_add():
    """AJAX API: 上传新的 Amiibo"""
    try:
        from amiibo_library import library
        
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': '没有选择文件'})
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': '没有选择文件'})
        
        # 保存到临时位置
        if not file.filename.lower().endswith('.bin'):
             return jsonify({'success': False, 'error': '请上传 .bin 格式的 Amiibo 文件'})
        
        from amiibo_library import library
        # 使用安全的临时路径
        import uuid
        temp_name = f'temp_{uuid.uuid4().hex}.bin'
        temp_path = get_file_path(os.path.join('amiibo', temp_name))
        
        # 确保目录存在
        os.makedirs(os.path.dirname(temp_path), exist_ok=True)
        
        file.save(temp_path)
        
        # 添加到库
        custom_name = request.form.get('name', None)
        result = library.add_amiibo(temp_path, custom_name or file.filename)
        
        # 删除临时文件
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/delete', methods=['POST'])
def api_amiibo_delete():
    """AJAX API: 删除 Amiibo"""
    try:
        from amiibo_library import library
        
        data = request.get_json()
        filename = data.get('filename', '')
        # 如果是前端传来的全名，需要确保处理逻辑可以匹配
        remove_origin = data.get('remove_origin', False)
        
        if not filename:
            return jsonify({'success': False, 'error': '缺少文件名'})
        
        result = library.remove_amiibo(filename, remove_origin)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/restore', methods=['POST'])
def api_amiibo_restore():
    """AJAX API: 恢复 Amiibo 到原始状态"""
    try:
        from amiibo_library import library
        
        data = request.get_json()
        filename = data.get('filename', '')
        
        if not filename:
            return jsonify({'success': False, 'error': '缺少文件名'})
        
        result = library.restore_amiibo(filename)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/info/<filename>', methods=['GET'])
def api_amiibo_info(filename):
    """AJAX API: 获取 Amiibo 详细信息"""
    try:
        from amiibo_library import library
        
        info = library.get_amiibo_info(filename)
        if info:
            return jsonify({'success': True, 'info': info})
        else:
            return jsonify({'success': False, 'error': '未找到该 Amiibo'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/search', methods=['GET'])
def api_amiibo_search():
    """AJAX API: 搜索 Amiibo"""
    try:
        from amiibo_library import library
        
        query = request.args.get('q', '')
        results = library.search_amiibos(query)
        
        return jsonify({'success': True, 'amiibos': results, 'query': query})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/tree', methods=['GET'])
def api_amiibo_tree():
    """AJAX API: 获取 Amiibo 树状结构"""
    try:
        from amiibo_library import library
        
        tree = library.get_tree_structure()
        return jsonify({'success': True, 'tree': tree})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/external/scan', methods=['POST'])
def api_amiibo_external_scan():
    """AJAX API: 扫描外部 Amiibo 库"""
    try:
        from amiibo_library import AmiiboExternalLibrary
        
        data = request.get_json()
        path = data.get('path', '')
        
        if not path:
            # 使用默认路径（相对于项目的Amiibo目录）
            import os
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            path = os.path.join(base, 'Amiibo', 'Amiibo NFC')
        
        tree = AmiiboExternalLibrary.scan_external_library(path)
        return jsonify({'success': True, 'tree': tree, 'scanned_path': path})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/external/import', methods=['POST'])
def api_amiibo_external_import():
    """AJAX API: 从外部库导入 Amiibo"""
    try:
        from amiibo_library import AmiiboExternalLibrary
        
        data = request.get_json()
        items = data.get('items', [])
        
        if not items:
            # 单个导入
            src_path = data.get('path', '')
            series = data.get('series')
            name = data.get('name')
            
            if not src_path:
                return jsonify({'success': False, 'error': '缺少文件路径'})
            
            result = AmiiboExternalLibrary.import_from_external(src_path, series, name)
            return jsonify(result)
        else:
            # 批量导入
            result = AmiiboExternalLibrary.batch_import(items)
            return jsonify({'success': True, **result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/subscription', methods=['POST'])
def api_amiibo_subscription():
    """AJAX API: 订阅仓库信息"""
    try:
        data = request.get_json()
        repo_url = data.get('repo', '')
        
        # 使用 GitHub API 获取文件列表
        from amiibo_library import library
        result = library.fetch_github_repo_tree(repo_url)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/download', methods=['POST'])
def api_amiibo_download():
    """AJAX API: 下载并添加 Amiibo"""
    try:
        data = request.get_json()
        url = data.get('url', '')
        name = data.get('name', '')
        
        if not url:
            return jsonify({'success': False, 'error': '下载链接为空'})
            
        from amiibo_library import library
        result = library.download_file_from_url(url, name)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/updatesource', methods=['POST'])
def api_amiibo_update_source():
    """AJAX API: 更新 AmiiboDB 数据库源"""
    try:
        from amiibo_library import library
        result = library.update_master_database()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/refresh_metadata', methods=['POST'])
def api_amiibo_refresh_metadata():
    """AJAX API: 刷新本地 Amiibo 元数据"""
    try:
        from amiibo_library import library
        result = library.refresh_local_amiibos()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/update', methods=['POST'])
def api_amiibo_update():
    """AJAX API: 更新 Amiibo 信息"""
    try:
        from amiibo_library import library
        
        data = request.get_json()
        filename = data.get('filename', '')
        
        if not filename:
            return jsonify({'success': False, 'error': '缺少文件名'})
        
        # 提取可更新的字段
        update_fields = {}
        for key in ['custom_name', 'series', 'character', 'game_series']:
            if key in data:
                update_fields[key] = data[key]
        
        result = library.update_amiibo_info(filename, **update_fields)
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/amiibo/scan', methods=['POST'])
def api_amiibo_scan():
    """AJAX API: 扫描/使用 Amiibo"""
    try:
        data = request.get_json()
        filename = data.get('filename', '')
        
        if not filename:
            return jsonify({'success': False, 'error': '缺少文件名'})
        
        # 发送 amiibo 命令
        write('command.txt', f'amiibo {filename}')
        
        return jsonify({'success': True, 'message': f'正在扫描 {filename}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# ==================== 原有路由 ====================

@app.route('/')
def index():
    msg,script=default()
    return render_template('index.html',msg = msg,script =script)

@app.route('/bluez',methods=['POST'])
def bluez():
    if request.method == 'POST':
        #暂时无法使用
        #write('message.txt'request.form['btn']+'\n')
        write('message.txt','该功能暂时无法使用\n')
        write('command.txt',request.form['btn'])

    msg,script=default()
    return render_template('index.html',msg = msg,script =script)

@app.route('/btn',methods=['POST'])
def btn():
    if request.method == 'POST':
        btn = request.form['btn']
        write('command.txt',btn)
        if btn == 'amiibo clean':
            path = get_file_path('amiibo')
            if os.path.exists(path):
                shutil.rmtree(path)
            os.mkdir(path)
            msg,script=default()
            return render_template('index.html',msg =msg,script =script,amiibo='cleaned!')
        elif btn == 'amiibo remove':
            write('command.txt','amiibo remove')
            msg,script=default()
            return render_template('index.html',msg = msg,script =script,amiibo='removed!')

    msg,script=default()
    return render_template('index.html',msg = msg,script =script)

@app.route('/script/run',methods=['POST'])
def run():
    if request.method == 'POST':
        script = request.form['script']
        write('script.txt',script)
        write('scriptcopy.txt',script)
        write('command.txt','run')
        
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'success': True})

    msg,script=default()
    return render_template('index.html',msg = msg,script =script)

@app.route('/script/stop',methods=['POST'])
def stop():
    if request.method == 'POST':
        write('command.txt','stop')
        
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'success': True})

    msg,script=default()
    return render_template('index.html',msg = msg,script =script)

#Amiibo
@app.route('/amiibo/upload',methods=['POST'])
def upload():
    file = request.files['file']
    filename = file.filename
    if filename.rsplit('.', 1)[1].lower() in {'bin','BIN'}:
        filename = filename.replace(' ','_').lower()
        file.save(get_file_path(os.path.join('amiibo', filename)))
        write('command.txt','amiibo '+filename)
        msg,script=default()
        return render_template('index.html',msg = msg,script =script,amiibo='OK!')
    else:
        msg,script=default()
        return render_template('index.html',msg = msg,script =script,amiibo='NO! This isn`t bin file.') 
#动森批量刷amiibo跳转
@app.route('/amiibos')
def toAmiibosUpload():
    return render_template('amiibos.html')

#上传amiibo压缩包
@app.route('/amiibos',methods=['POST'])
def amiibosUpload():
    file = request.files['file']
    filename = file.filename
    if filename.rsplit('.',1)[1].lower() == 'zip':

        #清除残余amiibo数据
        path = get_file_path('amiibo')
        if os.path.exists(path):
            shutil.rmtree(path)
        os.mkdir(path)

        #保存zip压缩包
        filename = filename.replace(' ','_').lower()
        file.save(os.path.join(path, filename))

        #解压并生成脚本
        amiibos.run(filename)
        return render_template('amiibos.html',msg = '上传成功，脚本生成完毕，请按下方按钮跳转查看')
    else:
        return render_template('amiibos.html',msg = '上传失败，仅支持zip压缩文件')

#raspi
@app.route('/raspi',methods=['POST'])
def raspi():
    if request.method == 'POST':
        cmd = request.form['btn']
        os.system(cmd)

if __name__ == '__main__':
    clean('message.txt')
    clean('command.txt')
    clean('script.txt')
    app.run(debug=True,host='0.0.0.0')
