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

// ==================== Modal 动画关闭 ====================
function closeModal(dialog) {
    if (!dialog.open || dialog.classList.contains('modal-closing')) return;
    dialog.classList.add('modal-closing');
    const done = () => {
        dialog.classList.remove('modal-closing');
        dialog.close();
    };
    dialog.addEventListener('transitionend', function handler(e) {
        if (e.target === dialog) {
            dialog.removeEventListener('transitionend', handler);
            done();
        }
    });
    // 兜底：防止 transitionend 不触发
    setTimeout(done, 350);
}

// 拦截所有 modal-backdrop 的 form[method=dialog] 提交，改用动画关闭
document.addEventListener('submit', e => {
    const form = e.target;
    if (form.getAttribute('method') === 'dialog' && form.classList.contains('modal-backdrop')) {
        e.preventDefault();
        const dialog = form.closest('dialog');
        if (dialog) closeModal(dialog);
    }
}, true);

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
            closeModal(modal);
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

// ---- 主题切换 ----
const THEME_DARK = 'dracula';
const THEME_LIGHT = 'cmyk';

function syncThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === THEME_DARK;
    document.getElementById('theme-icon-sun').style.display = isDark ? 'none' : '';
    document.getElementById('theme-icon-moon').style.display = isDark ? '' : 'none';
}

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    
    function applyTheme() {
        html.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        syncThemeIcon();
    }

    if (document.startViewTransition) {
        document.startViewTransition(() => {
            applyTheme();
        });
    } else {
        applyTheme();
    }
}

// 系统偏好色变化时跟随（仅在用户没有手动选过时）
if (!localStorage.getItem('theme')) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
        const auto = e.matches ? THEME_LIGHT : THEME_DARK;
        document.documentElement.setAttribute('data-theme', auto);
        syncThemeIcon();
    });
}
// 页面加载后同步图标
document.addEventListener('DOMContentLoaded', syncThemeIcon);

// ---- SVG 图标辅助 ----
function svgIcon(name, cls = 'icon w-4 h-4') {
    return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}

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
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            // 移动端全屏时尝试锁定为横屏，提供最优手柄体验
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch((e) => {
                    console.log('部分设备不支持自动旋转锁定或需手动同意:', e);
                });
            }
        }).catch(() => {});
    } else {
        if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
        }
        document.exitFullscreen();
    }
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

const SCRIPT_BTN_BASE = 'btn flex-1 min-h-[44px] rounded-xl shadow-sm gap-2';

