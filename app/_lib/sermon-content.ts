import type {
  GenerateSermonsRequest,
  ReviseSermonRequest,
  SermonAlternative,
  SermonPoint,
} from "./sermon-types";

type SermonAngle = {
  titleLead: string;
  lens: string;
  image: string;
  movement: string;
  blessing: string;
};

const ANGLES: SermonAngle[] = [
  {
    titleLead: "은혜로 다시 걷는",
    lens: "하나님이 먼저 다가오시는 은혜",
    image: "긴 겨울 끝에 새순이 돋는 장면",
    movement: "받은 사랑을 이웃에게 흘려보내는 삶",
    blessing: "지친 마음을 일으키시는 하나님의 평안",
  },
  {
    titleLead: "말씀 앞에 바로 서는",
    lens: "본문의 문맥이 드러내는 하나님의 뜻",
    image: "어두운 길을 비추는 한 등불",
    movement: "말씀을 듣고 한 걸음 순종하는 삶",
    blessing: "분별력과 담대함을 더하시는 은혜",
  },
  {
    titleLead: "상처를 소망으로 바꾸는",
    lens: "깨어진 자리에도 찾아오시는 회복",
    image: "금이 간 그릇을 귀하게 빚으시는 토기장이",
    movement: "아픔을 숨기지 않고 주님께 맡기는 삶",
    blessing: "눈물을 닦고 새 노래를 주시는 위로",
  },
  {
    titleLead: "함께 세워 가는",
    lens: "서로를 통해 일하시는 공동체의 부르심",
    image: "서로 다른 돌이 맞물려 한 집을 이루는 모습",
    movement: "먼저 손 내밀고 함께 책임지는 삶",
    blessing: "교회를 한 몸으로 묶으시는 성령의 기쁨",
  },
  {
    titleLead: "내일을 향해 보내시는",
    lens: "현재를 넘어 하나님 나라를 바라보는 소망",
    image: "새벽을 기다리며 씨앗을 심는 농부",
    movement: "작은 충성을 오늘의 자리에서 시작하는 삶",
    blessing: "끝까지 동행하시며 열매 맺게 하시는 약속",
  },
];

const POINT_TITLES = [
  "말씀을 다시 바라보십시오",
  "마음의 자리를 주님께 내어드리십시오",
  "작은 순종을 오늘 시작하십시오",
  "공동체와 함께 끝까지 걸으십시오",
];

const PASTORAL_TENSIONS = [
  "결과를 빨리 확인하고 싶어 말씀보다 조급한 판단을 앞세우기 쉽습니다",
  "상처받지 않으려는 마음이 관계를 향한 사랑의 책임을 밀어내기도 합니다",
  "익숙한 신앙 언어가 실제 삶의 순종을 대신하는 순간이 찾아옵니다",
  "비교와 성과의 기준이 하나님이 주신 정체성을 흐리게 만들 때가 있습니다",
  "실패의 기억 때문에 하나님이 여실 다음 장면까지 미리 포기하고 싶어집니다",
];

const GOSPEL_RESPONSES = [
  "복음은 더 강해지라고 다그치기보다 그리스도께서 먼저 이루신 일을 바라보게 합니다",
  "성령께서는 거창한 결심보다 오늘 순종할 수 있는 작고 분명한 한 걸음을 보여 주십니다",
  "말씀 앞의 정직한 고백은 정죄의 끝이 아니라 회복이 시작되는 자리입니다",
  "공동체의 기도와 권면은 혼자 감당하던 짐을 은혜의 자리로 옮겨 줍니다",
  "하나님의 약속은 우리의 감정이 흔들리는 날에도 변하지 않는 삶의 기준이 됩니다",
];

