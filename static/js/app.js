/**
 * RasCon Pro - Frontend Application
 * 所有前端业务逻辑集中管理，通过 fetch API 与后端通信
 * 初始数据通过 window.APP_CONFIG 从服务端注入
 */

// ==================== API 客户端 ====================
const api = {
    /**
     * 统一 HTTP 请求  —  自动处理 JSON 序列化 / 响应解析 / success 判定
     * 当 response.success === false 或 HTTP 异常时抛出 Error(message)
     */
    async request(url, { method = 'GET', body, headers = {} } = {}) {
        const opts = { method, headers: { ...headers } };

        if (body instanceof FormData) {
            opts.body = body;                               // 浏览器自动设定 multipart boundary
        } else if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }

        const res = await fetch(url, opts);

        // 非 2xx 直接抛出
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `HTTP ${res.status}`);
        }

        const data = await res.json();

        // 后端统一约定: success === false 代表业务失败
        if (data.success === false) {
            throw new Error(data.error || '操作失败');
        }

        return data;
    },

    get(url, opts)        { return this.request(url, { ...opts, method: 'GET' }); },
    post(url, body, opts) { return this.request(url, { ...opts, method: 'POST', body }); },
};

// ==================== DaisyUI Toast 通知 ====================
const UI = {
    _el: null,
    get el() { return this._el || (this._el = document.getElementById('toast-container')); },

    /**
     * @param {string} msg   消息文本
     * @param {'success'|'error'|'warning'|'info'} type
     * @param {number} ms    自动消失毫秒数
     */
    toast(msg, type = 'info', ms = 3000) {
        const cls = { success: 'alert-success', error: 'alert-error', warning: 'alert-warning', info: 'alert-info' }[type] || 'alert-info';
        const d = document.createElement('div');
        d.className = `alert ${cls} min-w-[260px] max-w-sm shadow-lg transition-all duration-300 opacity-0 translate-y-2`;
        d.innerHTML = `<span class="text-sm">${msg}</span>`;
        this.el.appendChild(d);
        requestAnimationFrame(() => d.classList.remove('opacity-0', 'translate-y-2'));
        setTimeout(() => {
            d.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => d.remove(), 300);
        }, ms);
    },

    success(m, ms) { this.toast(m, 'success', ms); },
    error(m, ms)   { this.toast(m, 'error', ms); },
    warning(m, ms) { this.toast(m, 'warning', ms); },
    info(m, ms)    { this.toast(m, 'info', ms); },
};

// ==================== DaisyUI 确认对话框 ====================
function confirmDialog(message) {
    return new Promise(resolve => {
        const modal   = document.getElementById('confirm-modal');
        const msgEl   = document.getElementById('confirm-message');
        const okBtn   = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        msgEl.textContent = message;

        const cleanup = result => {
            modal.close();
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('close', onBackdrop);
            resolve(result);
        };
        const onOk       = () => cleanup(true);
        const onCancel   = () => cleanup(false);
        const onBackdrop = () => cleanup(false);   // ESC / 点击遮罩

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('close', onBackdrop);
        modal.showModal();
    });
}

// ==================== UI / Layout Logic ====================

