"""
Amiibo 库管理系统
支持 Amiibo 的上传、分类、复原和扫描

功能:
- 原始文件保存在 origin/ (只读备份)
- 可编辑版本保存在 data/ (用于扫描)
- 自动从 AmiiboDB 获取元数据
- 支持按系列/游戏分类浏览
"""

import os
import json
import shutil
import hashlib
import struct
import requests
from pathlib import Path
from typing import Optional, Dict, List, Any
from datetime import datetime

# Amiibo 文件夹路径
AMIIBO_BASE = Path('file/amiibo')
AMIIBO_ORIGIN = AMIIBO_BASE / 'origin'    # 原始备份（只读）
AMIIBO_DATA = AMIIBO_BASE / 'data'        # 可编辑数据（用于扫描）
AMIIBO_DB = AMIIBO_BASE / 'database.json' # 本地数据库
AMIIBO_IMAGES = AMIIBO_BASE / 'images'    # 图片缓存

# 确保目录存在
AMIIBO_BASE.mkdir(parents=True, exist_ok=True)
AMIIBO_ORIGIN.mkdir(exist_ok=True)
AMIIBO_DATA.mkdir(exist_ok=True)
AMIIBO_IMAGES.mkdir(exist_ok=True)

# AmiiboDB API
AMIIBODB_API = "https://www.amiiboapi.com/api/amiibo/"


