// --- 基本設定與畫布 ---
const canvas        = document.querySelector('canvas');// 取得畫布元素，作為主要渲染區域
const viewport      = document.querySelector('#viewport');// 取得畫面容器，用於計算視窗大小與相機位置
const buffer        = canvas.getContext('2d', { alpha: true });// 建立 2D 繪圖上下文，並啟用透明背景
const parallaxFar   = document.getElementById('parallaxFar');// 遠景背景元素，用於視差滾動效果
const parallaxMid   = document.getElementById('parallaxMid');// 中景背景元素，用於視差滾動效果

let game_switch    = true; // 遊戲開關，控制遊戲是否運行
let debug_switch = false; // 除錯開關
let boardVisible   = false; // 任務面板顯示開關
let camera = { x: 0, y: 0 }; // 相機位置，用於控制畫面偏移與角色居中

const RENDER_SCALE = 4.5;  // 渲染縮放比例，用於調整畫布渲染大小
const ENTITY_SCALE = 0.5;  // 實體縮放比例，用於調整實體渲染大小



// 載入地圖
if (!window.TileMaps || !TileMaps["map"]) {
    throw new Error("map.js 尚未載入或 TileMaps 物件不存在。");
}
const mapData   = TileMaps["map"];
const TILE_SIZE = mapData.tileheight;

// 解析圖層與碰撞盒
const tileLayers = mapData.layers
    .filter(l => l.type === "tilelayer" && l.visible)
    .map(l => ({
    name:   l.name,
    widthPx:  mapData.width  * TILE_SIZE,
    heightPx: mapData.height * TILE_SIZE,
    data:     l.data
    }));
// 讀取碰撞層並轉換為物件陣列
const collisionBoxes = (mapData.layers
    .find(l => l.type === "objectgroup" && l.name === "collision")
    ?.objects || []
).map(o => ({
    x: o.x, y: o.y, width: o.width, height: o.height
}));

// 讀取互動物件層並標上 id
const interactiveLayer = mapData.layers
    .find(l => l.type === "objectgroup" && l.name === "interactive");

const interactiveZones = (interactiveLayer?.objects || []).map(o => ({
    id:      o.id,
    x:       o.x,
    y:       o.y,            
    width:   o.width,
    height:  o.height
}));

// 互動區域偵測
function checkInteractions(scale = 1){
    for(let zone of interactiveZones){
        const sw=user.width*scale, sh=user.height*scale;
        const overlap=
            user.x+sw>zone.x&&user.x<zone.x+zone.width&&
            user.y+sh>zone.y&&user.y<zone.y+zone.height;
        if(!overlap) continue;
        if(debug_switch){
            buffer.save();
            buffer.strokeStyle='green'; buffer.lineWidth=2;
            buffer.strokeRect(
            zone.x*RENDER_SCALE-camera.x,
            zone.y*RENDER_SCALE-camera.y,
            zone.width*RENDER_SCALE,
            zone.height*RENDER_SCALE
            );
            buffer.fillStyle='green'; buffer.font='16px sans-serif';
            buffer.fillText(
            zone.id,
            zone.x*RENDER_SCALE-camera.x+4,
            zone.y*RENDER_SCALE-camera.y+16
            );
            buffer.restore();
        }
        if(jPressed && interactionHandlers[zone.id]){
            interactionHandlers[zone.id]();
            jPressed=false;
        }
    }
}

// --- 支援 Tiled 動畫圖塊 ---
const animatedTiles = {};
for (let ts of mapData.tilesets) {
    if (!ts.tiles) continue;
    const baseGid = ts.firstgid;
    for (let tile of ts.tiles) {
        if (tile.animation) {
            const gid = tile.id + baseGid;
            animatedTiles[gid] = {
            frames:    tile.animation.map(f => f.tileid + baseGid),
            durations: tile.animation.map(f => f.duration),
            index:     0,
            timer:     0
            };
        }
    }
}
// 更新動畫圖塊
function updateTileAnimations(dt) {
    for (let at of Object.values(animatedTiles)) {
        at.timer += dt;
        while (at.timer >= at.durations[at.index]) {
            at.timer -= at.durations[at.index];
            at.index = (at.index + 1) % at.frames.length;
        }
    }
}

