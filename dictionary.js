// 로컬 사전 (Local Dictionary)
// 
// 이 사전은 번역의 일관성을 유지하기 위해 사용됩니다.
// 번역할 텍스트에 dictionary의 단어가 포함되어 있으면,
// AI에게 해당 단어를 지정된 번역으로 사용하도록 지시합니다.
//
// 주의사항:
// - key는 반드시 소문자로 입력하세요 (대소문자 구분 없이 매칭됩니다)
// - 단어 경계를 인식하므로 "rob"이 "robin"에 매칭되지 않습니다
// - 고유명사, 캐릭터 이름, 특수 용어 등에 사용하세요

const localDictionary = {
    // ===== 주요 관계 =====
    "robin": "로빈",
    "whitney": "휘트니",

    // ===== 관심 인물 =====
    "bailey": "베일리",
    "briar": "브라이어",
    "charlie": "찰리",
    "darryl": "데릴",
    "doren": "도렌",
    "gwylan": "그윌란",
    "harper": "하퍼",
    "jordan": "조던",
    "landry": "랜드리",
    "leighton": "레이턴",
    "mason": "메이슨",
    "morgan": "모건",
    "river": "리버",
    "sam": "샘",
    "sirris": "시리스",
    "winter": "윈터",
    "quinn": "퀸",
    "remy": "레미",
};
