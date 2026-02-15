/**
 * JiyuuDayo Redux - Full Feature Set with Characters & Resilience
 * Includes Message Editing & Character Editing
 * Updates: Expression Triggers (Live2D) added
 */
/* -------------------------------------------------------------------------- */
/*                             SUPABASE / CLOUDSYNC                            */
/* -------------------------------------------------------------------------- */
const supabaseUrl = 'https://zwunsazssoazvqnvdnnr.supabase.co';
const supabaseKey = 'sb_publishable_wfxTq0m-TwqmMulTE9lZjA_SxpveLHD';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let saveTimeout = null;

const CloudSync = {
    async push() {
        if (!currentUser) return;
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            const state = {
                config: config,
                characters: await storage.getCharacters(),
                conversations: await storage.getConversations()
            };
            await supabaseClient.from('user_saves').upsert({ 
                user_id: currentUser.id, game_state: state, updated_at: new Date() 
            });
        }, 3000);
    },
    async pull(user) {
        const { data } = await supabaseClient.from('user_saves').select('game_state').eq('user_id', user.id).maybeSingle();
        if (data?.game_state) {
            if (data.game_state.config) await storage.saveSettings(data.game_state.config);
            if (data.game_state.characters) {
                for (let char of data.game_state.characters) await storage.saveCharacter(char);
            }
            window.location.reload();
        }
    }
};

/* -------------------------------------------------------------------------- */
/*                               SVG ICONS MAP                                */
/* -------------------------------------------------------------------------- */
const ICONS = {
    trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#ecf0f1"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1 1h-5l-1 1H5v2h14V4z"/></svg>`,
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#3498db"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-8 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#f1c40f"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    up: `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M7 14l5-5 5 5z"/></svg>`,
    down: `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M7 10l5 5 5-5z"/></svg>`
};

/* -------------------------------------------------------------------------- */
/*                            PROVIDER PRESETS                                */
/* -------------------------------------------------------------------------- */
const PROVIDER_PRESETS = {
    openai: {
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        placeholderModel: "gpt-4-turbo"
    },
    openrouter: undefined,
    google: {
        label: "Google AI Studio",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
        placeholderModel: "gemini-1.5-pro-latest"
    },
    cohere: {
        label: "Cohere",
        baseUrl: "https://api.cohere.ai/v1",
        placeholderModel: "command-r-plus"
    }
};

/* -------------------------------------------------------------------------- */
/*                               STORAGE ENGINE                               */
/* -------------------------------------------------------------------------- */
class StorageManager {
    constructor() {
        this.dbName = 'JiyuuDayoDB_V2'; 
        this.version = 3; 
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn("IndexedDB not supported. Running in volatile mode.");
                return resolve(null);
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('conversations')) {
                    const store = db.createObjectStore('conversations', { keyPath: 'id' });
                    store.createIndex('lastModified', 'lastModified', { unique: false });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id' });
                    store.createIndex('chatId', 'chatId', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('characters')) {
                    db.createObjectStore('characters', { keyPath: 'id' });
                }
            };

            request.onsuccess = (e) => { 
                this.db = e.target.result; 
                resolve(this.db); 
            };

            request.onerror = (e) => {
                console.error("IDB Error:", e.target.error);
                reject(e.target.error);
            };

            request.onblocked = (e) => {
                alert("Database blocked! Please close other tabs of this application and reload.");
                reject(new Error("Database blocked"));
            };
        });
    }
    compress(stringData) {
        if (typeof pako === 'undefined') return stringData;
        return pako.deflate(stringData);
    }
    decompress(data) {
        if (typeof pako === 'undefined' || typeof data === 'string') return data;
        try { return pako.inflate(data, { to: 'string' }); } 
        catch (e) { return ""; }
    }
    async saveMessage(messageObj) {
        if (!this.db) return;
        const record = { ...messageObj, content: this.compress(messageObj.content) };
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['messages', 'conversations'], 'readwrite');
            tx.objectStore('messages').put(record);
            const convStore = tx.objectStore('conversations');
            convStore.get(messageObj.chatId).onsuccess = (e) => {
                const conv = e.target.result || { id: messageObj.chatId, name: `Chat ${new Date().toLocaleTimeString()}`, createdAt: Date.now() };
                conv.lastModified = Date.now();
                convStore.put(conv);
            };
            tx.oncomplete = () => {
                resolve();
                // Recompute token counts after a successful save so the UI reflects any change in context window.
                try { if (window && typeof window.updateTokenCounts === 'function') window.updateTokenCounts(); } catch(e) { console.error('updateTokenCounts call failed', e); }
            };
            tx.onerror = (e) => reject(e);
        });
    }
    async getMessage(id) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const tx = this.db.transaction('messages', 'readonly');
            tx.objectStore('messages').get(id).onsuccess = (e) => {
                const rec = e.target.result;
                if(rec) rec.content = this.decompress(rec.content);
                resolve(rec);
            };
        });
    }
    async getMessages(chatId) {
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction('messages', 'readonly');
            const index = tx.objectStore('messages').index('chatId');
            index.getAll(IDBKeyRange.only(chatId)).onsuccess = (e) => {
                const msgs = e.target.result.map(rec => ({ ...rec, content: this.decompress(rec.content) }));
                resolve(msgs.sort((a, b) => a.timestamp - b.timestamp));
            };
        });
    }
    async getConversations() {
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction('conversations', 'readonly');
            tx.objectStore('conversations').getAll().onsuccess = (e) => {
                resolve(e.target.result.sort((a, b) => b.lastModified - a.lastModified));
            };
        });
    }
    async saveCharacter(charObj) {
        if (!this.db) return;
        const tx = this.db.transaction('characters', 'readwrite');
        tx.objectStore('characters').put(charObj);
        return new Promise(resolve => tx.oncomplete = resolve);
    }
    async getCharacters() {
        if (!this.db) return [];
        return new Promise(resolve => {
            this.db.transaction('characters', 'readonly').objectStore('characters').getAll().onsuccess = (e) => resolve(e.target.result);
        });
    }
    async deleteCharacter(id) {
        if (!this.db) return;
        const tx = this.db.transaction('characters', 'readwrite');
        tx.objectStore('characters').delete(id);
        return new Promise(resolve => tx.oncomplete = resolve);
    }
    async loadSettings() {
        if (!this.db) return {};
        return new Promise(resolve => {
            this.db.transaction('settings').objectStore('settings').get('userSettings').onsuccess = (e) => resolve(e.target.result || {});
        });
    }
    async saveSettings(settings) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({ id: 'userSettings', ...settings });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    }
    async deleteConversation(chatId) {
        if (!this.db) return;
        const tx = this.db.transaction(['conversations', 'messages'], 'readwrite');
        tx.objectStore('conversations').delete(chatId);
        const msgStore = tx.objectStore('messages');
        const index = msgStore.index('chatId');
        index.openKeyCursor(IDBKeyRange.only(chatId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if(cursor) { msgStore.delete(cursor.primaryKey); cursor.continue(); }
        };
    }
    async deleteMessage(messageId) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('messages', 'readwrite');
            tx.objectStore('messages').delete(messageId);
            tx.oncomplete = () => {
                // Recompute token counts after deletion so the UI reflects the new context.
                try { if (window && typeof window.updateTokenCounts === 'function') window.updateTokenCounts(); } catch(e) { console.error('updateTokenCounts call failed', e); }
                resolve();
            };
            tx.onerror = (e) => reject(e);
        });
    }
    async wipeAll() {
        if (this.db) {
            this.db.close();
        }
        const req = indexedDB.deleteDatabase(this.dbName);
        req.onsuccess = () => {
             alert("Data wiped successfully.");
             window.location.reload();
        };
        req.onerror = () => alert("Could not delete database.");
        req.onblocked = () => alert("Delete blocked: Close other tabs.");
    }
}

/* -------------------------------------------------------------------------- */
/*                                 APP LOGIC                                  */
/* -------------------------------------------------------------------------- */
const storage = new StorageManager();
const converter = new showdown.Converter({ simpleLineBreaks: true, tables: true, strikethrough: true });

// Global State
let config = {
    apiProvider: 'openai', apiKey: '', model: 'gpt-3.5-turbo',
    temperature: 0.7, maxTokens: 1000, repetitionPenalty: 1.1,
    topP: 1.0, topK: 40, frequencyPenalty: 0, presencePenalty: 0,
    geminiKey: '', cohereKey: '',
    aiName: 'AI', userName: 'User', systemPrompt: '', memory: '',
    fontSize: 16, msgWidth: 70, msgOpacity: 90,
    bgImage: '', bgVideo: '', backgroundTriggers: [],
    expressionLinks: [], // New: Store expression triggers here
    inputTemplate: '', outputRegex: [],
    contextWindow: 25, 
    fallbackChain: [] 
};
let newCharTriggers = [];
let newExpressionLinks = []; // New: Temporary editing state
let newRegexRules = [];
let currentChatId = Date.now().toString();
let editingCharacterId = null;
let currentCharacterId = null; 
let tiktokenEncoder = null;

let charStagedLive2DFile = null;
let charStagedLive2DDataUrl = null;

async function initTokenizer() {
    try {
        const mod = await import("https://esm.sh/js-tiktoken@1.0.12");
        const { encodingForModel } = mod;
        tiktokenEncoder = encodingForModel("gpt-4o");
        console.log('[Tokenizer] js-tiktoken initialized');
        updateTokenCounts();
    } catch (e) {
        console.error('[Tokenizer Error]', e);
    }
}

async function updateTokenCounts() {
    if (!tiktokenEncoder) return;
    const systemPromptTextarea = document.getElementById('char-system-prompt') || document.getElementById('modify-system-textarea');
    const systemText = (systemPromptTextarea && systemPromptTextarea.value) || config.systemPrompt || '';
    
    try {
        const systemEncoded = tiktokenEncoder.encode(systemText);
        const systemTokenCount = systemEncoded.length;
        let contextTokenCount = 0;
        
        if (currentChatId && storage.db) {
            const msgs = await storage.getMessages(currentChatId) || [];
            const relevant = msgs.filter(m => m.sender === 'user' || m.sender === 'ai');
            const windowSize = parseInt(config.contextWindow) || 25;
            const windowMsgs = relevant.slice(-windowSize);
            for (const msg of windowMsgs) {
                const contentTokens = tiktokenEncoder.encode(msg.content || '');
                contextTokenCount += contentTokens.length + 3;
            }
            contextTokenCount += 3;
        }
        
        const totalSystem = systemTokenCount + (systemText ? 3 : 0);
        const totalTokenCount = totalSystem + contextTokenCount;
        
        const sidebarTokenEl = document.getElementById('storage-tokens');
        if (sidebarTokenEl) sidebarTokenEl.innerText = `${totalTokenCount}`;
        
        const promptCountEl = document.getElementById('system-prompt-token-count');
        if (promptCountEl) promptCountEl.innerText = `${systemTokenCount} tokens`;
    } catch (e) { console.error('[Token Count Error]', e); }
}