// --- 圖塊與碰撞繪製 ---
const tileImage = new Image();
tileImage.src   = "images/SpriteSheet.png";
// 繪製單層圖塊
function drawTileLayer(layer) {
    const tilesPerRow = tileImage.width / TILE_SIZE | 0;
    let i = 0;
    for (let ty = 0; ty < mapData.height; ty++) {
        for (let tx = 0; tx < mapData.width; tx++) {
            let gid = layer.data[i++];
            if (!gid) continue;
            if (animatedTiles[gid]) {
                gid = animatedTiles[gid].frames[animatedTiles[gid].index];
            }
            const t  = gid - 1;
            const sx = (t % tilesPerRow) * TILE_SIZE;
            const sy = Math.floor(t / tilesPerRow) * TILE_SIZE;
            buffer.drawImage(
            tileImage,
            sx, sy, TILE_SIZE, TILE_SIZE,
            tx*TILE_SIZE*RENDER_SCALE,
            ty*TILE_SIZE*RENDER_SCALE,
            TILE_SIZE*RENDER_SCALE,
            TILE_SIZE*RENDER_SCALE
            );
        }
    }
}
// 繪製碰撞盒
function drawCollisionBoxes(boxes, scale=1, fillColor='rgba(0,0,255,0.3)', borderColor='blue') {
    buffer.save();
    buffer.fillStyle   = fillColor;
    buffer.strokeStyle = borderColor;
    for (let b of boxes) {
        buffer.fillRect(
            b.x*scale*RENDER_SCALE, b.y*scale*RENDER_SCALE,
            b.width*scale*RENDER_SCALE, b.height*scale*RENDER_SCALE
        );
        buffer.strokeRect(
            b.x*scale*RENDER_SCALE, b.y*scale*RENDER_SCALE,
            b.width*scale*RENDER_SCALE, b.height*scale*RENDER_SCALE
        );
    }
    buffer.restore();
}

// 儲存各互動觸發區域回呼
const interactionHandlers = {};

// 註冊函式：triggerInteraction(區域編號, 回呼函式)
function triggerInteraction(zoneId, callback) {
    interactionHandlers[zoneId] = callback;
}

//互動觸發區域自訂功能
triggerInteraction(12, () => {
    if (editor.style.display === "flex") return;
    boardVisible = !boardVisible;
    const overlay = document.getElementById("taskOverlays");
    if (boardVisible) drawBoard();
    else {
        overlay.innerHTML = "";
        main_loop(lastTime);
    }
});

triggerInteraction(23, () => {
    if (user.onGround) user.gravity = -12;
});

triggerInteraction(13, () => {
    const overlay = document.getElementById("taskOverlays");
    if (overlay.querySelector("iframe")) return;// 若已存在 iframe，則不重複建立
    overlay.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "50%";
    wrapper.style.top = "50%";
    wrapper.style.transform = "translate(-50%, -50%)";
    wrapper.style.width = "90vw";
    wrapper.style.height = "90vh";
    wrapper.style.border = "2px solid #000";
    wrapper.style.zIndex = 30;
    wrapper.style.background = "#fff";
    wrapper.style.pointerEvents = "auto";

    const iframe = document.createElement("iframe");
    iframe.src = "web/BasicInformationTable.html";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";

    const closeBtn = document.createElement("button");
    closeBtn.innerText = "❌";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "10px";
    closeBtn.style.right = "10px";
    closeBtn.style.zIndex = 31;
    closeBtn.style.padding = "4px 10px";
    closeBtn.style.fontSize = "20px";
    closeBtn.onclick = () => {
    overlay.innerHTML = "";
    };

    wrapper.appendChild(iframe);
    wrapper.appendChild(closeBtn);
    overlay.appendChild(wrapper);
});



