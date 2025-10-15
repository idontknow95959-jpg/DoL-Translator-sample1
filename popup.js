// 기본 프롬프트 (사용자 설정 부분)
const DEFAULT_PROMPT = `캐릭터의 말투나 특별한 용어 등, 번역에 적용하고 싶은 규칙을 여기에 입력하세요.

예시:
- Robin 캐릭터는 항상 존댓말을 사용해줘.`;

// 기본 모델
const DEFAULT_MODEL = 'gemini-2.5-flash';

// 페이지 로드 시 저장된 설정 불러오기
document.addEventListener('DOMContentLoaded', async () => {
    const result = await chrome.storage.sync.get({
        apiKey: '',
        modelName: DEFAULT_MODEL,
        prompt: DEFAULT_PROMPT,
        translationEnabled: true
    });

    document.getElementById('apiKey').value = result.apiKey;
    document.getElementById('modelName').value = result.modelName;
    document.getElementById('prompt').value = result.prompt;
    document.getElementById('translationEnabled').checked = result.translationEnabled;
});

// 게임 페이지인지 확인
function isGamePage(url) {
    return url && (url.includes('dolmods.net') || url.includes('vanilla.dolmods.net'));
}

// 저장 버튼 클릭
document.getElementById('saveBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const modelName = document.getElementById('modelName').value.trim();
    const prompt = document.getElementById('prompt').value.trim();
    const translationEnabled = document.getElementById('translationEnabled').checked;

    // 유효성 검사
    if (!apiKey) {
        showStatus('API 키를 입력해주세요.', 'error');
        return;
    }

    if (!modelName) {
        showStatus('모델 이름을 입력해주세요.', 'error');
        return;
    }

    if (!prompt) {
        showStatus('번역 프롬프트를 입력해주세요.', 'error');
        return;
    }

    // 설정 저장
    await chrome.storage.sync.set({
        apiKey: apiKey,
        modelName: modelName,
        prompt: prompt,
        translationEnabled: translationEnabled
    });

    // 활성 탭에 메시지 전송 (게임 페이지인 경우에만)
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isGamePage(tab.url)) {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'updateSettings',
                enabled: translationEnabled
            });
        }
    } catch (error) {
        // 메시지 전송 실패는 무시 (게임 페이지가 아닐 수 있음)
        console.log('메시지 전송 실패 (정상):', error.message);
    }

    showStatus('설정이 저장되었습니다!', 'success');
});

// 상태 메시지 표시
function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}

// 번역 토글 변경 시
document.getElementById('translationEnabled').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ translationEnabled: enabled });
    
    // 활성 탭에 메시지 전송 (게임 페이지인 경우에만)
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isGamePage(tab.url)) {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'updateSettings',
                enabled: enabled
            });
        }
    } catch (error) {
        // 메시지 전송 실패는 무시
        console.log('메시지 전송 실패 (정상):', error.message);
    }
});

// '현재 화면 새로 번역' 버튼 클릭
document.getElementById('refreshBtn').addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isGamePage(tab.url)) {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'forceRefresh' // 새로운 액션
            });
            showStatus('새로 번역을 요청했습니다!', 'success');
        } else {
            showStatus('게임 페이지에서만 사용할 수 있습니다.', 'error');
        }
    } catch (error) {
        console.log('새로고침 메시지 전송 실패:', error.message);
        showStatus('요청에 실패했습니다.', 'error');
    }
});