/** 按钮加载态包装 (DaisyUI loading spinner) */
async function withLoading(btnOrId, asyncFn) {
    const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
    if (!btn) return asyncFn();
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="loading loading-spinner loading-xs"></span>`;
    try {
        return await asyncFn();
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-active');
}

// ==================== 蓝牙连接 ====================
async function connectBluetooth() {
    await withLoading('btn-connect', async () => {
        try {
            await api.post('/api/bluez', { action: 'ON' });
            UI.info('正在连接...');
        } catch (e) { UI.error(e.message || '连接失败'); }
    });
}

async function disconnectBluetooth() {
    await withLoading('btn-disconnect', async () => {
        try {
            await api.post('/api/bluez', { action: 'OFF' });
            UI.info('正在断开...');
        } catch (e) { UI.error(e.message || '断开失败'); }
    });
}

function switchAmiiboTab(tab) {
    document.querySelectorAll('[role="tablist"] .tab').forEach(b => b.classList.remove('tab-active'));
    document.getElementById('tab-' + tab).classList.add('tab-active');

    document.getElementById('amiibo-library-view').style.display = 'none';
    document.getElementById('amiibo-subscription-view').style.display = 'none';

    if (tab === 'library') {
        document.getElementById('amiibo-library-view').style.display = 'flex';
    } else {
        document.getElementById('amiibo-subscription-view').style.display = 'flex';
        const lastRepo = localStorage.getItem('last_amiibo_repo');
        const input = document.getElementById('repo-url-input');
        if (lastRepo && !input.value) input.value = lastRepo;
    }
}

// ==================== Script Logic ====================
let isScriptRunning = false;

async function toggleScript() {
    if (isScriptRunning) {
        await stopScript();
    } else {
        await runScript();
    }
}

function updateScriptButton() {
    const btn = document.getElementById('script-toggle-btn');
    if (!btn) return;
    
    if (isScriptRunning) {
btn.innerHTML = '⏹ 停止';
btn.className = 'btn btn-error btn-sm';
    } else {
btn.innerHTML = '▶ 运行';
btn.className = 'btn btn-primary btn-sm';
    }
}

async function saveScript() {
    const script = document.getElementById('script-area').value;
    try {
        await api.post('/api/script/save', { script });
        UI.success('脚本已保存');
    } catch (e) { UI.error(e.message || '保存失败'); }
}

async function clearScript() {
    if (!await confirmDialog('确定要清空脚本内容吗？')) return;
    document.getElementById('script-area').value = '';
}

async function runScript() {
    const script = document.getElementById('script-area').value;
    if (!script.trim()) return;
    try {
        await api.post('/api/script/run', { script });
        isScriptRunning = true;
        updateScriptButton();
        UI.success('脚本开始运行');
    } catch (e) { UI.error(e.message || '运行失败'); }
}

async function stopScript() {
    try {
        await api.post('/api/script/stop');
        isScriptRunning = false;
        updateScriptButton();
        UI.info('脚本已停止');
    } catch (e) { /* ignore */ }
}

// ==================== Subscription Logic ====================


async function fetchRepoTree() {
    const repoInput = document.getElementById('repo-url-input');
    const repo = repoInput.value.trim();
    if (!repo) { UI.error('请输入仓库地址'); return; }

    const contentDiv = document.getElementById('repo-content');
    contentDiv.innerHTML = '<div class="empty-state">正在从 GitHub API 获取文件列表...</div>';

    try {
        const data = await api.post('/api/amiibo/subscription', { repo });
        localStorage.setItem('last_amiibo_repo', data.repo);
        _lastRepoFiles = data.files;
        renderRepoFiles(data.files);
    } catch (e) {
        contentDiv.innerHTML = `<div class="error-state">${e.message}</div>`;
    }
}

function renderRepoFiles(files) {
     const contentDiv = document.getElementById('repo-content');
     const toolbar = document.getElementById('repo-toolbar');
     if(!files || files.length === 0) {
 contentDiv.innerHTML = '<div class="empty-state">该仓库未找到 .bin 文件</div>';
 if (toolbar) toolbar.classList.add('hidden');
 return;
     }
     
     // 显示工具栏
     if (toolbar) toolbar.classList.remove('hidden');
     
     // 构建嵌套树结构
     const tree = { folders: {}, files: [] };
     files.forEach(f => {
 const parts = f.path.split('/');
 let node = tree;
 for (let i = 0; i < parts.length - 1; i++) {
     const seg = parts[i];
     if (!node.folders[seg]) node.folders[seg] = { folders: {}, files: [] };
     node = node.folders[seg];
 }
 node.files.push(f);
     });
     
     const collapsedRepoGroups = JSON.parse(localStorage.getItem('repo_collapsed_groups') || '{}');
     
     function countFiles(node) {
 let c = node.files.length;
 for (const sub of Object.values(node.folders)) c += countFiles(sub);
 return c;
     }
     
     function renderNode(node, parentPath) {
 let html = '';
 const folderNames = Object.keys(node.folders).sort((a, b) => a.localeCompare(b));
 
 for (const name of folderNames) {
     const subNode = node.folders[name];
     const fullPath = parentPath ? `${parentPath}/${name}` : name;
     const isCollapsed = collapsedRepoGroups[fullPath] === true;
     const total = countFiles(subNode);
     const escapedPath = fullPath.replace(/'/g, "\\'");
     
     html += `
     <div class="tree-group" data-repo-group="${fullPath}">
         <div class="tree-group-header" onclick="toggleRepoGroup(this, '${escapedPath}')">
             <span class="toggle ${isCollapsed ? 'collapsed' : ''}"></span>
             <span class="group-icon">📁</span>
             <span class="group-name" title="${fullPath}">${name}</span>
             <span class="group-count">${total}</span>
             <div class="group-actions">
                 <button onclick="event.stopPropagation(); downloadAllInFolder('${escapedPath}')" title="下载全部">⬇ 全部</button>
             </div>
         </div>
         <div class="tree-group-items ${isCollapsed ? 'collapsed' : ''}">
             <div class="tree-group-items-inner">
                 ${renderNode(subNode, fullPath)}
             </div>
         </div>
     </div>`;
 }
 
 for (const f of node.files) {
     const safeUrl = f.url.replace(/'/g, "\\'");
     const safeName = f.name.replace(/'/g, "\\'");
     html += `
     <div class="repo-file-item">
         <span class="file-icon">📄</span>
         <div class="file-info">
             <div class="file-name" title="${f.name}">${f.name}</div>
             <div class="file-meta">${(f.size/1024).toFixed(1)} KB</div>
         </div>
         <button onclick="event.stopPropagation(); downloadRepoFile('${safeUrl}', '${safeName}')" class="btn btn-primary btn-sm">⬇</button>
     </div>`;
 }
 
 return html;
     }
     
     contentDiv.innerHTML = renderNode(tree, '');
}

async function downloadRepoFile(url, name) {
    if (!await confirmDialog(`确认下载 ${name}?`)) return;
    UI.info(`正在下载 ${name}...`);
    try {
        await api.post('/api/amiibo/download', { url, name });
        UI.success('下载成功！已添加到库');
        refreshAmiiboList();
    } catch (e) { UI.error(e.message || '下载失败'); }
}

// ==================== 可折叠树组 ====================

// 本地库分组折叠
function toggleTreeGroup(headerEl, groupName) {
    const group = headerEl.closest('.tree-group');
    const itemsEl = group.querySelector(':scope > .tree-group-items');
    const toggleEl = headerEl.querySelector('.toggle');
    
    const isCollapsed = itemsEl.classList.toggle('collapsed');
    toggleEl.classList.toggle('collapsed', isCollapsed);
    
    // 持久化折叠状态
    const state = JSON.parse(localStorage.getItem('amiibo_collapsed_groups') || '{}');
    state[groupName] = isCollapsed;
    localStorage.setItem('amiibo_collapsed_groups', JSON.stringify(state));
}

// 订阅分组折叠
function toggleRepoGroup(headerEl, folderName) {
    const group = headerEl.closest('.tree-group');
    const itemsEl = group.querySelector(':scope > .tree-group-items');
    const toggleEl = headerEl.querySelector('.toggle');
    
    const isCollapsed = itemsEl.classList.toggle('collapsed');
    toggleEl.classList.toggle('collapsed', isCollapsed);
    
    const state = JSON.parse(localStorage.getItem('repo_collapsed_groups') || '{}');
    state[folderName] = isCollapsed;
    localStorage.setItem('repo_collapsed_groups', JSON.stringify(state));
}

// 全部折叠/展开 (本地库)
function collapseAllGroups() {
    const state = {};
    document.querySelectorAll('#amiibo-list .tree-group').forEach(g => {
const gName = g.dataset.group;
const itemsEl = g.querySelector(':scope > .tree-group-items');
const toggleEl = g.querySelector('.toggle');
itemsEl.classList.add('collapsed');
toggleEl.classList.add('collapsed');
state[gName] = true;
    });
    localStorage.setItem('amiibo_collapsed_groups', JSON.stringify(state));
}

function expandAllGroups() {
    document.querySelectorAll('#amiibo-list .tree-group').forEach(g => {
const itemsEl = g.querySelector(':scope > .tree-group-items');
const toggleEl = g.querySelector('.toggle');
itemsEl.classList.remove('collapsed');
toggleEl.classList.remove('collapsed');
    });
    localStorage.setItem('amiibo_collapsed_groups', '{}');
}

// 订阅: 批量下载某个文件夹
// 缓存最近的 renderRepoFiles 数据以供批量下载使用
let _lastRepoFiles = [];

async function downloadAllInFolder(folderPath) {
    const files = _lastRepoFiles.filter(f => {
        return f.path === folderPath + '/' + f.name || f.path.startsWith(folderPath + '/');
    });
    if (files.length === 0) { UI.error('未找到可下载文件'); return; }
    if (!await confirmDialog(`确认下载 "${folderPath}" 下的 ${files.length} 个文件？`)) return;

    UI.info(`开始批量下载 ${files.length} 个文件...`);
    let ok = 0, fail = 0;
    for (const f of files) {
        try {
            await api.post('/api/amiibo/download', { url: f.url, name: f.name });
            ok++;
        } catch { fail++; }
    }
    UI.toast(`批量下载完成: ${ok} 成功, ${fail} 失败`, ok > 0 ? 'success' : 'error');
    if (ok > 0) refreshAmiiboList();
}

// 订阅文件筛选
function filterRepoFiles(query) {
    if (!_lastRepoFiles.length) return;
    if (!query) {
renderRepoFiles(_lastRepoFiles);
return;
    }
    const q = query.toLowerCase();
    const filtered = _lastRepoFiles.filter(f => 
f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
    renderRepoFiles(filtered);
}

// 订阅分组全部折叠/展开
function collapseAllRepoGroups() {
    const state = {};
    document.querySelectorAll('#repo-content .tree-group').forEach(g => {
const folder = g.dataset.repoGroup;
const itemsEl = g.querySelector(':scope > .tree-group-items');
const toggleEl = g.querySelector('.toggle');
itemsEl.classList.add('collapsed');
toggleEl.classList.add('collapsed');
if (folder) state[folder] = true;
    });
    localStorage.setItem('repo_collapsed_groups', JSON.stringify(state));
}

function expandAllRepoGroups() {
    document.querySelectorAll('#repo-content .tree-group').forEach(g => {
const itemsEl = g.querySelector(':scope > .tree-group-items');
const toggleEl = g.querySelector('.toggle');
itemsEl.classList.remove('collapsed');
toggleEl.classList.remove('collapsed');
    });
    localStorage.setItem('repo_collapsed_groups', '{}');
}

// ==================== Amiibo 库管理 ====================

let allAmiibos = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initControllerButtons();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // 从服务端注入的初始数据填充 textarea
    const config = window.APP_CONFIG || {};
    if (config.initialScript) {
        const scriptArea = document.getElementById('script-area');
        if (scriptArea) scriptArea.value = config.initialScript;
    }
    
    // 加载 Amiibo 库
    refreshAmiiboList();
    
    // 定期更新状态
    setInterval(updateStatus, 3000);
});

// 刷新 Amiibo 列表
async function refreshAmiiboList() {
    try {
        const data = await api.get('/api/amiibo/list');
        allAmiibos = data.amiibos;
        renderAmiiboList(allAmiibos);
    } catch (e) {
        console.error('加载 Amiibo 列表失败:', e);
        UI.error('加载列表失败');
    }
}

async function updateAmiiboDatabase() {
    if (!await confirmDialog('是否从 AmiiboAPI 下载最新的 Amiibo 数据库并匹配本地文件？\n这需要联网，可能花费几秒钟。')) return;
    UI.info('正在下载 Amiibo 数据库...');
    try {
        await api.post('/api/amiibo/updatesource');
        UI.info(`数据库更新成功，正在刷新 ${allAmiibos.length} 个文件的元数据...`);
        const dataMeta = await api.post('/api/amiibo/refresh_metadata');
        UI.success(`全部完成！已更新 ${dataMeta.updated} 个 Amiibo 的图片和信息。`);
        refreshAmiiboList();
    } catch (e) {
        console.error(e);
        UI.error(`更新失败: ${e.message}`);
    }
}

// 搜索 Amiibo
function searchAmiibo(query) {
    if (!query) {
renderAmiiboList(allAmiibos);
return;
    }
    
    const q = query.toLowerCase();
    const filtered = allAmiibos.filter(a => 
a.filename.toLowerCase().includes(q) ||
(a.custom_name || '').toLowerCase().includes(q) ||
(a.character || '').toLowerCase().includes(q) ||
(a.series || '').toLowerCase().includes(q) ||
(a.game_series || '').toLowerCase().includes(q)
    );
    
    renderAmiiboList(filtered);
}

let isGroupMode = true; // 默认开启分组模式

function toggleGroupMode() {
    isGroupMode = !isGroupMode;
    const btn = document.getElementById('btn-group-mode');
    if (btn) btn.classList.toggle('btn-active', isGroupMode);
    renderAmiiboList(currentFilteredAmiibos || allAmiibos);
}

let currentFilteredAmiibos = null;

// 渲染 Amiibo 列表 (Smart Grouped List)
function renderAmiiboList(amiibos) {
    currentFilteredAmiibos = amiibos;
    const list = document.getElementById('amiibo-list');
    if (!list) return;
    
    if (!amiibos || amiibos.length === 0) {
list.innerHTML = `<div class="empty-state">
    <div style="font-size:24px; margin-bottom:10px; opacity:0.5;">📦</div>
    <div>暂无 Amiibo 文件</div>
    <div style="font-size:11px; margin-top:5px; color:var(--color-subtle);">点击上方 "上传" 添加 .bin 文件</div>
</div>`;
return;
    }

    const renderItem = (a) => {
const rawName = a.filename.replace(/\.bin$/i, '');
const displayName = a.custom_name || rawName;
const char = (a.character ? a.character.charAt(0) : displayName.charAt(0)).toUpperCase();

// 元数据
let meta = [];
if (!isGroupMode && a.series) meta.push(a.series); // 分组模式下元数据不显示系列
if (a.game_series && a.game_series !== a.series) meta.push(a.game_series);
if (meta.length === 0) meta.push((a.size / 1024).toFixed(1) + ' KB');

// 颜色
const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#34495e', '#16a085', '#d35400', '#c0392b'];
let hash = 0;
for (let i = 0; i < rawName.length; i++) hash = rawName.charCodeAt(i) + ((hash << 5) - hash);
const color = colors[Math.abs(hash) % colors.length];

// 状态标记
const hasBackup = a.has_origin; 

// 图片处理
let iconHtml = `<div class="amiibo-icon" style="background:${color}1a; color:${color}; border-color:${color}33">${char}</div>`;
if (a.image_url) {
    iconHtml = `<div class="amiibo-icon has-image">
         <img src="${a.image_url}" alt="${displayName}" loading="lazy">
    </div>`;
}

return `
<div class="amiibo-item" data-filename="${a.filename}" onclick="selectAmiibo('${a.filename}')">
    ${iconHtml}
    <div class="amiibo-info">
        <div class="name" title="${a.filename}">
            ${displayName}
            ${hasBackup ? '<span style="color:var(--color-info); font-size:10px; margin-left:4px;" title="有原始备份">↺</span>' : ''}
        </div>
        <div class="meta" title="${meta.join(' · ')}">${meta.join(' · ')}</div>
    </div>
</div>`;
    };
    
    // 确保 list 是清空的
    list.innerHTML = '';

    // 根据是否分组来渲染内容
    if (isGroupMode) {
// 分组逻辑
const groups = {};

// 数据预处理：没有系列信息的归为 "未分类"
amiibos.forEach(a => {
    const groupName = a.series || '未分类';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(a);
});

// 按组名排序
const sortedGroups = Object.keys(groups).sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    return a.localeCompare(b, 'zh-CN');
});

// 渲染每个分组 (可折叠树)
// 读取折叠状态
const collapsedGroups = JSON.parse(localStorage.getItem('amiibo_collapsed_groups') || '{}');

list.innerHTML = sortedGroups.map(gName => {
    const isCollapsed = collapsedGroups[gName] === true;
    const items = groups[gName];
    return `
    <div class="tree-group" data-group="${gName}">
        <div class="tree-group-header" onclick="toggleTreeGroup(this, '${gName.replace(/'/g, "\\'")}')"> 
            <span class="toggle ${isCollapsed ? 'collapsed' : ''}"></span>
            <span class="group-icon">📂</span>
            <span class="group-name">${gName}</span>
            <span class="group-count">${items.length}</span>
        </div>
        <div class="tree-group-items ${isCollapsed ? 'collapsed' : ''}">
            <div class="tree-group-items-inner">
                ${items.map(renderItem).join('')}
            </div>
        </div>
    </div>`;
}).join('');
    } else {
// 扁平列表
list.innerHTML = amiibos.map(renderItem).join('');
    }
}

// 选中 Amiibo - 加载详情面板
let selectedAmiibo = null;
let selectedAmiiboData = null;

function selectAmiibo(filename) {
    selectedAmiibo = filename;
    document.querySelectorAll('.amiibo-item').forEach(el => {
if (el.getAttribute('data-filename') === filename) {
    el.classList.add('selected');
} else {
    el.classList.remove('selected');
}
    });
    
    // 从已加载的列表数据中找到该 amiibo 的基本信息
    selectedAmiiboData = allAmiibos.find(a => a.filename === filename) || null;
    
    // 显示详情面板
    loadAmiiboDetail(filename);
}

async function loadAmiiboDetail(filename) {
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    
    if (!filename) {
emptyEl.style.display = 'flex';
contentEl.style.display = 'none';
return;
    }
    
    emptyEl.style.display = 'none';
    contentEl.style.display = 'flex';
    
    // 基本信息 (从列表缓存)
    const data = selectedAmiiboData;
    if (data) {
// 图片
const imageEl = document.getElementById('detail-image');
if (data.image_url) {
    imageEl.innerHTML = `<img src="${data.image_url}" alt="${data.filename}" loading="lazy">`;
} else {
    const char = (data.character || data.filename.charAt(0)).charAt(0).toUpperCase();
    imageEl.innerHTML = `<span class="placeholder">${char}</span>`;
}

// 名称
const rawName = data.filename.replace(/\.bin$/i, '');
document.getElementById('detail-name').textContent = data.custom_name || rawName;
document.getElementById('detail-name').title = data.filename;

// 子信息
let subParts = [];
if (data.character) subParts.push(data.character);
if (data.game_series) subParts.push(data.game_series);
if (subParts.length === 0) subParts.push((data.size / 1024).toFixed(1) + ' KB');
document.getElementById('detail-sub').textContent = subParts.join(' · ');

// 标签
const tagsEl = document.getElementById('detail-tags');
let tagsHtml = '';
if (data.series) tagsHtml += `<span class="detail-tag">${data.series}</span>`;
if (data.has_origin) tagsHtml += `<span class="detail-tag">有备份</span>`;
if (data.modified) tagsHtml += `<span class="detail-tag modified">已修改</span>`;
tagsEl.innerHTML = tagsHtml;

// 重置按钮状态
const restoreBtn = document.getElementById('detail-btn-restore');
if (restoreBtn) {
    restoreBtn.disabled = !data.has_origin;
    restoreBtn.style.opacity = data.has_origin ? '1' : '0.4';
}
    }
    
    // 加载版本历史
    loadVersionHistory(filename);
}

async function loadVersionHistory(filename) {
    const versionList = document.getElementById('version-list');
    versionList.innerHTML = '<div class="version-empty">加载中...</div>';
    
    try {
        const data = await api.get(`/api/amiibo/versions/${encodeURIComponent(filename)}`);

        if (data.versions && data.versions.length > 0) {
    versionList.innerHTML = data.versions.map(v => {
        const isOrigin = v.type === 'origin';
        const icon = isOrigin ? '📁' : '💾';
        const sizeKB = (v.size / 1024).toFixed(1);
        
        let actionsHtml = `
            <button class="btn-ver-restore" onclick="event.stopPropagation(); restoreToVersion('${filename}', '${v.type}', '${v.bak_file || ''}')" title="恢复到此版本">↺</button>
        `;
        // 只有 backup 类型才能删除
        if (!isOrigin) {
            actionsHtml += `
                <button class="btn-ver-delete" onclick="event.stopPropagation(); deleteVersion('${filename}', '${v.bak_file}')" title="删除此版本">✕</button>
            `;
        }
        
        return `
        <div class="version-item">
            <span class="ver-icon">${icon}</span>
            <div class="ver-info">
                <div class="ver-label">${v.label}</div>
                <div class="ver-date">${v.mtime_str} · ${sizeKB} KB</div>
            </div>
            <div class="ver-actions">${actionsHtml}</div>
        </div>`;
    }).join('');
} else {
    versionList.innerHTML = '<div class="version-empty">无版本记录<br><small style="color:var(--color-subtle)">Switch 写入数据后将自动生成备份</small></div>';
}
    } catch (e) {
versionList.innerHTML = '<div class="version-empty">加载版本失败</div>';
    }
}

// 版本管理操作
async function restoreToVersion(filename, versionType, bakFile) {
    const label = versionType === 'origin' ? '原始版本' : bakFile;
    if (!await confirmDialog(`确定要将 ${filename} 恢复到 ${label}？\n当前数据将被覆盖。`)) return;
    try {
        await api.post('/api/amiibo/restore_version', { filename, version_type: versionType, bak_file: bakFile });
        UI.success('已恢复到指定版本');
        refreshAmiiboList();
        loadAmiiboDetail(filename);
    } catch (e) { UI.error(e.message || '恢复失败'); }
}

async function deleteVersion(filename, bakFile) {
    if (!await confirmDialog(`确定删除备份 ${bakFile}？此操作不可恢复。`)) return;
    try {
        await api.post('/api/amiibo/delete_version', { filename, bak_file: bakFile });
        UI.success('已删除备份');
        loadVersionHistory(filename);
    } catch (e) { UI.error(e.message || '删除失败'); }
}

// 详情面板快捷操作
function scanSelectedAmiibo() {
    if (selectedAmiibo) scanAmiibo(selectedAmiibo);
}

function restoreSelectedAmiibo() {
    if (selectedAmiibo) restoreAmiibo(selectedAmiibo);
}

function deleteSelectedAmiibo() {
    if (selectedAmiibo) {
deleteAmiibo(selectedAmiibo);
// 删除后清空详情面板
selectedAmiibo = null;
selectedAmiiboData = null;
loadAmiiboDetail(null);
    }
}

// 扫描/使用 Amiibo
async function scanAmiibo(filename) {
    try {
        await api.post('/api/amiibo/scan', { filename });
        UI.success(`正在扫描 ${filename}`);
        updateCurrentAmiibo(filename);
    } catch (e) { UI.error(e.message || '扫描失败'); }
}

// 恢复 Amiibo
async function restoreAmiibo(filename) {
    if (!await confirmDialog(`确定要将 ${filename} 恢复到原始状态吗？`)) return;
    try {
        await api.post('/api/amiibo/restore', { filename });
        UI.success('已恢复到原始状态');
        if (selectedAmiibo === filename) loadVersionHistory(filename);
    } catch (e) { UI.error(e.message || '恢复失败'); }
}

// 删除 Amiibo
async function deleteAmiibo(filename) {
    if (!await confirmDialog(`确定要删除 ${filename} 吗？`)) return;
    const removeOrigin = await confirmDialog('是否同时删除原始备份？');
    try {
        await api.post('/api/amiibo/delete', { filename, remove_origin: removeOrigin });
        UI.success('已删除');
        refreshAmiiboList();
        if (selectedAmiibo === filename) {
            selectedAmiibo = null;
            selectedAmiiboData = null;
            loadAmiiboDetail(null);
        }
    } catch (e) { UI.error(e.message || '删除失败'); }
}

// 上传 Amiibo
async function uploadAmiibo() {
    const fileInput = document.getElementById('amiibo-file');
    const files = fileInput.files;
    if (files.length === 0) { UI.info('请选择文件'); return; }

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            await api.post('/api/amiibo/add', formData);
            UI.success(`${file.name} 上传成功`);
        } catch (e) {
            UI.error(`${file.name}: ${e.message || '上传失败'}`);
        }
    }
    fileInput.value = '';
    refreshAmiiboList();
}

// 更新当前 Amiibo 状态
function updateCurrentAmiibo(filename) {
    const status = document.getElementById('current-amiibo-status');
    const name = document.getElementById('current-amiibo-name');
    
    if (filename) {
status.classList.remove('hide');
name.textContent = filename;
    } else {
status.classList.add('hide');
    }
}

// 移除当前 Amiibo
async function removeCurrentAmiibo() {
    try {
        await api.post('/api/btn', { action: 'push', button: 'amiibo remove' });
        updateCurrentAmiibo(null);
        UI.success('已移除 Amiibo');
    } catch (e) { UI.error(e.message || '移除失败'); }
}

// ==================== 键位管理与键盘快捷键 ====================

// 默认键盘映射配置
const DEFAULT_KEY_MAP = {
    // WASD -> 左摇杆
    'KeyW': { type: 'stick', stick: 'ls', direction: 'up' },
    'KeyA': { type: 'stick', stick: 'ls', direction: 'left' },
    'KeyS': { type: 'stick', stick: 'ls', direction: 'down' },
    'KeyD': { type: 'stick', stick: 'ls', direction: 'right' },
    // 方向键 -> 右摇杆
    'ArrowUp': { type: 'stick', stick: 'rs', direction: 'up' },
    'ArrowLeft': { type: 'stick', stick: 'rs', direction: 'left' },
    'ArrowDown': { type: 'stick', stick: 'rs', direction: 'down' },
    'ArrowRight': { type: 'stick', stick: 'rs', direction: 'right' },
    // 摇杆中心按下
    'Comma': { type: 'button', button: 'l_stick' },
    'Period': { type: 'button', button: 'r_stick' },
    // 常用按键
    'KeyI': { type: 'button', button: 'x' },
    'KeyJ': { type: 'button', button: 'y' },
    'KeyL': { type: 'button', button: 'a' },
    'KeyK': { type: 'button', button: 'b' },
    'KeyQ': { type: 'button', button: 'l' },
    'KeyE': { type: 'button', button: 'r' },
    'Digit1': { type: 'button', button: 'zl' },
    'Digit3': { type: 'button', button: 'zr' },
    'BracketRight': { type: 'button', button: 'home' },
    'BracketLeft': { type: 'button', button: 'capture' },
    'Equal': { type: 'button', button: 'plus' },
    'Minus': { type: 'button', button: 'minus' },
    // 十字键 (Shift + wasd)
    'ShiftKeyW': { type: 'button', button: 'up' },
    'ShiftKeyA': { type: 'button', button: 'left' },
    'ShiftKeyS': { type: 'button', button: 'down' },
    'ShiftKeyD': { type: 'button', button: 'right' },
};

// 从 localStorage 加载自定义映射
let keyMap = {};
function loadKeyMap() {
    keyMap = { ...DEFAULT_KEY_MAP };
    try {
        const saved = JSON.parse(localStorage.getItem('rascon_keymap') || '{}');
        for (const [ctrlBtn, keyCode] of Object.entries(saved)) {
            for (const k of Object.keys(keyMap)) {
                const m = keyMap[k];
                const mBtn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
                if (mBtn === ctrlBtn) delete keyMap[k];
            }
            if (!keyCode) continue;
            delete keyMap[keyCode];
            const stickMatch = ctrlBtn.match(/^(ls|rs) (up|down|left|right)$/);
            if (stickMatch) {
                keyMap[keyCode] = { type: 'stick', stick: stickMatch[1], direction: stickMatch[2] };
            } else {
                keyMap[keyCode] = { type: 'button', button: ctrlBtn };
            }
        }
    } catch (e) { /* ignore */ }
}
loadKeyMap();

function saveCustomKeyMap() {
    const custom = {};
    const defaultByBtn = {};
    for (const [k, m] of Object.entries(DEFAULT_KEY_MAP)) {
        const btn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
        defaultByBtn[btn] = k;
    }
    const currentByBtn = {};
    for (const [k, m] of Object.entries(keyMap)) {
        const btn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
        currentByBtn[btn] = k;
    }
    const allBtns = new Set([...Object.keys(defaultByBtn), ...Object.keys(currentByBtn)]);
    for (const btn of allBtns) {
        if (defaultByBtn[btn] !== currentByBtn[btn]) {
            custom[btn] = currentByBtn[btn] || '';
        }
    }
    if (Object.keys(custom).length === 0) {
        localStorage.removeItem('rascon_keymap');
    } else {
        localStorage.setItem('rascon_keymap', JSON.stringify(custom));
    }
}

// ==================== 键位编辑模式 ====================
let isKeybindMode = false;

function toggleKeybindMode() {
    isKeybindMode = !isKeybindMode;
    const btn = document.getElementById('btn-keybind-mode');
    const grid = document.querySelector('.controller-grid');
    if (isKeybindMode) {
        btn.classList.add('btn-active');
        grid.classList.add('keybind-mode');
        showKeybindLabels(true);
        UI.info('键位编辑模式：点击控制器按钮修改绑定');
    } else {
        btn.classList.remove('btn-active');
        grid.classList.remove('keybind-mode');
        showKeybindLabels(false);
    }
}

function showKeybindLabels(show) {
    document.querySelectorAll('.controller-grid button[data-btn]').forEach(btn => {
        const existing = btn.querySelector('.keybind-label');
        if (existing) existing.remove();
        if (!show) return;
        const btnValue = btn.getAttribute('data-btn');
        const keyCode = findKeyForButton(btnValue);
        const label = document.createElement('span');
        label.className = 'keybind-label';
        label.textContent = keyCode ? formatKeyCode(keyCode) : '—';
        btn.appendChild(label);
    });
}

function findKeyForButton(btnValue) {
    const normalized = btnValue.replace(/,\d+$/, '');
    for (const [keyCode, m] of Object.entries(keyMap)) {
        const mBtn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
        if (mBtn === normalized) return keyCode;
    }
    return null;
}

function formatKeyCode(code) {
    const shift = code.startsWith('Shift') && code !== 'ShiftLeft' && code !== 'ShiftRight';
    let key = shift ? code.slice(5) : code;
    const map = {
        'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
        'BracketLeft': '[', 'BracketRight': ']', 'Equal': '=', 'Minus': '-',
        'Comma': ',', 'Period': '.', 'Space': '␣', 'Enter': '⏎',
        'Backquote': '`', 'Slash': '/', 'Backslash': '\\', 'Semicolon': ';', 'Quote': "'",
    };
    if (map[key]) key = map[key];
    else key = key.replace('Key', '').replace('Digit', '');
    return shift ? `⇧${key}` : key;
}

