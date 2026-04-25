// ================= 核心架构与状态管理 =================
const GameState = { SELECTION: 0, BATTLE: 1, END: 2 };
let currentState = GameState.SELECTION;

class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = false;
        this.lastShootTime = 0;
        this.lastHitTime = 0;
        this.lastCastTime = 0;
        this.lastDashTime = 0;
        this.lastWallTime = 0;
        this.lastExplosionTime = 0;
    }

    init() {
        if (!this.ctx) {
            const AudioContextCtor = window.AudioContext || window['webkitAudioContext'];
            this.ctx = new AudioContextCtor();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        this.enabled = true;
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playNoise(duration, vol = 0.1) {
        if (!this.enabled || !this.ctx) return;
        const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;

        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    }

    shouldSkip(tsName, gap = 50) {
        const now = performance.now();
        if (this[tsName] && now - this[tsName] < gap) return true;
        this[tsName] = now;
        return false;
    }

    shoot() {
        if (this.shouldSkip('lastShootTime')) return;
        this.playTone(400, 'square', 0.1, 0.05);
        setTimeout(() => this.playTone(300, 'square', 0.1, 0.05), 50);
    }

    hit() {
        if (this.shouldSkip('lastHitTime')) return;
        this.playNoise(0.2, 0.2);
    }

    cast() {
        if (this.shouldSkip('lastCastTime')) return;
        this.playTone(600, 'sine', 0.3, 0.1);
        setTimeout(() => this.playTone(800, 'sine', 0.3, 0.1), 100);
    }

    dash() {
        if (this.shouldSkip('lastDashTime')) return;
        this.playNoise(0.3, 0.1);
        this.playTone(200, 'sawtooth', 0.3, 0.05);
    }

    wall() {
        if (this.shouldSkip('lastWallTime')) return;
        this.playNoise(0.5, 0.15);
        this.playTone(150, 'square', 0.5, 0.1);
    }

    explosion() {
        if (this.shouldSkip('lastExplosionTime')) return;
        this.playNoise(0.8, 0.4);
    }

    select() {
        this.playTone(800, 'sine', 0.1, 0.1);
    }

    start() {
        this.playTone(440, 'sine', 0.2, 0.1);
        setTimeout(() => this.playTone(554, 'sine', 0.2, 0.1), 200);
        setTimeout(() => this.playTone(659, 'sine', 0.4, 0.1), 400);
    }

    win() {
        this.playTone(440, 'square', 0.2, 0.1);
        setTimeout(() => this.playTone(554, 'square', 0.2, 0.1), 200);
        setTimeout(() => this.playTone(659, 'square', 0.2, 0.1), 400);
        setTimeout(() => this.playTone(880, 'square', 0.6, 0.1), 600);
    }
}

const soundManager = new SoundManager();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const configA = { id: 'A', startX: 150, startY: 300, color: '#2ecc71', keys: { up: 'w', down: 's', left: 'a', right: 'd', skill1: '1', skill2: '2', skill3: '3', skill4: '4', skill5: '5' } };
const configB = { id: 'B', startX: 850, startY: 300, color: '#e74c3c', keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', skill1: '8', skill2: '9', skill3: '0', skill4: '-', skill5: '=' } };

const networkStatusEl = document.getElementById('network-status');
const roomCodeEl = document.getElementById('room-code');
const roomIdInput = document.getElementById('room-id-input');
const startTipEl = document.getElementById('start-tip');
const localBtn = document.getElementById('local-mode-btn');
const hostBtn = document.getElementById('host-room-btn');
const joinBtn = document.getElementById('join-room-btn');
const copyRoomBtn = document.getElementById('copy-room-btn');

let playerAClass = null;
let playerBClass = null;
let p1 = null;
let p2 = null;
let entities = [];
let particles = [];
let lastTime = 0;
let animationStarted = false;
let startScheduled = false;

const keys = {};
let remoteKeys = {};

const NetworkMode = { LOCAL: 'local', ONLINE: 'online' };
const NetworkRole = { LOCAL: 'local', HOST: 'host', GUEST: 'guest' };
let networkMode = NetworkMode.LOCAL;
let networkRole = NetworkRole.LOCAL;
let peer = null;
let connection = null;
let roomId = '';
let lastSnapshotSent = 0;

const SkillData = {
    '火系': {
        color: '#e67e22',
        skills: [
            { id: 'fireball', name: '火球术', cd: 2, cost: 10, keyName: '1/8', desc: '发射火球，附带灼烧效果' },
            { id: 'fireblast', name: '炎爆阵', cd: 8, cost: 30, keyName: '2/9', desc: '自身周围爆发，造成范围伤害并击退' },
            { id: 'flamedash', name: '烈焰冲刺', cd: 6, cost: 20, keyName: '3/0', desc: '向前突进一段距离，对路径上的敌人造成伤害' },
            { id: 'firewall', name: '火墙术', cd: 12, cost: 35, keyName: '4/-', desc: '在面前生成一道火墙，穿越的敌人会被严重灼烧' },
            { id: 'meteor', name: '陨石雨', cd: 20, cost: 50, keyName: '5/=', desc: '在敌人当前位置召唤巨大的陨石砸下，造成毁灭性范围伤害' }
        ]
    },
    '水系': {
        color: '#3498db',
        skills: [
            { id: 'frostray', name: '冰霜射线', cd: 3, cost: 15, keyName: '1/8', desc: '发射射线，附带减速效果' },
            { id: 'waterprison', name: '水牢术', cd: 10, cost: 25, keyName: '2/9', desc: '在敌人脚下召唤水牢，命中造成禁锢' },
            { id: 'waterjet', name: '水流喷射', cd: 5, cost: 20, keyName: '3/0', desc: '持续向前方喷射水流，造成多段伤害并击退' },
            { id: 'frostarmor', name: '冰霜护甲', cd: 15, cost: 30, keyName: '4/-', desc: '为自己附加护甲，减少受到的伤害并使攻击者减速' },
            { id: 'blizzard', name: '暴风雪', cd: 18, cost: 45, keyName: '5/=', desc: '召唤大范围暴风雪，持续造成伤害并强力减速所有敌人' }
        ]
    },
    '土系': {
        color: '#f1c40f',
        skills: [
            { id: 'stonevolley', name: '飞石连击', cd: 4, cost: 20, keyName: '1/8', desc: '发射三颗飞石，附带微弱减速' },
            { id: 'earthshield', name: '大地之盾', cd: 12, cost: 40, keyName: '2/9', desc: '召唤高额护盾，破裂时反伤周围敌人' },
            { id: 'earthspike', name: '地刺突袭', cd: 8, cost: 25, keyName: '3/0', desc: '从地下召唤一排地刺向前方蔓延，造成伤害和短暂击飞' },
            { id: 'mudswamp', name: '泥沼术', cd: 14, cost: 35, keyName: '4/-', desc: '在目标区域生成泥沼，极大降低敌人移速并持续吸蓝' },
            { id: 'earthquake', name: '地震波', cd: 18, cost: 45, keyName: '5/=', desc: '以自身为中心引发大范围地震，造成伤害并眩晕（禁锢）所有敌人' }
        ]
    },
    '风系': {
        color: '#1abc9c',
        skills: [
            { id: 'windblade', name: '风刃', cd: 1.5, cost: 8, keyName: '1/8', desc: '基础攻击，弹道极快，伤害较低' },
            { id: 'whirlwind', name: '旋风斩', cd: 6, cost: 25, keyName: '2/9', desc: '发出缓慢向前的龙卷风，持续多段伤害并附带小幅击退' },
            { id: 'windwall', name: '风墙', cd: 12, cost: 30, keyName: '3/0', desc: '在面前生成一道风墙，持续4秒，阻挡所有敌方飞行道具' },
            { id: 'hurricane', name: '飓风术', cd: 15, cost: 45, keyName: '4/-', desc: '在目标区域召唤强大飓风，短暂延迟后将敌人浮空并造成巨额伤害' },
            { id: 'tailwind', name: '顺风之息', cd: 20, cost: 20, keyName: '5/=', desc: '为自己附加极速状态，移动速度提升60%，持续5秒' }
        ]
    }
};

function setNetworkStatus(text, tone = 'normal') {
    networkStatusEl.textContent = text;
    networkStatusEl.dataset.tone = tone;
}

function setRoomCode(text) {
    roomCodeEl.textContent = text;
}

function updateStartTip() {
    if (networkMode === NetworkMode.LOCAL) {
        startTipEl.textContent = '本地模式：双方在同一台电脑选择法系后自动开始';
        return;
    }
    if (networkRole === NetworkRole.HOST) {
        startTipEl.textContent = '联机主机：你负责玩家 A，等待客机连接并选择法系';
        return;
    }
    if (networkRole === NetworkRole.GUEST) {
        startTipEl.textContent = '联机客机：你负责玩家 B，连接成功后按 7/8/9/0 选择法系';
    }
}

function setSelectionStatusDefaults() {
    document.getElementById('p1-status').innerText = '当前选择：等待中...';
    document.getElementById('p2-status').innerText = '当前选择：等待中...';
}

function resetRuntimeState() {
    playerAClass = null;
    playerBClass = null;
    p1 = null;
    p2 = null;
    entities = [];
    particles = [];
    remoteKeys = {};
    startScheduled = false;
    Object.keys(keys).forEach(key => { keys[key] = false; });
    currentState = GameState.SELECTION;
    document.getElementById('selection-screen').classList.remove('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('end-screen').classList.add('hidden');
    setSelectionStatusDefaults();
    updateStartTip();
}

function cleanupConnection(keepMode = false) {
    if (connection) {
        connection.off && connection.off();
        connection.close();
        connection = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    roomId = '';
    setRoomCode('房间码：未创建');
    if (!keepMode) {
        networkMode = NetworkMode.LOCAL;
        networkRole = NetworkRole.LOCAL;
    }
}

function switchToLocalMode() {
    cleanupConnection();
    resetRuntimeState();
    setNetworkStatus('当前为本地双人模式', 'normal');
}

function ensurePeerJs() {
    if (window.Peer) return true;
    setNetworkStatus('未能加载 PeerJS，请确认网络可访问 CDN', 'error');
    return false;
}

function isGuestConnected() {
    return !!(connection && connection.open);
}

function broadcast(message) {
    if (isGuestConnected()) {
        connection.send(message);
    }
}

function setupConnection(conn) {
    connection = conn;
    conn.on('open', () => {
        if (networkRole === NetworkRole.HOST) {
            setNetworkStatus('客机已连接，等待双方选择法系', 'success');
            broadcast({ type: 'host-selection', className: playerAClass });
        } else {
            setNetworkStatus('已连接主机，使用玩家 B 键位', 'success');
            if (playerBClass) {
                connection.send({ type: 'guest-selection', className: playerBClass });
            }
        }
        updateStartTip();
    });

    conn.on('data', data => {
        handleNetworkMessage(data);
    });

    conn.on('close', () => {
        setNetworkStatus('连接已断开，可重新创建或加入房间', 'error');
        if (networkRole === NetworkRole.HOST) {
            remoteKeys = {};
        }
    });

    conn.on('error', () => {
        setNetworkStatus('联机出现错误，请重新连接', 'error');
    });
}

function createRoom() {
    if (!ensurePeerJs()) return;
    cleanupConnection(true);
    resetRuntimeState();
    networkMode = NetworkMode.ONLINE;
    networkRole = NetworkRole.HOST;
    roomId = `magic-${Math.random().toString(36).slice(2, 8)}`;
    setNetworkStatus('正在创建房间...', 'normal');
    setRoomCode(`房间码：${roomId}`);
    updateStartTip();

    peer = new window.Peer(roomId);
    peer.on('open', () => {
        setNetworkStatus('房间已创建，把房间码发给朋友', 'success');
    });
    peer.on('connection', conn => {
        if (connection && connection.open) {
            conn.close();
            return;
        }
        setupConnection(conn);
    });
    peer.on('error', err => {
        setNetworkStatus(`创建房间失败：${err.type || '未知错误'}`, 'error');
    });
}

function joinRoom() {
    if (!ensurePeerJs()) return;
    const targetRoomId = roomIdInput.value.trim();
    if (!targetRoomId) {
        setNetworkStatus('请先输入房间码', 'error');
        return;
    }

    cleanupConnection(true);
    resetRuntimeState();
    networkMode = NetworkMode.ONLINE;
    networkRole = NetworkRole.GUEST;
    setRoomCode(`目标房间：${targetRoomId}`);
    setNetworkStatus('正在连接主机...', 'normal');
    updateStartTip();

    peer = new window.Peer();
    peer.on('open', () => {
        const conn = peer.connect(targetRoomId, { reliable: true });
        setupConnection(conn);
    });
    peer.on('error', err => {
        setNetworkStatus(`连接失败：${err.type || '未知错误'}`, 'error');
    });
}

function copyRoomCode() {
    if (!roomId) {
        setNetworkStatus('当前没有可复制的房间码', 'error');
        return;
    }
    navigator.clipboard.writeText(roomId).then(() => {
        setNetworkStatus('房间码已复制', 'success');
    }).catch(() => {
        setNetworkStatus(`请手动复制房间码：${roomId}`, 'normal');
    });
}

localBtn.addEventListener('click', switchToLocalMode);
hostBtn.addEventListener('click', createRoom);
joinBtn.addEventListener('click', joinRoom);
copyRoomBtn.addEventListener('click', copyRoomCode);

function scheduleStartIfReady() {
    if (startScheduled || currentState !== GameState.SELECTION) return;
    if (!playerAClass || !playerBClass) return;
    if (networkMode === NetworkMode.ONLINE && networkRole === NetworkRole.HOST && !isGuestConnected()) return;

    startScheduled = true;
    setTimeout(() => {
        startScheduled = false;
        if (!playerAClass || !playerBClass || currentState !== GameState.SELECTION) return;
        if (networkMode === NetworkMode.ONLINE && networkRole === NetworkRole.HOST) {
            broadcast({ type: 'start', playerAClass, playerBClass });
        }
        startGame();
    }, 500);
}

function handleSelectionInput(key) {
    if (currentState !== GameState.SELECTION) return;

    const classMap = { '1': '火系', '2': '水系', '3': '土系', '4': '风系', '7': '风系', '8': '火系', '9': '水系', '0': '土系' };

    if (networkMode === NetworkMode.LOCAL) {
        if (['1', '2', '3', '4'].includes(key)) {
            playerAClass = classMap[key];
            document.getElementById('p1-status').innerText = `当前选择：${playerAClass}`;
            soundManager.select();
        }
        if (['7', '8', '9', '0'].includes(key)) {
            playerBClass = classMap[key];
            document.getElementById('p2-status').innerText = `当前选择：${playerBClass}`;
            soundManager.select();
        }
        scheduleStartIfReady();
        return;
    }

    if (networkRole === NetworkRole.HOST && ['1', '2', '3', '4'].includes(key)) {
        playerAClass = classMap[key];
        document.getElementById('p1-status').innerText = `当前选择：${playerAClass}`;
        broadcast({ type: 'host-selection', className: playerAClass });
        soundManager.select();
        scheduleStartIfReady();
    }

    if (networkRole === NetworkRole.GUEST && ['7', '8', '9', '0'].includes(key)) {
        playerBClass = classMap[key];
        document.getElementById('p2-status').innerText = `当前选择：${playerBClass}`;
        if (isGuestConnected()) {
            connection.send({ type: 'guest-selection', className: playerBClass });
        }
        soundManager.select();
    }
}

function isGuestBattleKey(key) {
    return Object.values(configB.keys).includes(key);
}

function handleNetworkMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'guest-selection' && networkRole === NetworkRole.HOST) {
        playerBClass = message.className;
        document.getElementById('p2-status').innerText = `当前选择：${playerBClass}`;
        scheduleStartIfReady();
        return;
    }

    if (message.type === 'host-selection' && networkRole === NetworkRole.GUEST) {
        playerAClass = message.className;
        document.getElementById('p1-status').innerText = playerAClass ? `当前选择：${playerAClass}` : '当前选择：等待中...';
        return;
    }

    if (message.type === 'input' && networkRole === NetworkRole.HOST) {
        remoteKeys[message.key] = !!message.pressed;
        return;
    }

    if (message.type === 'start' && networkRole === NetworkRole.GUEST) {
        playerAClass = message.playerAClass;
        playerBClass = message.playerBClass;
        document.getElementById('p1-status').innerText = `当前选择：${playerAClass}`;
        document.getElementById('p2-status').innerText = `当前选择：${playerBClass}`;
        startGame();
        return;
    }

    if (message.type === 'snapshot' && networkRole === NetworkRole.GUEST) {
        applySnapshot(message.state);
        return;
    }

    if (message.type === 'end' && networkRole === NetworkRole.GUEST) {
        endGame(message.winner, false);
    }
}

window.addEventListener('keydown', e => {
    soundManager.init();
    const alreadyPressed = !!keys[e.key];
    keys[e.key] = true;

    if (!alreadyPressed) {
        handleSelectionInput(e.key);
        if (networkMode === NetworkMode.ONLINE && networkRole === NetworkRole.GUEST && currentState === GameState.BATTLE && isGuestBattleKey(e.key) && isGuestConnected()) {
            connection.send({ type: 'input', key: e.key, pressed: true });
        }
    }
});

window.addEventListener('keyup', e => {
    keys[e.key] = false;
    if (networkMode === NetworkMode.ONLINE && networkRole === NetworkRole.GUEST && currentState === GameState.BATTLE && isGuestBattleKey(e.key) && isGuestConnected()) {
        connection.send({ type: 'input', key: e.key, pressed: false });
    }
});

function shouldSimulateLocally() {
    return networkMode === NetworkMode.LOCAL || networkRole === NetworkRole.HOST;
}

function getInputState(playerId) {
    if (networkMode === NetworkMode.LOCAL) return keys;
    return playerId === 'A' ? keys : remoteKeys;
}

class Player {
    constructor(config, className) {
        this.config = config;
        this.className = className;
        this.classData = SkillData[className];
        this.x = config.startX;
        this.y = config.startY;
        this.hp = 100;
        this.maxHp = 100;
        this.mp = 100;
        this.maxMp = 100;
        this.mpRegen = 5;
        this.baseSpeed = 250;
        this.radius = 20;
        this.cooldowns = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
        this.statuses = [];
        this.shieldAmount = 0;
    }

    get speed() {
        if (this.hasStatus('root')) return 0;
        let finalSpeed = this.baseSpeed;
        if (this.hasStatus('slow')) finalSpeed *= 0.6;
        if (this.hasStatus('haste')) finalSpeed *= 1.6;
        return finalSpeed;
    }

    hasStatus(type) {
        return this.statuses.some(s => s.type === type);
    }

    addStatus(type, duration, value = 0) {
        this.statuses.push({ type, duration, maxDuration: duration, value, tickTimer: 0 });
    }

    takeDamage(amount, sourceClass = null) {
        soundManager.hit();
        let finalDamage = amount;

        if (sourceClass) {
            if ((sourceClass === '火系' && this.className === '风系') ||
                (sourceClass === '风系' && this.className === '土系') ||
                (sourceClass === '土系' && this.className === '水系') ||
                (sourceClass === '水系' && this.className === '火系')) {
                finalDamage *= 1.2;
            }
        }

        if (this.shieldAmount > 0) {
            if (this.shieldAmount >= finalDamage) {
                this.shieldAmount -= finalDamage;
                finalDamage = 0;
            } else {
                finalDamage -= this.shieldAmount;
                this.shieldAmount = 0;
            }
        }

        this.hp = Math.max(0, this.hp - finalDamage);
        this.updateUI();
    }

    update(dt, enemy) {
        const shieldIndex = this.statuses.findIndex(s => s.type === 'shield');
        if (shieldIndex !== -1 && this.shieldAmount <= 0) {
            const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
            if (dist < 100) enemy.takeDamage(15, this.className);
            createExplosion(this.x, this.y, '#f1c40f', 20, 150, 0.6, 6);
            createExplosion(this.x, this.y, '#7f8c8d', 15, 120, 0.5, 4);
            entities.push(new AoE(this, this.x, this.y, 100, 0.1, '#f1c40f', 'shieldbreak', () => {}));
            this.statuses.splice(shieldIndex, 1);
        }

        for (let i = this.statuses.length - 1; i >= 0; i--) {
            const s = this.statuses[i];
            s.duration -= dt;

            if (s.type === 'burn') {
                if (Math.random() < 0.1) {
                    particles.push(new Particle(
                        this.x + (Math.random() - 0.5) * this.radius * 2,
                        this.y + (Math.random() - 0.5) * this.radius * 2,
                        0, -30, 0.5, '#e74c3c', 2
                    ));
                }
                s.tickTimer += dt;
                if (s.tickTimer >= 1) {
                    this.takeDamage(2, '火系');
                    s.tickTimer -= 1;
                }
            }

            if (s.duration <= 0) {
                if (s.type === 'shield') {
                    const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
                    if (dist < 100) enemy.takeDamage(15, this.className);
                    createExplosion(this.x, this.y, '#f1c40f', 20, 150, 0.6, 6);
                    createExplosion(this.x, this.y, '#7f8c8d', 15, 120, 0.5, 4);
                    entities.push(new AoE(this, this.x, this.y, 100, 0.1, '#f1c40f', 'shieldbreak', () => {}));
                    this.shieldAmount = 0;
                }
                this.statuses.splice(i, 1);
            }
        }

        if (!this.hasStatus('root') && !this.hasStatus('knockup')) {
            const input = getInputState(this.config.id);
            let dx = 0;
            let dy = 0;
            if (input[this.config.keys.up]) dy -= 1;
            if (input[this.config.keys.down]) dy += 1;
            if (input[this.config.keys.left]) dx -= 1;
            if (input[this.config.keys.right]) dx += 1;
            if (dx !== 0 && dy !== 0) {
                const len = Math.hypot(dx, dy);
                dx /= len;
                dy /= len;
            }
            this.x += dx * this.speed * dt;
            this.y += dy * this.speed * dt;
            this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
            this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));
        }

        this.mp = Math.min(this.maxMp, this.mp + this.mpRegen * dt);
        for (let i = 0; i < 5; i++) {
            if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;
        }
        this.updateSkillUI();

        const input = getInputState(this.config.id);
        for (let i = 0; i < 5; i++) {
            const skillKey = this.config.keys[`skill${i + 1}`];
            if (skillKey && input[skillKey] && this.cooldowns[i] <= 0 && this.classData.skills[i]) {
                const cost = this.classData.skills[i].cost;
                if (this.mp >= cost) {
                    this.mp -= cost;
                    this.castSkill(i, enemy);
                }
            }
        }
    }

    castSkill(slot, enemy) {
        const skill = this.classData.skills[slot];
        this.cooldowns[slot] = skill.cd;

        let dirX = enemy.x - this.x;
        let dirY = enemy.y - this.y;
        const dist = Math.hypot(dirX, dirY);
        if (dist > 0) {
            dirX /= dist;
            dirY /= dist;
        }

        if (['fireball', 'frostray', 'waterjet', 'stonevolley', 'windblade'].includes(skill.id)) {
            soundManager.shoot();
        } else if (['fireblast', 'meteor', 'waterprison', 'blizzard', 'earthquake', 'hurricane', 'frostarmor', 'earthshield'].includes(skill.id)) {
            soundManager.cast();
        } else if (['flamedash', 'tailwind', 'earthspike'].includes(skill.id)) {
            soundManager.dash();
        } else if (['firewall', 'windwall', 'mudswamp', 'whirlwind'].includes(skill.id)) {
            soundManager.wall();
        } else {
            soundManager.shoot();
        }

        switch (skill.id) {
            case 'fireball':
                entities.push(new Projectile(this, this.x, this.y, dirX, dirY, 500, 15, '#e74c3c', 'fireball', target => {
                    target.takeDamage(20, this.className);
                    target.addStatus('burn', 3);
                }));
                break;
            case 'fireblast':
                entities.push(new AoE(this, this.x, this.y, 100, 0.5, '#e67e22', 'fireblast', target => {
                    target.takeDamage(40, this.className);
                    const kx = target.x - this.x;
                    const ky = target.y - this.y;
                    const kLen = Math.hypot(kx, ky);
                    if (kLen > 0) {
                        target.x += (kx / kLen) * 50;
                        target.y += (ky / kLen) * 50;
                    }
                }));
                break;
            case 'flamedash': {
                const dashDist = 150;
                const dashSteps = 5;
                for (let i = 1; i <= dashSteps; i++) {
                    const px = this.x + dirX * (dashDist / dashSteps) * i;
                    const py = this.y + dirY * (dashDist / dashSteps) * i;
                    entities.push(new AoE(this, px, py, 30, 0.2, '#e74c3c', 'flamedash', target => {
                        target.takeDamage(15, this.className);
                        target.addStatus('burn', 2);
                    }));
                }
                this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x + dirX * dashDist));
                this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y + dirY * dashDist));
                createExplosion(this.x, this.y, '#f39c12', 20, 80, 0.4, 4);
                break;
            }
            case 'firewall': {
                const wallX = this.x + dirX * 50;
                const wallY = this.y + dirY * 50;
                entities.push(new Wall(this, wallX, wallY, dirX, dirY, 100, 4, '#e67e22', true));
                break;
            }
            case 'meteor':
                entities.push(new AoE(this, enemy.x, enemy.y, 120, 1.5, '#c0392b', 'meteor', target => {
                    target.takeDamage(60, this.className);
                    target.addStatus('burn', 5);
                }));
                break;
            case 'frostray':
                entities.push(new Projectile(this, this.x, this.y, dirX, dirY, 1000, 10, '#00a8ff', 'frostray', target => {
                    target.takeDamage(15, this.className);
                    target.addStatus('slow', 2);
                }));
                break;
            case 'waterprison':
                entities.push(new AoE(this, enemy.x, enemy.y, 40, 0.5, '#3498db', 'waterprison', target => {
                    target.takeDamage(10, this.className);
                    target.addStatus('root', 1.5);
                }));
                break;
            case 'waterjet':
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        entities.push(new Projectile(this, this.x, this.y, dirX, dirY, 600, 12, '#2980b9', 'waterjet', target => {
                            target.takeDamage(10, this.className);
                            target.x += dirX * 10;
                            target.y += dirY * 10;
                        }));
                    }, i * 200);
                }
                break;
            case 'frostarmor':
                this.addStatus('shield', 6);
                this.shieldAmount = 30;
                this.addStatus('frostarmor', 6);
                createExplosion(this.x, this.y, '#3498db', 20, 50, 0.5, 4);
                break;
            case 'blizzard':
                entities.push(new AoE(this, enemy.x, enemy.y, 150, 2.0, '#bdc3c7', 'blizzard', target => {
                    target.takeDamage(45, this.className);
                    target.addStatus('slow', 4);
                }));
                break;
            case 'stonevolley':
                for (let i = -1; i <= 1; i++) {
                    const angle = Math.atan2(dirY, dirX) + i * 0.2;
                    entities.push(new Projectile(this, this.x, this.y, Math.cos(angle), Math.sin(angle), 400, 8, '#7f8c8d', 'stone', target => {
                        target.takeDamage(10, this.className);
                        target.addStatus('slow', 0.2);
                    }));
                }
                break;
            case 'earthshield':
                this.shieldAmount = 50;
                this.addStatus('shield', 5);
                createExplosion(this.x, this.y, '#f1c40f', 15, 50, 0.5, 4);
                createExplosion(this.x, this.y, '#95a5a6', 10, 80, 0.6, 5);
                break;
            case 'earthspike':
                for (let i = 1; i <= 4; i++) {
                    setTimeout(() => {
                        const px = this.x + dirX * 60 * i;
                        const py = this.y + dirY * 60 * i;
                        entities.push(new AoE(this, px, py, 25, 0.3, '#f39c12', 'earthspike', target => {
                            target.takeDamage(15, this.className);
                            target.addStatus('knockup', 0.5);
                        }));
                    }, i * 150);
                }
                break;
            case 'mudswamp':
                entities.push(new AoE(this, enemy.x, enemy.y, 80, 0.5, '#7f8c8d', 'mudswamp', target => {
                    target.takeDamage(10, this.className);
                    target.addStatus('slow', 5);
                    target.mp = Math.max(0, target.mp - 20);
                }));
                break;
            case 'earthquake':
                entities.push(new AoE(this, this.x, this.y, 250, 1.5, '#8e44ad', 'earthquake', target => {
                    target.takeDamage(45, this.className);
                    target.addStatus('root', 2);
                }));
                break;
            case 'windblade':
                entities.push(new Projectile(this, this.x, this.y, dirX, dirY, 800, 10, '#1abc9c', 'windblade', target => {
                    target.takeDamage(8, this.className);
                }));
                break;
            case 'whirlwind':
                entities.push(new Projectile(this, this.x, this.y, dirX, dirY, 150, 40, '#16a085', 'whirlwind', target => {
                    target.takeDamage(25, this.className);
                    target.x += dirX * 30;
                    target.y += dirY * 30;
                }, true));
                break;
            case 'windwall': {
                const wallX = this.x + dirX * 50;
                const wallY = this.y + dirY * 50;
                entities.push(new Wall(this, wallX, wallY, dirX, dirY, 80, 4, '#1abc9c', false));
                break;
            }
            case 'hurricane':
                entities.push(new AoE(this, enemy.x, enemy.y, 60, 1.0, '#1abc9c', 'hurricane', target => {
                    target.takeDamage(45, this.className);
                    target.addStatus('knockup', 1.5);
                }));
                break;
            case 'tailwind':
                this.addStatus('haste', 5);
                createExplosion(this.x, this.y, '#1abc9c', 20, 100, 0.5, 3);
                break;
        }
    }

    draw(ctx) {
        drawPlayerShape(ctx, this);
    }

    initUI() {
        const containerId = this.config.id === 'A' ? 'p1-skills' : 'p2-skills';
        const skillsContainer = document.getElementById(containerId);
        skillsContainer.innerHTML = '';
        this.classData.skills.forEach((skill, index) => {
            skillsContainer.innerHTML += `
                <div class="skill-icon" id="p${this.config.id}-skill${index}" style="border-color: ${this.classData.color}">
                    <span>${skill.name}</span>
                    <div class="cooldown-overlay" id="p${this.config.id}-cd${index}"></div>
                </div>
            `;
        });
        this.updateUI();
    }

    updateUI() {
        const hpBar = document.getElementById(this.config.id === 'A' ? 'p1-hp' : 'p2-hp');
        const mpBar = document.getElementById(this.config.id === 'A' ? 'p1-mp' : 'p2-mp');
        hpBar.style.width = `${(this.hp / this.maxHp) * 100}%`;
        mpBar.style.width = `${(this.mp / this.maxMp) * 100}%`;
    }

    updateSkillUI() {
        for (let i = 0; i < 5; i++) {
            if (!this.classData.skills[i]) continue;
            const cdOverlay = document.getElementById(`p${this.config.id}-cd${i}`);
            const skillIcon = document.getElementById(`p${this.config.id}-skill${i}`);
            if (cdOverlay) {
                const maxCd = this.classData.skills[i].cd;
                const currentCd = Math.max(0, this.cooldowns[i]);
                const pct = currentCd > 0 ? (currentCd / maxCd) * 100 : 0;
                cdOverlay.style.height = `${pct}%`;
            }
            if (skillIcon) {
                skillIcon.style.opacity = this.mp < this.classData.skills[i].cost ? '0.5' : '1';
            }
        }
        this.updateUI();
    }
}