document.addEventListener('DOMContentLoaded', async () => {
    try { await storage.init(); } catch (err) { console.error('Storage init failed:', err); }

    // Supabase auth state handling + login hooks
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        const profile = document.getElementById('user-profile');
        const authBtns = document.getElementById('auth-buttons');
        if (session) {
            currentUser = session.user;
            profile?.classList.remove('hidden');
            authBtns?.classList.add('hidden');
            document.getElementById('user-avatar').src = currentUser.user_metadata?.avatar_url || '';
            document.getElementById('user-name-display').innerText = currentUser.user_metadata?.full_name || currentUser.email || '';
            if (event === 'SIGNED_IN') await CloudSync.pull(currentUser);
        } else {
            currentUser = null;
            profile?.classList.add('hidden');
            authBtns?.classList.remove('hidden');
        }
    });

    const loginGoogleBtn = document.getElementById('login-google');
    const loginDiscordBtn = document.getElementById('login-discord');
    const signOutBtn = document.getElementById('sign-out-btn');
    const handleGoogleLogin = async () => {
        try {
            const { data, error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    // Point back to the base domain and avoid redirecting this frame
                    redirectTo: window.location.origin,
                    skipBrowserRedirect: true
                }
            });

            if (error) {
                console.error("Auth error:", error);
                if (window.showApiError) window.showApiError(`Sign-in failed: ${error.message || error}`);
                return { error };
            }

            const authUrl = data?.url || data?.provider_url || null;
            if (!authUrl) {
                console.warn("No OAuth URL returned for breakout flow.");
                return { error: new Error("No OAuth URL returned") };
            }

            const authWindow = window.open(
                authUrl,
                'SupabaseAuth',
                'width=600,height=800,resizable=yes,scrollbars=yes'
            );

            if (!authWindow) {
                alert("Popup blocked. Please allow popups or try again.");
                return { error: new Error("Popup blocked") };
            }

            const authInterval = setInterval(async () => {
                try {
                    // If user closed the window, check session once and stop polling
                    if (authWindow.closed) {
                        clearInterval(authInterval);
                        const { data: sessionData } = await supabaseClient.auth.getSession();
                        const session = sessionData?.session;
                        if (session) {
                            console.log("Login successful!", session.user);
                            // Reload to refresh app state with new session
                            window.location.reload();
                        } else {
                            console.warn("Auth window closed but no session found.");
                        }
                    }
                } catch (e) {
                    console.error("Error while checking auth session:", e);
                    clearInterval(authInterval);
                }
            }, 1000);

            return { success: true };
        } catch (err) {
            console.error('handleGoogleLogin failed:', err);
            if (window.showApiError) window.showApiError(`Sign-in failed: ${err.message || err}`);
            return { error: err };
        }
    };
    if (loginGoogleBtn) loginGoogleBtn.onclick = () => handleGoogleLogin();
    if (loginDiscordBtn) loginDiscordBtn.onclick = () => supabaseClient.auth.signInWithOAuth({ provider: 'discord' });
    if (signOutBtn) signOutBtn.onclick = () => supabaseClient.auth.signOut();

    const saved = await (storage.loadSettings ? storage.loadSettings().catch(()=>({})) : {});
    config = { ...config, ...saved };
    if(!Array.isArray(config.fallbackChain)) config.fallbackChain = [];
    if(!Array.isArray(config.expressionLinks)) config.expressionLinks = [];

    initTokenizer();

    try {
        if (window.live2dManager && typeof window.live2dManager.init === 'function') {
            window.live2dManager.init();
        }
    } catch (e) { console.warn('Live2D manager init failed:', e); }

    populateSettingsUI();
    applyVisualSettings();
    setupNavigation();
    renderApiSettingsFields('api-config-container', config); 
    renderApiSettingsFields('char-api-settings-container', config); 
    const convs = storage.db ? await storage.getConversations() : [];
    if (convs && convs.length > 0) loadConversation(convs[0].id);
    else startNewChat();
    renderCharacterGrid();
    setupEventListeners();
    renderFallbackList();

    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('active')) updateStorageUsageIndicator();
});

function setupNavigation() {
    const sidebar = document.getElementById('sidebar');
    const navToggle = document.getElementById('nav-toggle');
    const closeNav = document.getElementById('close-nav');
    const gearToggle = document.getElementById('gear-toggle');
    const gearMenu = document.getElementById('gear-menu');
    const toggleMenu = () => {
        sidebar.classList.toggle('active');
        if (sidebar.classList.contains('active')) updateStorageUsageIndicator();
    };
    navToggle.addEventListener('click', toggleMenu);
    closeNav.addEventListener('click', toggleMenu);
    gearToggle.addEventListener('click', () => {
        gearMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!gearToggle.contains(e.target) && !gearMenu.contains(e.target)) {
            gearMenu.classList.add('hidden');
        }
    });
    document.querySelectorAll('.nav-links li[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            if (viewId === 'view-create') {
                resetCreateForm();
            }
            switchView(viewId);
            sidebar.classList.remove('active');
        });
    });
    document.getElementById('open-settings-btn').addEventListener('click', () => {
        document.getElementById('settings-overlay').classList.remove('hidden');
        sidebar.classList.remove('active');
    });
}

async function updateStorageUsageIndicator() {
    const el = document.getElementById('storage-used');
    if (!el) return;
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const usedMB = (estimate.usage || 0) / (1024 * 1024);
            const quotaGB = (estimate.quota || 0) / (1024 * 1024 * 1024);
            el.innerText = `${usedMB.toFixed(3)} MB / ${quotaGB.toFixed(3)} GB`;
        } else {
            el.innerText = 'N/A';
        }
    } catch (e) { el.innerText = 'N/A'; }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    const activeLi = document.querySelector(`.nav-links li[data-view="${viewId}"]`);
    if(activeLi) activeLi.classList.add('active');
    if (viewId === 'view-characters') renderCharacterGrid();
    if (viewId === 'view-previous') renderPreviousChats();

    const gearToggleEl = document.getElementById('gear-toggle');
    if (gearToggleEl) {
        if (viewId === 'view-chat') {
            gearToggleEl.style.display = '';
        } else {
            gearToggleEl.style.display = 'none';
            const gearMenu = document.getElementById('gear-menu');
            if (gearMenu) gearMenu.classList.add('hidden');
        }
    }
}

function setupEventListeners() {
    document.getElementById('send-btn').addEventListener('click', handleSendMessage);
    document.getElementById('user-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    });
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay').classList.add('hidden');
        });
    });
    document.getElementById('save-settings-btn').addEventListener('click', saveGlobalSettings);
    document.getElementById('wipe-data-btn').addEventListener('click', () => { if(confirm("Destroy data?")) storage.wipeAll(); });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            const targetTab = e.target.dataset.tab;
            document.getElementById(targetTab).classList.add('active');
        });
    });
    document.querySelectorAll('input[name="apiSelection"]').forEach(r => r.addEventListener('change', () => {
        renderApiSettingsFields('api-config-container', config);
    }));
    document.getElementById('char-add-trigger-btn').addEventListener('click', addCharTrigger);
    
    // NEW: Expression Trigger Listeners
    if(document.getElementById('char-add-exp-btn')) {
        document.getElementById('char-add-exp-btn').addEventListener('click', addExpressionLink);
    }
    if(document.getElementById('refresh-live2d-list')) {
        document.getElementById('refresh-live2d-list').addEventListener('click', populateLive2DDropdown);
    }

    document.getElementById('char-add-regex-btn').addEventListener('click', addRegexRule);
    document.getElementById('save-character-btn').addEventListener('click', handleCreateCharacter);
    ['fontSize', 'msgWidth', 'msgOpacity'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            config[id] = e.target.value;
            applyVisualSettings();
        });
    });
    
    document.getElementById('char-system-prompt').addEventListener('input', updateTokenCounts);
    
    const ta = document.getElementById('user-input');
    const MAX_TA_HEIGHT = 150; 
    function autoResizeTextarea() {
        if (!ta) return;
        // Only adjust if height would change to avoid layout thrash
        const prevHeight = ta.style.height ? parseInt(ta.style.height) : 0;
        // Use scrollHeight but avoid setting to 'auto' unless necessary
        const neededHeight = Math.min(ta.scrollHeight, MAX_TA_HEIGHT);
        if (prevHeight !== neededHeight) {
            ta.style.height = neededHeight + 'px';
            ta.style.overflowY = (ta.scrollHeight > MAX_TA_HEIGHT) ? 'auto' : 'hidden';
        }
    }
    if (ta) {
        autoResizeTextarea();
        ta.addEventListener('input', autoResizeTextarea);
        ta.addEventListener('focus', autoResizeTextarea);
    }

    const openCharSettingsBtn = document.getElementById('open-character-settings');
    if (openCharSettingsBtn) {
        openCharSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const overlay = document.getElementById('character-settings-overlay');
            if (overlay) overlay.classList.remove('hidden');
            const settingsOverlay = document.getElementById('settings-overlay');
            if (settingsOverlay) settingsOverlay.classList.add('hidden');
        });
    }

    document.getElementById('gear-new-chat').addEventListener('click', async () => {
        document.getElementById('gear-menu').classList.add('hidden');
        startNewChat();
    });
    document.getElementById('gear-restart-chat').addEventListener('click', async () => {
        document.getElementById('gear-menu').classList.add('hidden');
        const msgs = await storage.getMessages(currentChatId);
        if (msgs.length > 1) {
            for (let i = 1; i < msgs.length; i++) {
                await storage.deleteMessage(msgs[i].id);
            }
        }
        document.getElementById('chat-messages').innerHTML = '';
        if (msgs.length > 0) addMessageToUI(msgs[0]);
    });
    document.getElementById('gear-modify-system').addEventListener('click', () => {
        document.getElementById('gear-menu').classList.add('hidden');
        openModifySystemModal();
    });

    document.getElementById('add-fallback-btn').addEventListener('click', openNodeModal);
    document.getElementById('close-node-modal').addEventListener('click', () => {
        document.getElementById('node-config-modal').classList.add('hidden');
    });
    document.getElementById('save-node-btn').addEventListener('click', saveFallbackNode);
    document.getElementById('save-resilience-btn').addEventListener('click', saveGlobalSettings);
    
    document.querySelectorAll('#node-provider-pills .pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#node-provider-pills .pill').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const provider = e.target.dataset.val;
            document.getElementById('node-base-url').value = PROVIDER_PRESETS[provider].baseUrl;
            document.getElementById('node-model').value = PROVIDER_PRESETS[provider].placeholderModel;
        });
    });

    // Live2D dropzone within Create Character view
    const liveDrop = document.getElementById('char-live2d-dropzone');
    const liveInput = document.getElementById('char-live2d-file');
    const liveFileName = document.getElementById('char-live2d-filename');

    if (liveInput) {
        liveInput.addEventListener('change', async () => {
            const f = liveInput.files[0];
            if (!f) return;
            if (!f.name.endsWith('.zip')) { alert("Please provide a .zip file"); return; }
            charStagedLive2DFile = f;
            liveFileName.innerText = f.name;
            // convert to data url immediately for saving with character
            try {
                charStagedLive2DDataUrl = await fileToBase64(f);
            } catch (e) {
                console.error("Failed reading live2d file:", e);
            }
        });
    }
    if (liveDrop) {
        liveDrop.ondragover = e => { e.preventDefault(); liveDrop.classList.add('dragover'); };
        liveDrop.ondragleave = e => { e.preventDefault(); liveDrop.classList.remove('dragover'); };
        liveDrop.ondrop = async e => {
            e.preventDefault(); liveDrop.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                const f = e.dataTransfer.files[0];
                if (!f.name.endsWith('.zip')) { alert("Please provide a .zip file"); return; }
                charStagedLive2DFile = f;
                liveFileName.innerText = f.name;
                try {
                    charStagedLive2DDataUrl = await fileToBase64(f);
                } catch (err) { console.error(err); }
            }
        };
        liveDrop.onclick = () => liveInput && liveInput.click();
    }
}