function updateScriptButton() {
    const btn = document.getElementById('script-toggle-btn');
    if (!btn) return;
    if (isScriptRunning) {
        btn.innerHTML = `${svgIcon('stop')} 停止`;
        btn.className = `${SCRIPT_BTN_BASE} btn-error`;
    } else {
        btn.innerHTML = `${svgIcon('play')} 运行`;
        btn.className = `${SCRIPT_BTN_BASE} btn-primary`;
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
    contentDiv.innerHTML = `
    <div class="flex flex-col items-center justify-center p-12 text-base-content/50 h-full">
        <span class="loading loading-spinner loading-md mb-4 text-primary"></span>
        <span class="text-sm">正在从 GitHub 获取内容...</span>
    </div>`;

    try {
        const data = await api.post('/api/amiibo/subscription', { repo });
        localStorage.setItem('last_amiibo_repo', data.repo);
        _lastRepoFiles = data.files;
        renderRepoFiles(data.files);
    } catch (e) {
        contentDiv.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 h-full text-error">
            ${svgIcon('x', 'w-10 h-10 mb-4 opacity-50')}
            <span class="text-sm text-center">${e.message}</span>
        </div>`;
    }
}

function renderRepoFiles(files) {
    const contentDiv = document.getElementById('repo-content');
    const toolbar = document.getElementById('repo-toolbar');
    if(!files || files.length === 0) {
        contentDiv.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-base-content/40 h-full">
            ${svgIcon('inbox', 'w-12 h-12 mb-4 opacity-30')}
            <div class="font-medium text-sm">该仓库未找到 .bin 文件</div>
        </div>`;
        if (toolbar) toolbar.classList.add('hidden');
        return;
    }
    
    if (toolbar) toolbar.classList.remove('hidden');
    
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
            <li>
                <details ${isCollapsed ? '' : 'open'} ontoggle="saveRepoGroupState('${escapedPath}', !this.open)">
                    <summary class="group py-2 min-h-0 text-[13px] font-medium text-base-content/80 hover:bg-base-200/60 hover:text-base-content transition-colors rounded-xl mx-1">
                        ${svgIcon('folder', 'icon w-4 h-4 opacity-40 group-open:hidden transition-transform')}
                        ${svgIcon('folder-open', 'icon w-4 h-4 text-primary hidden group-open:block')}
                        <span class="truncate flex-1">${name}</span>
                        <div class="flex items-center gap-1.5 ml-auto">
                            <span class="badge badge-sm border-base-content/10 bg-base-100 text-[10px] shadow-sm">${total}</span>
                            <button onclick="event.preventDefault(); event.stopPropagation(); downloadAllInFolder('${escapedPath}')" class="btn btn-xs btn-ghost btn-circle opacity-0 group-hover:opacity-100 transition-opacity min-h-0 h-6 w-6" title="下载全部">
                                ${svgIcon('download', 'icon w-3.5 h-3.5')}
                            </button>
                        </div>
                    </summary>
                    <ul class="before:w-[1px] before:bg-base-300 ml-3 pl-2 mt-0.5 mb-1 gap-0.5">
                        ${renderNode(subNode, fullPath)}
                    </ul>
                </details>
            </li>`;
        }
        
        for (const f of node.files) {
            const safeUrl = f.url.replace(/'/g, "\\'");
            const safeName = f.name.replace(/'/g, "\\'");
            html += `
            <li>
                <a class="group flex gap-2 py-1.5 px-3 min-h-0 text-[13px] hover:bg-base-200/60 rounded-lg mx-1 transition-colors" onclick="event.stopPropagation(); downloadRepoFile('${safeUrl}', '${safeName}')">
                    ${svgIcon('file', 'icon w-4 h-4 opacity-40')}
                    <span class="truncate flex-1">${f.name}</span>
                    <span class="text-[10px] opacity-40 font-mono mt-0.5 group-hover:hidden">${(f.size/1024).toFixed(1)}K</span>
                    <button class="btn btn-xs btn-primary hidden group-hover:inline-flex min-h-0 h-5 px-2 font-normal rounded">下载</button>
                </a>
            </li>`;
        }
        return html;
    }
    
    contentDiv.innerHTML = `<ul class="menu bg-transparent w-full p-2 h-full gap-0.5">${renderNode(tree, '')}</ul>`;
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

// ==================== 可折叠树组持久化 ====================

window.saveAmiiboGroupState = function(groupName, isCollapsed) {
    const state = JSON.parse(localStorage.getItem('amiibo_collapsed_groups') || '{}');
    state[groupName] = isCollapsed;
    localStorage.setItem('amiibo_collapsed_groups', JSON.stringify(state));
};

window.saveRepoGroupState = function(folderName, isCollapsed) {
    const state = JSON.parse(localStorage.getItem('repo_collapsed_groups') || '{}');
    state[folderName] = isCollapsed;
    localStorage.setItem('repo_collapsed_groups', JSON.stringify(state));
};

function collapseAllGroups() {
    document.querySelectorAll('#amiibo-list details').forEach(d => {
        if (d.open) { d.open = false; d.dispatchEvent(new Event('toggle')); }
    });
}

function expandAllGroups() {
    document.querySelectorAll('#amiibo-list details').forEach(d => {
        if (!d.open) { d.open = true; d.dispatchEvent(new Event('toggle')); }
    });
}

function collapseAllRepoGroups() {
    document.querySelectorAll('#repo-content details').forEach(d => {
        if (d.open) { d.open = false; d.dispatchEvent(new Event('toggle')); }
    });
}

function expandAllRepoGroups() {
    document.querySelectorAll('#repo-content details').forEach(d => {
        if (!d.open) { d.open = true; d.dispatchEvent(new Event('toggle')); }
    });
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

// ==================== Amiibo 库管理 ====================

let allAmiibos = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initControllerButtons();
    initJoysticks();
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
        list.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-base-content/40 h-full">
            ${svgIcon('inbox', 'w-12 h-12 mb-4 opacity-30')}
            <div class="font-medium text-sm">暂无 Amiibo 文件</div>
            <div class="text-[11px] mt-2 opacity-60">点击上方 "上传" 添加 .bin 文件</div>
        </div>`;
        return;
    }

    const renderItem = (a) => {
        const rawName = a.filename.replace(/\.bin$/i, '');
        const displayName = a.custom_name || rawName;
        const char = (a.character ? a.character.charAt(0) : displayName.charAt(0)).toUpperCase();

        let meta = [];
        if (!isGroupMode && a.series) meta.push(a.series);
        if (a.game_series && a.game_series !== a.series) meta.push(a.game_series);
        if (meta.length === 0) meta.push((a.size / 1024).toFixed(1) + ' KB');

        const isSelected = selectedAmiibo === a.filename;
        const safeFilename = a.filename.replace(/'/g, "\\'");

        // Simple distinct color hashing
        const colors = [
            'bg-error/10 text-error', 'bg-warning/10 text-warning', 'bg-success/10 text-success',
            'bg-info/10 text-info', 'bg-primary/10 text-primary', 'bg-secondary/10 text-secondary',
            'bg-accent/10 text-accent'
        ];
        let hash = 0; for (let i = 0; i < rawName.length; i++) hash = rawName.charCodeAt(i) + ((hash << 5) - hash);
        const colorCls = colors[Math.abs(hash) % colors.length];

        const activeCls = isSelected ? 'bg-primary/10 border-primary/20 shadow-sm' : 'border-transparent hover:bg-base-200/60';

        return `
        <li>
            <a class="amiibo-item flex gap-3 py-2 px-3 min-h-0 rounded-xl transition-all border ${activeCls} mx-1" onclick="selectAmiibo('${safeFilename}')" data-filename="${safeFilename}">
                <div class="avatar placeholder">
                    <div class="w-9 h-9 rounded-xl ${colorCls} overflow-hidden shadow-inner flex items-center justify-center font-bold text-lg">
                        ${a.image_url ? `<img src="${a.image_url}" class="object-cover w-full h-full" loading="lazy">` : char}
                    </div>
                </div>
                <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <div class="flex items-center gap-1.5">
                        <span class="truncate text-[13px] font-medium text-base-content/90">${displayName}</span>
                        ${a.has_origin ? `
                            <div class="tooltip tooltip-right" data-tip="有原始备份">
                                ${svgIcon('undo', 'icon w-3 h-3 text-info opacity-70')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="truncate text-[10px] text-base-content/50">${meta.join(' · ')}</div>
                </div>
            </a>
        </li>`;
    };

    list.innerHTML = '';

    if (isGroupMode) {
        const groups = {};
        amiibos.forEach(a => { const g = a.series || '未分类'; if (!groups[g]) groups[g] = []; groups[g].push(a); });
        const sortedGroups = Object.keys(groups).sort((a, b) => a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh-CN'));
        const collapsedGroups = JSON.parse(localStorage.getItem('amiibo_collapsed_groups') || '{}');

        list.innerHTML = `<ul class="menu bg-transparent w-full p-2 h-full gap-1">` + sortedGroups.map(gName => {
            const isCollapsed = collapsedGroups[gName] === true;
            const items = groups[gName];
            const safeName = gName.replace(/'/g, "\\'");
            return `
            <li>
                <details ${isCollapsed ? '' : 'open'} ontoggle="saveAmiiboGroupState('${safeName}', !this.open)">
                    <summary class="group py-2 min-h-0 text-[13px] font-medium text-base-content/80 hover:bg-base-200/60 hover:text-base-content transition-colors rounded-xl mx-1">
                        ${svgIcon('folder', 'icon w-4 h-4 opacity-40 group-open:hidden transition-transform')}
                        ${svgIcon('folder-open', 'icon w-4 h-4 text-primary hidden group-open:block')}
                        <span class="truncate flex-1">${gName}</span>
                        <span class="badge badge-sm border-base-content/10 bg-base-100 text-[10px] shadow-sm ml-auto">${items.length}</span>
                    </summary>
                    <ul class="before:w-[1px] before:bg-base-300 ml-3 pl-2 mt-0.5 mb-1 gap-0.5">
                        ${items.map(renderItem).join('')}
                    </ul>
                </details>
            </li>`;
        }).join('') + `</ul>`;
    } else {
        list.innerHTML = `<ul class="menu bg-transparent w-full p-2 h-full gap-0.5">` + amiibos.map(renderItem).join('') + `</ul>`;
    }
}

// 选中 Amiibo - 加载详情面板
let selectedAmiibo = null;
let selectedAmiiboData = null;

function selectAmiibo(filename) {
    selectedAmiibo = filename;
    document.querySelectorAll('.amiibo-item').forEach(el => {
        const isTarget = el.getAttribute('data-filename') === filename;
        el.classList.toggle('bg-primary/10', isTarget);
        el.classList.toggle('border-primary/20', isTarget);
        el.classList.toggle('shadow-sm', isTarget);
        el.classList.toggle('border-transparent', !isTarget);
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
        emptyEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
        return;
    }
    
    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    
    const data = selectedAmiiboData;
    if (data) {
        const imageEl = document.getElementById('detail-image');
        if (data.image_url) {
            imageEl.innerHTML = `<img src="${data.image_url}" alt="${data.filename}" class="object-contain w-full h-full p-2 drop-shadow-lg" loading="lazy">`;
        } else {
            const char = (data.character || data.filename.charAt(0)).charAt(0).toUpperCase();
            imageEl.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center text-4xl text-base-content/20 font-bold bg-base-300/30 rounded-2xl">${char}</div>`;
        }

        const rawName = data.filename.replace(/\.bin$/i, '');
        const nameEl = document.getElementById('detail-name');
        nameEl.textContent = data.custom_name || rawName;
        nameEl.title = data.filename;

        let subParts = [];
        if (data.character) subParts.push(data.character);
        if (data.game_series) subParts.push(data.game_series);
        if (subParts.length === 0) subParts.push((data.size / 1024).toFixed(1) + ' KB');
        document.getElementById('detail-sub').textContent = subParts.join(' · ');

        const tagsEl = document.getElementById('detail-tags');
        let tagsHtml = '';
        if (data.series) tagsHtml += `<span class="badge badge-sm badge-outline border-base-content/20 text-base-content/70">${data.series}</span>`;
        if (data.has_origin) tagsHtml += `<span class="badge badge-sm badge-outline border-info/30 text-info bg-info/5">有备份</span>`;
        if (data.modified) tagsHtml += `<span class="badge badge-sm badge-outline border-warning/30 text-warning bg-warning/5">已修改</span>`;
        tagsEl.innerHTML = tagsHtml;

        const restoreBtn = document.getElementById('detail-btn-restore');
        if (restoreBtn) restoreBtn.disabled = !data.has_origin;
    }
    
    loadVersionHistory(filename);
}

async function loadVersionHistory(filename) {
    const versionList = document.getElementById('version-list');
    versionList.innerHTML = `<div class="flex justify-center p-8 text-base-content/30"><span class="loading loading-spinner loading-md"></span></div>`;
    
    try {
        const data = await api.get(`/api/amiibo/versions/${encodeURIComponent(filename)}`);

        if (data.versions && data.versions.length > 0) {
            versionList.innerHTML = `<ul class="menu bg-base-200/50 rounded-2xl p-2 gap-1 border border-base-200 shadow-inner">` + data.versions.map(v => {
                const isOrigin = v.type === 'origin';
                const icon = isOrigin ? svgIcon('folder', 'icon w-4 h-4 text-primary/80') : svgIcon('save', 'icon w-4 h-4 text-base-content/50');
                const sizeKB = (v.size / 1024).toFixed(1);
                
                let actionsHtml = `<button class="btn btn-ghost btn-xs btn-square text-info hover:bg-info/20 hover:text-info" onclick="event.stopPropagation(); restoreToVersion('${filename}', '${v.type}', '${v.bak_file || ''}')" title="恢复到此版本">${svgIcon('undo', 'icon w-3.5 h-3.5')}</button>`;
                if (!isOrigin) {
                    actionsHtml += `<button class="btn btn-ghost btn-xs btn-square text-error hover:bg-error/20 hover:text-error ml-1" onclick="event.stopPropagation(); deleteVersion('${filename}', '${v.bak_file}')" title="删除此版本">${svgIcon('trash', 'icon w-3.5 h-3.5')}</button>`;
                }
                
                return `
                <li>
                    <div class="flex gap-3 py-2 px-3 hover:bg-base-100 transition-colors rounded-xl mx-0.5">
                        <div class="mt-0.5">${icon}</div>
                        <div class="flex-1 min-w-0">
                            <div class="text-[12px] font-medium text-base-content/90 truncate">${v.label}</div>
                            <div class="text-[10px] text-base-content/50 mt-0.5 font-mono">${v.mtime_str} · ${sizeKB} KB</div>
                        </div>
                        <div class="flex items-center">${actionsHtml}</div>
                    </div>
                </li>`;
            }).join('') + `</ul>`;
        } else {
            versionList.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 text-center bg-base-200/30 rounded-2xl border border-base-200 border-dashed">
                <div class="text-base-content/50 text-[12px] font-medium">无版本记录</div>
                <div class="text-[10px] text-base-content/40 mt-1.5 max-w-[150px]">Switch 写入数据后将自动生成备份</div>
            </div>`;
        }
    } catch (e) {
        versionList.innerHTML = `<div class="text-center text-error text-xs p-4 bg-error/10 rounded-2xl">加载版本失败</div>`;
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
        status.classList.remove('translate-y-full', 'opacity-0');
        status.classList.add('translate-y-0', 'opacity-100');
        name.textContent = filename;
    } else {
        status.classList.add('translate-y-full', 'opacity-0');
        status.classList.remove('translate-y-0', 'opacity-100');
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
        // outline classes are now handled natively by smooth CSS transitions in index.html, no need to inject via JS
        showKeybindLabels(true);
        UI.info('键位编辑模式：点击控制器按钮修改绑定');
    } else {
        btn.classList.remove('btn-active');
        grid.classList.remove('keybind-mode');
        showKeybindLabels(false);
    }
}

function showKeybindLabels(show) {
    if (!show) {
        document.querySelectorAll('.keybind-label').forEach(label => {
            // Animate out
            label.classList.remove('opacity-100', 'scale-100');
            label.classList.add('opacity-0', 'scale-50');
            // Wait for animation to finish before blocking layout
            setTimeout(() => { if (!isKeybindMode) label.style.display = 'none'; }, 300);
        });
        return;
    }
    
    document.querySelectorAll('.controller-grid [data-btn]').forEach(btn => {
        let label = btn.querySelector('.keybind-label');
        const btnValue = btn.getAttribute('data-btn');
        const keyCode = findKeyForButton(btnValue);
        
        if (!label) {
            label = document.createElement('span');
            // 回归半透明且无主题色的性冷淡/玻璃态风格，移除高亮 primary 色
            label.className = 'keybind-label pointer-events-none absolute bottom-0 right-[-2px] text-[10px] font-bold bg-base-content/70 text-base-100 backdrop-blur-sm border border-base-100/30 px-1.5 py-[2px] min-w-[20px] rounded-lg shadow-sm leading-none text-center z-50 font-mono transition-all duration-300 ease-out opacity-0 scale-50 inline-flex items-center justify-center';
            btn.appendChild(label);
        }
        
        label.style.display = 'block';
        label.textContent = keyCode ? formatKeyCode(keyCode) : '—';
        
        // Force reflow to ensure display: block is registered before transitioning
        void label.offsetHeight;
        
        // Transition in
        label.classList.remove('opacity-0', 'scale-50');
        label.classList.add('opacity-100', 'scale-100');
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

    const nameMap = {
        'l_stick': '左摇杆按压', 'r_stick': '右摇杆按压',
        'ls up': '左摇杆(上)', 'ls left': '左摇杆(左)', 'ls right': '左摇杆(右)', 'ls down': '左摇杆(下)',
        'rs up': '右摇杆(上)', 'rs left': '右摇杆(左)', 'rs right': '右摇杆(右)', 'rs down': '右摇杆(下)'
    };
    
    let btnLabel = '';
    if (btnElement.tagName === 'BUTTON') {
        const textNode = Array.from(btnElement.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) btnLabel = textNode.textContent.trim();
    }
    
    if (!btnLabel || btnLabel.length > 5) {
        btnLabel = nameMap[normalized] || normalized.toUpperCase();
    }
    
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
        closeModal(modal);
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

    // 同步摇杆视觉
    const stickMatch = buttonValue.match(/^(ls|rs) (up|down|left|right)/);
    if (stickMatch) {
        if (stickState[stickMatch[1]] !== undefined) {
            stickState[stickMatch[1]][stickMatch[2]] = true;
            updateJoystickVisuals(stickMatch[1]);
        }
    }
}

// 处理鼠标/触摸释放
function handleButtonRelease(button, buttonValue) {
    if (isKeybindMode) return;
    button.classList.remove('pressed');
    sendButton('release', buttonValue);

    // 同步摇杆视觉
    const stickMatch = buttonValue.match(/^(ls|rs) (up|down|left|right)/);
    if (stickMatch) {
        if (stickState[stickMatch[1]] !== undefined) {
            stickState[stickMatch[1]][stickMatch[2]] = false;
            updateJoystickVisuals(stickMatch[1]);
        }
    }
}

// 初始化控制器按钮
function initControllerButtons() {
    const buttons = document.querySelectorAll('.controller-grid [data-btn]');
    
    buttons.forEach(button => {
const btnValue = button.getAttribute('data-btn');
if (!btnValue || btnValue === 'l_stick' || btnValue === 'r_stick') return;

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

// ---- 虚拟摇杆 ----
function initJoysticks() {
    document.querySelectorAll('.joystick-zone').forEach(zone => {
        const stick = zone.dataset.stick; // 'ls' or 'rs'
        const base = zone.querySelector('.joystick-base');
        const knob = zone.querySelector('.joystick-knob');
        const stickBtn = stick === 'ls' ? 'l_stick' : 'r_stick';
        let dragging = false;
        let currentDir = null;
        let moved = false;
        let targetWasKnob = false;
        let activeTouchId = null;

        function getOffset(e) {
            const rect = base.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const maxR = rect.width / 2 - knob.offsetWidth / 2;
            let dx = e.clientX - cx;
            let dy = e.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
            return { dx, dy, dist, maxR };
        }

        function getDirection(dx, dy, deadZone) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < deadZone) return null;
            const angle = Math.atan2(-dy, dx);
            if (angle >= -Math.PI / 4 && angle < Math.PI / 4) return 'right';
            if (angle >= Math.PI / 4 && angle < 3 * Math.PI / 4) return 'up';
            if (angle >= -3 * Math.PI / 4 && angle < -Math.PI / 4) return 'down';
            return 'left';
        }

        base.addEventListener('pointerdown', (e) => {
            if (isKeybindMode) {
                const btnEl = e.target.closest('[data-btn]');
                if (btnEl) { e.preventDefault(); e.stopPropagation(); openKeybindDialog(btnEl); }
                return;
            }
            if (e.target.closest('button')) return;
            
            // Allow primary touch/mouse only
            if (e.pointerType === 'mouse' && e.button !== 0) return;

            e.preventDefault();
            base.setPointerCapture(e.pointerId);
            dragging = true;
            moved = false;
            targetWasKnob = e.target.closest('.joystick-knob') !== null;
            knob.classList.add('dragging');
        });

        base.addEventListener('pointermove', (e) => {
            if (!dragging || !base.hasPointerCapture(e.pointerId)) return;
            e.preventDefault();
            moved = true;
            const { dx, dy, maxR } = getOffset(e);
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            const newDir = getDirection(dx, dy, maxR * 0.28);
            if (newDir !== currentDir) {
                if (currentDir) {
                    sendButton('release', `${stick} ${currentDir},100`);
                    highlightStick(stick, currentDir, false);
                }
                if (newDir) {
                    sendButton('press', `${stick} ${newDir},100`);
                    highlightStick(stick, newDir, true);
                }
                currentDir = newDir;
            }
        });

        function handleEnd(e) {
            if (!dragging || !base.hasPointerCapture(e.pointerId)) return;
            base.releasePointerCapture(e.pointerId);
            dragging = false;
            
            if (currentDir) {
                sendButton('release', `${stick} ${currentDir},100`);
                highlightStick(stick, currentDir, false);
                currentDir = null;
            }
            if (!moved && targetWasKnob) {
                sendButton('press', stickBtn);
                knob.classList.add('bg-primary', 'scale-90');
                setTimeout(() => {
                    sendButton('release', stickBtn);
                    knob.classList.remove('bg-primary', 'scale-90');
                }, 80);
            }
            knob.style.transform = '';
            knob.classList.remove('dragging');
            moved = false;
        }

        base.addEventListener('pointerup', handleEnd);
        base.addEventListener('pointercancel', handleEnd);
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
    const btn = document.querySelector(`[data-btn="${buttonName}"]`);
    if (btn) {
        if (active) {
            btn.classList.add('bg-primary', 'text-primary-content', 'scale-95', 'shadow-inner');
            btn.classList.remove('bg-base-200');
        } else {
            btn.classList.remove('bg-primary', 'text-primary-content', 'scale-95', 'shadow-inner');
            btn.classList.add('bg-base-200');
        }
    }
}

// 控制摇杆视觉位置 (基于虚拟按键的按压)
const stickState = {
    ls: { up: false, down: false, left: false, right: false },
    rs: { up: false, down: false, left: false, right: false }
};

function updateJoystickVisuals(stick) {
    const zone = document.querySelector(`[data-stick="${stick}"]`);
    if (!zone) return;
    const knob = zone.querySelector('.joystick-knob');
    if (!knob) return;
    
    // 如果正在拖拽中，键盘不覆盖拖拽的视觉
    if (knob.classList.contains('dragging')) return;

    const s = stickState[stick];
    let dx = 0, dy = 0;
    
    if (s.left) dx -= 1;
    if (s.right) dx += 1;
    if (s.up) dy -= 1;
    if (s.down) dy += 1;

    // 当有按键按下时移动到底部边缘(比如最大偏移)，约等于基座的一半减去摇杆的一半
    if (dx !== 0 || dy !== 0) {
        const base = zone.querySelector('.joystick-base');
        const maxR = base.offsetWidth / 2 - knob.offsetWidth / 2;
        
        // 归一化并乘以半径
        const length = Math.sqrt(dx*dx + dy*dy);
        const nx = (dx / length) * maxR;
        const ny = (dy / length) * maxR;

        knob.style.transform = `translate(${nx}px, ${ny}px)`;
    } else {
        knob.style.transform = '';
    }
}

// 高亮摇杆及按键
function highlightStick(stick, direction, active) {
    // 高亮环绕的十字按键
    const btn = document.querySelector(`[data-btn="${stick} ${direction},100"]`);
    if (btn) {
        if (active) {
            btn.classList.add('text-primary');
            btn.classList.remove('text-base-content/30');
            btn.classList.add('bg-base-content/10');
        } else {
            btn.classList.remove('text-primary');
            btn.classList.add('text-base-content/30');
            btn.classList.remove('bg-base-content/10');
        }
    }
    
    // 更新视觉摇杆位置
    if (stickState[stick] !== undefined) {
        stickState[stick][direction] = active;
        updateJoystickVisuals(stick);
    }
}


// 状态更新 (定时轮询，静默失败)
async function updateStatus() {
    try {
        const data = await api.get('/api/status');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        if (statusDot) {
            statusDot.classList.toggle('connected', !!data.connected);
            statusDot.classList.toggle('bg-base-content/20', !data.connected);
        }
        if (statusText) statusText.textContent = data.connected ? '已连接' : '未连接';
        if (data.current_amiibo) updateCurrentAmiibo(data.current_amiibo);
    } catch (e) {
        console.error('状态更新失败:', e.message);
    }
}