//動畫類別
class Animation {
    constructor() {
        this.states   = {};
        this.current  = "idle";
        this.frameSet = [];
        this.frameIndex = 0;
        this.count    = 0;
        this.delay    = 10;
        this.width    = 32;
        this.height   = 32;
        this.frame    = 0;
    }
    defineState(name, frameSet, delay=10, w=32, h=32) {
        this.states[name] = { frameSet, delay, width: w, height: h };
    }
    setState(name) {
        if (this.current !== name && this.states[name]) {
            const s = this.states[name];
            this.frameSet   = s.frameSet;
            this.delay      = s.delay;
            this.width      = s.width;
            this.height     = s.height;
            this.current    = name;
            this.frameIndex = 0;
            this.count      = 0;
            this.frame      = s.frameSet[0];
        }
    }
    update() {
        if (!this.frameSet.length) return;
        this.count++;
        if (this.count >= this.delay) {
            this.count = 0;
            this.frameIndex = (this.frameIndex + 1) % this.frameSet.length;
            this.frame = this.frameSet[this.frameIndex];
        }
    }
}
// 實體類別
class Entity {
    constructor(x=0, y=0, w=32, h=32, color='red', velocity=1) {
        Object.assign(this, { x, y, width: w, height: h, color, velocity, gravity: 0, flip: false });
        this.image     = new Image();
        this.animation = new Animation();
        this.onGround  = false;
        this.name      = "";
    }
    save() {
        return { name:this.name, x:this.x, y:this.y, flip:this.flip, state:this.animation.current };
    }
    load(data) {
        if (!data) return;
        this.x    = data.x;
        this.y    = data.y;
        this.flip = data.flip;
        this.animation.setState(data.state);
    }
    drawSprite(scale = 1, tintColor = { r: 235, g: 9, b: 9 }, tintAlpha = 0, blendMode = 'soft-light') {
        const sw = this.animation.width;
        const sh = this.animation.height;
        const offCanvas = document.createElement('canvas');
        const offCtx    = offCanvas.getContext('2d');
        offCanvas.width = sw; offCanvas.height = sh;

        // 原始幀
        offCtx.drawImage(
            this.image,
            this.animation.frame * sw, 0, sw, sh,
            0, 0, sw, sh
        );
        // 染色層
        offCtx.globalCompositeOperation = blendMode;
        offCtx.fillStyle = `rgba(${tintColor.r}, ${tintColor.g}, ${tintColor.b}, ${tintAlpha})`;
        offCtx.fillRect(0, 0, sw, sh);
        // 透明遮罩
        offCtx.globalCompositeOperation = 'destination-in';
        offCtx.drawImage(
            this.image,
            this.animation.frame * sw, 0, sw, sh,
            0, 0, sw, sh
        );
        // 主畫布
        buffer.save();
        buffer.scale(this.flip ? -1 : 1, 1);
        const dx = this.flip
            ? -(this.x * RENDER_SCALE + this.width * RENDER_SCALE * scale)
            : this.x * RENDER_SCALE;
        buffer.drawImage(
            offCanvas,
            0, 0, sw, sh,
            dx, this.y * RENDER_SCALE,
            this.width * RENDER_SCALE * scale,
            this.height * RENDER_SCALE * scale
        );
        buffer.restore();
    }
    physics(gravity=0.6) {
        this.gravity += gravity;
        this.y += this.gravity;
    }
    checkCollision(boxes, scale = 1) {
        this.onGround = false;
        const sw = this.width * scale;
        const sh = this.height * scale;
        const nextX = this.x;
        const nextY = this.y + this.gravity;
        for (let b of boxes) {
            const bx = b.x, by = b.y, bw = b.width, bh = b.height;
            const collided =
            nextX + sw > bx &&
            nextX < bx + bw &&
            nextY + sh > by &&
            nextY < by + bh;
            if (!collided) continue;
            const dx = (nextX + sw / 2) - (bx + bw / 2);
            const dy = (nextY + sh / 2) - (by + bh / 2);
            const wy = (sw + bw) / 2;
            const hx = (sh + bh) / 2;
            if (Math.abs(dx) <= wy && Math.abs(dy) <= hx) {
                const wy_diff = wy - Math.abs(dx);
                const hx_diff = hx - Math.abs(dy);
                if (wy_diff < hx_diff) {
                    // 左右牆
                    if (dx > 0) this.x = bx + bw;
                    else        this.x = bx - sw;
                } else {
                    // 地板 / 天花板
                    if (dy > 0) {
                        this.y = by + bh; this.gravity = 0;
                    } else {
                        this.y = by - sh; this.gravity = 0; this.onGround = true;
                    }
                }
            }
        }
    }
    follow(target) {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 20) {
            this.x += this.velocity * dx / dist;
            this.y += this.velocity * dy / dist;
            this.animation.setState("run");
        } else this.animation.setState("idle");
        this.flip = this.x > target.x;
        this.animation.update();
    }
    hitbox(alpha=1, scale=1) {
        buffer.save();
        buffer.globalAlpha = alpha;
        buffer.fillStyle   = this.color;
        buffer.fillRect(
            this.x*RENDER_SCALE, this.y*RENDER_SCALE,
            this.width*RENDER_SCALE*scale, this.height*RENDER_SCALE*scale
        );
        buffer.restore();
    }
}