class Particle {
    constructor(x, y, vx, vy, life, color, size, fade = true) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.life = life;
        this.maxLife = life;
        this.color = color;
        this.size = size;
        this.fade = fade;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        if (this.fade) {
            ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        }
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function createExplosion(x, y, color, count, speed, life, size) {
    soundManager.explosion();
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const s = speed * (0.5 + Math.random() * 0.5);
        particles.push(new Particle(
            x,
            y,
            Math.cos(angle) * s,
            Math.sin(angle) * s,
            life * (0.5 + Math.random() * 0.5),
            color,
            size * (0.5 + Math.random() * 0.5)
        ));
    }
}

class Projectile {
    constructor(owner, x, y, dirX, dirY, speed, radius, color, type, onHit, pierce = false) {
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.dirX = dirX;
        this.dirY = dirY;
        this.speed = speed;
        this.radius = radius;
        this.color = color;
        this.type = type;
        this.onHit = onHit;
        this.active = true;
        this.pierce = pierce;
        this.hitTargets = new Set();
    }

    update(dt) {
        if (!this.active) return;
        this.x += this.dirX * this.speed * dt;
        this.y += this.dirY * this.speed * dt;

        for (const entity of entities) {
            if (entity instanceof Wall && entity.owner !== this.owner) {
                const dist = Math.hypot(this.x - entity.x, this.y - entity.y);
                if (dist < entity.length / 2 + this.radius) {
                    this.active = false;
                    createExplosion(this.x, this.y, this.color, 5, 50, 0.3, 3);
                    return;
                }
            }
        }

        if (Math.random() < 0.5) {
            if (this.type === 'fireball') {
                particles.push(new Particle(this.x, this.y, -this.dirX * 50, -this.dirY * 50, 0.4, '#f39c12', this.radius * 0.4));
            } else if (this.type === 'frostray' || this.type === 'waterjet') {
                particles.push(new Particle(this.x, this.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.3, '#ecf0f1', this.radius * 0.25));
            } else if (this.type === 'stone') {
                particles.push(new Particle(this.x, this.y, -this.dirX * 20, -this.dirY * 20, 0.25, '#95a5a6', this.radius * 0.3));
            } else if (this.type === 'windblade' || this.type === 'whirlwind') {
                particles.push(new Particle(this.x, this.y, -this.dirY * 20, this.dirX * 20, 0.25, '#ecf0f1', this.radius * 0.18));
            }
        }

        if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
            this.active = false;
            return;
        }

