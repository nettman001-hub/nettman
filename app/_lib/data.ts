export type SermonSections = {
  introduction: string;
  body: Array<{ heading: string; content: string }>;
  conclusion: string;
  application: string;
};

export type SermonAuthorshipMode = "pastor_assisted" | "ai_generated";

export type SermonRecord = {
  id: string;
  title: string;
  scripture: string;
  sermonType: string;
  audience: string;
  audienceSituation: string;
  pointCount: number;
  duration: number;
  emotion: string;
  sections: SermonSections;
  /** Derived from a completed helper relationship; legacy/local records may omit it. */
  authorshipMode?: SermonAuthorshipMode;
  createdAt: string;
  updatedAt: string;
};

export type ConsultationRecord = {
  id: string;
  sermonId: string;
  sermonTitle: string;
  reason: string;
  status: "waiting" | "assigned" | "in_progress" | "completed";
  expertName: string | null;
  queuePosition: number;
  createdAt: string;
  updatedAt: string;
};

export const demoSermons: SermonRecord[] = [
  {
    id: "demo-sermon-1",
    title: "머무름이 열매가 되는 삶",
    scripture: "요한복음 15:1-8",
    sermonType: "강해",
    audience: "청장년",
    audienceSituation: "일반",
    pointCount: 3,
    duration: 20,
    emotion: "따뜻한 도전",
    createdAt: "2026-08-03T09:00:00.000Z",
    updatedAt: "2026-08-03T09:00:00.000Z",
    sections: {
      introduction: "열매를 맺기 위해 분주히 달리는 우리에게 예수님은 먼저 '내 안에 거하라'고 말씀하십니다. 가지가 나무에 붙어 있는 단순한 모습 속에 신앙의 가장 깊은 비밀이 담겨 있습니다.",
      body: [
        { heading: "머무름은 신뢰의 선택입니다", content: "주님 안에 거한다는 것은 아무것도 하지 않는 멈춤이 아니라, 내 힘보다 주님의 생명을 의지하는 적극적인 신뢰입니다." },
        { heading: "가지치기는 버림이 아니라 돌봄입니다", content: "하나님은 우리를 아프게 하려는 분이 아니라 더 풍성한 열매를 위해 불필요한 것을 다듬으시는 농부이십니다." },
        { heading: "열매는 사랑으로 드러납니다", content: "말씀 안에 머문 사람의 변화는 일상의 관계에서 사랑과 인내, 온유의 열매로 나타납니다." },
      ],
      conclusion: "그리스도 안에서 우리는 이미 생명의 나무에 연결된 가지입니다. 열매를 증명하려 애쓰기보다 오늘 다시 주님 안에 머무십시오.",
      application: "이번 한 주 매일 10분 동안 요한복음 15장을 천천히 읽고, 한 사람에게 먼저 사랑의 말을 건네기로 결단합시다.",
    },
  },
  {
    id: "demo-sermon-2",
    title: "폭풍 속에서도 들리는 음성",
    scripture: "마가복음 4:35-41",
    sermonType: "내러티브",
    audience: "청년",
    audienceSituation: "일반",
    pointCount: 3,
    duration: 15,
    emotion: "위로",
    createdAt: "2026-07-27T09:00:00.000Z",
    updatedAt: "2026-07-27T09:00:00.000Z",
    sections: {
      introduction: "제자들은 예수님과 같은 배에 있었지만 폭풍이 오자 두려움에 사로잡혔습니다. 믿음의 길에도 예상하지 못한 파도가 찾아옵니다.",
      body: [
        { heading: "폭풍은 동행을 지우지 못합니다", content: "주님이 침묵하시는 것처럼 보여도 같은 배에 계신다는 사실은 변하지 않습니다." },
        { heading: "두려움은 정직하게 주님께 가져갈 수 있습니다", content: "제자들의 서툰 외침도 주님께 향했을 때 기도가 되었습니다." },
        { heading: "말씀은 혼돈에 질서를 세웁니다", content: "바람과 바다를 잠잠하게 하신 주님은 오늘 우리의 마음에도 평안을 말씀하십니다." },
      ],
      conclusion: "우리의 평안은 잔잔한 환경이 아니라 배 안에 계신 예수님에게서 옵니다.",
      application: "두려운 상황 한 가지를 적고, 그 문장 아래 '주님이 나와 같은 배에 계신다'고 고백해 봅시다.",
    },
  },
];

export const demoConsultations: ConsultationRecord[] = [
  {
    id: "demo-consult-1",
    sermonId: "demo-sermon-1",
    sermonTitle: "머무름이 열매가 되는 삶",
    reason: "본론의 신학적 연결과 적용 문장을 함께 점검하고 싶습니다.",
    status: "in_progress",
    expertName: "김선우 목회코치",
    queuePosition: 0,
    createdAt: "2026-08-04T02:20:00.000Z",
    updatedAt: "2026-08-05T08:30:00.000Z",
  },
];

export function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