// --- 實體 & 動畫設定 ---
const user = new Entity(250, 0, 57.6,61.2);
const npc  = new Entity(200, 0, 32,32);
user.name = "user"; npc.name = "npc";
user.image.src = "images/role1.png";
npc.image.src  = "images/npc.png";

user.animation.defineState("idle", [0,1], 15, 48,51);
user.animation.defineState("run",  [2,3,4,5], 4, 48,51);
user.animation.defineState("jump", [6,7], 10, 48,51);
npc.animation.defineState("idle", [0,1,2,3], 20, 23,27);
npc.animation.defineState("run",  [4,5,6,7,8,9], 5, 23,27);

const allEntities     = [user, npc];
const physicsEntities = [user, npc];


// clamp 工具
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

// 更新相機位置並同步視差背景位置
function updateCamera(target) {
    let cx = target.x*RENDER_SCALE - viewport.clientWidth/2;
    let cy = target.y*RENDER_SCALE - viewport.clientHeight/2;
    camera.x = Math.round(clamp(cx, 0, canvas.width - viewport.clientWidth));// 計算相機 X 軸位置，限制在地圖範圍內
    camera.y = Math.round(clamp(cy, 0, canvas.height - viewport.clientHeight));// 計算相機 Y 軸位置，限制在地圖範圍內
    parallaxFar.style.backgroundPosition = `${-camera.x * 0.2}px bottom`;// 根據相機位置更新遠景背景位置，產生視差效果
    parallaxMid.style.backgroundPosition = `${-camera.x * 0.5}px bottom`;// 根據相機位置更新中景背景位置，產生視差效果
}


// --- 儲存 / 載入遊戲 ---
function saveGame() {
    const states = allEntities.map(e => e.save());
    localStorage.setItem('gameSave', JSON.stringify({ entities: states }));
}
function loadGame() {
    const data = JSON.parse(localStorage.getItem('gameSave'));
    if (!data || !Array.isArray(data.entities)) return;
    for (let s of data.entities) {
    const e = allEntities.find(x => x.name === s.name);
    if (e) e.load(s);
    }
}


// 任務系統界面
let tasks = JSON.parse(localStorage.getItem("canvasTasks")||"[]");
tasks.forEach(t => { if (t.iframeVisible === undefined) t.iframeVisible = false; });
let draggingTask=null, dragOffset={x:0,y:0};
let selectedTaskId=null;

const editor          = document.getElementById("editor");
const titleInput      = document.getElementById("taskTitle");
const contentTextarea = document.getElementById("taskContent");
const saveBtn         = document.getElementById("saveTask");
const deleteBtn       = document.getElementById("deleteTask");
const cancelBtn       = document.getElementById("cancelEdit");

function saveTasks() {
    localStorage.setItem("canvasTasks", JSON.stringify(tasks));
}
function wrapTextCentered(text, cx, sy, maxW, lh) {
    const words = text.split(' ');
    let line="", y=sy, lines=[];
    for (let w of words) {
        const t = line + w + ' ';
        if (buffer.measureText(t).width > maxW && line.length) {
            lines.push(line); line = w + ' ';
        } else line = t;
    }
    lines.push(line);
    for (let l of lines) {
        buffer.fillText(l.trim(), cx, y);
        y += lh;
    }
}