function openKeybindDialog(btnElement) {
    const btnValue = btnElement.getAttribute('data-btn');
    const normalized = btnValue.replace(/,\d+$/, '');
    const modal = document.getElementById('keybind-modal');
    const titleEl = document.getElementById('keybind-modal-title');
    const keyEl = document.getElementById('keybind-modal-key');
    const currentEl = document.getElementById('keybind-modal-current');
    const okBtn = document.getElementById('keybind-ok');
    const cancelBtn = document.getElementById('keybind-cancel');
    const unbindBtn = document.getElementById('keybind-unbind');

    const btnLabel = btnElement.childNodes[0].textContent.trim();
    titleEl.textContent = `设置「${btnLabel}」的键位`;
    const currentKey = findKeyForButton(btnValue);
    currentEl.textContent = currentKey ? formatKeyCode(currentKey) : '无';
    keyEl.textContent = '—';
    okBtn.disabled = true;

    let pendingKeyCode = null;

    const onKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') return;
        if (e.code.startsWith('Shift')) return;
        const code = (e.shiftKey ? 'Shift' : '') + e.code;
        pendingKeyCode = code;
        keyEl.textContent = formatKeyCode(code);
        okBtn.disabled = false;
    };

    const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        unbindBtn.removeEventListener('click', onUnbind);
        modal.removeEventListener('close', onBackdrop);
        modal.close();
    };

    const onOk = () => {
        if (pendingKeyCode) {
            delete keyMap[pendingKeyCode];
            for (const k of Object.keys(keyMap)) {
                const m = keyMap[k];
                const mBtn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
                if (mBtn === normalized) { delete keyMap[k]; break; }
            }
            const stickMatch = normalized.match(/^(ls|rs) (up|down|left|right)$/);
            if (stickMatch) {
                keyMap[pendingKeyCode] = { type: 'stick', stick: stickMatch[1], direction: stickMatch[2] };
            } else {
                keyMap[pendingKeyCode] = { type: 'button', button: normalized };
            }
            saveCustomKeyMap();
            showKeybindLabels(true);
            UI.success(`已绑定 ${formatKeyCode(pendingKeyCode)} → ${btnLabel}`);
        }
        cleanup();
    };

    const onUnbind = () => {
        // 移除当前绑定
        for (const k of Object.keys(keyMap)) {
            const m = keyMap[k];
            const mBtn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
            if (mBtn === normalized) { delete keyMap[k]; break; }
        }
        // 恢复该按钮的默认绑定
        for (const [k, m] of Object.entries(DEFAULT_KEY_MAP)) {
            const mBtn = m.type === 'stick' ? `${m.stick} ${m.direction}` : m.button;
            if (mBtn === normalized) {
                delete keyMap[k]; // 清除该键码上可能的其他绑定
                keyMap[k] = { ...m };
                break;
            }
        }
        saveCustomKeyMap();
        showKeybindLabels(true);
        UI.info(`已恢复「${btnLabel}」的默认键位`);
        cleanup();
    };

    const onCancel = () => cleanup();
    const onBackdrop = () => cleanup();

    document.addEventListener('keydown', onKeyDown, true);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    unbindBtn.addEventListener('click', onUnbind);
    modal.addEventListener('close', onBackdrop);
    modal.showModal();
}