class AmiiboLibrary:
    """Amiibo 库管理类"""
    
    def __init__(self):
        self.db = self._load_database()
        self.amiibo_info_cache = None  # AmiiboDB 信息缓存

    def update_master_database(self) -> Dict[str, Any]:
        """从 AmiiboAPI 更新主数据库"""
        try:
            print("正在从 AmiiboAPI 下载数据库...")
            response = requests.get(AMIIBODB_API)
            if response.status_code == 200:
                data = response.json()
                # 建立 ID -> Info 的映射
                cache = {}
                for item in data.get('amiibo', []):
                    # 格式化 ID: head + tail
                    head = item.get('head', '')
                    tail = item.get('tail', '')
                    amiibo_id = f"{head}-{tail}"
                    cache[amiibo_id] = item
                
                self.amiibo_info_cache = cache
                # 保存缓存到本地文件以便下次使用
                with open(AMIIBO_BASE / 'master_db_cache.json', 'w', encoding='utf-8') as f:
                    json.dump(cache, f, ensure_ascii=False)
                
                return {'success': True, 'count': len(cache)}
            else:
                return {'success': False, 'error': f"HTTP Error: {response.status_code}"}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def _load_master_cache(self):
        """加载本地缓存的主数据库"""
        cache_file = AMIIBO_BASE / 'master_db_cache.json'
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    self.amiibo_info_cache = json.load(f)
            except:
                self.amiibo_info_cache = {}
        else:
             # 如果没有缓存，尝试下载
             self.update_master_database()

    def refresh_local_amiibos(self) -> Dict[str, Any]:
        """刷新本地所有 Amiibo 的元数据"""
        if not self.amiibo_info_cache:
            self._load_master_cache()
            
        updated_count = 0
        
        # 遍历所有 data 目录下的 bin 文件
        existing_files = list(AMIIBO_DATA.glob('*.bin'))
        
        for f in existing_files:
            filename = f.name
            
            # 读取文件获取 ID
            with open(f, 'rb') as file_obj:
                data = file_obj.read()
            
            amiibo_id = self.get_amiibo_id(data)
            
            if not amiibo_id:
                continue
                
            # 在数据库中查找
            file_hash = self.get_file_hash(f)
            
            # 如果不在 DB 中，初始化它
            if filename not in self.db['amiibos']:
                self.db['amiibos'][filename] = {
                    'filename': filename,
                    'amiibo_id': amiibo_id,
                    'hash': file_hash,
                    'added_date': datetime.now().isoformat(),
                    'size': len(data)
                }
            
            # 尝试从 Master Cache 匹配元数据
            # 注意: AmiiboAPI 的 ID format 是 hex string without dash usually, or separate head/tail
            # Our get_amiibo_id returns XXXXXXXX-XXXXXXXX (Head-Tail)
            # AmiiboAPI returns data with 'head' and 'tail' fields.
            
            # 尝试匹配
            if self.amiibo_info_cache and amiibo_id in self.amiibo_info_cache:
                info = self.amiibo_info_cache[amiibo_id]
                self.db['amiibos'][filename].update({
                    'character': info.get('character'),
                    'game_series': info.get('gameSeries'),
                    'series': info.get('amiiboSeries'),
                    'image_url': info.get('image'),
                    'type': info.get('type')
                })
                updated_count += 1
        
        self._save_database()
        return {'success': True, 'updated': updated_count, 'total': len(existing_files)}
    
    def _load_database(self) -> Dict:
        """加载本地数据库"""
        if AMIIBO_DB.exists():
            try:
                with open(AMIIBO_DB, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {'amiibos': {}, 'last_updated': None}
    
    def _save_database(self):
        """保存数据库"""
        self.db['last_updated'] = datetime.now().isoformat()
        with open(AMIIBO_DB, 'w', encoding='utf-8') as f:
            json.dump(self.db, f, ensure_ascii=False, indent=2)
    
    @staticmethod
    def get_amiibo_id(data: bytes) -> Optional[str]:
        """
        从 Amiibo 二进制数据中提取 ID
        Amiibo ID 位于偏移量 84-91 (8 bytes)
        格式: XXXXXXXX-XXXXXXXX
        """
        if len(data) < 540:  # 标准 Amiibo 数据至少 540 字节
            return None
        
        try:
            # 读取 Character ID (bytes 84-85)
            # Game & Variant (bytes 86-87)  
            # Figure Type (byte 88-88)
            # Model Number (byte 89-90)
            # Series (byte 91)
            
            # 完整 8 字节 ID
            id_bytes = data[84:92]
            amiibo_id = id_bytes.hex().upper()
            # 格式化为 XXXXXXXX-XXXXXXXX
            return f"{amiibo_id[:8]}-{amiibo_id[8:16]}"
        except Exception:
            return None
    
    @staticmethod
    def get_file_hash(filepath: Path) -> str:
        """计算文件 MD5 哈希"""
        with open(filepath, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    
    def add_amiibo(self, filepath: str, filename: Optional[str] = None) -> Dict[str, Any]:
        """
        添加 Amiibo 到库中
        
        Args:
            filepath: 源文件路径
            filename: 自定义文件名（可选）
        
        Returns:
            添加结果信息
        """
        src_path = Path(filepath)
        if not src_path.exists():
            return {'success': False, 'error': '文件不存在'}
        
        # 读取文件内容
        with open(src_path, 'rb') as f:
            data = f.read()
        
        # 验证文件大小
        if len(data) < 540:
            return {'success': False, 'error': '无效的 Amiibo 文件（太小）'}
        
        # 提取 Amiibo ID
        amiibo_id = self.get_amiibo_id(data)
        if not amiibo_id:
            return {'success': False, 'error': '无法提取 Amiibo ID'}
        
        # 确定文件名
        if filename:
            dest_name = filename if filename.endswith('.bin') else f"{filename}.bin"
        else:
            dest_name = src_path.name
        
        # 复制到 origin（备份）
        origin_path = AMIIBO_ORIGIN / dest_name
        shutil.copy2(src_path, origin_path)
        
        # 复制到 data（可编辑）
        data_path = AMIIBO_DATA / dest_name
        shutil.copy2(src_path, data_path)
        
        # 计算哈希
        file_hash = self.get_file_hash(origin_path)
        
        # 更新数据库
        self.db['amiibos'][dest_name] = {
            'filename': dest_name,
            'amiibo_id': amiibo_id,
            'hash': file_hash,
            'added_date': datetime.now().isoformat(),
            'size': len(data),
            'custom_name': None,
            'series': None,
            'character': None,
            'game_series': None,
            'image_url': None
        }
        self._save_database()
        
        return {
            'success': True,
            'filename': dest_name,
            'amiibo_id': amiibo_id,
            'hash': file_hash
        }
    
    def remove_amiibo(self, filename: str, remove_origin: bool = False) -> Dict[str, Any]:
        """
        删除 Amiibo
        
        Args:
            filename: 文件名
            remove_origin: 是否同时删除原始备份
        
        Returns:
            删除结果
        """
        data_path = AMIIBO_DATA / filename
        origin_path = AMIIBO_ORIGIN / filename
        
        removed_data = False
        removed_origin = False
        
        if data_path.exists():
            data_path.unlink()
            removed_data = True
        
        if remove_origin and origin_path.exists():
            origin_path.unlink()
            removed_origin = True
        
        # 从数据库中删除
        if filename in self.db['amiibos']:
            del self.db['amiibos'][filename]
            self._save_database()
        
        return {
            'success': removed_data or removed_origin,
            'removed_data': removed_data,
            'removed_origin': removed_origin
        }
    
    def restore_amiibo(self, filename: str) -> Dict[str, Any]:
        """
        从原始备份恢复 Amiibo
        
        Args:
            filename: 文件名
        
        Returns:
            恢复结果
        """
        origin_path = AMIIBO_ORIGIN / filename
        data_path = AMIIBO_DATA / filename
        
        if not origin_path.exists():
            return {'success': False, 'error': '原始备份不存在'}
        
        shutil.copy2(origin_path, data_path)
        
        return {'success': True, 'message': f'{filename} 已恢复到原始状态'}
    
    def get_amiibo_list(self, include_info: bool = True) -> List[Dict[str, Any]]:
        """
        获取所有 Amiibo 列表
        
        Args:
            include_info: 是否包含详细信息
        
        Returns:
            Amiibo 列表
        """
        # 确保有缓存
        if not self.amiibo_info_cache:
            self._load_master_cache()

        amiibos = []
        
        # 扫描 data 文件夹
        for f in AMIIBO_DATA.glob('*.bin'):
            info = {
                'filename': f.name,
                'size': f.stat().st_size,
                'path': str(f),
                'has_origin': (AMIIBO_ORIGIN / f.name).exists(),
                'modified': False
            }
            
            # 检查是否修改（简单哈希对比）
            if info['has_origin']:
                # 这里为了性能，通常只在请求详细信息时才做完整哈希对比
                # 但可以通过文件修改时间初步判断
                info['modified'] = f.stat().st_mtime > (AMIIBO_ORIGIN / f.name).stat().st_mtime

            if include_info:
                # 优先从数据库读取用户自定义信息
                db_entry = self.db['amiibos'].get(f.name, {})
                
                # 如果数据库为空，尝试初始化基本信息
                if not db_entry:
                     with open(f, 'rb') as file_obj:
                         amiibo_id = self.get_amiibo_id(file_obj.read())
                     db_entry = {'amiibo_id': amiibo_id}
                     self.db['amiibos'][f.name] = db_entry

                amiibo_id = db_entry.get('amiibo_id')

                # 如果有 ID 且有缓存，尝试补全缺失的元数据
                if amiibo_id and self.amiibo_info_cache and amiibo_id in self.amiibo_info_cache:
                    cached_info = self.amiibo_info_cache[amiibo_id]
                    # 仅当本地没有数据时才使用缓存数据默认值
                    series = db_entry.get('series') or cached_info.get('amiiboSeries')
                    character = db_entry.get('character') or cached_info.get('character')
                    game_series = db_entry.get('game_series') or cached_info.get('gameSeries')
                    image_url = db_entry.get('image_url') or cached_info.get('image')
                else:
                    series = db_entry.get('series')
                    character = db_entry.get('character')
                    game_series = db_entry.get('game_series')
                    image_url = db_entry.get('image_url')

                info.update({
                    'amiibo_id': amiibo_id,
                    'custom_name': db_entry.get('custom_name'),
                    'series': series,
                    'character': character,
                    'game_series': game_series,
                    'image_url': image_url
                })
            
            amiibos.append(info)
        
        return sorted(amiibos, key=lambda x: x['filename'])
    
    def get_amiibo_info(self, filename: str) -> Optional[Dict[str, Any]]:
        """获取单个 Amiibo 的详细信息"""
        data_path = AMIIBO_DATA / filename
        if not data_path.exists():
            return None
        
        info = {
            'filename': filename,
            'size': data_path.stat().st_size,
            'path': str(data_path),
            'has_origin': (AMIIBO_ORIGIN / filename).exists()
        }
        
        if filename in self.db['amiibos']:
            info.update(self.db['amiibos'][filename])
        
        return info
    
    def update_amiibo_info(self, filename: str, **kwargs) -> Dict[str, Any]:
        """
        更新 Amiibo 信息
        
        Args:
            filename: 文件名
            **kwargs: 要更新的字段 (custom_name, series, character, etc.)
        
        Returns:
            更新结果
        """
        if filename not in self.db['amiibos']:
            # 重新扫描添加到数据库
            data_path = AMIIBO_DATA / filename
            if data_path.exists():
                with open(data_path, 'rb') as f:
                    data = f.read()
                amiibo_id = self.get_amiibo_id(data)
                self.db['amiibos'][filename] = {
                    'filename': filename,
                    'amiibo_id': amiibo_id,
                    'hash': self.get_file_hash(data_path),
                    'added_date': datetime.now().isoformat(),
                    'size': len(data)
                }
            else:
                return {'success': False, 'error': '文件不存在'}
        
        # 更新指定字段
        for key, value in kwargs.items():
            if key in ['custom_name', 'series', 'character', 'game_series', 'image_url']:
                self.db['amiibos'][filename][key] = value
        
        self._save_database()
        return {'success': True, 'updated': list(kwargs.keys())}
    
    def scan_and_sync(self) -> Dict[str, Any]:
        """
        扫描文件夹并与数据库同步
        
        Returns:
            同步结果
        """
        added = []
        removed = []
        
        # 检查新文件
        for f in AMIIBO_DATA.glob('*.bin'):
            if f.name not in self.db['amiibos']:
                # 新发现的文件，添加到数据库
                with open(f, 'rb') as file:
                    data = file.read()
                amiibo_id = self.get_amiibo_id(data)
                self.db['amiibos'][f.name] = {
                    'filename': f.name,
                    'amiibo_id': amiibo_id,
                    'hash': self.get_file_hash(f),
                    'added_date': datetime.now().isoformat(),
                    'size': len(data)
                }
                added.append(f.name)
        
        # 检查已删除的文件
        for filename in list(self.db['amiibos'].keys()):
            if not (AMIIBO_DATA / filename).exists():
                del self.db['amiibos'][filename]
                removed.append(filename)
        
        if added or removed:
            self._save_database()
        
        return {
            'success': True,
            'added': added,
            'removed': removed,
            'total': len(self.db['amiibos'])
        }
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取库统计信息"""
        return {
            'total': len(self.db['amiibos']),
            'data_count': len(list(AMIIBO_DATA.glob('*.bin'))),
            'origin_count': len(list(AMIIBO_ORIGIN.glob('*.bin'))),
            'last_updated': self.db.get('last_updated'),
            'total_size': sum(f.stat().st_size for f in AMIIBO_DATA.glob('*.bin'))
        }
    
    def search_amiibos(self, query: str) -> List[Dict[str, Any]]:
        """
        搜索 Amiibo
        
        Args:
            query: 搜索关键词（支持文件名、角色名、系列名）
        
        Returns:
            匹配的 Amiibo 列表
        """
        if not query:
            return self.get_amiibo_list()
        
        query_lower = query.lower()
        results = []
        
        for amiibo in self.get_amiibo_list():
            # 搜索文件名
            if query_lower in amiibo.get('filename', '').lower():
                results.append(amiibo)
                continue
            
            # 搜索自定义名称
            if query_lower in (amiibo.get('custom_name') or '').lower():
                results.append(amiibo)
                continue
            
            # 搜索角色名
            if query_lower in (amiibo.get('character') or '').lower():
                results.append(amiibo)
                continue
            
            # 搜索系列名
            if query_lower in (amiibo.get('series') or '').lower():
                results.append(amiibo)
                continue
            
            # 搜索游戏系列
            if query_lower in (amiibo.get('game_series') or '').lower():
                results.append(amiibo)
                continue
        
        return results
    
    def get_by_series(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        按系列分组获取 Amiibo
        
        Returns:
            {series_name: [amiibo_list], ...}
        """
        grouped = {}
        
        for amiibo in self.get_amiibo_list():
            series = amiibo.get('series') or '未分类'
            if series not in grouped:
                grouped[series] = []
            grouped[series].append(amiibo)
        
        return grouped
    
    def get_tree_structure(self) -> Dict[str, Any]:
        """
        获取树状结构（用于前端树状导航）
        
        Returns:
            树状结构数据
        """
        grouped = self.get_by_series()
        
        tree = {
            'name': '我的 Amiibo',
            'type': 'root',
            'count': len(self.db['amiibos']),
            'children': []
        }
        
        for series, amiibos in sorted(grouped.items()):
            series_node = {
                'name': series,
                'type': 'series',
                'count': len(amiibos),
                'children': [
                    {
                        'name': a.get('custom_name') or a['filename'].rsplit('.', 1)[0],
                        'filename': a['filename'],
                        'type': 'file',
                        'has_origin': a.get('has_origin', False),
                        'image_url': a.get('image_url')
                    }
                    for a in sorted(amiibos, key=lambda x: x['filename'])
                ]
            }
            tree['children'].append(series_node)
        
        return tree


# 全局实例
library = AmiiboLibrary()

class AmiiboExternalLibrary:
    """外部Amiibo库管理（用于导入外部NFC文件）"""
    
    # 已知的游戏系列映射（用于分类）
    SERIES_MAP = {
        'Animal_Crossing': '动物森友会',
        'Fire_Emblem': '火焰纹章',
        'Legend_of_Zelda': '塞尔达传说',
        'Super_Mario': '超级马里奥',
        'Super_Smash_Bros': '任天堂明星大乱斗',
        'Splatoon': 'Splatoon',
        'Kirby': '星之卡比',
        'Pokemon': '宝可梦',
        'Metroid': '银河战士',
        'Pikmin': '皮克敏',
        'Monster_Hunter': '怪物猎人',
        'Mega_Man': '洛克人',
        'Shovel_Knight': '铲子骑士',
        'Skylanders': 'Skylanders',
        'Dark_Souls': '黑暗之魂',
        'Diablo': '暗黑破坏神',
        'Xenoblade': '异度神剑',
        'Yoshi': '耀西',
        'Box_boy': 'BoxBoy!',
        'Chibi_Robo': 'Chibi-Robo!',
        'Pokken': '宝可拳',
        'Power_Pros': '实况力量棒球',
        'Other': '其他'
    }
    
    @staticmethod
    def scan_external_library(base_path: str) -> Dict[str, Any]:
        """
        扫描外部Amiibo库目录结构
        
        Args:
            base_path: 外部库根目录路径
        
        Returns:
            树状结构数据
        """
        import os
        
        tree = {'name': 'Amiibo库', 'type': 'root', 'children': [], 'count': 0}
        
        if not os.path.exists(base_path):
            return tree
        
        # 扫描子目录
        for item in sorted(os.listdir(base_path)):
            item_path = os.path.join(base_path, item)
            if os.path.isdir(item_path):
                # 查找系列名称
                series_name = AmiiboExternalLibrary.SERIES_MAP.get(
                    item.replace(' ', '_').replace('_Amiibo', ''),
                    item.replace('_', ' ')
                )
                
                series_node = {
                    'name': series_name,
                    'path': item_path,
                    'folder': item,
                    'type': 'series',
                    'children': [],
                    'count': 0
                }
                
                # 扫描该系列下的文件
                for root, dirs, files in os.walk(item_path):
                    for f in files:
                        if f.lower().endswith('.bin'):
                            rel_path = os.path.relpath(root, item_path)
                            file_path = os.path.join(root, f)
                            
                            series_node['children'].append({
                                'name': f.rsplit('.', 1)[0],
                                'filename': f,
                                'path': file_path,
                                'subfolder': rel_path if rel_path != '.' else None,
                                'type': 'file',
                                'size': os.path.getsize(file_path)
                            })
                            series_node['count'] += 1
                            tree['count'] += 1
                
                if series_node['count'] > 0:
                    tree['children'].append(series_node)
        
        return tree
    
    @staticmethod
    def import_from_external(src_path: str, 
                             series: Optional[str] = None,
                             character_name: Optional[str] = None) -> Dict[str, Any]:
        """
        从外部库导入单个Amiibo
        
        Args:
            src_path: 源文件路径
            series: 所属系列
            character_name: 角色名称
        
        Returns:
            导入结果
        """
        result = library.add_amiibo(src_path)
        
        if result.get('success') and series:
            # 更新系列信息
            library.update_amiibo_info(
                result['filename'],
                series=series,
                character=character_name
            )
        
        return result
    
    @staticmethod
    def batch_import(items: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        批量导入Amiibo
        
        Args:
            items: [{'path': '...', 'series': '...', 'name': '...'}, ...]
        
        Returns:
            批量导入结果
        """
        results = {'success': 0, 'failed': 0, 'errors': []}
        
        for item in items:
            try:
                result = AmiiboExternalLibrary.import_from_external(
                    item['path'],
                    item.get('series'),
                    item.get('name')
                )
                if result.get('success'):
                    results['success'] += 1
                else:
                    results['failed'] += 1
                    results['errors'].append({
                        'file': item['path'],
                        'error': result.get('error', '未知错误')
                    })
            except Exception as e:
                results['failed'] += 1
                results['errors'].append({
                    'file': item['path'],
                    'error': str(e)
                })
        
        return results


# 全局外部库实例
external_library = AmiiboExternalLibrary()