let addBtnX = 0;
let addBtnY = 0;
let closeBtnX = 0;
let closeBtnY = 0;
function drawBoard() {
    const panelX = 100, panelY = 100;
    const panelW = viewport.clientWidth - 200;
    const panelH = viewport.clientHeight - 200;

    buffer.save();
    buffer.fillStyle = "rgba(34,34,34,0.5)";
    buffer.fillRect(panelX,panelY,panelW,panelH);

    buffer.fillStyle = "#ffd700";
    buffer.font = "bold 48px sans-serif";
    buffer.textAlign = "center";
    buffer.fillText("懸賞任務", panelX + panelW/2, panelY + 50);

    // 新增按鈕
    addBtnX = panelX + 20
    addBtnY = panelY + 20;
    buffer.fillStyle = "#0f0";
    buffer.fillRect(addBtnX, addBtnY, 40, 40);
    buffer.fillStyle = "#000";
    buffer.font = "bold 30px sans-serif";
    buffer.fillText("+", addBtnX+20, addBtnY+30);

    // 關閉按鈕
    closeBtnX = panelX + panelW - 60;
    closeBtnY = panelY + 20;

    // 繪製按鈕
    buffer.fillStyle = "#f00";
    buffer.fillRect(closeBtnX, closeBtnY, 40, 40);
    buffer.fillStyle = "#fff";
    buffer.font = "bold 30px sans-serif";
    buffer.fillText("✕", closeBtnX + 20, closeBtnY + 30);


    const overlayContainer = document.getElementById("taskOverlays");
    overlayContainer.innerHTML = "";

    for (let t of tasks) {
        buffer.fillStyle = "#fff";
        buffer.fillRect(t.x,t.y,220,80);
        buffer.strokeStyle = "#000";
        buffer.strokeRect(t.x,t.y,220,80);
        buffer.fillStyle = "#000";
        buffer.font = "bold 18px sans-serif";
        buffer.textAlign = "center";
        wrapTextCentered(t.title || "(無標題)", t.x+110, t.y+25, 200, 22);

        if (t.content.trim().startsWith("<iframe")) {
            const toggleBtn = document.createElement("button");
            toggleBtn.innerText = t.iframeVisible ? "❌" : "🟢";
            toggleBtn.style.position = "absolute";
            toggleBtn.style.left = `${t.x + 10}px`;
            toggleBtn.style.top = `${t.y + 50}px`;
            toggleBtn.style.zIndex = 20;
            toggleBtn.onclick = () => {
            t.iframeVisible = !t.iframeVisible;
            saveTasks();
            drawBoard();
            };
            overlayContainer.appendChild(toggleBtn);

            if (t.iframeVisible) {
                const div = document.createElement("div");
                div.style.position = "absolute";
                div.style.left = "50%";
                div.style.top  = "50%";
                div.style.width = "90vw";
                div.style.height = "90vh";
                div.style.pointerEvents = "auto";
                div.innerHTML = t.content;
                overlayContainer.appendChild(div);
            }
        }
    }
    buffer.restore();
}

// --- 任務互動事件
canvas.addEventListener("mousedown", e => {
    if (!boardVisible) return;
    const x=e.offsetX, y=e.offsetY;
    const centerX = camera.x + viewport.clientWidth / 2;
    const centerY = camera.y + viewport.clientHeight / 2;
    if (x>=addBtnX && x<=addBtnX+40 && y>=addBtnY && y<=addBtnY+40) {// 任務面板新增任務
        const nt = { id:Date.now(), title:"", content:"", x: centerX - 110, y: centerY - 40, iframeVisible: false };
        tasks.push(nt); saveTasks();
        selectedTaskId = nt.id;
        titleInput.value=""; contentTextarea.value="";
        editor.style.display="flex";
        drawBoard(); return;
    }
    if (x >= closeBtnX &&x <= closeBtnX + 40 &&y >= closeBtnY &&y <= closeBtnY + 40) {// 關閉任務面板
        boardVisible = false;
        const overlay = document.getElementById("taskOverlays");
        overlay.innerHTML = "";
        main_loop(lastTime);
        return;
    }
    for (let t of tasks) {
        if (x>=t.x && x<=t.x+220 && y>=t.y && y<=t.y+80) {
            selectedTaskId = t.id;
            dragOffset.x = x - t.x;
            dragOffset.y = y - t.y;
            draggingTask = t;
            return;
        }
    }
});
canvas.addEventListener("mousemove", e => {
    if (boardVisible && draggingTask) {
        draggingTask.x = e.offsetX - dragOffset.x;
        draggingTask.y = e.offsetY - dragOffset.y;
        drawBoard();
    }
});
canvas.addEventListener("mouseup", () => {
    if (boardVisible && draggingTask) saveTasks();
    draggingTask = null;
});
canvas.addEventListener("dblclick", e => {
    if (!boardVisible) return;
    const x=e.offsetX, y=e.offsetY;
    for (let t of tasks) {
        if (x>=t.x && x<=t.x+220 && y>=t.y && y<=t.y+80) {
            selectedTaskId = t.id;
            titleInput.value   = t.title;
            contentTextarea.value = t.content;
            editor.style.display  = "flex";
            return;
        }
    }
});
saveBtn.onclick = () => {
    const t = tasks.find(x => x.id === selectedTaskId);
    if (t) {
        t.title   = titleInput.value.trim();
        t.content = contentTextarea.value.trim();
        saveTasks();
        editor.style.display = "none";
        if (boardVisible) drawBoard();
    }
};
deleteBtn.onclick = () => {
    tasks = tasks.filter(x => x.id !== selectedTaskId);
    saveTasks();
    editor.style.display = "none";
    if (boardVisible) drawBoard();
};
cancelBtn.onclick = () => {
    editor.style.display = "none";
    if (boardVisible) drawBoard();
};