// 当前按下的键
const pressedKeys = new Set();
const PREVENT_DEFAULT_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'
]);

// 发送按键命令 (高频调用，静默失败)
async function sendButton(action, button) {
    try {
        await api.post('/api/btn', { action, button });
    } catch (e) {
        console.error('按键命令失败:', e.message);
    }
}

// 处理鼠标/触摸按下
function handleButtonPress(button, buttonValue) {
    if (isKeybindMode) {
        openKeybindDialog(button);
        return;
    }
    button.classList.add('pressed');
    sendButton('press', buttonValue);
}

// 处理鼠标/触摸释放
function handleButtonRelease(button, buttonValue) {
    if (isKeybindMode) return;
    button.classList.remove('pressed');
    sendButton('release', buttonValue);
}

// 初始化控制器按钮
function initControllerButtons() {
    const buttons = document.querySelectorAll('.controller-grid button[data-btn]');
    
    buttons.forEach(button => {
const btnValue = button.getAttribute('data-btn');
if (!btnValue) return;

// 鼠标事件
button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handleButtonPress(button, btnValue);
});

button.addEventListener('mouseup', (e) => {
    e.preventDefault();
    handleButtonRelease(button, btnValue);
});

button.addEventListener('mouseleave', (e) => {
    if (button.classList.contains('pressed')) {
        handleButtonRelease(button, btnValue);
    }
});

// 触摸事件 (移动设备)
button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleButtonPress(button, btnValue);
});