        const enemy = this.owner === p1 ? p2 : p1;
        const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
        if (dist < this.radius + enemy.radius && !this.hitTargets.has(enemy.config.id)) {
            this.onHit(enemy);
            if (this.pierce) {
                this.hitTargets.add(enemy.config.id);
            } else {
                this.active = false;
            }

            if (this.type === 'fireball') {
                createExplosion(this.x, this.y, '#e74c3c', 15, 100, 0.5, 5);
            } else if (this.type === 'frostray' || this.type === 'waterjet') {
                createExplosion(this.x, this.y, '#3498db', 10, 80, 0.4, 4);
            } else if (this.type === 'stone') {
                createExplosion(this.x, this.y, '#7f8c8d', 8, 60, 0.3, 6);
            } else if (this.type === 'windblade') {
                createExplosion(this.x, this.y, '#1abc9c', 8, 120, 0.3, 3);
            } else if (this.type === 'whirlwind') {
                createExplosion(this.x, this.y, '#16a085', 12, 80, 0.4, 4);
            }
        }
    }

    draw(ctx) {
        drawProjectileShape(ctx, this);
    }
}

class Wall {
    constructor(owner, x, y, dirX, dirY, length, duration, color, damaging = false) {
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.dx = -dirY;
        this.dy = dirX;
        this.length = length;
        this.duration = duration;
        this.color = color;
        this.active = true;
        this.damaging = damaging;
        this.damageTickTimer = 0;
        this.burnTickTimer = 0;
    }