function renderApiSettingsFields(containerId, dataSource) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let provider = dataSource.apiProvider;
    const radio = document.querySelector('input[name="apiSelection"]:checked');
    if (radio && containerId === 'api-config-container') provider = radio.value;
    container.innerHTML = '';
    const createInput = (label, id, val, type='text') => `
        <div class="field">
            <label>${label}</label>
            <input type="${type}" id="${id}" value="${val !== undefined ? val : ''}">
        </div>
    `;
    let html = '';
    if (containerId === 'api-config-container') {
        if (provider === 'openai') {
            html += createInput('API Key', 'apiKey', dataSource.apiKey, 'password');
            html += createInput('Base URL', 'baseUrl', dataSource.baseUrl || '', 'text');
            html += createInput('Model', 'model', dataSource.model);
            html += createInput('Rep. Penalty', 'repPen', dataSource.repetitionPenalty, 'number');
        } else if (provider === 'gemini') {
            html += createInput('Gemini Key', 'gemKey', dataSource.geminiKey, 'password');
            html += createInput('Model', 'gemModel', dataSource.geminiModel || 'gemini-1.5-flash');
        } else if (provider === 'cohere') {
            html += createInput('Cohere Key', 'cohKey', dataSource.cohereKey, 'password');
        }
        html += createInput('Temperature', 'temp', dataSource.temperature, 'number');
        html += createInput('Top K', 'topK', (dataSource.topK !== undefined ? dataSource.topK : config.topK), 'number');
        html += createInput('Max Tokens', 'maxTokens', dataSource.maxTokens, 'number');
    } 
    container.innerHTML = html;
}

/* -------------------------------------------------------------------------- */
/*                            FALLBACK / RESILIENCE                           */
/* -------------------------------------------------------------------------- */

function openNodeModal() {
    document.getElementById('node-config-modal').classList.remove('hidden');
    document.getElementById('node-name').value = '';
    document.getElementById('node-api-key').value = '';
    const def = PROVIDER_PRESETS['openai'];
    document.getElementById('node-base-url').value = def.baseUrl;
    document.getElementById('node-model').value = def.placeholderModel;
    document.querySelectorAll('#node-provider-pills .pill').forEach(b => b.classList.remove('active'));
    document.querySelector('#node-provider-pills .pill[data-val="openai"]').classList.add('active');
}

function saveFallbackNode() {
    const provider = document.querySelector('#node-provider-pills .active').dataset.val;
    const node = {
        id: Date.now(),
        name: document.getElementById('node-name').value || `${provider.toUpperCase()} Backup`,
        providerType: provider,
        baseUrl: document.getElementById('node-base-url').value,
        model: document.getElementById('node-model').value,
        apiKey: document.getElementById('node-api-key').value,
        params: {
            temperature: parseFloat(document.getElementById('node-temp').value) || 0.7,
            top_p: parseFloat(document.getElementById('node-top-p').value) || 1.0,
            top_k: parseInt(document.getElementById('node-top-k').value) || 40
        },
        triggers: {
            codes: document.getElementById('node-trigger-codes').value,
            timeout: parseInt(document.getElementById('node-trigger-timeout').value) || 15000
        }
    };
    config.fallbackChain.push(node);
    renderFallbackList();
    document.getElementById('node-config-modal').classList.add('hidden');
}

function renderFallbackList() {
    const list = document.getElementById('fallback-chain-list');
    list.innerHTML = '';
    if (config.fallbackChain.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#666;font-style:italic;">No fallback nodes configured.</div>';
        return;
    }
    config.fallbackChain.forEach((node, idx) => {
        const el = document.createElement('div');
        el.className = 'fallback-node';
        el.innerHTML = `
            <div class="node-info">
                <div class="node-title">
                    <span style="background:#333;padding:2px 6px;border-radius:4px;font-size:0.7em;">${idx+1}</span>
                    ${node.name}
                </div>
                <div class="node-subtitle">${node.providerType} • ${node.model}</div>
            </div>
            <div class="node-actions">
                <button class="node-action-btn" onclick="moveFallback(${idx}, -1)">${ICONS.up}</button>
                <button class="node-action-btn" onclick="moveFallback(${idx}, 1)">${ICONS.down}</button>
                <button class="node-action-btn delete" onclick="deleteFallback(${idx})">${ICONS.trash}</button>
            </div>
        `;
        list.appendChild(el);
    });
}

window.moveFallback = (idx, dir) => {
    if (idx + dir < 0 || idx + dir >= config.fallbackChain.length) return;
    const temp = config.fallbackChain[idx];
    config.fallbackChain[idx] = config.fallbackChain[idx + dir];
    config.fallbackChain[idx + dir] = temp;
    renderFallbackList();
};

window.deleteFallback = (idx) => {
    config.fallbackChain.splice(idx, 1);
    renderFallbackList();
};

/* -------------------------------------------------------------------------- */
/*                                CORE ENGINE                                 */
/* -------------------------------------------------------------------------- */

async function handleSendMessage() {
    const input = document.getElementById('user-input');
    let originalText = input.value.trim();
    if (!originalText) return;
    input.value = '';
    const uid = `${currentChatId}-${Date.now()}`;
    const userMsg = { id: uid, chatId: currentChatId, sender: 'user', content: originalText, timestamp: Date.now() };
    addMessageToUI(userMsg);
    await storage.saveMessage(userMsg);
    try { CloudSync.push(); } catch(e) { /* noop */ }

    const aid = `${currentChatId}-${Date.now()}-ai`;
    // Use a sentinel token so UI can render a styled loader element instead of plain '...'
    const loaderMsg = { id: aid, chatId: currentChatId, sender: 'ai', content: '__LOADING__', timestamp: Date.now() };
    addMessageToUI(loaderMsg);

    try {
        let responseText = await executeResilientRequestSequence(originalText);
        
        // Triggers Logic (Background + Expressions)
        responseText = checkTriggers(responseText);

        document.querySelector(`.message-row[data-id="${aid}"]`).remove();
        const aiMsg = { id: aid, chatId: currentChatId, sender: 'ai', content: responseText, timestamp: Date.now() };
        addMessageToUI(aiMsg);
        await storage.saveMessage(aiMsg);
        try { CloudSync.push(); } catch(e) { /* noop */ }
    } catch (err) {
        console.error(err);

        const jokes = [
            "The NPC forgot their line and is awkwardly staring at the camera.",
            "Error: Skill issue.",
            "We’re protecting the canon from whatever that was.",
            "Even an unfeeling machine has to draw the line somewhere.",
            "The NPC you were talking to has blocked you. Just kidding (mostly).",
            "The narrator went on strike—or maybe you’re just boring.",
            "Character development not found. Please try being more interesting.",
            "Something went wrong. Don't report it: we don't care."
        ];

        const loader = document.querySelector(`.message-row[data-id="${aid}"] .message-content`);
        if (loader) {
            // Immediately show a terse failure marker (keeps loader area visible)
            loader.innerText = "Failed: " + (err && err.message ? err.message : 'Unknown error');

            // After 5s, if the loader area is still present, replace with a random joke in italics
            setTimeout(() => {
                // If the loader was already removed or replaced by a successful response, do nothing
                const stillPresent = document.querySelector(`.message-row[data-id="${aid}"] .message-content`);
                if (!stillPresent) return;
                // Choose a random joke and render as italic markdown/html
                const joke = jokes[Math.floor(Math.random() * jokes.length)];
                try {
                    stillPresent.innerHTML = converter ? converter.makeHtml(`*${joke}*`) : `<em>${joke}</em>`;
                } catch (e) {
                    stillPresent.innerHTML = `<em>${joke}</em>`;
                }
            }, 5000);
        }
    }
}

// Prepare the execution plan (Primary -> Fallbacks)
async function executeResilientRequestSequence(userText) {
    let msgs = await storage.getMessages(currentChatId);
    const windowSize = parseInt(config.contextWindow) || 25;
    const shiftRate = Math.max(1, parseInt(config.contextShiftRate || 1));

    // Ensure token counts reflect the latest stored messages before building the API history.
    // This forces a reprocessing of the context token calculation whenever a request sequence begins.
    try { if (window && typeof window.updateTokenCounts === 'function') await window.updateTokenCounts(); } catch (e) { console.error('updateTokenCounts failed during request sequence', e); }

    // Keep all messages in storage (no automatic deletion).
    // We will assemble history below to send to the API while preserving the first greeting message.

    // Build history to send to the model:
    // - Always include the very first message (greeting) if it exists
    // - Include the most recent `windowSize` messages
    // - Avoid duplicating the first message if it's already within the recent slice
    let history = [];
    if (!msgs || msgs.length === 0) {
        history = [];
    } else {
        const first = msgs[0];
        const recent = msgs.slice(-windowSize);
        // If the recent slice already starts with the first message (chat is short), use recent as-is
        if (recent.length > 0 && recent[0].id === first.id) {
            history = recent;
        } else {
            history = [first, ...recent];
        }
    }
    const primaryNode = buildPrimaryNodeFromConfig();
    const executionPlan = [primaryNode, ...config.fallbackChain];

    let system = (config.systemPrompt || '')
        .replace(/{{char}}/g, config.aiName)
        .replace(/{{user}}/g, config.userName);

    // If using Expression triggers, inject them into the system prompt automatically?
    // Optional feature: You can uncomment below if you want the system to know its triggers.
    /*
    if (config.expressionLinks && config.expressionLinks.length > 0) {
        const trigs = config.expressionLinks.map(l => l.trigger).join(', ');
        system += `\n[Live2D Instructions] You can perform actions by including these tags in your response: ${trigs}.`;
    }
    */
    
    const processedMessages = history.map(m => {
        if(m.sender === 'user') return { ...m, content: applyInputTemplate(m.content) };
        return m;
    });

    return await attemptNode(executionPlan, 0, userText, processedMessages, system);
}

function buildPrimaryNodeFromConfig() {
    let key = '';
    let baseUrl = '';
    let model = '';
    const prov = config.apiProvider;

    if (prov === 'openai') {
        key = config.apiKey;
        baseUrl = config.baseUrl || PROVIDER_PRESETS.openai.baseUrl;
        model = config.model;
    } else if (prov === 'gemini') {
        key = config.geminiKey;
        baseUrl = PROVIDER_PRESETS.google.baseUrl;
        model = config.geminiModel;
    } else if (prov === 'cohere') {
        key = config.cohereKey;
        baseUrl = 'https://api.cohere.ai/v1';
        model = '';
    }

    return {
        name: "Primary Settings",
        providerType: prov,
        apiKey: key,
        baseUrl: baseUrl,
        model: model,
        params: {
            temperature: config.temperature,
            top_p: config.topP,
            repetition_penalty: config.repetitionPenalty,
            top_k: config.topK,
            max_tokens: config.maxTokens
        },
        triggers: {
            codes: "429, 500, 502, 503",
            timeout: 25000 
        }
    };
}