button.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleButtonRelease(button, btnValue);
});
    });
}

// 键盘事件处理
function handleKeyDown(e) {
    // 如果在输入框中，不处理快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // 键位编辑模式下不走游戏输入
    if (isKeybindMode) return;

    const keyCode = (e.shiftKey && !e.code.startsWith('Shift') ? 'Shift' : '') + e.code;
    const mapping = keyMap[keyCode] || keyMap[e.code];
    
    // 始终阻止会触发页面滚动的按键默认行为
    if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();

    if (mapping && !pressedKeys.has(keyCode)) {
e.preventDefault();
pressedKeys.add(keyCode);

if (mapping.type === 'button') {
    sendButton('press', mapping.button);
    highlightButton(mapping.button, true);
} else if (mapping.type === 'stick') {
    sendButton('press', `${mapping.stick} ${mapping.direction}`);
    highlightStick(mapping.stick, mapping.direction, true);
}
    }
}

function handleKeyUp(e) {
    if (isKeybindMode) return;
    if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();
    
    // 检查所有可能的键码
    const keyCode = (e.shiftKey && !e.code.startsWith('Shift') ? 'Shift' : '') + e.code;
    [keyCode, e.code, 'Shift' + e.code].forEach(code => {
if (pressedKeys.has(code)) {
    pressedKeys.delete(code);
    const m = keyMap[code];
    if (m) {
        if (m.type === 'button') {
            sendButton('release', m.button);
            highlightButton(m.button, false);
        } else if (m.type === 'stick') {
            sendButton('release', `${m.stick} ${m.direction}`);
            highlightStick(m.stick, m.direction, false);
        }
    }
}
    });
}

// 高亮按钮
function highlightButton(buttonName, active) {
    const btn = document.querySelector(`button[data-btn="${buttonName}"]`);
    if (btn) {
if (active) {
    btn.classList.add('pressed');
} else {
    btn.classList.remove('pressed');
}
    }
}

// 高亮摇杆
function highlightStick(stick, direction, active) {
    const btn = document.querySelector(`button[data-btn="${stick} ${direction},100"]`);
    if (btn) {
if (active) {
    btn.classList.add('pressed');
} else {
    btn.classList.remove('pressed');
}
    }
}


// 状态更新 (定时轮询，静默失败)
async function updateStatus() {
    try {
        const data = await api.get('/api/status');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        if (statusDot) statusDot.classList.toggle('connected', !!data.connected);
        if (statusText) statusText.textContent = data.connected ? '已连接' : '未连接';
        if (data.current_amiibo) updateCurrentAmiibo(data.current_amiibo);
    } catch (e) {
        console.error('状态更新失败:', e.message);
    }
}