    update(dt) {
        if (!this.active) return;
        this.duration -= dt;
        if (this.duration <= 0) {
            this.active = false;
            return;
        }

        if (Math.random() < 0.25) {
            const offset = (Math.random() - 0.5) * this.length;
            particles.push(new Particle(
                this.x + this.dx * offset,
                this.y + this.dy * offset,
                this.dy * 20,
                -this.dx * 20,
                0.5,
                this.damaging ? '#f39c12' : '#ecf0f1',
                2
            ));
        }

        if (this.damaging) {
            const enemy = this.owner === p1 ? p2 : p1;
            const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
            if (dist < this.length / 2 + enemy.radius) {
                this.damageTickTimer += dt;
                this.burnTickTimer += dt;

                // 火墙改为固定频率结算，避免按帧伤害过高。
                if (this.damageTickTimer >= 0.25) {
                    enemy.takeDamage(4, this.owner.className);
                    this.damageTickTimer = 0;
                }

                if (this.burnTickTimer >= 0.75) {
                    enemy.addStatus('burn', 1.5);
                    this.burnTickTimer = 0;
                }
            } else {
                this.damageTickTimer = 0;
                this.burnTickTimer = 0;
            }
        }
    }

    draw(ctx) {
        drawWallShape(ctx, this);
    }
}

