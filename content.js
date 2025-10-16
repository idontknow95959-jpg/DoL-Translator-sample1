// iframe 내부에서만 실행되도록 체크
if (window.self !== window.top) {
    console.log('DoL 번역기: iframe 내부에서 실행 중');
    
    // 전역 변수
    let translationEnabled = true;
    let showTranslation = true;
    let isTranslating = false;
    let translationCache = new Map();
    let originalTextCache = new Map();
    let failedTranslations = new Map();
    let observer = null;
    let processedNodes = new WeakSet();
    let retryCount = 0;
    let retryScheduled = false;
    let retryTimer = null;
    const MAX_RETRIES = 20;
    const MAX_TRANSLATION_RETRIES = 3;
    const MAX_BATCH_RETRIES = 3;
    const CACHE_KEY = 'dol_translation_cache';
    const MAX_CACHE_SIZE = 10000;

    // ========== 키보드 이벤트 관련 함수 추가 ==========
    
    // 버튼 텍스트에서 키 조합 파싱
    function parseKeyFromText(text) {
        if (!text) return null;
        
        // (1), (2), ..., (9), (0) 패턴
        const numberMatch = text.match(/\((\d)\)/);
        if (numberMatch) {
            return { key: numberMatch[1], shiftKey: false };
        }
        
        // (Shift+1), (Shift+2) 등 패턴 (대소문자 무시)
        const shiftMatch = text.match(/\(Shift\s*\+\s*(\d)\)/i);
        if (shiftMatch) {
            return { key: shiftMatch[1], shiftKey: true };
        }
        
        return null;
    }

    // 키보드 이벤트 발생시키기
    function triggerKeyEvent(key, shiftKey = false) {
        const numKey = parseInt(key);
        const keyCode = (numKey === 0) ? 48 : (48 + numKey); // 0은 48, 1은 49, ...
        
        console.log(`🎮 키보드 이벤트 발생: ${shiftKey ? 'Shift+' : ''}${key} (keyCode: ${keyCode})`);
        
        // keydown 이벤트
        const keydownEvent = new KeyboardEvent('keydown', {
            key: key,
            code: `Digit${key}`,
            keyCode: keyCode,
            which: keyCode,
            shiftKey: shiftKey,
            bubbles: true,
            cancelable: true,
            view: window
        });
        document.dispatchEvent(keydownEvent);
        
        // keypress 이벤트 (일부 게임에서 필요할 수 있음)
        const keypressEvent = new KeyboardEvent('keypress', {
            key: key,
            code: `Digit${key}`,
            keyCode: keyCode,
            which: keyCode,
            shiftKey: shiftKey,
            bubbles: true,
            cancelable: true,
            view: window
        });
        document.dispatchEvent(keypressEvent);
        
        // keyup 이벤트
        setTimeout(() => {
            const keyupEvent = new KeyboardEvent('keyup', {
                key: key,
                code: `Digit${key}`,
                keyCode: keyCode,
                which: keyCode,
                shiftKey: shiftKey,
                bubbles: true,
                cancelable: true,
                view: window
            });
            document.dispatchEvent(keyupEvent);
        }, 50);
    }

    // 번역 후 링크에 키보드 이벤트 리스너 추가
    function attachKeyboardShortcuts(element) {
        if (!element) return;
        
        // link-internal 또는 macro-link 클래스를 가진 모든 링크 찾기
        const links = element.querySelectorAll('a.link-internal, a.macro-link, a[data-passage]');
        
        let attachedCount = 0;
        
        links.forEach(link => {
            const linkText = link.textContent || link.innerText || '';
            const keyInfo = parseKeyFromText(linkText);
            
            if (keyInfo) {
                // 클릭 이벤트 리스너 추가
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log(`🖱️ 링크 클릭됨: "${linkText.substring(0, 30)}..." → 키 이벤트 발생`);
                    triggerKeyEvent(keyInfo.key, keyInfo.shiftKey);
                }, true); // capture phase에서 처리
                
                // 접근성을 위해 커서 스타일 유지
                link.style.cursor = 'pointer';
                attachedCount++;
            }
        });
        
        if (attachedCount > 0) {
            console.log(`✅ ${attachedCount}개의 링크에 키보드 이벤트 연결됨`);
        }
    }

    // ========== 기존 함수들 ==========

    // 안전한 HTML 정리 함수
    function sanitizeHTML(html) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;

        wrapper.querySelectorAll('script, style').forEach(node => node.remove());

        wrapper.querySelectorAll('*').forEach(el => {
            const attrs = Array.from(el.attributes);
            attrs.forEach(attr => {
                const name = attr.name.toLowerCase();
                const value = attr.value || '';

                if (name.startsWith('on')) {
                    el.removeAttribute(attr.name);
                    return;
                }

                if ((name === 'href' || name === 'src' || name.endsWith(':href')) && /^javascript:/i.test(value.trim())) {
                    el.removeAttribute(attr.name);
                    return;
                }
            });
        });

        return wrapper.innerHTML;
    }

    // 캐시 로드 함수
    async function loadCache() {
        try {
            const result = await chrome.storage.local.get(CACHE_KEY);
            if (result[CACHE_KEY]) {
                const cacheData = result[CACHE_KEY];
                console.log(`📦 캐시 로드: ${Object.keys(cacheData).length}개 항목`);
                for (const [key, value] of Object.entries(cacheData)) {
                    translationCache.set(key, { translation: value, elements: [] });
                }
            }
        } catch (error) {
            console.error('캐시 로드 실패:', error);
        }
    }

    // 캐시 저장 함수
    let saveTimer = null;
    async function saveCache() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            try {
                const cacheObject = {};
                let count = 0;
                
                const entries = Array.from(translationCache.entries()).reverse();

                for (const [key, value] of entries) {
                    if (count >= MAX_CACHE_SIZE) break;

                    const trimmedKey = key.trim().toLowerCase();
                    if (typeof localDictionary === 'undefined' || !localDictionary.has(trimmedKey)) {
                        cacheObject[key] = value.translation;
                        count++;
                    }
                }
                
                if (count > 0) {
                    await chrome.storage.local.set({ [CACHE_KEY]: cacheObject });
                    console.log(`💾 캐시 저장: ${count}개 항목`);
                }

            } catch (error) {
                console.error('캐시 저장 실패:', error);
            }
        }, 2000);
    }

    // 캐시 통계
    async function showCacheStats() {
        const result = await chrome.storage.local.get(CACHE_KEY);
        if (result[CACHE_KEY]) {
            const size = JSON.stringify(result[CACHE_KEY]).length;
            console.log(`📊 캐시 통계:
- 항목 수: ${Object.keys(result[CACHE_KEY]).length}개
- 데이터 크기: ${(size / 1024).toFixed(2)} KB`);
        }
    }

    // 캐시 초기화
    async function clearCache() {
        await chrome.storage.local.remove(CACHE_KEY);
        translationCache.clear();
        console.log('🗑️ 캐시 초기화 완료');
    }

    // 특정 캐시 항목 삭제
    async function deleteCacheEntry(originalText) {
        if (!originalText || typeof originalText !== 'string') {
            console.error('❌ 삭제할 텍스트(원문)를 정확히 입력해주세요.');
            return;
        }

        if (translationCache.has(originalText)) {
            translationCache.delete(originalText);
            console.log(`✅ 메모리 캐시에서 "${originalText}" 항목을 삭제했습니다.`);
        }

        try {
            const result = await chrome.storage.local.get(CACHE_KEY);
            if (result[CACHE_KEY] && result[CACHE_KEY][originalText]) {
                delete result[CACHE_KEY][originalText];
                await chrome.storage.local.set({ [CACHE_KEY]: result[CACHE_KEY] });
                console.log(`💾 영구 캐시에서 "${originalText}" 항목을 삭제했습니다.`);
            }
        } catch (error) {
            console.error('❌ 영구 캐시 삭제 중 오류 발생:', error);
        }
    }

    // 토글 버튼 생성
    function createToggleButton() {
        const existingBtn = document.getElementById('dol-translation-toggle');
        if (existingBtn) {
            existingBtn.remove();
        }

        const button = document.createElement('button');
        button.id = 'dol-translation-toggle';
        button.textContent = 'Eng';

        button.addEventListener('click', () => {
            showTranslation = !showTranslation;
            button.textContent = showTranslation ? 'Eng' : 'Kor';
            toggleDisplayMode();
        });

        if (document.body) {
            document.body.appendChild(button);
            console.log('✅ 토글 버튼 생성됨');
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.body.appendChild(button);
                console.log('✅ 토글 버튼 생성됨 (DOMContentLoaded)');
            });
        }
    }

    // 원문/번역문 표시 전환
    function toggleDisplayMode() {
        if (showTranslation) {
            // 번역문으로 전환
            console.log('🔄 번역문으로 전환');
            let restoredCount = 0;
            
            for (const [element, originalHTML] of originalTextCache.entries()) {
                if (!document.contains(element)) {
                    originalTextCache.delete(element);
                    continue;
                }
                
                const cachedItem = translationCache.get(originalHTML);
                if (cachedItem && cachedItem.translation) {
                    const safeHTML = sanitizeHTML(cachedItem.translation);
                    element.innerHTML = safeHTML;
                    // ⭐ 번역문으로 전환 후 키보드 이벤트 재연결
                    attachKeyboardShortcuts(element);
                    restoredCount++;
                }
            }
            
            console.log(`✅ ${restoredCount}개의 번역문을 복원했습니다.`);
        } else {
            // 원문으로 전환
            console.log('🔄 원문으로 전환');
            let restoredCount = 0;
            
            for (const [element, originalHTML] of originalTextCache.entries()) {
                if (document.contains(element)) {
                    element.innerHTML = originalHTML;
                    restoredCount++;
                } else {
                    originalTextCache.delete(element);
                }
            }
            
            console.log(`✅ ${restoredCount}개의 원문을 복원했습니다.`);
        }
    }

    // 초기화
    async function init() {
        const settings = await chrome.storage.sync.get({
            translationEnabled: true
        });
        translationEnabled = settings.translationEnabled;

        if (translationEnabled) {
            console.log('DoL 번역기 초기화 중...');
            await loadCache();
            setTimeout(() => {
                createToggleButton();
            }, 1000);
            waitForStoryArea();
        }
    }

    // 스토리 영역 대기
    function waitForStoryArea() {
        const storyArea = document.querySelector('#story');

        if (storyArea) {
            console.log('스토리 영역 발견: #story');
            retryCount = 0;
            startObserving();
        } else {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
                console.log(`스토리 영역을 찾을 수 없습니다. 재시도 ${retryCount}/${MAX_RETRIES}...`);
                setTimeout(waitForStoryArea, 1000);
            } else {
                console.error('스토리 영역을 찾지 못했습니다.');
            }
        }
    }

    // 스토리 영역 감시
    function startObserving() {
        if (observer) {
            observer.disconnect();
        }

        const storyArea = document.querySelector('#story');

        if (!storyArea) {
            console.error('스토리 영역을 찾을 수 없습니다.');
            return;
        }

        console.log('번역 감시 시작: #story');
        translateStoryArea();

        observer = new MutationObserver((mutations) => {
            if (isTranslating) return;
            
            let hasStoryChange = false;
            for (const mutation of mutations) {
                if (mutation.target === storyArea || storyArea.contains(mutation.target)) {
                    hasStoryChange = true;
                    break;
                }
            }
            
            if (hasStoryChange) {
                debounceTranslate();
            }
        });

        observer.observe(storyArea, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    // 디바운스
    let debounceTimer;
    function debounceTranslate() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            translateStoryArea();
        }, 500);
    }

    // 번역문 찾기
    function findTranslation(text) {
        const trimmedText = text.trim().toLowerCase();
        if (typeof localDictionary !== 'undefined' && localDictionary.has(trimmedText)) {
            return localDictionary.get(trimmedText);
        }

        if (translationCache.has(text)) {
            return translationCache.get(text).translation;
        }
        
        return null;
    }

    // 스토리 영역 번역
    async function translateStoryArea() {
        if (!translationEnabled || isTranslating) return;

        const storyArea = document.querySelector('#story');
        if (!storyArea) {
            console.error('스토리 영역을 찾을 수 없습니다.');
            return;
        }

        isTranslating = true;

        try {
            const textNodesToProcess = getTextNodes(storyArea)
                .filter(node => !processedNodes.has(node) && shouldTranslate(node.textContent));

            if (textNodesToProcess.length === 0) {
                isTranslating = false;
                return;
            }

            const parents = [...new Set(textNodesToProcess.map(n => n.parentElement).filter(p => p))];
            const batches = [];

            for (const parent of parents) {
                let blockAncestor = parent.closest('p, div, section, article, li, blockquote');
                if (!blockAncestor || !storyArea.contains(blockAncestor)) {
                    blockAncestor = parent;
                }

                if (batches.some(b => b.element === blockAncestor)) continue;

                let html = '';
                try {
                    if (blockAncestor.ownerDocument === document) {
                        html = blockAncestor.innerHTML.trim();
                    }
                } catch (e) {
                    console.warn('cross-origin block 무시됨:', e.message);
                    continue;
                }

                if (/[A-Za-z]/.test(html)) {
                    batches.push({ element: blockAncestor, html });
                }
            }

            console.log(`${batches.length}개의 번역 단위(배치) 발견`);

            let translatedCount = 0;
            let failedCount = 0;

            for (const batch of batches) {
                const { element, html } = batch;
                const originalHTML = html;

                if (!originalTextCache.has(element)) {
                    originalTextCache.set(element, originalHTML);
                }

                const foundTranslation = findTranslation(originalHTML);
                if (foundTranslation) {
                    if (showTranslation) {
                        element.innerHTML = sanitizeHTML(foundTranslation);
                        // ⭐ 번역 적용 후 키보드 이벤트 연결
                        attachKeyboardShortcuts(element);
                    }
                    if (!translationCache.has(originalHTML)) {
                        translationCache.set(originalHTML, { 
                            translation: foundTranslation, 
                            elements: [element] 
                        });
                    } else {
                        const cached = translationCache.get(originalHTML);
                        if (!cached.elements.includes(element)) {
                            cached.elements.push(element);
                        }
                    }
                    translatedCount++;
                    continue;
                }

                const result = await translateWithRetry(originalHTML, element);
                if (result.success) translatedCount++;
                else failedCount++;

                await sleep(400);
            }

            console.log(`✅ 번역 완료: ${translatedCount}개 배치 성공, ${failedCount}개 배치 실패`);
            
            if (translatedCount > 0) {
                saveCache();
            }
            
            if (failedCount > 0 && !retryScheduled) {
                scheduleRetry();
            }

        } finally {
            isTranslating = false;
        }
    }

    // 재시도 스케줄링
    function scheduleRetry() {
        if (retryScheduled || failedTranslations.size === 0) return;
        retryScheduled = true;
        console.log(`⏳ 5초 후 실패한 번역 ${failedTranslations.size}개를 재시도합니다...`);
        retryTimer = setTimeout(() => {
            retryScheduled = false;
            retryFailedTranslations();
        }, 5000);
    }

    // 번역 함수
    async function translateWithRetry(text, element, currentRetry = 0) {
        try {
            console.log(`번역 요청 (시도 ${currentRetry + 1}/${MAX_TRANSLATION_RETRIES}):`, text.substring(0, 50) + '...');
            const translation = await requestTranslation(text);

            if (translation) {
                translationCache.set(text, { 
                    translation, 
                    elements: [element] 
                });

                if (showTranslation && element && document.contains(element)) {
                    const safeHTML = sanitizeHTML(translation);
                    element.innerHTML = safeHTML;
                    // ⭐ 번역 적용 후 키보드 이벤트 연결
                    attachKeyboardShortcuts(element);
                }

                processedNodes.add(element);
                failedTranslations.delete(text);
                
                console.log('✓ 번역 성공:', translation.substring(0, 50) + '...');
                return { success: true };
            }

            throw new Error('번역 결과가 비어있습니다.');
        } catch (error) {
            console.error(`❌ 번역 실패 (${currentRetry + 1}/${MAX_TRANSLATION_RETRIES}):`, error.message);

            if (currentRetry < MAX_TRANSLATION_RETRIES - 1) {
                await sleep(1000);
                return await translateWithRetry(text, element, currentRetry + 1);
            } else {
                failedTranslations.set(text, { element, retryCount: 0 });
                console.error('❌ 최대 재시도 횟수 초과:', text.substring(0, 50) + '...');
                return { success: false };
            }
        }
    }

    // 실패한 번역 재시도
    async function retryFailedTranslations() {
        if (failedTranslations.size === 0) return;
        
        console.log(`🔄 실패한 번역 ${failedTranslations.size}개 재시도 중...`);
        const failedEntries = Array.from(failedTranslations.entries());
        let successCount = 0;
        let stillFailedCount = 0;
        
        for (const [text, data] of failedEntries) {
            const { element, retryCount } = data;
            
            if (!document.contains(element)) {
                failedTranslations.delete(text);
                continue;
            }
            if (translationCache.has(text) || retryCount >= MAX_BATCH_RETRIES) {
                failedTranslations.delete(text);
                continue;
            }
            
            const result = await translateWithRetry(text, element);
            if (result.success) {
                successCount++;
                failedTranslations.delete(text);
            } else {
                failedTranslations.set(text, { element, retryCount: retryCount + 1 });
                stillFailedCount++;
            }
            await sleep(400);
        }
        
        console.log(`🔄 재시도 완료: ${successCount}개 성공, ${stillFailedCount}개 여전히 실패`);
        
        if (successCount > 0) {
            saveCache();
        }
        
        if (failedTranslations.size > 0) {
            scheduleRetry();
        } else {
            console.log('✅ 모든 번역 작업 완료!');
        }
    }

    // 텍스트 노드 추출
    function getTextNodes(element) {
        const textNodes = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                const parent = node.parentElement;
                if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON'].includes(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }

                if (parent.closest('#saves-list-container')) return NodeFilter.FILTER_REJECT;

                if (!node.textContent.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.offsetParent === null && parent.style.display !== 'contents') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        return textNodes;
    }

    // 번역 대상 확인
    function shouldTranslate(text) {
        const trimmed = text.trim().toLowerCase();
        if (trimmed.length < 2 && !['a', 'i'].includes(trimmed)) return false;

        const patterns = [
            /^\d+$/,
            /^[^\w\s]+$/,
            /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/,
            /^\d+°c$/,
            /^[a-df][+\-]?$/,
            /^[a-z]\*$/
        ];

        if (patterns.some((re) => re.test(trimmed))) return false;
        if (!/[a-z]/.test(trimmed)) return false;

        return true;
    }

    // 번역 요청
    function requestTranslation(text) {
        return new Promise((resolve, reject) => {
            // dictionary를 객체로 변환하여 전달
            const dictionaryObj = {};
            if (typeof localDictionary !== 'undefined') {
                for (const [key, value] of localDictionary.entries()) {
                    dictionaryObj[key] = value;
                }
            }
        
            chrome.runtime.sendMessage({ 
                action: 'translate', 
                text: text,
                dictionary: dictionaryObj  // dictionary 추가 전달
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.translation);
                } else {
                    reject(new Error(response?.error || '번역 실패'));
                }
            });
        });
    }

    // 대기 함수
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // 강제 새로고침
    async function forceRefresh() {
        console.log('🔄 수동 새로고침 요청 수신됨. 캐시를 지우고 새로 번역합니다.');
        
        if (isTranslating) {
            console.log('번역이 진행 중이므로 새로고침을 중단합니다.');
            return;
        }
        if (observer) observer.disconnect();

        showTranslation = false;
        toggleDisplayMode(); 
        showTranslation = true;

        await clearCache();
        originalTextCache.clear();
        processedNodes = new WeakSet();
        failedTranslations.clear();
        
        console.log('🔄 모든 캐시를 지우고 번역을 다시 시작합니다.');
        
        await translateStoryArea();
        startObserving();
    }

    // 메시지 수신
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSettings') {
            translationEnabled = request.enabled;
            if (retryTimer) clearTimeout(retryTimer);
            retryScheduled = false;

            if (translationEnabled) {
                processedNodes = new WeakSet();
                retryCount = 0;
                if (!document.getElementById('dol-translation-toggle')) {
                    createToggleButton();
                }
                waitForStoryArea();
            } else {
                if (observer) observer.disconnect();
                const btn = document.getElementById('dol-translation-toggle');
                if (btn) btn.remove();
            }
            sendResponse({ success: true });
        } else if (request.action === 'showCacheStats') {
            showCacheStats();
            sendResponse({ success: true });
        } else if (request.action === 'clearCache') {
            clearCache();
            sendResponse({ success: true });
        } else if (request.action === 'forceRefresh') {
            forceRefresh();
            sendResponse({ success: true });
        }
    });

    // 콘솔 유틸리티
    window.dolTranslator = {
        showStats: showCacheStats,
        clearCache: clearCache,
        delete: deleteCacheEntry,
        getCacheSize: () => translationCache.size
    };

    init();
} else {
    console.log('DoL 번역기: 메인 페이지 (iframe 외부) - 실행하지 않음');
}
