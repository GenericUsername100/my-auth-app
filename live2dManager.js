/* live2dManager.js
   FIXED: AI Control Defaults to ON
   - state.aiEnabled is now true by default.
   - UI Checkbox automatically syncs to enabled state on load.
   - Added console logging to .play() for easier debugging.
*/
(function () {
    // --- GLOBAL VARIABLES ---
    let app = null;
    let currentModel = null;
    let modelTicker = null;
    let stagedFile = null;

    let globalFileMap = new Map(); 
    let rawResources = { expressions: [], motions: [] };
    
    const state = {
        aiEnabled: true, // <--- FIXED: Enabled by default now
        allowedExpressions: new Set(),
        allowedMotions: new Set(),
        loopOverrideMap: {}, 
        activeLoopName: null,
        loopFadeTime: 0.0, 
        keyMap: {}, 
        isBinding: false, 
        bindingTarget: null,
        defaultSnapshot: null,
        defaultIdleGroup: null 
    };

    // --- 0. MINI CONSOLE ---
    function logToScreen(msg, type='info') {
        console.log(`[L2D ${type.toUpperCase()}] ${msg}`);
    }

    // --- 1. LOADER UTILITIES ---
    async function loadScript(url, globalVar) {
        if (window[globalVar]) return;
        const backup = { m: window.module, e: window.exports, d: window.define };
        window.module = undefined; window.exports = undefined; window.define = undefined;

        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => {
                window.module = backup.m; window.exports = backup.e; window.define = backup.d;
                let attempts = 0;
                const check = setInterval(() => {
                    if (window[globalVar]) { clearInterval(check); resolve(); }
                    else if (attempts > 20) { clearInterval(check); resolve(); } 
                    attempts++;
                }, 50);
            };
            s.onerror = () => reject(new Error(`Failed to load ${url}`));
            document.head.appendChild(s);
        });
    }

    async function ensureEngine(onProgress) {
        onProgress("Loading Engine...", 0);
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "JSZip");
        await loadScript("https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js", "Live2DCubismCore");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pixi.js/6.5.8/browser/pixi.min.js", "PIXI");
        await loadScript("https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js", "PixiLive2dDisplay");
        if (!window.PixiLive2dDisplay && window.PIXI && window.PIXI.live2d) window.PixiLive2dDisplay = window.PIXI.live2d;
        return window.PixiLive2dDisplay.Live2DModel;
    }

    async function initApp() {
        if (app) return;
        const canvas = document.getElementById('live2d-canvas');
        if (!canvas) throw new Error("Canvas #live2d-canvas not found in DOM");

        app = new window.PIXI.Application({
            view: canvas,
            autoStart: true,
            backgroundAlpha: 0,
            resizeTo: window
        });
        
        canvas.addEventListener('mousedown', () => window.focus());
        if(app.renderer.plugins.interaction) app.renderer.plugins.interaction.moveWhenInside = true;
    }

    function blobToDataURI(blob) {
        return new Promise((resolve, reject) => { 
            const fr = new FileReader(); 
            fr.onload = () => resolve(fr.result); 
            fr.onerror = (e) => reject(e);
            fr.readAsDataURL(blob); 
        });
    }

    // --- 2. ZIP PROCESSING ---
    async function processZip(file, onProgress) {
        onProgress("Reading Zip...", 10);
        if (!window.JSZip) throw new Error("JSZip not loaded");
        const zip = await window.JSZip.loadAsync(file);
        
        const normalize = (path) => path.replace(/\\/g, '/').replace(/^\.\//, '');
        const validKeys = Object.keys(zip.files).filter(k => !k.includes('__MACOSX') && !zip.files[k].dir);
        
        let modelPath = validKeys.find(k => k.endsWith('.model3.json') || k.endsWith('.model.json'));
        if (!modelPath) {
             const junkRegex = /(physics|motion|pose|expression|userdata|meta|cdi|displayInfo)/i;
             modelPath = validKeys.find(k => k.endsWith('.json') && !junkRegex.test(k));
        }
        if (!modelPath) throw new Error("No Model JSON found.");
        logToScreen(`Main Model File: ${modelPath}`, 'success');

        globalFileMap.clear(); 
        rawResources = { expressions: [], motions: [] };
        state.loopOverrideMap = {}; 

        const total = validKeys.length;

        for (let i = 0; i < total; i++) {
            const key = validKeys[i];
            const lowKey = normalize(key).toLowerCase();
            let mime = 'application/octet-stream';
            let suffix = ""; 
            let identifiedType = "unknown";
            let loopsByDefault = false;

            if (lowKey.endsWith('.motion3.json')) { identifiedType = "motion"; suffix = "#.motion3.json"; }
            else if (lowKey.endsWith('.mtn')) { identifiedType = "motion_v3"; suffix = "#.mtn"; }
            else if (lowKey.endsWith('.exp3.json')) { identifiedType = "expression"; suffix = "#.exp3.json"; }
            else if (lowKey.endsWith('.png')) { mime = 'image/png'; identifiedType = "texture"; }
            else if (lowKey.endsWith('.physics3.json')) { identifiedType = "physics"; suffix = "#.physics3.json"; }
            else if (lowKey.endsWith('.pose3.json')) { identifiedType = "pose"; suffix = "#.pose3.json"; }
            else if (lowKey.endsWith('.userdata3.json')) { identifiedType = "userdata"; suffix = "#.userdata3.json"; }
            else if (lowKey.includes('cdi3.json') || lowKey.includes('displayinfo')) { identifiedType = "ignore"; }
            else if (lowKey.endsWith('.json') && lowKey !== normalize(modelPath).toLowerCase()) {
                try {
                    const contentStr = await zip.files[key].async('string');
                    if (contentStr.includes('Curves')) { identifiedType = "motion"; suffix = "#.motion3.json"; }
                    else if (contentStr.includes('Live2D Expression')) { identifiedType = "expression"; suffix = "#.exp3.json"; }
                } catch (e) {}
            }

            if (identifiedType === "motion") {
                try {
                    const str = await zip.files[key].async('string');
                    const json = JSON.parse(str);
                    if (json && json.Meta && json.Meta.Loop === true) loopsByDefault = true; 
                } catch(e) {}
                rawResources.motions.push({ 
                    key: lowKey, original: key, suffix, type: identifiedType, loops: loopsByDefault 
                });
                mime = 'application/json';
            }
            else if (identifiedType === "expression") {
                rawResources.expressions.push({ key: lowKey, original: key, suffix, type: identifiedType });
                mime = 'application/json';
            }

            if (identifiedType !== "ignore") {
                const blob = await zip.files[key].async('blob');
                const baseUri = await blobToDataURI(new Blob([blob], {type: mime}));
                const dataUri = baseUri + suffix;
                const cleanName = lowKey.split('/').pop();
                globalFileMap.set(lowKey, dataUri); 
                globalFileMap.set(cleanName, dataUri); 
                globalFileMap.set(key, dataUri); 
            }
            if(i % 5 === 0) onProgress(`Unpacking...`, 20 + Math.floor((i/total)*50));
        }

        onProgress("Configuring Model...", 80);
        const jsonStr = await zip.files[modelPath].async('string');
        const jsonObj = JSON.parse(jsonStr);

        const deepWalk = (obj) => {
            for (let k in obj) {
                if (typeof obj[k] === 'object' && obj[k] !== null) {
                    deepWalk(obj[k]);
                } else if (typeof obj[k] === 'string') {
                    const val = obj[k];
                    const lowVal = normalize(val).toLowerCase();
                    const cleanVal = lowVal.split('/').pop();
                    if (globalFileMap.has(val)) obj[k] = globalFileMap.get(val);
                    else if (globalFileMap.has(lowVal)) obj[k] = globalFileMap.get(lowVal);
                    else if (globalFileMap.has(cleanVal)) obj[k] = globalFileMap.get(cleanVal);
                }
            }
        };
        deepWalk(jsonObj);

        if (!jsonObj.FileReferences) jsonObj.FileReferences = {};
        if (!jsonObj.FileReferences.Expressions) jsonObj.FileReferences.Expressions = [];
        rawResources.expressions.forEach(res => {
            const dataUri = globalFileMap.get(res.key);
            const exists = jsonObj.FileReferences.Expressions.some(e => e.File === dataUri);
            if (!exists) {
                const name = res.original.split('/').pop().replace('.exp3.json','').replace('.json','');
                jsonObj.FileReferences.Expressions.push({ Name: name, File: dataUri });
            }
        });

        if (!jsonObj.FileReferences.Motions) jsonObj.FileReferences.Motions = {};
        const motionGroups = jsonObj.FileReferences.Motions;
        rawResources.motions.forEach(res => {
            const dataUri = globalFileMap.get(res.key);
            let found = false;
            const cleanName = res.original.split('/').pop().replace(/\.motion3\.json$|\.json$|\.mtn$/i, '');
            if(res.loops) state.loopOverrideMap[cleanName] = true; 

            for (let group in motionGroups) {
                if (Array.isArray(motionGroups[group])) {
                    if (motionGroups[group].some(m => m.File === dataUri)) found = true;
                }
            }
            if (!found) {
                let name = res.original.split('/').pop();
                let groupName = name.split('_')[0].toLowerCase() || "Standard";
                if (!motionGroups[groupName]) motionGroups[groupName] = [];
                motionGroups[groupName].push({ File: dataUri, Loop: res.loops || undefined }); 
            }
        });
        
        jsonObj.url = modelPath; 
        return jsonObj;
    }

    // --- 3. RENDER & LOGIC ---
    async function loadModel(modelObj, ModelClass, onProgress) {
        onProgress("Rendering...", 90);
        
        if (currentModel) {
            app.stage.removeChild(currentModel);
            try { currentModel.destroy(); } catch(e) {}
            currentModel = null;
            if (modelTicker) { app.ticker.remove(modelTicker); modelTicker = null; }
        }

        let model;
        try {
            model = await ModelClass.from(modelObj, { autoInteract: true });
        } catch(e) {
            logToScreen("Load Error: " + e.message, 'error');
            console.error(e);
            throw e;
        }
        
        const s = Math.min(window.innerWidth/model.width, window.innerHeight/model.height) * 0.8;
        model.scale.set(s);
        model.anchor.set(0.5, 1.0);
        model.x = window.innerWidth / 2;
        model.y = window.innerHeight;

        currentModel = model;
        app.stage.addChild(model);

        state.defaultSnapshot = { params: null, parts: null };
        const internal = model.internalModel;
        
        try {
            if(internal && internal.coreModel) {
                const core = internal.coreModel;
                if (core._parameterValues) state.defaultSnapshot.params = new Float32Array(core._parameterValues);
                if(internal.parts) state.defaultSnapshot.parts = internal.parts.map(p => p.opacity);
                logToScreen(`Snapshot: Params[${state.defaultSnapshot.params ? state.defaultSnapshot.params.length : 0}]`, 'success');
            }
        } catch(e) { console.error("Snapshot Failed", e); }

        let lastTime = performance.now();
        modelTicker = () => {
            const now = performance.now();
            model.update(now - lastTime);
            lastTime = now;
        };
        app.ticker.add(modelTicker);

        let motions = {};
        let expressions = [];
        state.defaultIdleGroup = null;

        if (model.internalModel && model.internalModel.motionManager) {
             if (model.internalModel.motionManager.definitions) motions = model.internalModel.motionManager.definitions;
             if (model.internalModel.motionManager.expressionManager) {
                 expressions = model.internalModel.motionManager.expressionManager.definitions;
             }
        }

        Object.keys(motions).forEach(key => {
            if (/idle|loop|stand/i.test(key) && state.loopOverrideMap[key] === undefined) {
                state.loopOverrideMap[key] = true;
            }
        });

        const idleGroup = Object.keys(motions).find(n => /idle|loop|stand/i.test(n));
        if (idleGroup) {
            state.defaultIdleGroup = idleGroup;
            model.internalModel.motionManager.groups.idle = idleGroup;
            model.internalModel.motionManager.startMotion(idleGroup, 0, 1);
            logToScreen(`Default Loop Set: ${idleGroup}`, 'success');
        }

        state.keyMap = { 
            'Numpad0': { type: 'STOP', name: 'STOP' },
            'KeyC': { type: 'STOP', name: 'STOP' }
        };

        setupGlobalKeys();
        populateUI(expressions, motions); 
        populateManualMapper(); 
        onProgress("Ready!", 100);
    }

    // --- 4. THE SNAPSHOT RESET ---
    function forceResetFace() {
        if(!currentModel) return;
        state.activeLoopName = null;

        const executeReset = () => {
            const internal = currentModel.internalModel;
            const motionMgr = internal.motionManager;
            const core = internal.coreModel;

            if (motionMgr.expressionManager) {
                if(typeof motionMgr.expressionManager.restore === 'function') motionMgr.expressionManager.restore();
                motionMgr.expressionManager.expressions = []; 
                motionMgr.expressionManager._currentExpression = null; 
            }
            
            if (state.defaultIdleGroup) motionMgr.groups.idle = state.defaultIdleGroup; 
            else motionMgr.groups.idle = null; 

            try { 
                if(typeof motionMgr.stopAllMotions === 'function') motionMgr.stopAllMotions();
                else if(typeof motionMgr.stopAll === 'function') motionMgr.stopAll();
            } catch(e) {}

            if (internal && core && state.defaultSnapshot) {
                if (state.defaultSnapshot.params && core._parameterValues) {
                    try { core._parameterValues.set(state.defaultSnapshot.params); } catch(e) {}
                }
                if (state.defaultSnapshot.parts && internal.parts) {
                    internal.parts.forEach((p, i) => {
                         const target = state.defaultSnapshot.parts[i] !== undefined ? state.defaultSnapshot.parts[i] : 1;
                         p.opacity = target; p.setValue(target); 
                         if(core._partOpacities && core._partOpacities[i] !== undefined) core._partOpacities[i] = target;
                    });
                }
            }
            if(internal.physics) {
                 try { internal.physics.reset(); if(internal.physics.update) internal.physics.update(0); } catch(e) {}
            }
            try { if(currentModel.update) currentModel.update(0.1); } catch(e) {}
        };

        executeReset();
        
        setTimeout(() => {
            executeReset();
            const internal = currentModel.internalModel;
            if (internal && internal.motionManager && state.defaultIdleGroup) {
                state.activeLoopName = null;
                internal.motionManager.startRandomMotion(state.defaultIdleGroup, 1);
            }
        }, 30);

        showToast("✨ Factory Reset");
        logToScreen("System: Snapshot Restored", 'success');
    }

    // --- 5. KEY HANDLING ---
    function setupGlobalKeys() {
        window.removeEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keydown', handleKeyDown, true);
        window.focus();
    }

    function handleKeyDown(e) {
        if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && !e.ctrlKey) return;
        const code = e.code;
        const key = e.key.toLowerCase();

        if (code === 'KeyC' || key === 'c' || code === 'Numpad0') {
            e.preventDefault(); e.stopPropagation();
            forceResetFace(); 
            return;
        }

        if (state.isBinding && state.bindingTarget) {
            e.preventDefault(); e.stopPropagation();
            if(['ControlLeft','ShiftLeft','AltLeft','MetaLeft'].includes(code)) return;
            if (code === 'Escape') {
                const { btn } = state.bindingTarget;
                btn.innerText = "Key: -";
                btn.classList.remove('binding-active');
                btn.style.background = ""; btn.style.color = "";
                state.isBinding = false; state.bindingTarget = null;
                showToast("Binding cancelled");
                return;
            }
            const { type, name, btn } = state.bindingTarget;
            state.keyMap[code] = { type, name };
            const prettyKey = code.replace(/^(Key|Digit|Numpad)/, '');
            btn.innerText = `Key: ${prettyKey}`;
            btn.classList.remove('binding-active');
            btn.style.background = ""; btn.style.color = "#4caf50"; btn.style.borderColor = "#4caf50";
            state.isBinding = false; state.bindingTarget = null;
            showToast(`Bound ${name} to ${prettyKey}`);
            return;
        }

        if (state.keyMap[code]) {
            e.preventDefault(); e.stopPropagation();
            const action = state.keyMap[code];
            if (action.type === 'STOP') forceResetFace();
            else trigger(action.type, action.name);
        }
    }
    
    function showToast(text) {
        if (typeof console !== 'undefined' && console.log) {
            console.log(`[L2D TOAST] ${text}`);
        }
    }

    // --- 6. UI POPULATION ---
    function populateUI(expressions, motions) {
        const expList = document.getElementById('expression-list');
        const motList = document.getElementById('motion-list');
        if(!expList || !motList) return;

        expList.innerHTML = ''; motList.innerHTML = '';
        state.allowedExpressions.clear(); state.allowedMotions.clear();
        
        if (Array.isArray(expressions) && expressions.length > 0) {
            expressions.forEach(e => {
                if (!e || !e.name) return;
                const fileDisplay = (e.file || e.name).split('/').pop(); 
                createUIItem(e.name, fileDisplay, 'expression', expList, state.allowedExpressions);
            });
        } else { expList.innerHTML = '<div class="empty-msg">None Found</div>'; }
        
        // --- GLOBAL FADE CONTROL ---
        const fadeCtrl = document.createElement('div');
        fadeCtrl.style.cssText = "margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #444;";
        fadeCtrl.innerHTML = `
            <div style="font-size:12px; color:#aaa; margin-bottom:4px; display:flex; justify-content:space-between;">
                <span>Loop Smoothness (Crossfade)</span>
                <span id="fade-val-disp">0ms</span>
            </div>
            <input type="range" min="0" max="2000" step="100" value="0" id="loop-fade-slider" style="width:100%;">
            <div style="font-size:10px; color:#666;">Left: Hard Snap (Engine) | Right: Blur Snap (Blend)</div>
        `;
        motList.appendChild(fadeCtrl);
        const slider = fadeCtrl.querySelector('#loop-fade-slider');
        const disp = fadeCtrl.querySelector('#fade-val-disp');
        slider.oninput = () => {
            state.loopFadeTime = parseInt(slider.value) / 1000;
            disp.innerText = slider.value + "ms";
        };

        if (motions && Object.keys(motions).length > 0) {
            Object.keys(motions).forEach(groupName => {
                createUIItem(groupName, groupName, 'motion', motList, state.allowedMotions);
            });
        } else { motList.innerHTML = '<div class="empty-msg">None Found</div>'; }
    }

    function createUIItem(internalName, displayName, type, container, allowSet) {
        const div = document.createElement('div');
        div.className = 'control-item';
        div.style.cssText = "display:flex; align-items:center; margin-bottom:4px; gap: 5px;";

        const lbl = document.createElement('span');
        lbl.innerText = displayName.replace(/\.motion3\.json$|\.exp3\.json$|\.json$|\.mtn$/i, '');
        lbl.title = internalName;
        lbl.style.cssText = "flex-grow:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-family:monospace; font-size:12px;";
        
        const bindBtn = document.createElement('button');
        bindBtn.innerText = 'Key: -';
        const existingKey = Object.keys(state.keyMap).find(k => state.keyMap[k].name === internalName && state.keyMap[k].type === type);
        if (existingKey) {
            bindBtn.innerText = `Key: ${existingKey.replace(/^(Key|Digit|Numpad)/, '')}`;
            bindBtn.style.color = "#4caf50"; bindBtn.style.borderColor = "#4caf50";
        }
        bindBtn.className = 'bind-btn';
        bindBtn.style.cssText = "padding:2px 8px; font-size:10px; cursor:pointer; background:#444; color:#ccc; border:1px solid #666; min-width:60px; transition:all 0.1s;";
        bindBtn.onclick = (e) => {
            e.stopPropagation(); 
            if (state.isBinding) { showToast("Binding already active!"); return; }
            state.isBinding = true;
            state.bindingTarget = { type, name: internalName, btn: bindBtn }; 
            bindBtn.innerText = "...";
            bindBtn.classList.add('binding-active');
            bindBtn.style.background = "#d32f2f"; bindBtn.style.color = "#fff"; bindBtn.style.borderColor = "#ff5252";
            showToast("Press any key (Esc to cancel)");
        };

        let chk = null;
        if (type !== 'motion') {
            chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = true;
            allowSet.add(internalName);
            chk.title = "Allow AI to use this";
            chk.onchange = () => { if(chk.checked) allowSet.add(internalName); else allowSet.delete(internalName); };
        } else {
            allowSet.add(internalName);
        }
        
        div.appendChild(lbl);
        
        if (type === 'motion') {
            const loopChk = document.createElement('input');
            loopChk.type = 'checkbox';
            loopChk.style.cssText = "cursor:pointer;";
            loopChk.title = "Loop this motion";
            if (state.loopOverrideMap[internalName]) loopChk.checked = true;
            loopChk.onchange = () => {
                state.loopOverrideMap[internalName] = loopChk.checked;
                logToScreen(`Loop ${internalName}: ${loopChk.checked}`, 'info');
            };
            const loopLbl = document.createElement('span');
            loopLbl.innerText = "↻";
            loopLbl.style.fontSize = "12px";
            loopLbl.style.color = "#aaa";
            div.appendChild(loopLbl);
            div.appendChild(loopChk);
            const sp = document.createElement('span');
            sp.style.width="10px";
            div.appendChild(sp);
        }

        div.appendChild(bindBtn);
        if (chk) div.appendChild(chk);
        container.appendChild(div);
    }

    // --- 7. TRIGGER LOGIC ---
    function trigger(type, name) {
        if (!currentModel) return;
        try {
            const internal = currentModel.internalModel;
            const motionManager = internal.motionManager;
            
            if (type === 'expression') {
                const manager = motionManager.expressionManager;
                if (!manager) { logToScreen("No Expression Manager.", 'error'); return; }
                let expEntry = manager.definitions.find(d => d.name === name) || manager.definitions.find(d => d.file === name);
                if (expEntry) {
                    manager.setExpression(expEntry.name);
                    showToast(`😊 Exp: ${expEntry.name}`);
                    logToScreen(`Set Exp: ${expEntry.name}`);
                }
            } 
            else if (type === 'motion') {
                if (motionManager.definitions[name]) {
                    const isLooping = state.loopOverrideMap[name] === true;
                    let defs = motionManager.definitions[name];
                    if (!Array.isArray(defs)) defs = [defs];

                    if (motionManager.motions && motionManager.motions.has(name)) {
                        motionManager.motions.delete(name);
                    }

                    if (isLooping) {
                        state.activeLoopName = name;
                        const useCrossfade = state.loopFadeTime > 0;
                        if (useCrossfade) {
                            defs.forEach(def => { def.Loop = false; def.fadeInTime = state.loopFadeTime; def.fadeOutTime = state.loopFadeTime; });
                            motionManager.groups.idle = name; 
                            if(typeof motionManager.stopAll === 'function') motionManager.stopAll();
                            motionManager.startMotion(name, 0, 3);
                            showToast(`🔄 Soft Loop (${state.loopFadeTime}s)`);
                        } else {
                            defs.forEach(def => { def.Loop = true; def.fadeInTime = 0; def.fadeOutTime = 0; });
                            if(motionManager.groups.idle === name) motionManager.groups.idle = null;
                            if(typeof motionManager.stopAll === 'function') motionManager.stopAll();
                            motionManager.startMotion(name, 0, 3);
                            showToast(`🔄 Hard Loop`);
                        }
                    } else {
                        state.activeLoopName = null;
                        defs.forEach(def => { def.Loop = false; def.fadeInTime = 1.0; def.fadeOutTime = 1.0; });
                        if(motionManager.groups.idle === name) motionManager.groups.idle = state.defaultIdleGroup;
                        motionManager.startMotion(name, 0, 3);
                        showToast(`🏃 Mot: ${name}`);
                    }
                }
            }
        } catch(e) {
            console.error(e);
            logToScreen("Trigger Error: " + e.message, 'error');
        }
    }

    // --- 8. MANUAL MAPPER ---
    function populateManualMapper() {
        const selector = document.getElementById('manual-file-select');
        const addBtn = document.getElementById('manual-add-btn');
        if(!selector || !addBtn) return;

        selector.innerHTML = '<option value="">Select file to add...</option>';
        
        let allFiles = [];
        rawResources.expressions.forEach(r => allFiles.push({f: r.key, type: 'expression'}));
        rawResources.motions.forEach(r => allFiles.push({f: r.key, type: 'motion', loops: r.loops}));
        allFiles.sort((a,b) => a.f.localeCompare(b.f));

        allFiles.forEach(item => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify(item); 
            opt.innerText = `[${item.type.substr(0,3).toUpperCase()}] ${item.f.split('/').pop()}`;
            selector.appendChild(opt);
        });

        const newBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newBtn, addBtn);

        newBtn.onclick = async () => {
            try {
                if(!selector.value) return;
                const item = JSON.parse(selector.value);
                const groupName = item.f.split('/').pop().replace(/\.motion3\.json$|\.exp3\.json$|\.json$|\.mtn$/i,'');
                let storedDataUri = globalFileMap.get(item.f); 
                if (!storedDataUri) return;

                if(item.type === 'motion') {
                    const newDef = { file: storedDataUri };
                    if (item.loops) newDef.Loop = true; 
                    if (!currentModel.internalModel.motionManager.definitions[groupName]) {
                        currentModel.internalModel.motionManager.definitions[groupName] = [newDef];
                    } else {
                        currentModel.internalModel.motionManager.definitions[groupName].push(newDef);
                    }
                    if (item.loops) state.loopOverrideMap[groupName] = true;
                } else { 
                    const manager = currentModel.internalModel.motionManager.expressionManager;
                    if(manager && !manager.definitions.find(d=>d.name===groupName)) {
                        manager.definitions.push({ name: groupName, file: storedDataUri });
                    }
                }
                const container = item.type === 'expression' ? document.getElementById('expression-list') : document.getElementById('motion-list');
                const set = item.type === 'expression' ? state.allowedExpressions : state.allowedMotions;
                createUIItem(groupName, groupName, item.type, container, set);
                showToast(`Added: ${groupName}`);
            } catch(e) { console.error(e); }
        };
    }

    // --- 9. UI SETUP ---
    function wireUI() {
        const uploadBtn = document.getElementById('live2d-upload-btn');
        const fileInput = document.getElementById('live2d-file-input');
        const dropzone = document.getElementById('live2d-dropzone');
        const overlay = document.getElementById('character-settings-overlay');
        const openBtn = document.getElementById('open-character-settings');
        const closeBtn = document.getElementById('close-character-settings');
        const aiToggle = document.getElementById('ai-control-toggle');
        const aiPanel = document.getElementById('ai-config-panel');
        
        if (aiToggle && aiPanel) {
            // FIX: Ensure UI checkbox matches the state variable (which is now TRUE)
            aiToggle.checked = state.aiEnabled;
            aiPanel.classList.toggle('hidden', !state.aiEnabled);

            aiToggle.onchange = () => {
                state.aiEnabled = aiToggle.checked;
                aiPanel.classList.toggle('hidden', !aiToggle.checked);
            };
        }

        if (openBtn) openBtn.onclick = () => overlay.classList.remove('hidden');
        if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');

        const handleFile = (f) => {
            if(!f || !f.name.endsWith('.zip')) { alert("Please upload a ZIP file"); return; }
            stagedFile = f;
            if(dropzone) {
                 dropzone.style.borderColor = "#4caf50";
                 dropzone.querySelector('.drop-hint').innerText = "✅ " + f.name;
            }
        };

        if (fileInput) fileInput.onchange = () => handleFile(fileInput.files[0]);
        if (dropzone) {
            dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragover'); };
            dropzone.ondragleave = e => { e.preventDefault(); dropzone.classList.remove('dragover'); };
            dropzone.ondrop = e => { 
                e.preventDefault(); dropzone.classList.remove('dragover'); 
                if(e.dataTransfer.files.length > 0) { handleFile(e.dataTransfer.files[0]); }
            };
            dropzone.onclick = () => fileInput && fileInput.click();
        }

        if (uploadBtn) uploadBtn.onclick = async () => {
            if (!stagedFile) { alert("Please select a ZIP file first"); return; }
            const pCont = document.getElementById('live2d-progress-container');
            const pBar = document.getElementById('live2d-progress-bar');
            const pTxt = document.getElementById('live2d-progress-text');
            if(pCont) pCont.classList.remove('hidden');
            uploadBtn.disabled = true;
            const update = (m, p) => { 
                if(pBar) pBar.style.width = p+"%"; 
                if(pTxt) pTxt.innerText = m; 
            };
            try {
                const ModelClass = await ensureEngine(update);
                await initApp();
                const modelObj = await processZip(stagedFile, update);
                await loadModel(modelObj, ModelClass, update);
                if(overlay) overlay.classList.add('hidden');
            } catch (e) {
                console.error(e);
                logToScreen("Load Failed: " + e.message, 'error');
                setupGlobalKeys();
            } finally {
                uploadBtn.disabled = false;
                if(pCont) pCont.classList.add('hidden');
                stagedFile = null;
                if(dropzone) {
                    dropzone.style.borderColor = "";
                    dropzone.querySelector('.drop-hint').innerText = "Drag & drop ZIP here";
                }
            }
        };
        
        const unload = document.getElementById('live2d-unload-btn');
        if(unload) unload.onclick = () => {
            if (currentModel) { currentModel.destroy(); currentModel = null; }
            if (modelTicker) { app.ticker.remove(modelTicker); modelTicker = null; }
            if(app) app.stage.removeChildren();
            document.getElementById('expression-list').innerHTML = '<div class="empty-msg">Model Unloaded</div>';
            document.getElementById('motion-list').innerHTML = '<div class="empty-msg">Model Unloaded</div>';
            showToast("Model unloaded");
        };
    }

    window.Live2D_API = {
        play: (name) => {
            if (!state.aiEnabled) {
                console.warn("[Live2D] Play request blocked: AI Control is Disabled.");
                return "AI Control disabled.";
            }
            if (name === "RESET" || name === "NEUTRAL") { forceResetFace(); return "Face Reset"; }
            
            // Try explicit match
            if (state.allowedExpressions.has(name)) { trigger('expression', name); return "Exp: " + name; }
            if (state.allowedMotions.has(name)) { trigger('motion', name); return "Mot: " + name; }

            // Try loose match
            const findExp = Array.from(state.allowedExpressions).find(e => e.toLowerCase().includes(name.toLowerCase()));
            if (findExp) { trigger('expression', findExp); return "Exp: " + name; }
            
            const findMot = Array.from(state.allowedMotions).find(m => m.toLowerCase().includes(name.toLowerCase()));
            if (findMot) { trigger('motion', findMot); return "Mot: " + name; }
            
            // Last resort: Try raw resource match (if user manually typed a filename)
            const rawExp = rawResources.expressions.find(r => r.key.includes(name.toLowerCase()));
            if(rawExp) { trigger('expression', rawExp.key); return "Exp: " + name; }

            console.warn(`[Live2D] Could not find action matching: "${name}"`);
            return "Not found.";
        },

        // --- NEW FUNCTION: Returns exact list used by Manual Select ---
        getRawFileList: () => {
            let allFiles = [];
            // Exact logic from populateManualMapper
            rawResources.expressions.forEach(r => allFiles.push({f: r.key, type: 'expression'}));
            rawResources.motions.forEach(r => allFiles.push({f: r.key, type: 'motion', loops: r.loops}));
            allFiles.sort((a,b) => a.f.localeCompare(b.f));
            return allFiles;
        },

        getAvailable: () => ({ expressions: Array.from(state.allowedExpressions), motions: Array.from(state.allowedMotions) }),

        loadZipDataUrl: async (dataUrl, onProgress = () => {}) => {
            try {
                if (!dataUrl) throw new Error("No data URL provided");
                onProgress("Preparing ZIP...", 5);
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                onProgress("Loading engine...", 10);
                const ModelClass = await ensureEngine(onProgress);
                await initApp();
                const modelObj = await processZip(blob, onProgress);
                await loadModel(modelObj, ModelClass, onProgress);
                return true;
            } catch (e) {
                console.error("Live2D loadZipDataUrl error:", e);
                throw e;
            }
        },

        unload: async () => {
            return new Promise((resolve) => {
                try {
                    if (currentModel) { try { currentModel.destroy(); } catch(e) {} currentModel = null; }
                    if (modelTicker && app && app.ticker) { try { app.ticker.remove(modelTicker); } catch(e) {} modelTicker = null; }
                    if (app && app.stage) { try { app.stage.removeChildren(); } catch(e) {} }
                    state.allowedExpressions.clear();
                    state.allowedMotions.clear();
                    rawResources.expressions = [];
                    rawResources.motions = [];
                } catch (e) { console.error('Live2D unload error:', e); } finally { resolve(true); }
            });
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUI);
    else wireUI();

})();