class AoE {
    constructor(owner, x, y, radius, delay, color, type, onHit) {
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.delay = delay;
        this.timer = 0;
        this.color = color;
        this.type = type;
        this.onHit = onHit;
        this.active = true;
    }

    update(dt) {
        if (!this.active) return;
        this.timer += dt;

        if (this.type === 'fireblast' && Math.random() < 0.2) {
            particles.push(new Particle(this.x + (Math.random() - 0.5) * this.radius, this.y + (Math.random() - 0.5) * this.radius, 0, -20, 0.5, '#e67e22', 2));
        } else if (this.type === 'waterprison' && Math.random() < 0.2) {
            particles.push(new Particle(this.x + (Math.random() - 0.5) * this.radius, this.y + (Math.random() - 0.5) * this.radius, 0, -30, 0.6, '#ecf0f1', 3));
        } else if (this.type === 'hurricane') {
            particles.push(new Particle(this.x + (Math.random() - 0.5) * this.radius, this.y + (Math.random() - 0.5) * this.radius, (Math.random() - 0.5) * 40, -40, 0.4, '#1abc9c', 2));
        }

        if (this.timer >= this.delay) {
            const enemy = this.owner === p1 ? p2 : p1;
            const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
            if (dist < this.radius + enemy.radius) {
                this.onHit(enemy);
            }
            this.active = false;
            triggerAoEExplosion(this);
        }
    }