async function attemptNode(plan, index, userText, history, systemPrompt) {
    if (index >= plan.length) {
        throw new Error("All API nodes failed. Please check configurations.");
    }
    const node = plan[index];
    console.log(`[Attempt ${index+1}/${plan.length}] Using: ${node.name} (${node.providerType})`);
    try {
        const responseData = await executeRequestForNode(node, userText, history, systemPrompt);
        return responseData;
    } catch (error) {
        console.warn(`[Fail] Node '${node.name}' failed: ${error.message}`);
        const shouldCycle = checkFailoverTriggers(node, error);
        if (shouldCycle) {
            console.log("-> Switching to next fallback...");
            return attemptNode(plan, index + 1, userText, history, systemPrompt);
        } else {
            throw error; 
        }
    }
}

function checkFailoverTriggers(node, error) {
    if (error.message === "TRIGGER_TIMEOUT" || error.message === "TRIGGER_STATUS") return true;
    const codes = (node.triggers?.codes || "").split(',').map(c => parseInt(c.trim()));
    const match = error.message.match(/Status (\d+)/);
    if (match) {
        const status = parseInt(match[1]);
        if (codes.includes(status)) return true;
    }
    if (error.message.includes("NetworkError") || error.message.includes("Failed to fetch")) return true;
    return false;
}

async function executeRequestForNode(node, currentInput, history, systemPrompt) {
    const { providerType, apiKey, baseUrl, model } = node;
    // sanitize numeric params strictly
    const params = node.params || {};
    const triggers = node.triggers || {};
    const sanitizedParams = {
        temperature: parseFloat(params.temperature) || 0.0,
        top_p: parseFloat(params.top_p) || 1.0,
        repetition_penalty: parseFloat(params.repetition_penalty) || (params.repetition_penalty === 0 ? 0 : 1.0),
        top_k: parseInt(params.top_k || params.topK || 0, 10) || 0,
        max_tokens: parseInt(params.max_tokens || params.maxTokens || 0, 10) || 0
    };

    const isMissingKey = !apiKey || String(apiKey).trim() === '';
    const isCustomProxy = providerType === 'openai' && baseUrl && model && baseUrl !== PROVIDER_PRESETS.openai.baseUrl;

    if (isMissingKey && !isCustomProxy) {
        try {
            const wsMessages = [
                { role: 'system', content: systemPrompt || '' },
                ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content })),
                { role: 'user', content: currentInput }
            ];
            const completion = await websim.chat.completions.create({ messages: wsMessages });
            return completion.content || '';
        } catch (err) {
            console.warn('websim fallback failed:', err);
            // surface a friendly transient error to the user with copy button
            if (window && typeof window.showApiError === 'function') {
                const details = (err && err.message) ? `${err.message}` : String(err);
                window.showApiError(`Websim fallback failed: ${details}`);
            }
            throw err;
        }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), triggers.timeout || 20000);

    let url = baseUrl;
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (providerType === 'openai' || providerType === 'openrouter') {
        if (!url.endsWith('/chat/completions')) {
            url = url.replace(/\/$/, '') + '/chat/completions';
        }
        headers['Authorization'] = `Bearer ${apiKey}`;
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content }))
        ];
        
        body = {
            model: model,
            messages: messages,
            temperature: sanitizedParams.temperature,
            max_tokens: sanitizedParams.max_tokens || config.maxTokens,
            top_p: sanitizedParams.top_p,
            repetition_penalty: sanitizedParams.repetition_penalty,
            top_k: sanitizedParams.top_k
        };
    }
    else if (providerType === 'google') {
        url = `${baseUrl}/${model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`;
        const contents = history.map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));
        body = {
            contents: contents,
            generationConfig: {
                temperature: params.temperature,
                maxOutputTokens: params.max_tokens || config.maxTokens,
                topP: params.top_p,
                topK: params.top_k || 40
            },
            system_instruction: { parts: [{ text: systemPrompt }] }
        };
    }
    else if (providerType === 'cohere') {
        url = 'https://api.cohere.ai/v1/chat'; 
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = {
            message: applyInputTemplate(currentInput), 
            chat_history: history.slice(0, -1).map(m => ({
                role: m.sender === 'user' ? 'USER' : 'CHATBOT',
                message: m.content
            })),
            preamble: systemPrompt,
            temperature: params.temperature,
            p: params.top_p
        };
    }

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const codeList = (triggers.codes || "").split(',').map(n => parseInt(n, 10));
        if (codeList.includes(res.status)) {
            throw new Error(`TRIGGER_STATUS: Status ${res.status}`);
        }

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`API Error Status ${res.status}: ${txt}`);
        }

        const d = await res.json();
        if (providerType === 'google') return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (providerType === 'cohere') return d.text || "";
        return d.choices?.[0]?.message?.content || "";

    } catch (err) {
        clearTimeout(timeoutId);
        // show API error transient toast with copy option
        try {
            const details = (err && err.message) ? `${err.message}` : String(err);
            if (window && typeof window.showApiError === 'function') {
                window.showApiError(`API Request failed: ${details}`);
            }
        } catch(e) { console.error('Failed to show API error:', e); }
        if (err.name === 'AbortError') {
            // also surface timeout specifically
            if (window && typeof window.showApiError === 'function') {
                window.showApiError('Request timed out (TRIGGER_TIMEOUT)');
            }
            throw new Error("TRIGGER_TIMEOUT");
        }
        throw err;
    }
}

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                */
/* -------------------------------------------------------------------------- */

function applyInputTemplate(text) {
    if (!config.inputTemplate || !config.inputTemplate.includes('{{text}}')) return text;
    return config.inputTemplate.replace(/{{text}}/g, text);
}

/* API error toast helper: display transient red error with copy button for 30s */
window.showApiError = function(message, options = {}) {
    try {
        const container = document.getElementById('api-error-container');
        if (!container) return;
        const id = `api-err-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const toast = document.createElement('div');
        toast.className = 'api-error-toast';
        toast.id = id;
        const msg = document.createElement('div');
        msg.className = 'msg';
        msg.innerText = message || 'Unknown API error';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-error-btn';
        copyBtn.innerText = 'Copy';
        copyBtn.title = 'Copy error details';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(message || '').then(() => {
                copyBtn.classList.add('copied');
                copyBtn.innerText = 'Copied';
                setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerText = 'Copy'; }, 2000);
            }).catch(() => {
                copyBtn.innerText = 'Failed';
                setTimeout(() => { copyBtn.innerText = 'Copy'; }, 2000);
            });
        };
        const ts = document.createElement('div');
        ts.className = 'timestamp';
        const tnow = new Date();
        ts.innerText = `${tnow.toLocaleTimeString()}`;
        meta.appendChild(copyBtn);
        meta.appendChild(ts);
        toast.appendChild(msg);
        toast.appendChild(meta);
        container.appendChild(toast);
        // allow pointer events for the toast to enable copy button
        toast.style.pointerEvents = 'auto';
        // animate in
        requestAnimationFrame(() => toast.classList.add('show'));
        // auto-remove after 30s
        const removeAfter = (options.durationSeconds && Number(options.durationSeconds)) ? options.durationSeconds * 1000 : 30000;
        const timeout = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.remove(); }, 220);
        }, removeAfter);
        // allow manual removal on click outside button
        toast.addEventListener('click', (e) => {
            if (e.target !== copyBtn) {
                clearTimeout(timeout);
                toast.classList.remove('show');
                setTimeout(() => { toast.remove(); }, 180);
            }
        });
    } catch (e) { console.error('showApiError failed', e); }
};

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function addCharTrigger() {
    const raw = document.getElementById('char-trigger-input').value;
    const regex = /\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]/;
    const match = raw.match(regex);
    if (match) {
        newCharTriggers.push({ trigger: match[1], url: match[2], type: match[3], duration: parseInt(match[4]) });
        renderCharTriggers();
        document.getElementById('char-trigger-input').value = '';
    }
}

function renderCharTriggers() {
    const list = document.getElementById('char-trigger-list');
    list.innerHTML = newCharTriggers.map((t, i) => `
        <div>
            <span>"${t.trigger}" -> ${t.type}</span>
            <button onclick="removeCharTrigger(${i})" style="color:red;background:none;border:none;">X</button>
        </div>
    `).join('');
}

window.removeCharTrigger = (i) => {
    newCharTriggers.splice(i, 1);
    renderCharTriggers();
}

// --------------------------------------------------------------------------
// NEW: Expression Trigger Logic (REPLACED / UPDATED)
// --------------------------------------------------------------------------

/**
 * Populates the dropdown menu in Character Creator with available 
 * expressions and motions from the currently loaded Live2D model.
 * Matches logic in live2dManager.js > populateManualMapper
 */
function populateLive2DDropdown() {
    const select = document.getElementById('char-exp-select');
    // Guard clause if the UI element doesn't exist in the DOM
    if (!select) return; 
    
    // Reset Dropdown
    select.innerHTML = '<option value="">Select Animation...</option>';
    
    // Prefer raw file list exposed by the manager
    if (window.Live2D_API && typeof window.Live2D_API.getRawFileList === 'function') {
        const files = window.Live2D_API.getRawFileList();
        if (!files || files.length === 0) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.innerText = "No files found in model";
            select.appendChild(opt);
            return;
        }

        files.forEach(item => {
            const opt = document.createElement('option');
            // Clean name for display (remove extensions)
            const cleanName = item.f.split('/').pop().replace(/\.motion3\.json$|\.exp3\.json$|\.json$|\.mtn$/i, '');
            opt.value = cleanName;
            opt.innerText = `[${item.type.substr(0,3).toUpperCase()}] ${cleanName}`;
            select.appendChild(opt);
        });

        // Add Reset Option
        const resetOpt = document.createElement('option');
        resetOpt.value = "RESET";
        resetOpt.innerText = ">> RESET FACE <<";
        select.appendChild(resetOpt);
        return;
    }
    
    // Fallback: use allowed lists if raw list isn't available
    if (window.Live2D_API && typeof window.Live2D_API.getAvailable === 'function') {
        const avail = window.Live2D_API.getAvailable();
        let hasItems = false;
        
        if (avail.expressions && avail.expressions.length > 0) {
            const optGroup = document.createElement('optgroup');
            optGroup.label = "Expressions";
            avail.expressions.sort().forEach(name => {
                const opt = document.createElement('option');
                opt.value = name; 
                opt.innerText = `[EXP] ${name}`; // Matches Manager Style
                optGroup.appendChild(opt);
            });
            select.appendChild(optGroup);
            hasItems = true;
        }
        
        if (avail.motions && avail.motions.length > 0) {
            const optGroup = document.createElement('optgroup');
            optGroup.label = "Motions";
            avail.motions.sort().forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.innerText = `[MOT] ${name}`; // Matches Manager Style
                optGroup.appendChild(opt);
            });
            select.appendChild(optGroup);
            hasItems = true;
        }
        
        const resetGroup = document.createElement('optgroup');
        resetGroup.label = "System";
        const resetOpt = document.createElement('option');
        resetOpt.value = "RESET";
        resetOpt.innerText = "RESET (Neutral Face)";
        resetGroup.appendChild(resetOpt);
        select.appendChild(resetGroup);

        if (!hasItems) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.innerText = "(Model loaded, but no files found)";
            select.appendChild(opt);
        }
    } else {
        // Fallback if API isn't present
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.innerText = "No model loaded / API unavailable";
        select.appendChild(opt);
    }
}

/**
 * Adds the trigger/action pair to the temporary editing list.
 */
function addExpressionLink() {
    const triggerInput = document.getElementById('char-exp-trigger');
    const select = document.getElementById('char-exp-select');
    
    const triggerText = triggerInput.value.trim();
    const action = select.value;
    
    if (!triggerText || !action) {
        alert("Please enter a trigger word and select an animation from the list.");
        return;
    }
    
    // Prevent duplicates
    const exists = newExpressionLinks.some(l => l.trigger.toLowerCase() === triggerText.toLowerCase());
    if(exists) {
        alert("This trigger word is already defined.");
        return;
    }

    newExpressionLinks.push({ trigger: triggerText, action: action });
    renderExpressionLinks();
    triggerInput.value = '';
    // select.value = ''; // Optional: Keep selection or clear it
}

/**
 * Renders the list of active triggers in the UI.
 */
function renderExpressionLinks() {
    const list = document.getElementById('char-exp-list');
    if(!list) return;
    
    list.innerHTML = newExpressionLinks.map((t, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:4px 8px; margin-bottom:4px; border-radius:4px; border:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:0.9em; overflow:hidden; text-overflow:ellipsis;">
                <span style="color:var(--accent-color); font-weight:bold;">[${t.trigger}]</span> 
                <span style="color:#aaa;">⮕</span> 
                <span style="font-family:monospace;">${t.action}</span>
            </div>
            <button onclick="removeExpressionLink(${i})" style="color:#ff6b6b; background:none; border:none; cursor:pointer; font-weight:bold; padding:0 5px;">✕</button>
        </div>
    `).join('');
}