function id(prefix: string, index?: number): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${index ?? 0}-${suffix}`;
}

function audienceExample(audience: string): string {
  switch (audience) {
    case "청년":
      return "진로와 관계의 답을 서둘러 정해야 한다는 압박 속에서도";
    case "청소년":
      return "성적과 친구 관계로 마음이 흔들리는 순간에도";
    case "장년":
      return "건강과 가족, 이후의 삶을 함께 헤아리는 순간에도";
    default:
      return "가정과 일터의 책임이 무겁게 느껴지는 순간에도";
  }
}

function audienceSituationContext(situation: string | undefined): string {
  const normalized = situation?.trim() || "일반";
  return (
    {
      일반: "일상의 예배와 삶에서",
      장례: "장례와 애도의 자리에서",
      개업: "새로운 사업을 시작하는 자리에서",
      취업: "취업을 감사하고 새 책임을 맞는 자리에서",
      이사: "새로운 거처와 삶의 터전을 맞는 자리에서",
      결혼: "결혼으로 한 가정을 이루는 자리에서",
      출산: "새 생명을 맞이하는 감사의 자리에서",
      자녀: "자녀를 위해 기도하고 돌보는 자리에서",
      학업: "배움과 시험을 감당하는 자리에서",
      진로: "앞날의 길을 분별하는 자리에서",
    } as Record<string, string>
  )[normalized] ?? `‘${normalized}’의 구체적인 삶의 자리에서`;
}

function buildPoint(
  request: GenerateSermonsRequest,
  angle: SermonAngle,
  pointIndex: number,
): SermonPoint {
  const { options, scripture } = request;
  const heading = POINT_TITLES[pointIndex] ?? `${pointIndex + 1}대지`;
  const example = audienceExample(options.audience);
  const situationContext = audienceSituationContext(options.audienceSituation);
  const referenceText = (
    request.reference.notes || request.reference.file?.text || ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  const developments = [
    `${scripture} 말씀은 우리에게 익숙한 종교적 문장을 더하라고 요구하지 않습니다. 오히려 ${angle.lens}을 선명하게 보라고 초대합니다. 믿음은 내가 하나님께 도달하는 사다리가 아니라, 하나님이 그리스도 안에서 우리에게 내려오신 은혜를 붙드는 손입니다.`,
    `우리가 마주하는 문제는 환경만이 아닙니다. 두려움 때문에 말씀보다 계산을 앞세우고, 상처 때문에 사랑보다 방어를 선택하는 마음이 더 깊은 문제입니다. 그러나 복음은 실패를 숨기라고 하지 않습니다. 십자가 앞에 정직하게 서면 성령께서 굳은 마음을 새롭게 하십니다.`,
    `${example} ${situationContext} 주님은 멀리 계시지 않습니다. 오늘 할 수 있는 순종 하나를 보여 주십니다. 한 사람에게 진심으로 사과하고, 미뤄 둔 기도를 다시 시작하고, 도움이 필요한 이에게 시간을 내어 주는 선택이 하나님 나라의 씨앗이 됩니다.`,
    `혼자서는 쉽게 지치지만 하나님은 우리를 공동체로 부르셨습니다. 서로의 짐을 나누고 말씀으로 격려할 때 개인의 결심은 공동체의 습관이 됩니다. 그 작은 충성이 쌓여 ${angle.movement}을 세상에 보여 줍니다.`,
  ];

  return {
    heading,
    content: `${developments[pointIndex] ?? developments[0]}\n\n${
      pointIndex === 0
        ? `그러므로 본문을 나의 형편에 맞추기 전에, 내 생각과 욕심을 본문 앞에 내려놓아야 합니다. ${options.sermonType} 설교의 중심은 정보가 아니라 하나님을 만나 변화되는 데 있습니다.`
        : `성령께 도움을 구하십시오. 완벽해진 뒤 순종하는 것이 아니라, 은혜를 의지해 순종할 때 주님이 우리의 부족함까지 사용하십니다.`
    }${
      pointIndex === 0 && referenceText
        ? `\n\n참고 자료가 짚어 준 “${referenceText}”의 관점도 본문 아래에서 분별해 볼 필요가 있습니다. 이 통찰이 본문의 중심을 대신하지 않도록 살피면서, 회중의 실제 삶과 연결해 봅시다.`
        : ""
    }`,
  };
}

function expandToTarget(
  sections: SermonAlternative["sections"],
  request: GenerateSermonsRequest,
  angle: SermonAngle,
): SermonAlternative["sections"] {
  const target = request.options.targetCharacters ?? 3_000;
  const next = structuredClone(sections);
  const length = () => [
    next.introduction,
    ...next.points.flatMap((point) => [point.heading, point.content]),
    next.conclusion,
    next.application,
  ].join("\n").length;
  let cursor = 0;
  while (length() < target * 0.9 && cursor < 30) {
    const point = next.points[cursor % next.points.length];
    const tension = PASTORAL_TENSIONS[cursor % PASTORAL_TENSIONS.length];
    const response = GOSPEL_RESPONSES[Math.floor(cursor / PASTORAL_TENSIONS.length) % GOSPEL_RESPONSES.length];
    const paragraph = [
      `${point.heading}이라는 고백을 삶에 비추어 보면, 우리는 ${tension}. 그러나 ${response}.`,
      `${angle.lens}이라는 본문의 중심은 생각을 아름답게 정리하는 데서 멈추지 않습니다. ${request.options.audience} 공동체가 ${audienceSituationContext(request.options.audienceSituation)} 마주하는 실제 선택 속에서, 두려움 대신 신뢰를 선택하도록 우리를 부릅니다.`,
      `이번 주에 반복해서 마주칠 한 장면을 떠올려 보십시오. 그 자리에서 ${angle.movement}을 위해 말 한마디와 시간 한 조각을 내어 드릴 수 있습니다. 순종의 크기보다 누구를 의지해 내딛는지가 중요하며, 주님은 작은 응답을 통해 우리의 습관과 관계를 천천히 새롭게 하십니다.`,
    ].join(" ");
    point.content = `${point.content}\n\n${paragraph}`;
    cursor += 1;
  }
  return next;
}

export function generateLocalSermons(
  request: GenerateSermonsRequest,
): SermonAlternative[] {
  return ANGLES.map((angle, index) => {
    const { options, scripture } = request;
    const points = Array.from(
      { length: options.pointCount ?? 3 },
      (_, pointIndex) => buildPoint(request, angle, pointIndex),
    );
    const title = `${angle.titleLead} ${options.topic}`;

    const sections: SermonAlternative["sections"] = {
      introduction: `사랑하는 성도 여러분, ${angle.image}을 떠올려 보십시오. 우리의 삶에도 멈춘 것 같고 답이 보이지 않는 때가 있습니다. ${audienceExample(options.audience)} 특히 ${audienceSituationContext(options.audienceSituation)} 우리는 “하나님이 정말 여기에도 계시는가”라고 묻게 됩니다.\n\n오늘 ${scripture} 말씀은 그 질문을 외면하지 않습니다. 하나님은 ${options.topic}을(를) 막연한 이상으로 남겨 두지 않으시고, 지금 우리의 자리에서 살아 낼 복음의 길로 보여 주십니다. 이 시간 말씀을 통해 ${angle.lens}을 발견하기 원합니다.`,
      points,
      conclusion: `사랑하는 성도 여러분, ${options.topic}은(는) 우리의 의지로 완성해야 할 무거운 숙제가 아닙니다. 예수 그리스도께서 십자가와 부활로 이미 새 길을 여셨고, 성령께서 오늘도 그 길을 걷도록 붙드십니다. 실패가 마지막 말이 아니며 현재의 형편이 하나님의 약속을 취소하지 못합니다.\n\n이제 두려움보다 약속을, 익숙함보다 순종을 선택합시다. 주님이 시작하신 선한 일을 주님이 이루실 것입니다.`,
      application: `이번 주에는 세 가지를 실천해 보십시오. 첫째, 매일 ${scripture} 말씀을 천천히 읽고 마음에 남는 한 문장을 기록하십시오. 둘째, ${angle.movement}을 실천할 한 사람과 한 행동을 정하십시오. 셋째, 잠들기 전 오늘의 순종과 망설임을 주님께 솔직히 말씀드리십시오.\n\n${angle.blessing}이 여러분의 가정과 일터와 공동체 위에 충만하기를 바랍니다. 말씀을 듣는 데서 멈추지 않고 삶으로 응답하는 우리 모두가 되기를 주님의 이름으로 축원합니다.`,
    };

    return {
      id: id("alternative", index + 1),
      title,
      summary: `${angle.lens}의 관점에서 ${options.topic}을(를) 풀어내고, ${options.audienceSituation} 상황의 ${options.audience}을 ${angle.movement}으로 초대하는 ${options.tone}의 설교입니다.`,
      scripture,
      sections: expandToTarget(sections, request, angle),
    };
  });
}

function revisionParagraph(request: ReviseSermonRequest): string {
  const instruction = `${request.instruction} ${request.toneAdjustment}`.toLowerCase();
  const topic = request.options.topic || "말씀의 주제";
  const scripture = request.sermon.scripture;

  if (instruction.includes("청년") || instruction.includes("대학")) {
    return `불확실한 진로와 관계 앞에서 청년들은 선택 하나가 인생 전체를 결정할 것 같은 부담을 느낍니다. 그러나 ${scripture} 말씀은 정답을 모두 안 뒤에 출발하라고 하지 않습니다. 오늘 비춰 주시는 한 걸음에 순종할 때, 주님은 막힌 길에서도 새로운 만남과 배움으로 우리를 인도하십니다.`;
  }
  if (instruction.includes("예화") || instruction.includes("이야기")) {
    return `한 농부가 오랜 가뭄에도 매일 밭에 나가 작은 수로를 돌보았습니다. 사람들은 비도 오지 않는데 헛수고라고 말했지만, 농부는 비가 오는 날 물이 흐를 길을 준비하고 있었습니다. 믿음도 이와 같습니다. ${topic}을(를) 붙들고 드리는 오늘의 작은 순종은 하나님의 때를 맞이할 길을 준비합니다.`;
  }
  if (instruction.includes("문제") || instruction.includes("해결")) {
    return `문제의 뿌리는 상황의 어려움만이 아니라 하나님 없이 스스로를 지키려는 마음에 있습니다. 해결은 더 강한 의지를 쌓는 데 있지 않습니다. 그리스도께서 이미 이루신 구원을 신뢰하고 성령의 도우심을 구할 때, 우리는 두려움에 끌려가는 대신 사랑으로 응답할 힘을 얻습니다.`;
  }
  if (instruction.includes("부드") || instruction.includes("위로")) {
    return `혹시 지금 충분히 잘하지 못했다는 생각에 마음이 무겁습니까. 주님은 지친 우리를 꾸짖기 위해 기다리는 분이 아니라 상한 갈대를 꺾지 않고 품으시는 분입니다. 천천히 다시 시작해도 괜찮습니다. 은혜는 우리의 속도보다 깊고, 하나님의 손은 우리의 넘어짐보다 강합니다.`;
  }
  if (instruction.includes("도전") || instruction.includes("강조")) {
    return `말씀을 이해했다면 이제 한 가지를 결단해야 합니다. 미루어 온 순종을 오늘 시작하십시오. 감정이 준비될 때까지 기다리지 말고, 가장 가까운 자리에서 사랑과 정직과 섬김을 선택하십시오. 주님은 순종하는 한 걸음을 통해 우리 자신과 공동체를 새롭게 하십니다.`;
  }

  return `${scripture} 말씀을 다시 마음에 새겨 봅시다. ${topic}은(는) 생각에 머무는 가치가 아니라 오늘의 말과 선택과 관계에서 드러나는 믿음입니다. 성령께서 각 사람에게 필요한 한 걸음을 깨닫게 하시고, 그 순종을 끝까지 이어 갈 힘도 더해 주실 것입니다.`;
}

export function reviseLocalSermon(request: ReviseSermonRequest): SermonAlternative {
  const sermon = structuredClone(request.sermon);
  const paragraph = revisionParagraph(request);
  const separator = "\n\n";

  switch (request.section) {
    case "introduction":
      sermon.sections.introduction = `${paragraph}${separator}${sermon.sections.introduction}`;
      break;
    case "body":
      sermon.sections.points = sermon.sections.points.map((point, index) =>
        index === 0
          ? { ...point, content: `${point.content}${separator}${paragraph}` }
          : point,
      );
      break;
    case "conclusion":
      sermon.sections.conclusion = `${sermon.sections.conclusion}${separator}${paragraph}`;
      break;
    case "application":
      sermon.sections.application = `${paragraph}${separator}${sermon.sections.application}`;
      break;
  }

  sermon.id = id("revision", request.revisionCount + 1);
  sermon.summary = `${sermon.summary} ${request.section === "body" ? "본론" : sectionLabel(request.section)}의 목회적 흐름을 보강했습니다.`;
  return sermon;
}

function sectionLabel(section: ReviseSermonRequest["section"]): string {
  return (
    {
      introduction: "도입",
      body: "본론",
      conclusion: "결론",
      application: "적용",
    } as const
  )[section];
}