    draw(ctx) {
        drawAoEShape(ctx, this);
    }
}

function triggerAoEExplosion(aoe) {
    if (aoe.type === 'fireblast') {
        createExplosion(aoe.x, aoe.y, '#e74c3c', 30, 150, 0.8, 8);
        createExplosion(aoe.x, aoe.y, '#f1c40f', 20, 100, 0.6, 5);
    } else if (aoe.type === 'waterprison') {
        createExplosion(aoe.x, aoe.y, '#3498db', 20, 80, 0.5, 4);
    } else if (aoe.type === 'hurricane') {
        createExplosion(aoe.x, aoe.y, '#1abc9c', 40, 200, 0.8, 6);
        createExplosion(aoe.x, aoe.y, '#ecf0f1', 20, 150, 0.6, 4);
    } else if (aoe.type === 'meteor') {
        createExplosion(aoe.x, aoe.y, '#c0392b', 50, 250, 1.0, 10);
        createExplosion(aoe.x, aoe.y, '#e67e22', 30, 150, 0.8, 6);
    } else if (aoe.type === 'blizzard') {
        createExplosion(aoe.x, aoe.y, '#ecf0f1', 40, 120, 0.6, 5);
    } else if (aoe.type === 'earthspike') {
        createExplosion(aoe.x, aoe.y, '#f39c12', 10, 80, 0.4, 4);
    } else if (aoe.type === 'mudswamp') {
        createExplosion(aoe.x, aoe.y, '#7f8c8d', 20, 60, 0.8, 6);
    } else if (aoe.type === 'earthquake') {
        createExplosion(aoe.x, aoe.y, '#8e44ad', 40, 300, 1.0, 8);
        createExplosion(aoe.x, aoe.y, '#9b59b6', 20, 200, 0.8, 5);
    }
}