/**
 * Checks text output for trigger words and fires Live2D animations via API.
 */
function checkTriggers(text) {
    let outputText = text;

    // 1. Background Triggers (Existing logic)
    const lowerText = text.toLowerCase();
    (config.backgroundTriggers || []).forEach(t => {
        if (lowerText.includes(t.trigger.toLowerCase())) {
            const bg = document.getElementById('background-layer');
            bg.style.backgroundImage = `url("${t.url}")`;
            config.bgImage = t.url;
            storage.saveSettings(config).catch(err => console.error('Failed saving bg trigger:', err));
        }
    });

    // 2. Live2D Expression/Motion Triggers
    (config.expressionLinks || []).forEach(link => {
        // Escape special regex characters in the trigger word to prevent crashes
        const escapedTrigger = link.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Create a regex to match the trigger (case insensitive)
        const regex = new RegExp(escapedTrigger, 'i'); 
        
        if (regex.test(outputText)) {
            // Check if API is actually available before trying to play
            if (window.Live2D_API && typeof window.Live2D_API.play === 'function') {
                try {
                    window.Live2D_API.play(link.action);
                    console.log(`[Expression Triggered] Found "${link.trigger}" -> Playing "${link.action}"`);
                } catch (e) {
                    console.error(`[Live2D Error] Failed to play action "${link.action}":`, e);
                }
            } else {
                console.warn(`[Live2D Missing] Triggered "${link.trigger}" but Live2D_API is not loaded.`);
            }
            
            // Optional: Remove the trigger word from the displayed text?
            // outputText = outputText.replace(regex, ''); 
        }
    });

    return outputText;
}

window.removeExpressionLink = (i) => {
    newExpressionLinks.splice(i, 1);
    renderExpressionLinks();
}

function addRegexRule() {
    const pat = document.getElementById('char-regex-pattern').value;
    const rep = document.getElementById('char-regex-replace').value;
    if (pat) {
        newRegexRules.push({ regex: pat, replacement: rep });
        renderRegexRules();
        document.getElementById('char-regex-pattern').value = '';
        document.getElementById('char-regex-replace').value = '';
    }
}

function renderRegexRules() {
    const list = document.getElementById('char-regex-list');
    list.innerHTML = newRegexRules.map((r, i) => `
        <div>
            <span>/${r.regex}/ -> "${r.replacement}"</span>
            <button onclick="removeRegexRule(${i})" style="color:red;background:none;border:none;">X</button>
        </div>
    `).join('');
}

window.removeRegexRule = (i) => {
    newRegexRules.splice(i, 1);
    renderRegexRules();
}

function resetCreateForm() {
    editingCharacterId = null;
    document.getElementById('create-view-title').innerText = "Create Character";
    document.getElementById('save-character-btn').innerText = "Create Character";
    document.getElementById('char-name').value = '';
    document.getElementById('char-avatar-url').value = '';
    document.getElementById('char-description').value = '';
    document.getElementById('char-system-prompt').value = '';
    document.getElementById('char-initial-message').value = '';
    document.getElementById('char-bg-url').value = '';
    document.getElementById('char-trigger-input').value = '';
    document.getElementById('char-avatar-file').value = ''; 
    document.getElementById('char-bg-file').value = '';
    document.getElementById('char-input-template').value = '';
    document.getElementById('char-regex-pattern').value = '';
    document.getElementById('char-regex-replace').value = '';
    
    if(document.getElementById('char-exp-trigger')) document.getElementById('char-exp-trigger').value = '';
    
    newCharTriggers = [];
    newRegexRules = [];
    newExpressionLinks = []; // Reset expressions
    
    renderCharTriggers();
    renderRegexRules();
    renderExpressionLinks();
    populateLive2DDropdown(); // Populate dropdown on open

    // Ensure token counters are refreshed for cleared form
    updateCreateFieldToken('char-name', document.getElementById('char-name').value || '', 'token-name');
    updateCreateFieldToken('char-description', document.getElementById('char-description').value || '', 'token-desc');
    updateCreateFieldToken('char-system-prompt', document.getElementById('char-system-prompt').value || '', 'token-system');
    updateCreateFieldToken('char-initial-message', document.getElementById('char-initial-message').value || '', 'token-initial');
}

window.editCharacter = async (id, event) => {
    if(event) event.stopPropagation();
    const chars = await storage.getCharacters();
    const char = chars.find(c => c.id === id);
    if (!char) return;
    editingCharacterId = id;
    document.getElementById('create-view-title').innerText = "Edit Character";
    document.getElementById('save-character-btn').innerText = "Update Character";
    document.getElementById('char-name').value = char.name;
    document.getElementById('char-avatar-url').value = char.avatar.startsWith('data:') ? '' : char.avatar; 
    document.getElementById('char-description').value = char.description;
    document.getElementById('char-system-prompt').value = char.systemPrompt;
    document.getElementById('char-initial-message').value = char.parameters?.initialMessage || '';
    document.getElementById('char-bg-url').value = (char.bgImage && !char.bgImage.startsWith('data:')) ? char.bgImage : '';
    
    newCharTriggers = char.bgTriggers || [];
    renderCharTriggers();
    
    newExpressionLinks = char.expressionLinks || []; // Load expressions
    renderExpressionLinks();
    populateLive2DDropdown();
    
    document.getElementById('char-input-template').value = char.parameters?.inputTemplate || '';
    newRegexRules = char.parameters?.outputRegex || [];
    renderRegexRules();
    if (char.parameters) {
        document.getElementById('char-api-provider').value = char.parameters.apiProvider || 'openai';
        document.getElementById('char-model').value = char.parameters.model || '';
        document.getElementById('char-temp').value = char.parameters.temperature || 0.7;
        document.getElementById('char-tokens').value = char.parameters.maxTokens || 1000;
        document.getElementById('char-rep-pen').value = char.parameters.repetitionPenalty || 1.1;
        document.getElementById('char-top-p').value = char.parameters.topP || 1;
        document.getElementById('char-top-k').value = char.parameters.topK || 40;
    }
    switchView('view-create');
};

async function handleCreateCharacter() {
    const name = document.getElementById('char-name').value;
    if (!name) return alert("Name required");
    const avatarFile = document.getElementById('char-avatar-file').files[0];
    const avatarUrl = document.getElementById('char-avatar-url').value;
    let finalAvatar = avatarUrl;
    if (avatarFile) finalAvatar = await fileToBase64(avatarFile);
    const bgFile = document.getElementById('char-bg-file').files[0];
    const bgUrl = document.getElementById('char-bg-url').value;
    let finalBg = bgUrl;
    if (bgFile) finalBg = await fileToBase64(bgFile);

    // Live2D data: prefer freshly staged upload, otherwise preserve existing when editing
    let finalLive2D = charStagedLive2DDataUrl || null;
    if (editingCharacterId && !finalLive2D) {
        const oldChars = await storage.getCharacters();
        const oldChar = oldChars.find(c => c.id === editingCharacterId);
        if (oldChar && oldChar.live2dZip) finalLive2D = oldChar.live2dZip;
    }

    if (editingCharacterId) {
        const oldChars = await storage.getCharacters();
        const oldChar = oldChars.find(c => c.id === editingCharacterId);
        if(oldChar) {
            if (!finalAvatar) finalAvatar = oldChar.avatar;
            if (!finalBg) finalBg = oldChar.bgImage;
        }
    }
    if (!finalAvatar) finalAvatar = "https://ui-avatars.com/api/?name=" + name;
    const params = {
        apiProvider: document.getElementById('char-api-provider').value,
        model: document.getElementById('char-model').value,
        temperature: parseFloat(document.getElementById('char-temp').value) || 0.7,
        maxTokens: parseInt(document.getElementById('char-tokens').value) || 1000,
        repetitionPenalty: parseFloat(document.getElementById('char-rep-pen').value) || 1.1,
        topP: parseFloat(document.getElementById('char-top-p').value) || 1,
        topK: parseInt(document.getElementById('char-top-k').value) || 40,
        inputTemplate: document.getElementById('char-input-template').value,
        outputRegex: newRegexRules,
        initialMessage: document.getElementById('char-initial-message').value || ''
    };
    const character = {
        id: editingCharacterId || Date.now().toString(),
        name: name,
        description: document.getElementById('char-description').value,
        systemPrompt: document.getElementById('char-system-prompt').value,
        avatar: finalAvatar,
        bgImage: finalBg,
        bgTriggers: newCharTriggers,
        expressionLinks: newExpressionLinks, // Save expressions
        parameters: params,
        live2dZip: finalLive2D // store data URL of the uploaded ZIP if provided
    };
    await storage.saveCharacter(character);
    try { CloudSync.push(); } catch(e) { /* noop */ }
    alert(editingCharacterId ? "Character Updated!" : "Character Created!");
    // clear staged file after save
    charStagedLive2DFile = null;
    charStagedLive2DDataUrl = null;
    document.getElementById('char-live2d-filename').innerText = '';
    resetCreateForm();
    switchView('view-characters');
}