// 方向&互動快捷鍵
let control_right=false, control_left=false, control_up=false, jPressed = false;;  // 控制變數
function keyboard_mod(type, value) {
    addEventListener(type, e => {
    if (e.code==='KeyD') control_right = value;
    else if (e.code==='KeyA') control_left  = value;
    else if (e.code==='KeyW') control_up    = value;
    if (e.code === "KeyJ") jPressed = value;
    });
}
keyboard_mod('keydown', true);
keyboard_mod('keyup',   false);

function control(role) {
    if (control_right) {
        role.x += 1.5; role.flip = false; role.animation.setState("run");
    }
    else if (control_left) {
        role.x -= 1.5; role.flip = true;  role.animation.setState("run");
    }
    else if (!role.onGround) {
        role.animation.setState("jump");
    }
    else role.animation.setState("idle");
    if (control_up && role.onGround) role.gravity = -8;
}

// 功能快捷鍵
addEventListener('keydown', e => {
    if (e.code === 'KeyK') {
        if (editor.style.display === "flex") return;
        boardVisible = !boardVisible;
        const overlay = document.getElementById("taskOverlays");
        if (boardVisible) drawBoard();
        else {
            overlay.innerHTML = "";
            main_loop(lastTime);
        }
    }
    if (e.code === 'KeyP') {
        game_switch = !game_switch;
        if (game_switch && !boardVisible) main_loop(lastTime);
    }
    if (e.code === 'KeyH') debug_switch = !debug_switch;
    if (e.code === 'ArrowUp') saveGame();
    if (e.code === 'ArrowDown') loadGame();
});


// 調整畫布大小
function resizeCanvas() {
    canvas.width  = mapData.width  * TILE_SIZE * RENDER_SCALE;
    canvas.height = mapData.height * TILE_SIZE * RENDER_SCALE;
    buffer.imageSmoothingEnabled = false;
}


// --- 主迴圈與啟動 ---
let lastTime = performance.now();
function main_loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    if (!game_switch) return;
    if (boardVisible) return drawBoard();

    requestAnimationFrame(main_loop);

    // 更新動畫
    updateTileAnimations(dt);

    // 物理與碰撞
    for (let e of physicsEntities) {
    e.physics();
    e.checkCollision(collisionBoxes, ENTITY_SCALE);
    }

    // 控制與 NPC 跟隨
    control(user);
    user.animation.update();
    npc.follow(user);

    // 更新相機 (含視差)
    updateCamera(user);

    // 繪製
    buffer.clearRect(0, 0, canvas.width, canvas.height);
    buffer.save();
    buffer.translate(-camera.x, -camera.y);

    for (let layer of tileLayers) drawTileLayer(layer);
    if (debug_switch) {
        drawCollisionBoxes(collisionBoxes);
        user.hitbox(0.5, ENTITY_SCALE);
        npc.hitbox(1.0, ENTITY_SCALE);
    }
    user.drawSprite(ENTITY_SCALE);
    npc.drawSprite(ENTITY_SCALE);

    buffer.restore();
    checkInteractions(ENTITY_SCALE);
}

// 啟動
resizeCanvas();
requestAnimationFrame(main_loop);