function drawPlayerShape(ctx, player) {
    const hasBurn = player.hasStatus ? player.hasStatus('burn') : player.statuses.some(s => s.type === 'burn');
    const hasSlow = player.hasStatus ? player.hasStatus('slow') : player.statuses.some(s => s.type === 'slow');
    const hasHaste = player.hasStatus ? player.hasStatus('haste') : player.statuses.some(s => s.type === 'haste');
    const hasControl = player.hasStatus
        ? player.hasStatus('root') || player.hasStatus('knockup')
        : player.statuses.some(s => s.type === 'root' || s.type === 'knockup');

    if (player.shieldAmount > 0) {
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 15, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(241, 196, 15, 0.4)';
        ctx.lineWidth = 4;
        ctx.stroke();
        const time = performance.now() / 1000;
        ctx.rotate(time * 2);
        for (let i = 0; i < 3; i++) {
            ctx.save();
            ctx.rotate((Math.PI * 2 / 3) * i);
            ctx.translate(player.radius + 15, 0);
            ctx.fillStyle = '#95a5a6';
            ctx.beginPath();
            ctx.moveTo(5, 0);
            ctx.lineTo(2, 6);
            ctx.lineTo(-5, 3);
            ctx.lineTo(-4, -4);
            ctx.lineTo(2, -5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    let drawY = player.y;
    const knockupStatus = player.statuses.find(s => s.type === 'knockup');
    if (knockupStatus) {
        const t = knockupStatus.maxDuration - knockupStatus.duration;
        const total = knockupStatus.maxDuration || 1;
        const offsetY = 4 * 50 * (t / total) * (1 - t / total);
        drawY -= offsetY;
    }

    ctx.fillStyle = player.config.color;
    ctx.beginPath();
    ctx.arc(player.x, drawY, player.radius, 0, Math.PI * 2);
    ctx.fill();

    if (hasBurn) {
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(player.x - 5, drawY - player.radius - 10, 10, 10);
    }
    if (hasSlow) {
        ctx.fillStyle = '#3498db';
        ctx.fillRect(player.x - 15, drawY - player.radius - 10, 10, 10);
    }
    if (hasHaste) {
        ctx.fillStyle = '#1abc9c';
        ctx.fillRect(player.x + 5, drawY - player.radius - 10, 10, 10);
    }
    if (hasControl) {
        ctx.strokeStyle = '#9b59b6';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(player.x, drawY, player.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.className, player.x, drawY + 5);
}

function drawProjectileShape(ctx, projectile) {
    if (!projectile.active) return;
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    if (projectile.type === 'fireball') {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.arc(0, 0, projectile.radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = projectile.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
        ctx.fill();
    } else if (projectile.type === 'stone') {
        ctx.fillStyle = projectile.color;
        ctx.rotate(Math.atan2(projectile.dirY, projectile.dirX));
        ctx.beginPath();
        ctx.moveTo(projectile.radius, 0);
        ctx.lineTo(projectile.radius * 0.5, projectile.radius * 0.8);
        ctx.lineTo(-projectile.radius, projectile.radius * 0.5);
        ctx.lineTo(-projectile.radius * 0.8, -projectile.radius * 0.8);
        ctx.lineTo(projectile.radius * 0.3, -projectile.radius);
        ctx.closePath();
        ctx.fill();
    } else if (projectile.type === 'windblade') {
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, projectile.radius, projectile.radius * 0.3, Math.atan2(projectile.dirY, projectile.dirX), 0, Math.PI * 2);
        ctx.fill();
    } else if (projectile.type === 'whirlwind') {
        ctx.strokeStyle = projectile.color;
        ctx.lineWidth = 2;
        ctx.rotate(performance.now() / 100);
        ctx.beginPath();
        ctx.arc(0, 0, projectile.radius, 0, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, projectile.radius * 0.6, Math.PI, Math.PI * 2);
        ctx.stroke();
    } else if (projectile.type === 'frostray' || projectile.type === 'waterjet') {
        ctx.strokeStyle = projectile.type === 'frostray' ? '#ecf0f1' : '#85c1e9';
        ctx.lineCap = 'round';
        ctx.lineWidth = projectile.radius * 0.8;
        ctx.beginPath();
        ctx.moveTo(-projectile.dirX * projectile.radius * 1.5, -projectile.dirY * projectile.radius * 1.5);
        ctx.lineTo(projectile.dirX * projectile.radius * 1.5, projectile.dirY * projectile.radius * 1.5);
        ctx.stroke();
    } else {
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawWallShape(ctx, wall) {
    if (!wall.active) return;
    ctx.save();
    ctx.strokeStyle = wall.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 100) * 0.2;
    ctx.beginPath();
    ctx.moveTo(wall.x - wall.dx * wall.length / 2, wall.y - wall.dy * wall.length / 2);
    ctx.lineTo(wall.x + wall.dx * wall.length / 2, wall.y + wall.dy * wall.length / 2);
    ctx.stroke();
    ctx.restore();
}

function drawAoEShape(ctx, aoe) {
    if (!aoe.active) return;
    ctx.save();
    if (['fireblast', 'meteor', 'blizzard', 'earthquake', 'hurricane'].includes(aoe.type)) {
        ctx.strokeStyle = aoe.color;
        ctx.lineWidth = aoe.type === 'earthquake' ? 5 : 2;
        ctx.beginPath();
        const radius = aoe.type === 'earthquake' ? aoe.radius * (aoe.timer / aoe.delay) : aoe.radius;
        ctx.arc(aoe.x, aoe.y, radius, 0, Math.PI * 2);
        ctx.stroke();
    } else if (aoe.type === 'waterprison') {
        ctx.fillStyle = aoe.color;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        const currentRadius = aoe.radius * (aoe.timer / aoe.delay);
        ctx.ellipse(aoe.x, aoe.y + aoe.radius - currentRadius, currentRadius, currentRadius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.strokeStyle = aoe.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(aoe.x, aoe.y, aoe.radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = aoe.color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(aoe.x, aoe.y, aoe.radius * Math.min(1, aoe.timer / aoe.delay), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function serializePlayer(player) {
    return {
        className: player.className,
        x: player.x,
        y: player.y,
        hp: player.hp,
        maxHp: player.maxHp,
        mp: player.mp,
        maxMp: player.maxMp,
        shieldAmount: player.shieldAmount,
        cooldowns: { ...player.cooldowns },
        statuses: player.statuses.map(status => ({ ...status }))
    };
}

function serializeEntity(entity) {
    if (entity instanceof Projectile) {
        return {
            kind: 'projectile',
            ownerId: entity.owner.config.id,
            x: entity.x,
            y: entity.y,
            dirX: entity.dirX,
            dirY: entity.dirY,
            speed: entity.speed,
            radius: entity.radius,
            color: entity.color,
            type: entity.type,
            active: entity.active,
            pierce: entity.pierce,
            damaging: false
        };
    }
    if (entity instanceof Wall) {
        return {
            kind: 'wall',
            ownerId: entity.owner.config.id,
            x: entity.x,
            y: entity.y,
            dx: entity.dx,
            dy: entity.dy,
            length: entity.length,
            duration: entity.duration,
            color: entity.color,
            active: entity.active,
            damaging: entity.damaging
        };
    }
    if (entity instanceof AoE) {
        return {
            kind: 'aoe',
            ownerId: entity.owner.config.id,
            x: entity.x,
            y: entity.y,
            radius: entity.radius,
            delay: entity.delay,
            timer: entity.timer,
            color: entity.color,
            type: entity.type,
            active: entity.active
        };
    }
    return null;
}

function serializeParticle(particle) {
    return {
        x: particle.x,
        y: particle.y,
        vx: particle.vx,
        vy: particle.vy,
        life: particle.life,
        maxLife: particle.maxLife,
        color: particle.color,
        size: particle.size,
        fade: particle.fade
    };
}

function buildSnapshot() {
    return {
        players: {
            A: serializePlayer(p1),
            B: serializePlayer(p2)
        },
        entities: entities.map(serializeEntity).filter(Boolean),
        particles: particles.slice(-100).map(serializeParticle)
    };
}

function applyPlayerSnapshot(target, data) {
    target.x = data.x;
    target.y = data.y;
    target.hp = data.hp;
    target.maxHp = data.maxHp;
    target.mp = data.mp;
    target.maxMp = data.maxMp;
    target.shieldAmount = data.shieldAmount;
    target.cooldowns = { ...data.cooldowns };
    target.statuses = data.statuses.map(status => ({ ...status }));
    target.updateSkillUI();
}

function deserializeEntity(data) {
    const owner = data.ownerId === 'A' ? p1 : p2;
    if (data.kind === 'projectile') {
        const projectile = new Projectile(owner, data.x, data.y, data.dirX, data.dirY, data.speed, data.radius, data.color, data.type, () => {}, data.pierce);
        projectile.active = data.active;
        return projectile;
    }
    if (data.kind === 'wall') {
        const wall = new Wall(owner, data.x, data.y, 0, 1, data.length, data.duration, data.color, data.damaging);
        wall.dx = data.dx;
        wall.dy = data.dy;
        wall.active = data.active;
        return wall;
    }
    if (data.kind === 'aoe') {
        const aoe = new AoE(owner, data.x, data.y, data.radius, data.delay, data.color, data.type, () => {});
        aoe.timer = data.timer;
        aoe.active = data.active;
        return aoe;
    }
    return null;
}

function applySnapshot(state) {
    if (!state || !state.players) return;
    if (!p1 || !p2) {
        p1 = new Player(configA, state.players.A.className);
        p2 = new Player(configB, state.players.B.className);
        p1.initUI();
        p2.initUI();
    }

    applyPlayerSnapshot(p1, state.players.A);
    applyPlayerSnapshot(p2, state.players.B);
    entities = state.entities.map(deserializeEntity).filter(Boolean);
    particles = state.particles.map(data => {
        const particle = new Particle(data.x, data.y, data.vx, data.vy, data.maxLife, data.color, data.size, data.fade);
        particle.life = data.life;
        particle.maxLife = data.maxLife;
        return particle;
    });
}

function maybeSendSnapshot() {
    if (networkMode !== NetworkMode.ONLINE || networkRole !== NetworkRole.HOST || !isGuestConnected()) return;
    const now = performance.now();
    if (now - lastSnapshotSent < 50) return;
    lastSnapshotSent = now;
    broadcast({ type: 'snapshot', state: buildSnapshot() });
}

function startGame() {
    document.getElementById('selection-screen').classList.add('hidden');
    document.getElementById('end-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    currentState = GameState.BATTLE;
    soundManager.start();

    entities = [];
    particles = [];
    remoteKeys = {};

    p1 = new Player(configA, playerAClass);
    p2 = new Player(configB, playerBClass);
    p1.initUI();
    p2.initUI();

    lastTime = performance.now();
    if (!animationStarted) {
        animationStarted = true;
        requestAnimationFrame(gameLoop);
    }
}

function gameLoop(time) {
    if (currentState !== GameState.BATTLE) {
        animationStarted = false;
        return;
    }

    const dt = Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;

    if (shouldSimulateLocally()) {
        update(dt);
        maybeSendSnapshot();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    p1.update(dt, p2);
    p2.update(dt, p1);
    entities.forEach(entity => entity.update(dt));
    entities = entities.filter(entity => entity.active);
    particles.forEach(particle => particle.update(dt));
    particles = particles.filter(particle => particle.life > 0);

    if (p1.hp <= 0 || p2.hp <= 0) {
        let winner = '';
        if (p1.hp <= 0 && p2.hp <= 0) winner = '平局';
        else if (p1.hp <= 0) winner = '玩家 B';
        else winner = '玩家 A';
        endGame(winner, true);
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    if (!p1 || !p2) return;
    p1.draw(ctx);
    p2.draw(ctx);
    entities.forEach(entity => entity.draw(ctx));
    particles.forEach(particle => particle.draw(ctx));
}

function endGame(winner, notifyPeer) {
    currentState = GameState.END;
    soundManager.win();
    if (notifyPeer && networkMode === NetworkMode.ONLINE && networkRole === NetworkRole.HOST) {
        broadcast({ type: 'end', winner });
    }

    document.getElementById('game-screen').classList.add('hidden');
    const endScreen = document.getElementById('end-screen');
    endScreen.classList.remove('hidden');

    const winnerText = document.getElementById('winner-text');
    if (winner === '平局') {
        winnerText.innerText = '平局！';
        winnerText.style.color = '#ecf0f1';
    } else {
        winnerText.innerText = `${winner} 获胜！`;
        winnerText.style.color = winner === '玩家 A' ? configA.color : configB.color;
    }
}

switchToLocalMode();