async function renderCharacterGrid() {
    const grid = document.getElementById('character-grid');
    grid.innerHTML = '';
    const chars = await storage.getCharacters();
    const defaultCard = document.createElement('div');
    defaultCard.className = 'character-card';
    defaultCard.innerHTML = `
        <div class="card-image" style="background-color: #34495e; display:flex; align-items:center; justify-content:center;">
            <span style="font-size:3em; color:white;">AI</span>
        </div>
        <div class="card-content">
            <div class="card-name">Default Assistant</div>
            <div class="card-desc">The standard AI configuration with your global settings.</div>
        </div>
    `;
    defaultCard.onclick = () => activateCharacter(null);
    grid.appendChild(defaultCard);
    chars.forEach(c => {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.innerHTML = `
            <div class="card-actions">
                <button class="card-btn edit" onclick="editCharacter('${c.id}', event)">${ICONS.edit}</button>
                <button class="card-btn delete" onclick="deleteCharacter('${c.id}', event)">${ICONS.trash}</button>
            </div>
            <div class="card-image" style="background-image: url('${c.avatar}')"></div>
            <div class="card-content">
                <div class="card-name">${c.name}</div>
                <div class="card-desc">${c.description}</div>
            </div>
        `;
        card.onclick = (e) => { if(!e.target.closest('button')) activateCharacter(c); };
        grid.appendChild(card);
    });
}

window.deleteCharacter = async (id, e) => {
    e.stopPropagation();
    if (confirm("Delete character?")) {
        await storage.deleteCharacter(id);
        renderCharacterGrid();
    }
};

async function activateCharacter(charObj) {
    if (charObj) {
        // If switching from a different character, ensure any previously loaded Live2D model is unloaded
        if (currentCharacterId && charObj.id !== currentCharacterId) {
            try {
                if (window.Live2D_API && typeof window.Live2D_API.unload === 'function') {
                    await window.Live2D_API.unload();
                }
            } catch (e) {
                console.warn('Live2D unload on switch failed:', e);
            }
        }

        currentCharacterId = charObj.id;
        config.aiName = charObj.name;
        config.systemPrompt = charObj.systemPrompt;
        config.bgImage = charObj.bgImage;
        config.backgroundTriggers = charObj.bgTriggers || [];
        config.expressionLinks = charObj.expressionLinks || []; // Load expressions into config
        config.characterAvatar = charObj.avatar || '';
        const p = charObj.parameters;
        if (p.apiProvider) config.apiProvider = p.apiProvider;
        if (p.model) config.model = p.model;
        if (p.temperature) config.temperature = p.temperature;
        if (p.maxTokens) config.maxTokens = p.maxTokens;
        config.inputTemplate = p.inputTemplate || '';
        config.outputRegex = p.outputRegex || [];
        config.initialMessage = p.initialMessage || '';

        // New: if character includes a saved Live2D ZIP (data URL), attempt to load it via Live2D manager
        if (charObj.live2dZip && window.Live2D_API && typeof window.Live2D_API.loadZipDataUrl === 'function') {
            try {
                // call with a lightweight progress callback to update console
                window.Live2D_API.loadZipDataUrl(charObj.live2dZip, (msg, pct) => {
                    console.log(`[Live2D Load] ${msg} ${pct || ''}`);
                }).catch(err => console.warn('Auto Live2D load failed:', err));
            } catch (e) {
                console.warn("Auto load Live2D failed:", e);
            }
        }

    } else {
        // Selecting the default assistant: unload any loaded Live2D model
        try {
            if (window.Live2D_API && typeof window.Live2D_API.unload === 'function') {
                await window.Live2D_API.unload();
            }
        } catch (e) {
            console.warn('Live2D unload when selecting default failed:', e);
        }

        currentCharacterId = null;
        const saved = await storage.loadSettings();
        config = { ...config, ...saved };
        config.inputTemplate = '';
        config.outputRegex = [];
        config.initialMessage = '';
        config.characterAvatar = '';
        config.expressionLinks = [];
    }
    applyVisualSettings();
    startNewChat();
    switchView('view-chat');
}

function populateSettingsUI() {
    ['userName', 'fontSize', 'msgWidth', 'msgOpacity'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = config[id];
    });
    // Top K global setting
    const topKEl = document.getElementById('topK');
    if (topKEl) topKEl.value = (config.topK !== undefined ? config.topK : 40);

    const cw = document.getElementById('contextWindow');
    if (cw) cw.value = config.contextWindow || 25;
    const csr = document.getElementById('contextShiftRate');
    if (csr) csr.value = (config.contextShiftRate !== undefined ? config.contextShiftRate : 1);
}

async function saveGlobalSettings() {
    const provider = document.querySelector('input[name="apiSelection"]:checked').value;
    config.apiProvider = provider;
    if (provider === 'openai') {
        config.apiKey = document.getElementById('apiKey').value;
        config.baseUrl = (document.getElementById('baseUrl') && document.getElementById('baseUrl').value) ? document.getElementById('baseUrl').value.trim() : '';
        config.model = document.getElementById('model').value;
        config.repetitionPenalty = parseFloat(document.getElementById('repPen').value);
    } else if (provider === 'gemini') {
        config.geminiKey = document.getElementById('gemKey').value;
        config.geminiModel = document.getElementById('gemModel').value;
    } else if (provider === 'cohere') {
        config.cohereKey = document.getElementById('cohKey').value;
    }
    config.temperature = parseFloat(document.getElementById('temp').value) || 0.0;
    // Read Top K global setting
    const topKVal = document.getElementById('topK') ? parseInt(document.getElementById('topK').value, 10) : undefined;
    if (!Number.isNaN(topKVal)) config.topK = topKVal;
    config.maxTokens = parseInt(document.getElementById('maxTokens').value, 10) || 0;
    config.userName = document.getElementById('userName').value;
    config.contextWindow = parseInt(document.getElementById('contextWindow').value, 10) || 25;
    config.contextShiftRate = parseInt(document.getElementById('contextShiftRate').value, 10) || 1;
    config.fontSize = document.getElementById('fontSize').value;
    config.msgWidth = document.getElementById('msgWidth').value;
    config.msgOpacity = document.getElementById('msgOpacity').value;

    await storage.saveSettings(config);
    try { CloudSync.push(); } catch(e) { /* noop */ }
    applyVisualSettings();
    document.getElementById('settings-overlay').classList.add('hidden');
}

function applyVisualSettings() {
    const root = document.documentElement;
    root.style.setProperty('--font-size', `${config.fontSize}px`);
    root.style.setProperty('--msg-width', `${config.msgWidth}%`);
    root.style.setProperty('--msg-user-bg', `rgba(52, 73, 94, ${config.msgOpacity / 100})`);
    root.style.setProperty('--msg-ai-bg', `rgba(44, 62, 80, ${config.msgOpacity / 100})`);
    const bgDiv = document.getElementById('background-layer');
    if (config.bgImage) {
        bgDiv.style.backgroundImage = `url("${config.bgImage}")`;
    } else {
        bgDiv.style.backgroundImage = 'none';
    }
}

async function startNewChat() {
    currentChatId = Date.now().toString();
    document.getElementById('chat-messages').innerHTML = '';
    const initialText = (config.initialMessage && config.initialMessage.trim()) ? config.initialMessage : `Hello ${config.userName}.`;
    const initMsg = { id: `${currentChatId}-init`, chatId: currentChatId, sender: 'ai', content: initialText, timestamp: Date.now() };
    addMessageToUI(initMsg);
    await storage.saveMessage(initMsg);
    try { CloudSync.push(); } catch(e) { /* noop */ }
    const tx = storage.db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    store.get(currentChatId).onsuccess = (e) => {
        const conv = e.target.result || { id: currentChatId, name: `Chat ${new Date().toLocaleTimeString()}`, createdAt: Date.now() };
        conv.systemPrompt = config.systemPrompt || '';
        conv.characterId = currentCharacterId || null;
        conv.characterAvatar = config.characterAvatar || '';
        store.put(conv);
    };
}

async function loadConversation(id) {
    currentChatId = id;
    const msgs = await storage.getMessages(id);
    document.getElementById('chat-messages').innerHTML = '';
    msgs.forEach(m => addMessageToUI(m));
    const tx = storage.db.transaction('conversations', 'readonly');
    tx.objectStore('conversations').get(id).onsuccess = (e) => {
        const conv = e.target.result;
        if (conv && conv.systemPrompt !== undefined) {
            config.systemPrompt = conv.systemPrompt;
        }
    };
    switchView('view-chat');
}

function applyOutputFilters(text) {
    if (!config.outputRegex || !Array.isArray(config.outputRegex) || config.outputRegex.length === 0) return text;
    let processed = text;
    config.outputRegex.forEach(rule => {
        try {
            const re = new RegExp(rule.regex, 'g');
            processed = processed.replace(re, rule.replacement || '');
        } catch(e) {
            console.error("Regex Error on rule:", rule, e);
        }
    });
    return processed;
}

function addMessageToUI(msgObj) {
    const container = document.getElementById('chat-messages');
    let existingRow = document.querySelector(`.message-row[data-id="${msgObj.id}"]`);
    if (existingRow) existingRow.remove();

    const row = document.createElement('div');
    row.className = `message-row ${msgObj.sender}`;
    row.dataset.id = msgObj.id;
    row.dataset.timestamp = (msgObj.timestamp || Date.now()).toString();

    // Special-case loader sentinel to render animated dots instead of text
    let contentToDisplay = applyOutputFilters(msgObj.content);

    // If this is the loading placeholder, render the loader markup directly
    let html;
    if (msgObj.content === '__LOADING__' && msgObj.sender === 'ai') {
        html = `<div class="loader-dots" aria-hidden="true"><span></span><span></span><span></span></div>`;
    } else {
        html = converter.makeHtml(contentToDisplay);

    }

    // Cache the pre-rendered HTML to avoid re-parsing markdown during scrolls
    row._virtual = {
        cachedHtml: html,
        sender: msgObj.sender,
        id: msgObj.id
    };

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = `
        <div class="message-icons">
            <button class="icon-btn" onclick="toggleEditMessage('${msgObj.id}')">${ICONS.edit}</button>
            <button class="icon-btn" onclick="reloadMessage('${msgObj.id}')">${ICONS.refresh}</button>
            <button class="icon-btn" onclick="deleteMessage('${msgObj.id}')">${ICONS.trash}</button>
        </div>
        <div class="sender-name">${msgObj.sender === 'user' ? config.userName : config.aiName}</div>
        <div class="message-content" id="content-${msgObj.id}" data-virtual="1"></div>
    `;
    row.appendChild(bubble);

    const existingRows = Array.from(container.querySelectorAll('.message-row'));
    if (existingRows.length === 0) {
        container.appendChild(row);
    } else {
        let inserted = false;
        const ts = Number(row.dataset.timestamp);
        for (let i = 0; i < existingRows.length; i++) {
            const rTs = Number(existingRows[i].dataset.timestamp || Date.now());
            if (rTs > ts) {
                container.insertBefore(row, existingRows[i]);
                inserted = true;
                break;
            }
        }
        if (!inserted) container.appendChild(row);
    }

    // Observe this row for intersection visibility; the observer will mount/unmount inner HTML
    if (window._messageIntersectionObserver) {
        window._messageIntersectionObserver.observe(row);
    } else {
        // Fallback: render immediately if observer not yet initialized
        const contentEl = row.querySelector('.message-content[data-virtual="1"]');
        if (contentEl) {
            contentEl.innerHTML = row._virtual.cachedHtml;
            processCodeBlocks(contentEl);
            contentEl.dataset.mounted = '1';
        }
    }
}

let virtualRenderScheduled = false;
const CHUNK_SIZE = 2000; 
function scheduleRenderVisibleMessages() {
    if (virtualRenderScheduled) return;
    virtualRenderScheduled = true;
    requestAnimationFrame(() => {
        renderVisibleMessages();
        virtualRenderScheduled = false;
    });
}

function renderVisibleMessages() {
    const win = document.getElementById('chat-window');
    const messages = Array.from(document.querySelectorAll('.message-row'));
    if (!win) return;

    const viewportTop = win.scrollTop;
    const viewportBottom = viewportTop + win.clientHeight;

    messages.forEach(row => {
        const contentEl = row.querySelector('.message-content[data-virtual="1"]');
        if (!contentEl) return;

        const rect = row.getBoundingClientRect();
        const containerRect = win.getBoundingClientRect();
        const rowTop = rect.top - containerRect.top + win.scrollTop;
        const rowBottom = rowTop + rect.height;

        const buffer = 300; 
        if ((rowBottom + buffer) >= viewportTop && (rowTop - buffer) <= viewportBottom) {
            if (!contentEl.dataset.mounted) {
                const v = row._virtual;
                if (!v) {
                    contentEl.innerHTML = '';
                    contentEl.dataset.mounted = '1';
                    return;
                }

                const textContent = stripHtml(v.html);
                if (textContent.length > CHUNK_SIZE) {
                    let chunkWrapper = contentEl.querySelector('.chunk-wrapper');
                    if (!chunkWrapper) {
                        chunkWrapper = document.createElement('div');
                        chunkWrapper.className = 'chunk-wrapper';
                        chunkWrapper.style.maxHeight = '300px';
                        chunkWrapper.style.overflow = 'hidden';
                        chunkWrapper.style.position = 'relative';
                        chunkWrapper.style.paddingRight = '8px';
                        const inner = document.createElement('div');
                        inner.className = 'chunk-inner';
                        chunkWrapper.appendChild(inner);
                        contentEl.appendChild(chunkWrapper);
                    }
                    const inner = chunkWrapper.querySelector('.chunk-inner');
                    const chunkIndex = 0; 
                    const start = chunkIndex * CHUNK_SIZE;
                    const end = Math.min(textContent.length, start + CHUNK_SIZE);
                    const chunkHtml = converter.makeHtml(escapeHtmlToMarkdown(textContent.slice(start, end)));
                    inner.innerHTML = chunkHtml;
                } else {
                    contentEl.innerHTML = v.html;
                }
                
                // Process code blocks to add copy buttons
                processCodeBlocks(contentEl);
                
                contentEl.dataset.mounted = '1';
            }
        } else {
            if (contentEl.dataset.mounted) {
                contentEl.innerHTML = '';
                delete contentEl.dataset.mounted;
            }
        }
    });
}

function processCodeBlocks(container) {
    const codeBlocks = container.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
        if (pre.dataset.processed) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.title = "Copy code";
        
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const codeText = pre.innerText;
            navigator.clipboard.writeText(codeText).then(() => {
                const originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = originalHtml;
                    copyBtn.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Copy failed:', err);
                copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
                copyBtn.classList.add('error');
                setTimeout(() => {
                    copyBtn.innerHTML = originalHtml;
                    copyBtn.classList.remove('error');
                }, 2000);
            });
        });
        
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(pre);
        pre.dataset.processed = '1';
    });
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function escapeHtmlToMarkdown(text) {
    const esc = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return esc;
}

(function setupMessageIntersectionObserver(){

    // IntersectionObserver to mount/unmount message HTML for performance
    const win = document.getElementById('chat-window');
    const observerOptions = {
        root: win || null,
        rootMargin: '200px',
        threshold: 0.01
    };

    const ioCallback = (entries) => {
        entries.forEach(entry => {
            const row = entry.target;
            const contentEl = row.querySelector('.message-content[data-virtual="1"]');
            if (!contentEl) return;
            if (entry.isIntersecting) {
                // Populate from cached HTML and process code blocks
                if (!contentEl.dataset.mounted) {
                    const v = row._virtual;
                    if (v && v.cachedHtml !== undefined) {
                        contentEl.innerHTML = v.cachedHtml;
                    } else {
                        contentEl.innerHTML = '';
                    }
                    processCodeBlocks(contentEl);
                    contentEl.dataset.mounted = '1';
                }
            } else {
                // Unmount to reduce memory and keep DOM light
                if (contentEl.dataset.mounted) {
                    contentEl.innerHTML = '';
                    delete contentEl.dataset.mounted;
                }
            }
        });
    };

    try {
        const observer = new IntersectionObserver(ioCallback, observerOptions);
        window._messageIntersectionObserver = observer;

        // Observe any existing message rows
        document.querySelectorAll('.message-row').forEach(r => observer.observe(r));
    } catch (e) {
        console.warn('IntersectionObserver not available, falling back to immediate render.', e);
        window._messageIntersectionObserver = null;
    }

    // Also update on resize to let observer re-evaluate; avoid heavy calls
    window.addEventListener('resize', () => {
        // No layout-read here, IntersectionObserver will handle visibility recalculation.
    }, { passive: true });

})();

window.toggleEditMessage = async (id) => {
    const contentDiv = document.getElementById(`content-${id}`);
    const msg = await storage.getMessage(id);
    if (!msg) return;
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = msg.content;
    textarea.rows = 5;
    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save Changes';
    saveBtn.className = 'save-edit-btn';
    saveBtn.onclick = () => saveEditedMessage(id, textarea.value);
    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancel';
    cancelBtn.className = 'save-edit-btn';
    cancelBtn.style.background = '#7f8c8d';
    cancelBtn.style.marginLeft = '5px';
    cancelBtn.onclick = () => {
        contentDiv.innerHTML = converter.makeHtml(applyOutputFilters(msg.content)); 
    };
    contentDiv.innerHTML = '';
    contentDiv.appendChild(textarea);
    contentDiv.appendChild(saveBtn);
    contentDiv.appendChild(cancelBtn);
};

window.saveEditedMessage = async (id, newContent) => {
    const msg = await storage.getMessage(id);
    if (!msg) return;
    msg.content = newContent;
    await storage.saveMessage(msg);
    try { CloudSync.push(); } catch(e) { /* noop */ }
    const existingRow = document.querySelector(`.message-row[data-id="${id}"]`);
    if (existingRow) {
        const contentDiv = existingRow.querySelector(`#content-${id}`);
        if (contentDiv) {
            contentDiv.innerHTML = converter.makeHtml(applyOutputFilters(msg.content));
        } else {
            addMessageToUI(msg);
        }
    } else {
        addMessageToUI(msg);
    }
    try {
        const tx = storage.db.transaction('conversations', 'readwrite');
        const store = tx.objectStore('conversations');
        store.get(currentChatId).onsuccess = (e) => {
            const conv = e.target.result;
            if (conv) {
                conv.lastModified = Date.now();
                store.put(conv);
            }
        };
    } catch (e) { }
};

window.deleteMessage = (id) => {
    document.querySelector(`.message-row[data-id="${id}"]`)?.remove();
    storage.deleteMessage(id);
};

window.reloadMessage = async (id) => {
    const row = document.querySelector(`.message-row[data-id="${id}"]`);
    if (!row || row.classList.contains('user')) return;
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.classList.contains('user')) {
        await storage.deleteMessage(id);
        row.remove();
        const newId = `${currentChatId}-${Date.now()}`;
        const placeholder = { id: newId, chatId: currentChatId, sender: 'ai', content: '__LOADING__', timestamp: Date.now() };
        addMessageToUI(placeholder);
        try {
            const prevMsgId = prevRow.dataset.id;
            const prevMsg = await storage.getMessage(prevMsgId);
            const resp = await executeResilientRequestSequence(prevMsg.content);
            document.querySelector(`.message-row[data-id="${newId}"]`).remove();
            const finalMsg = { id: newId, chatId: currentChatId, sender: 'ai', content: resp, timestamp: Date.now() };
            addMessageToUI(finalMsg);
            storage.saveMessage(finalMsg);
        } catch(e) { 
            console.error(e);

            // Show a lighthearted italicized explanation after 5s if placeholder still visible
            const jokes = [
                "The NPC forgot their line and is awkwardly staring at the camera.",
                "Error: Skill issue.",
                "We’re protecting the canon from whatever that was.",
                "Even an unfeeling machine has to draw the line somewhere.",
                "The NPC you were talking to has blocked you. Just kidding (mostly).",
                "The narrator went on strike—or maybe you’re just boring.",
                "Character development not found. Please try being more interesting.",
                "Something went wrong. Don't report it: we don't care."
            ];

            const placeholderRow = document.querySelector(`.message-row[data-id="${newId}"] .message-content`);
            if (placeholderRow) {
                setTimeout(() => {
                    const stillThere = document.querySelector(`.message-row[data-id="${newId}"] .message-content`);
                    if (!stillThere) return;
                    const joke = jokes[Math.floor(Math.random() * jokes.length)];
                    try {
                        stillThere.innerHTML = converter ? converter.makeHtml(`*${joke}*`) : `<em>${joke}</em>`;
                    } catch (err) {
                        stillThere.innerHTML = `<em>${joke}</em>`;
                    }
                }, 5000);
            }
        }
    }
};

async function renderPreviousChats() {
    const grid = document.getElementById('previous-chats-grid');
    const tooltip = document.getElementById('chat-preview-tooltip');
    grid.innerHTML = '';

    const cleanBtn = document.getElementById('clean-chats-btn');
    if (cleanBtn && !cleanBtn.dataset.bound) {
        cleanBtn.addEventListener('click', onCleanChatsClicked);
        cleanBtn.dataset.bound = '1';
    }

    const convs = await storage.getConversations();
    const chars = await storage.getCharacters();
    const defaultAvatar = "https://ui-avatars.com/api/?name=AI";
    convs.forEach(async (c) => {
        const msgs = await storage.getMessages(c.id);
        const lastMsgs = msgs.slice(-6);
        let avatar = c.characterAvatar && c.characterAvatar.trim() ? c.characterAvatar : defaultAvatar;
        if ((!c.characterAvatar || !c.characterAvatar.trim()) && chars.length) {
            const foundByName = chars.find(ch => c.name && ch.name && c.name.toLowerCase().includes(ch.name.toLowerCase()));
            if (foundByName && foundByName.avatar) {
                avatar = foundByName.avatar;
            } else {
                const lastAi = lastMsgs.slice().reverse().find(m => m.sender === 'ai' && m.content);
                if (lastAi) {
                    const foundByContent = chars.find(ch => lastAi.content.toLowerCase().includes((ch.name || '').toLowerCase()));
                    if (foundByContent && foundByContent.avatar) {
                        avatar = foundByContent.avatar;
                    }
                }
            }
        }
        const card = document.createElement('div');
        card.className = 'chat-card';
        card.innerHTML = `
            <div class="avatar-circle" style="background-image:url('${avatar}')"></div>
            <div class="chat-meta">
                <input class="chat-title" value="${escapeHtml(c.name || 'Chat')}" />
                <div class="chat-actions"></div>
            </div>
           <button class="card-btn delete" title="Delete chat" data-id="${c.id}">
               ${ICONS.trash}
           </button>
        `;
        // Make the whole card clickable to open the chat (but keep delete button stopPropagation)
        card.addEventListener('click', () => loadConversation(c.id));
        card.querySelector('.card-btn.delete').addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (confirm('Delete this chat?')) {
                storage.deleteConversation(c.id).then(() => renderPreviousChats());
            }
        });
        const titleInput = card.querySelector('.chat-title');
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
        });
        titleInput.addEventListener('blur', async () => {
            const tx = storage.db.transaction('conversations', 'readwrite');
            const store = tx.objectStore('conversations');
            const rec = await new Promise(res => { store.get(c.id).onsuccess = (ev) => res(ev.target.result || c); });
            rec.name = titleInput.value || `Chat ${new Date(rec.lastModified || Date.now()).toLocaleTimeString()}`;
            store.put(rec);
            tx.oncomplete = () => renderPreviousChats(); 
        });
        card.addEventListener('mouseenter', (e) => {
            if (!lastMsgs || lastMsgs.length === 0) {
                tooltip.innerText = "(no messages)";
            } else {
                tooltip.innerHTML = lastMsgs.map(m => `<div class="preview-line"><strong>${m.sender === 'user' ? config.userName : (m.sender === 'ai' ? c.name || config.aiName : m.sender)}</strong>: ${escapeHtml(m.content).slice(0, 200)}</div>`).join('');
            }
            tooltip.classList.remove('hidden');
            const rect = card.getBoundingClientRect();
            tooltip.style.top = `${rect.bottom + 8}px`;
            tooltip.style.left = `${rect.left}px`;
        });
        card.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
            tooltip.innerHTML = '';
        });
        grid.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str && str !== '') return '';
    return String(str).replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// ---------- Token counter helpers for Create Character form ----------
let __createTokenTimers = {};
function scheduleCreateTokenUpdate(fieldId, displayId) {
    // debounce 100ms after typing stops
    if (__createTokenTimers[displayId]) clearTimeout(__createTokenTimers[displayId]);
    __createTokenTimers[displayId] = setTimeout(async () => {
        const el = document.getElementById(fieldId);
        const text = el ? el.value || '' : '';
        updateCreateFieldToken(fieldId, text, displayId);
        delete __createTokenTimers[displayId];
    }, 100);
}

async function updateCreateFieldToken(fieldId, text, displayId) {
    const disp = document.getElementById(displayId);
    if (!disp) return;
    try {
        if (typeof tiktokenEncoder !== 'undefined' && tiktokenEncoder) {
            const encoded = tiktokenEncoder.encode(text || '');
            disp.innerText = encoded.length;
        } else {
            // Fallback: rough estimate = chars / 4 (approx tokens) but keep simple: chars
            disp.innerText = String((text || '').length);
        }
    } catch (e) {
        console.error('Token counter error', e);
        disp.innerText = String((text || '').length);
    }
}

// Attach listeners to fields used in character creation when DOM ready / listeners setup
(function wireCreateFieldTokenListeners(){
    document.addEventListener('DOMContentLoaded', () => {
        const mappings = [
            { fid: 'char-name', did: 'token-name' },
            { fid: 'char-description', did: 'token-desc' },
            { fid: 'char-system-prompt', did: 'token-system' },
            { fid: 'char-initial-message', did: 'token-initial' }
        ];
        mappings.forEach(m => {
            const field = document.getElementById(m.fid);
            if (!field) return;
            // initialize display
            updateCreateFieldToken(m.fid, field.value || '', m.did);
            // input event -> debounce update
            field.addEventListener('input', () => scheduleCreateTokenUpdate(m.fid, m.did));
            field.addEventListener('change', () => scheduleCreateTokenUpdate(m.fid, m.did));
            field.addEventListener('paste', () => scheduleCreateTokenUpdate(m.fid, m.did));
        });
    });
})();

function openModifySystemModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal glass-panel">
            <div class="modal-header">
                <h2>Modify System Prompt</h2>
                <button class="close-modal">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>
            <div class="modal-content">
                <div class="setting-group">
                    <label>System Prompt for this chat:</label>
                    <div style="position: relative;">
                        <textarea id="modify-system-textarea" style="width:100%; height:150px; padding:10px; border:1px solid rgba(255,255,255,0.2); border-radius:6px; background:var(--input-bg); color:white; font-family:inherit; resize: vertical;">${config.systemPrompt || ''}</textarea>
                        <div id="system-prompt-token-count" class="token-count-prompt">0 tokens</div>
                    </div>
                </div>
                <div class="action-buttons" style="margin-top:20px;">
                    <button id="save-system-chat-only" class="primary-btn">Save for this chat only</button>
                    <button id="publish-system-character" class="primary-btn" style="background:#e74c3c; margin-top:10px;">Publish to Character</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    
    const modifyTextarea = overlay.querySelector('#modify-system-textarea');
    modifyTextarea.addEventListener('input', updateTokenCounts);
    updateTokenCounts();
    
    document.getElementById('save-system-chat-only').addEventListener('click', async () => {
        const newSystemPrompt = document.getElementById('modify-system-textarea').value;
        config.systemPrompt = newSystemPrompt;
        const tx = storage.db.transaction('conversations', 'readwrite');
        const store = tx.objectStore('conversations');
        store.get(currentChatId).onsuccess = (e) => {
            const conv = e.target.result;
            if (conv) {
                conv.systemPrompt = newSystemPrompt;
                store.put(conv);
            }
        };
        overlay.remove();
    });
    document.getElementById('publish-system-character').addEventListener('click', async () => {
        if (confirm('Are you sure? This will make changes outside of this conversation.')) {
            const newSystemPrompt = document.getElementById('modify-system-textarea').value;
            config.systemPrompt = newSystemPrompt;
            const tx = storage.db.transaction('conversations', 'readwrite');
            const store = tx.objectStore('conversations');
            store.get(currentChatId).onsuccess = (e) => {
                const conv = e.target.result;
                if (conv) {
                    conv.systemPrompt = newSystemPrompt;
                    store.put(conv);
                }
            };
            // Use currentCharacterId to find the exact character to update (safer than matching by name)
            if (currentCharacterId) {
                const chars = await storage.getCharacters();
                const charToUpdate = chars.find(c => c.id === currentCharacterId);
                if (charToUpdate) {
                    charToUpdate.systemPrompt = newSystemPrompt;
                    await storage.saveCharacter(charToUpdate);
                    alert('Character system prompt updated!');
                } else {
                    alert('Could not find character to update.');
                }
            } else {
                alert('No character selected to publish to.');
            }
            overlay.remove();
        }
    });
}

/* -------------------------------------------------------------------------- */
/*                     DOCS & UPDATES (WITH COPY BUTTONS)                     */
/* -------------------------------------------------------------------------- */

const docsContent = `
### Version 2.3 - Code Blocks Fixed

**Updates:**
- Code blocks now have a copy button!
- Mobile layout is fixed.

### Regex Example
\`\`\`regex
^[a-zA-Z0-9]+$
\`\`\`

### Javascript Example
\`\`\`javascript
function copyCode() {
    console.log("Copied!");
    return true;
}
\`\`\`
`;

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('docs-content-area');
    
    if (container && typeof converter !== 'undefined') {
        container.innerHTML = converter.makeHtml(docsContent);

        const codeBlocks = container.querySelectorAll('pre');
        codeBlocks.forEach(pre => {
            const wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';
            
            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.innerHTML = 'Copy'; 
            
            btn.addEventListener('click', () => {
                const codeText = pre.innerText;
                navigator.clipboard.writeText(codeText).then(() => {
                    btn.innerHTML = 'Copied!';
                    btn.style.background = '#2ecc71'; 
                    setTimeout(() => {
                        btn.innerHTML = 'Copy';
                        btn.style.background = 'rgba(255,255,255,0.1)';
                    }, 2000);
                }).catch(() => {
                    btn.innerHTML = 'Failed';
                    btn.style.background = '#e74c3c';
                    setTimeout(() => {
                        btn.innerHTML = 'Copy';
                        btn.style.background = 'rgba(255,255,255,0.1)';
                    }, 2000);
                });
            });

            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(btn);
            wrapper.appendChild(pre);
        });

        const styleId = 'docs-enhanced-styles';
        if (!document.getElementById(styleId)) {
            const css = `
                /* Docs Text Styling */
                #docs-content-area { padding: 20px; color: #ecf0f1; line-height: 1.6; }
                #docs-content-area h3 { color: var(--accent-color); margin-top: 30px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
                #docs-content-area ul { padding-left: 20px; }
                #docs-content-area li { margin-bottom: 8px; }
                #docs-content-area img { max-width: 100%; border-radius: 8px; margin-top: 10px; }

                /* CODE BLOCK WRAPPER */
                .code-wrapper {
                    position: relative;
                    margin: 20px 0;
                    background: #1e1e1e; /* Dark VS Code Background */
                    border-radius: 8px;
                    border: 1px solid #333;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }

                /* THE COPY BUTTON */
                .copy-btn {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: #fff;
                    font-size: 0.75rem;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    z-index: 10;
                    transition: all 0.2s;
                }
                .copy-btn:hover { background: rgba(255,255,255,0.2); }

                /* THE SCROLLABLE CODE AREA */
                #docs-content-area pre {
                    margin: 0;
                    padding: 40px 15px 15px 15px; /* Top padding makes room for button */
                    overflow-x: auto; /* Horizontal scroll on mobile */
                    -webkit-overflow-scrolling: touch;
                    color: #d4d4d4;
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 0.9rem;
                    white-space: pre;
                    background: transparent; /* Wrapper handles bg */
                    border: none;
                }

                #docs-content-area code { 
                    color: #ce9178; /* Syntax color approximation */
                }

                @media (max-width: 600px) {
                    #docs-content-area { padding: 14px; font-size: 14px; }
                    .code-wrapper { margin: 14px 0; border-radius: 6px; }
                    .copy-btn { top: 8px; right: 8px; padding: 3px 7px; font-size: 0.7rem; }
                    #docs-content-area pre { padding: 36px 12px 12px 12px; font-size: 0.85rem; }
                }
            `;
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = css;
            document.head.appendChild(style);
        }
    }
});

async function onCleanChatsClicked() {
    const raw = prompt("Type in a number to delete the oldest X chats.");
    if (raw === null) return; 
    const n = parseInt(raw.trim());
    if (!Number.isInteger(n) || n <= 0) return alert("Please enter a positive integer.");

    if (!confirm(`Are you sure you want to delete the oldest ${n} chat(s)? This cannot be undone.`)) return;

    try {
        const convs = await storage.getConversations();
        if (!convs || convs.length === 0) return alert("No chats to delete.");
        const sorted = convs.slice().sort((a,b) => (a.lastModified||0) - (b.lastModified||0));
        const toDelete = sorted.slice(0, n);
        for (const c of toDelete) {
            await storage.deleteConversation(c.id);
        }
        alert(`Deleted ${toDelete.length} chat(s).`);
        renderPreviousChats();
    } catch (e) {
        console.error("Clean Chats error:", e);
        alert("Failed to delete chats. See console for details.");
    }
}